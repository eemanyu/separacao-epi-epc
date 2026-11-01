import { api, escapar, formatarData, formatarNumero, iniciarSininho, mostrarToast } from './comum.js';

const parametros = new URLSearchParams(window.location.search);
const mobilizacaoId = parametros.get('id');
const conteudo = document.getElementById('conteudo');

let mobilizacao = null;
let separacao = null;
let operador = '';
let temporizadorItens = null;
let temporizadorOperador = null;
let pendentesSalvar = new Map();
let salvamentoEmCurso = null;

iniciarSininho();

/* ---------------- carregamento ---------------- */

async function carregar() {
  if (!mobilizacaoId) {
    renderErro('Mobilização não informada na URL.');
    return;
  }
  try {
    mobilizacao = await api(`/api/mobilizacoes/${encodeURIComponent(mobilizacaoId)}`);
    separacao = mobilizacao.separacao
      ? await api(`/api/separacoes/${encodeURIComponent(mobilizacao.separacao.id)}`)
      : null;
    operador = separacao?.operador || localStorage.getItem('operador-separacao') || '';

    if (!separacao) renderPendente();
    else if (separacao.status === 'enviada') renderEnviada();
    else renderFormulario();
  } catch (falha) {
    renderErro(falha.message);
  }
}

/* ---------------- blocos comuns ---------------- */

function cabecalho() {
  const status = mobilizacao.status;
  return `
    <div class="cabecalho-mobilizacao">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <h1>${escapar(mobilizacao.nome)}</h1>
          <span class="id">${escapar(mobilizacao.id)}</span>
        </div>
        <span class="selo selo-${escapar(status)}">${escapar(status === 'em_separacao' ? 'Em separação' : status === 'concluida' ? 'Concluída' : status === 'cancelada' ? 'Cancelada' : 'Pendente')}</span>
      </div>
      <div class="meta">
        <span><b>${formatarNumero(mobilizacao.itens_total)}</b> item(ns)</span>
        ${mobilizacao.obra ? `<span>Obra <b>${escapar(mobilizacao.obra)}</b></span>` : ''}
        ${mobilizacao.solicitante ? `<span>Solicitante <b>${escapar(mobilizacao.solicitante)}</b></span>` : ''}
        <span>Recebida em <b>${formatarData(mobilizacao.criada_em)}</b></span>
        ${separacao ? `<span>Separação <b class="id">${escapar(separacao.id)}</b></span>` : ''}
      </div>
    </div>`;
}

