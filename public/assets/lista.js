import { api, escapar, formatarData, formatarNumero, iniciarSininho, mostrarToast, rotuloStatus } from './comum.js';

const estado = { filtro: 'abertas', carregando: false };
const lista = document.getElementById('lista');

iniciarSininho();

function card(mobilizacao) {
  const total = mobilizacao.itens_total || 0;
  const conferidos = mobilizacao.separacao_id ? mobilizacao.conferidos || 0 : 0;
  const percentual = total ? Math.round((conferidos / total) * 100) : 0;
  const status = mobilizacao.status;

  return `
    <a class="card" href="/mobilizacao.html?id=${encodeURIComponent(mobilizacao.id)}">
      <div class="card-topo">
        <div>
          <h2>${escapar(mobilizacao.nome)}</h2>
          <span class="id">${escapar(mobilizacao.id)}</span>
        </div>
        <span class="selo selo-${escapar(status)}">${escapar(rotuloStatus(status))}</span>
      </div>
      <div class="card-meta">
        <span>${formatarNumero(total)} item(ns)</span>
        ${mobilizacao.obra ? `<span>Obra: ${escapar(mobilizacao.obra)}</span>` : ''}
        ${mobilizacao.operador ? `<span>Operador: ${escapar(mobilizacao.operador)}</span>` : ''}
      </div>
      <div class="card-rodape">
        <div class="linha-info">
          <span>${status === 'concluida' ? 'Separação concluída' : 'Itens conferidos'}</span>
          <span>${status === 'concluida' ? formatarNumero(total) : formatarNumero(conferidos)} / ${formatarNumero(total)}</span>
        </div>
        <div class="progresso"><span style="width:${status === 'concluida' ? 100 : percentual}%"></span></div>
        <div class="linha-info">
          <span>Recebida em ${formatarData(mobilizacao.criada_em)}</span>
        </div>
      </div>
    </a>`;
}

async function carregar() {
  if (estado.carregando) return;
  estado.carregando = true;
  try {
    const consulta = estado.filtro ? `?status=${encodeURIComponent(estado.filtro)}` : '';
    const { mobilizacoes } = await api(`/api/mobilizacoes${consulta}`);

    if (!mobilizacoes.length) {
      lista.innerHTML = estado.filtro === 'concluida'
        ? '<div class="vazio"><strong>Nenhuma separação concluída ainda.</strong>As mobilizações finalizadas aparecem aqui.</div>'
        : '<div class="vazio"><strong>Tudo em dia por aqui.</strong>Quando uma nova mobilização for enviada, ela aparece nesta lista e no sininho.</div>';
      return;
    }
    lista.innerHTML = mobilizacoes.map(card).join('');
  } catch (falha) {
    lista.innerHTML = `<div class="vazio"><strong>Não foi possível carregar.</strong>${escapar(falha.message)}</div>`;
    mostrarToast(falha.message, 'erro');
  } finally {
    estado.carregando = false;
  }
}

document.querySelectorAll('[data-filtro]').forEach((chip) => {
  chip.addEventListener('click', () => {
    estado.filtro = chip.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach((outro) => {
      outro.setAttribute('aria-selected', String(outro === chip));
    });
    carregar();
  });
});

document.getElementById('atualizar').addEventListener('click', carregar);
window.addEventListener('focus', carregar);
setInterval(() => {
  if (document.visibilityState === 'visible') carregar();
}, 20_000);

carregar();
