const ROTULOS = {
  pendente: 'Pendente',
  em_separacao: 'Em separação',
  concluida: 'Concluída',
  cancelada: 'Cancelada',
  rascunho: 'Em separação',
  enviada: 'Enviada',
};

export function escapar(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[caractere]);
}

export function rotuloStatus(status) {
  return ROTULOS[status] ?? status;
}

export function formatarData(iso) {
  if (!iso) return '—';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(data);
}

export function formatarNumero(valor) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(valor) || 0);
}

export async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: {
      ...(opcoes.body ? { 'content-type': 'application/json' } : {}),
      ...(opcoes.headers ?? {}),
    },
  });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const falha = new Error(corpo?.erro ?? `Falha na comunicação (${resposta.status}).`);
    falha.status = resposta.status;
    falha.codigo = corpo?.codigo;
    falha.detalhes = corpo?.detalhes;
    throw falha;
  }
  return corpo;
}

let temporizadorToast;
export function mostrarToast(mensagem, tipo = '') {
  let elemento = document.getElementById('toast');
  if (!elemento) {
    elemento = document.createElement('div');
    elemento.id = 'toast';
    document.body.append(elemento);
  }
  elemento.textContent = mensagem;
  elemento.className = tipo === 'erro' ? 'erro visivel' : 'visivel';
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => { elemento.className = tipo === 'erro' ? 'erro' : ''; }, 4000);
}

/* ---------------- sino de notificações ---------------- */

const ICONE_SINO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>`;

export function iniciarSininho() {
  const alvo = document.querySelector('[data-sino]');
  if (!alvo) return;

  alvo.className = 'sino-wrap';
  alvo.innerHTML = `
    <button class="sino" id="sino-botao" aria-label="Notificações" aria-expanded="false" aria-haspopup="true">
      ${ICONE_SINO}
      <span class="sino-badge" id="sino-badge"></span>
    </button>
    <div class="painel-notificacoes" id="painel-notificacoes" role="dialog" aria-label="Notificações">
      <div class="painel-cabecalho">
        <strong>Notificações</strong>
        <button type="button" id="marcar-todas">Marcar todas como lidas</button>
      </div>
      <div class="lista-notificacoes" id="lista-notificacoes"></div>
    </div>`;

  const botao = alvo.querySelector('#sino-botao');
  const painel = alvo.querySelector('#painel-notificacoes');
  const badge = alvo.querySelector('#sino-badge');
  const lista = alvo.querySelector('#lista-notificacoes');

  async function atualizarResumo() {
    try {
      const resumo = await api('/api/notificacoes/resumo');
      badge.textContent = resumo.nao_lidas > 99 ? '99+' : String(resumo.nao_lidas);
      badge.classList.toggle('ativo', resumo.nao_lidas > 0);
    } catch {
      /* sem rede: mantém o último estado */
    }
  }

  async function carregarLista() {
    lista.innerHTML = '<div class="painel-vazio">Carregando…</div>';
    try {
      const { notificacoes } = await api('/api/notificacoes?limite=40');
      if (!notificacoes.length) {
        lista.innerHTML = '<div class="painel-vazio">Nenhuma notificação por aqui.</div>';
        return;
      }
      lista.innerHTML = notificacoes.map((n) => `
        <button class="notificacao ${n.lida_em ? '' : 'nao-lida'}" data-id="${escapar(n.id)}" data-mobilizacao="${escapar(n.mobilizacao_id)}">
          <strong>${escapar(n.titulo)}</strong>
          <span>${escapar(n.mensagem ?? '')}</span>
          <time>${formatarData(n.criada_em)}</time>
        </button>`).join('');
    } catch (falha) {
      lista.innerHTML = `<div class="painel-vazio">${escapar(falha.message)}</div>`;
    }
  }

  function fechar() {
    painel.classList.remove('aberto');
    botao.setAttribute('aria-expanded', 'false');
  }

  botao.addEventListener('click', async (evento) => {
    evento.stopPropagation();
    const aberto = painel.classList.toggle('aberto');
    botao.setAttribute('aria-expanded', String(aberto));
    if (aberto) await carregarLista();
  });

  painel.addEventListener('click', async (evento) => {
    const item = evento.target.closest('.notificacao');
    if (!item) return;
    try {
      await api(`/api/notificacoes/${encodeURIComponent(item.dataset.id)}/lida`, { method: 'POST' });
    } catch {
      /* navega mesmo assim */
    }
    window.location.href = `/mobilizacao.html?id=${encodeURIComponent(item.dataset.mobilizacao)}`;
  });

  alvo.querySelector('#marcar-todas').addEventListener('click', async (evento) => {
    evento.stopPropagation();
    try {
      await api('/api/notificacoes/lidas', { method: 'POST' });
      await Promise.all([carregarLista(), atualizarResumo()]);
    } catch (falha) {
      mostrarToast(falha.message, 'erro');
    }
  });

  document.addEventListener('click', (evento) => {
    if (!alvo.contains(evento.target)) fechar();
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') fechar();
  });

  atualizarResumo();
  setInterval(atualizarResumo, 15_000);
  window.addEventListener('focus', atualizarResumo);
}