function tabelaPedido(itens) {
  return `
    <div class="tabela-wrap">
      <table class="tabela">
        <thead>
          <tr><th>Linha</th><th>Código</th><th>Material</th><th>Un.</th><th class="num">Quantidade</th></tr>
        </thead>
        <tbody>
          ${itens.map((item) => `
            <tr>
              <td class="cod">${item.linha}</td>
              <td class="cod">${escapar(item.codigo ?? '—')}</td>
              <td>${escapar(item.descricao)}${item.observacao ? `<div class="cod">${escapar(item.observacao)}</div>` : ''}</td>
              <td>${escapar(item.unidade ?? '—')}</td>
              <td class="num"><b>${formatarNumero(item.quantidade_solicitada)}</b></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function situacao(item) {
  if (item.disponivel === null) return ['Pendente', 'selo-pendente'];
  if (item.disponivel === false) return ['Sem estoque', 'selo-nao'];
  if ((item.quantidade_separada ?? 0) < item.quantidade_solicitada) return ['Parcial', 'selo-parcial'];
  return ['Disponível', 'selo-ok'];
}

function tabelaResultado(itens) {
  return `
    <div class="tabela-wrap">
      <table class="tabela">
        <thead>
          <tr><th>Linha</th><th>Código</th><th>Material</th><th class="num">Solicitado</th><th>Situação</th><th class="num">Separado</th><th>Patrimônios</th><th>Obs.</th></tr>
        </thead>
        <tbody>
          ${itens.map((item) => {
            const [rotulo, classe] = situacao(item);
            const patrimonios = Array.isArray(item.patrimonios) ? item.patrimonios.join(', ') : (item.patrimonios ?? '');
            return `
              <tr>
                <td class="cod">${item.linha}</td>
                <td class="cod">${escapar(item.codigo ?? '—')}</td>
                <td>${escapar(item.descricao)}</td>
                <td class="num">${formatarNumero(item.quantidade_solicitada)}${item.unidade ? ` ${escapar(item.unidade)}` : ''}</td>
                <td><span class="selo ${classe}">${rotulo}</span></td>
                <td class="num">${item.disponivel ? formatarNumero(item.quantidade_separada ?? 0) : '—'}</td>
                <td>${escapar(patrimonios || '—')}</td>
                <td>${escapar(item.observacao || '—')}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function resumoCards(resumo) {
  return `
    <div class="resumo-conclusao">
      <div><b>${formatarNumero(resumo.itens_total)}</b><span>Itens conferidos</span></div>
      <div><b>${formatarNumero(resumo.disponiveis)}</b><span>Disponíveis</span></div>
      <div><b>${formatarNumero(resumo.parciais)}</b><span>Parciais</span></div>
      <div><b>${formatarNumero(resumo.sem_estoque)}</b><span>Sem estoque</span></div>
    </div>`;
}

/* ---------------- estados da tela ---------------- */

function renderPendente() {
  conteudo.innerHTML = `
    ${cabecalho()}
    <div class="painel" style="margin-bottom:18px;display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap">
      <div>
        <h2>Pronto para separar?</h2>
        <p style="margin:0">Confira cada material abaixo e registre o que existe em estoque.</p>
      </div>
      <button type="button" class="btn btn-primario btn-grande" id="iniciar">Iniciar separação</button>
    </div>
    ${tabelaPedido(mobilizacao.itens)}`;

  document.getElementById('iniciar').addEventListener('click', async (evento) => {
    const botao = evento.currentTarget;
    botao.disabled = true;
    botao.textContent = 'Abrindo…';
    try {
      await api(`/api/mobilizacoes/${encodeURIComponent(mobilizacao.id)}/separacao`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      await carregar();
    } catch (falha) {
      botao.disabled = false;
      botao.textContent = 'Iniciar separação';
      mostrarToast(falha.message, 'erro');
    }
  });
}

function renderFormulario() {
  const itens = separacao.itens;
  conteudo.innerHTML = `
    ${cabecalho()}
    <div class="painel" style="margin-bottom:18px">
      <h2>Responsável pela separação</h2>
      <p>Seu nome será registrado no retorno para o sistema de origem.</p>
      <div class="formulario">
        <div class="campo">
          <label for="operador">Operador</label>
          <input id="operador" type="text" autocomplete="name" placeholder="Nome de quem separou" value="${escapar(operador)}">
        </div>
        <div class="campo">
          <label for="observacao-geral">Observação geral (opcional)</label>
          <input id="observacao-geral" type="text" placeholder="Ex.: material retirado do almoxarifado 2" value="${escapar(separacao.observacao ?? '')}">
        </div>
      </div>
    </div>

    <div id="itens">${itens.map(cardItem).join('')}</div>

    <div class="barra-acoes">
      <div class="progresso-area">
        <div class="texto"><span id="progresso-texto"></span><span id="progresso-pct"></span></div>
        <div class="progresso"><span id="progresso-barra" style="width:0%"></span></div>
      </div>
      <span class="salvando" id="estado-salvamento"></span>
      <button type="button" class="btn btn-primario btn-grande" id="enviar">Concluir separação</button>
    </div>`;

  document.getElementById('operador').addEventListener('input', (evento) => {
    operador = evento.target.value.trim();
    localStorage.setItem('operador-separacao', operador);
    clearTimeout(temporizadorOperador);
    temporizadorOperador = setTimeout(() => salvarRascunho({ operador }), 600);
  });

  document.getElementById('observacao-geral').addEventListener('input', (evento) => {
    separacao.observacao = evento.target.value;
    clearTimeout(temporizadorOperador);
    temporizadorOperador = setTimeout(() => salvarRascunho({ observacao: separacao.observacao }), 600);
  });

  const areaItens = document.getElementById('itens');

  areaItens.addEventListener('click', (evento) => {
    const botao = evento.target.closest('.alternador button');
    if (!botao) return;
    const cartao = botao.closest('.item');
    const item = acharItem(cartao.dataset.item);
    const marcarTem = botao.dataset.valor === '1';

    item.disponivel = marcarTem;
    if (marcarTem) {
      if (!item.quantidade_separada) item.quantidade_separada = item.quantidade_solicitada;
    } else {
      item.quantidade_separada = 0;
      item.patrimonios = [];
    }
    atualizarCartao(cartao, item);
    atualizarProgresso();
    agendarSalvar(item);
  });

  areaItens.addEventListener('input', (evento) => {
    const campo = evento.target.dataset.campo;
    if (!campo) return;
    const cartao = evento.target.closest('.item');
    const item = acharItem(cartao.dataset.item);

    if (campo === 'quantidade_separada') {
      item.quantidade_separada = evento.target.value === '' ? null : Number(evento.target.value);
      atualizarProgresso();
    } else if (campo === 'patrimonios') {
      item.patrimonios = evento.target.value.split(',').map((p) => p.trim()).filter(Boolean);
    } else if (campo === 'observacao') {
      item.observacao = evento.target.value;
    }
    agendarSalvar(item);
  });

  areaItens.addEventListener('change', (evento) => {
    if (evento.target.dataset.campo !== 'quantidade_separada') return;
    const cartao = evento.target.closest('.item');
    const item = acharItem(cartao.dataset.item);
    const valor = Number(evento.target.value);
    if (Number.isFinite(valor) && valor > item.quantidade_solicitada) {
      item.quantidade_separada = item.quantidade_solicitada;
      evento.target.value = String(item.quantidade_solicitada);
      mostrarToast('Quantidade ajustada ao total solicitado.');
      agendarSalvar(item);
    }
  });

  document.getElementById('enviar').addEventListener('click', enviar);

  atualizarProgresso();
}

function cardItem(item) {
  const tem = item.disponivel === true;
  const classe = item.disponivel === null ? '' : tem ? 'tem' : 'nao-tem';
  const patrimonios = Array.isArray(item.patrimonios) ? item.patrimonios.join(', ') : (item.patrimonios ?? '');
  const quantidade = item.disponivel === false ? '' : (item.quantidade_separada ?? '');

  return `
    <article class="item ${classe}" data-item="${item.mobilizacao_item_id}" data-linha="${item.linha}">
      <div class="item-cabecalho">
        <div>
          <div class="item-titulo">
            <span class="linha">#${item.linha}</span>
            <strong>${escapar(item.descricao)}</strong>
          </div>
          <div class="item-codigos">
            ${item.codigo ? `Código: ${escapar(item.codigo)}` : 'Sem código'}
            ${item.unidade ? ` · Unidade: ${escapar(item.unidade)}` : ''}
            ${item.observacao_material ? ` · ${escapar(item.observacao_material)}` : ''}
          </div>
        </div>
        <div class="item-solicitado">
          Solicitado
          <b>${formatarNumero(item.quantidade_solicitada)}${item.unidade ? ` ${escapar(item.unidade)}` : ''}</b>
        </div>
      </div>
      <div class="item-form">
        <div class="campo">
          <label>Estoque</label>
          <div class="alternador" role="group" aria-label="Disponibilidade do item ${escapar(item.descricao)}">
            <button type="button" data-valor="1" aria-pressed="${tem}">Tem</button>
            <button type="button" data-valor="0" aria-pressed="${item.disponivel === false}">Não tem</button>
          </div>
        </div>
        <div class="campo">
          <label>Qtd. separada</label>
          <input type="number" inputmode="decimal" min="0" step="any" max="${item.quantidade_solicitada}"
                 data-campo="quantidade_separada" value="${escapar(quantidade)}"
                 ${tem ? '' : 'disabled'} placeholder="${tem ? '' : '—'}">
        </div>
        <div class="campo">
          <label>Patrimônios</label>
          <input type="text" data-campo="patrimonios" value="${escapar(patrimonios)}"
                 ${tem ? '' : 'disabled'} placeholder="Ex.: 12345, 67890">
        </div>
        <div class="campo obs">
          <label>Observação</label>
          <input type="text" data-campo="observacao" value="${escapar(item.observacao ?? '')}" placeholder="Opcional">
        </div>
      </div>
    </article>`;
}

function atualizarCartao(cartao, item) {
  const tem = item.disponivel === true;
  cartao.classList.toggle('tem', tem);
  cartao.classList.toggle('nao-tem', item.disponivel === false);

  const alternador = cartao.querySelector('.alternador');
  alternador.querySelector('[data-valor="1"]').setAttribute('aria-pressed', String(tem));
  alternador.querySelector('[data-valor="0"]').setAttribute('aria-pressed', String(item.disponivel === false));

  const quantidade = cartao.querySelector('[data-campo="quantidade_separada"]');
  const patrimonios = cartao.querySelector('[data-campo="patrimonios"]');
  quantidade.disabled = !tem;
  patrimonios.disabled = !tem;
  quantidade.value = tem ? String(item.quantidade_separada ?? '') : '';
  patrimonios.value = tem ? (item.patrimonios ?? []).join(', ') : '';
}

function acharItem(id) {
  const item = separacao.itens.find((candidato) => String(candidato.mobilizacao_item_id) === String(id));
  if (!item) throw new Error(`Item ${id} não encontrado na separação.`);
  return item;
}

/* ---------------- salvamento ---------------- */

function agendarSalvar(item) {
  pendentesSalvar.set(item.mobilizacao_item_id, item);
  clearTimeout(temporizadorItens);
  temporizadorItens = setTimeout(() => { salvarPendentes().catch(() => {}); }, 700);
}

async function salvarPendentes() {
  if (salvamentoEmCurso) await salvamentoEmCurso.catch(() => {});
  if (!pendentesSalvar.size) return;

  const lote = [...pendentesSalvar.values()];
  pendentesSalvar.clear();
  marcarSalvamento('Salvando…');

  salvamentoEmCurso = (async () => {
    try {
      await api(`/api/separacoes/${encodeURIComponent(separacao.id)}`, {
        method: 'PUT',
        body: JSON.stringify({
          operador: operador || null,
          itens: lote.map((item) => ({
            mobilizacao_item_id: item.mobilizacao_item_id,
            disponivel: item.disponivel,
            quantidade_separada: item.quantidade_separada,
            patrimonios: item.patrimonios,
            observacao: item.observacao,
          })),
        }),
      });
      marcarSalvamento('Salvo');
    } catch (falha) {
      for (const item of lote) {
        if (!pendentesSalvar.has(item.mobilizacao_item_id)) pendentesSalvar.set(item.mobilizacao_item_id, item);
      }
      marcarSalvamento('Não salvo');
      mostrarToast(falha.message, 'erro');
      throw falha;
    } finally {
      salvamentoEmCurso = null;
    }
  })();

  await salvamentoEmCurso;
  if (pendentesSalvar.size) await salvarPendentes();
}

async function salvarRascunho(extra) {
  try {
    await api(`/api/separacoes/${encodeURIComponent(separacao.id)}`, {
      method: 'PUT',
      body: JSON.stringify(extra),
    });
    marcarSalvamento('Salvo');
    return true;
  } catch (falha) {
    marcarSalvamento('Não salvo');
    mostrarToast(falha.message, 'erro');
    return false;
  }
}

function marcarSalvamento(texto) {
  const elemento = document.getElementById('estado-salvamento');
  if (elemento) elemento.textContent = texto;
}

function atualizarProgresso() {
  const total = separacao.itens.length;
  const conferidos = separacao.itens.filter((item) => item.disponivel !== null).length;
  const percentual = total ? Math.round((conferidos / total) * 100) : 0;
  const texto = document.getElementById('progresso-texto');
  const pct = document.getElementById('progresso-pct');
  const barra = document.getElementById('progresso-barra');
  if (texto) texto.textContent = `${conferidos} de ${total} conferidos`;
  if (pct) pct.textContent = `${percentual}%`;
  if (barra) barra.style.width = `${percentual}%`;
}

/* ---------------- envio ---------------- */

async function enviar() {
  clearTimeout(temporizadorItens);
  clearTimeout(temporizadorOperador);
  try {
    await salvarPendentes();
  } catch {
    /* o toast já foi exibido */
  }
  if (pendentesSalvar.size) {
    mostrarToast('Ainda há alterações não salvas. Verifique a conexão e tente novamente.', 'erro');
    return;
  }

  operador = (document.getElementById('operador')?.value ?? operador).trim();
  if (!operador) {
    mostrarToast('Informe o nome do operador antes de concluir.', 'erro');
    document.getElementById('operador')?.focus();
    return;
  }
  if (!(await salvarRascunho({ operador }))) return;

  const naoConferidos = separacao.itens.filter((item) => item.disponivel === null);
  if (naoConferidos.length) {
    mostrarToast(`Ainda faltam ${naoConferidos.length} item(ns) para conferir.`, 'erro');
    return;
  }

  const semEstoque = separacao.itens.filter((item) => item.disponivel === false).length;
  const parciais = separacao.itens.filter((item) => item.disponivel === true && item.quantidade_separada < item.quantidade_solicitada).length;
  const mensagem = [
    'Concluir a separação?',
    '',
    `${separacao.itens.length} itens conferidos · ${semEstoque} sem estoque · ${parciais} parciais`,
    '',
    'Depois de enviada, a separação não poderá ser alterada.',
  ].join('\n');
  if (!window.confirm(mensagem)) return;

  const botao = document.getElementById('enviar');
  botao.disabled = true;
  botao.textContent = 'Enviando…';

  try {
    const resultado = await api(`/api/separacoes/${encodeURIComponent(separacao.id)}/enviar`, { method: 'POST' });
    separacao = resultado.separacao;
    mobilizacao.status = 'concluida';
    renderSucesso(resultado.payload);
  } catch (falha) {
    botao.disabled = false;
    botao.textContent = 'Concluir separação';
    mostrarToast(falha.message, 'erro');
  }
}

function renderEnviada() {
  const resumo = {
    itens_total: separacao.itens.length,
    disponiveis: separacao.itens.filter((item) => item.disponivel === true && item.quantidade_separada >= item.quantidade_solicitada).length,
    parciais: separacao.itens.filter((item) => item.disponivel === true && item.quantidade_separada < item.quantidade_solicitada).length,
    sem_estoque: separacao.itens.filter((item) => item.disponivel === false).length,
  };
  renderSucesso(null, resumo);
}

function renderSucesso(payload, resumoCalculado) {
  const resumo = payload?.resumo ?? resumoCalculado;
  const itens = payload?.itens ?? separacao.itens;
  const enviadaEm = payload?.enviada_em ?? separacao.enviada_em;

  conteudo.innerHTML = `
    ${cabecalho()}
    <div class="painel sucesso" style="margin-bottom:18px">
      <div class="icone">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="30" height="30" aria-hidden="true"><path d="m5 13 4 4L19 7"/></svg>
      </div>
      <h1>Separação concluída</h1>
      <p>
        Registrada em ${formatarData(enviadaEm)}${payload?.operador ? ` por ${escapar(payload.operador)}` : ''}.<br>
        ID da separação: <span class="codigo">${escapar(separacao.id)}</span>
      </p>
      <div class="acoes">
        <a class="btn btn-fantasma" href="/">Voltar para mobilizações</a>
        <button type="button" class="btn btn-fantasma" onclick="window.print()">Imprimir</button>
      </div>
    </div>
    ${resumoCards(resumo)}
    ${tabelaResultado(itens)}`;
}

function renderErro(mensagem) {
  conteudo.innerHTML = `
    <div class="painel">
      <h2>Não foi possível abrir a mobilização</h2>
      <p>${escapar(mensagem)}</p>
      <a class="btn btn-fantasma" href="/">Voltar para mobilizações</a>
    </div>`;
}

carregar();
