import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { abrirBanco } from '../src/lib/db.js';
import { criarApp } from '../src/app.js';
import { config } from '../src/lib/config.js';
import { assinar } from '../src/lib/webhook.js';
import { entregarPendentes } from '../src/lib/webhook.js';
import { parseNumero, textoCelula } from '../src/lib/planilha.js';

const temporarios = [];

after(() => {
  for (const pasta of temporarios) rmSync(pasta, { recursive: true, force: true });
});

async function subirApp(overrides = {}) {
  const uploads = mkdtempSync(path.join(tmpdir(), 'sep-uploads-'));
  temporarios.push(uploads);
  const db = abrirBanco(':memory:');
  const cfg = {
    ...config,
    uploads,
    chaveApi: 'chave-teste',
    webhookUrl: '',
    webhookSegredo: '',
    permitirUploadUi: true,
    ...overrides,
  };
  const app = criarApp({ db, cfg });
  const servidor = app.listen(0);
  await once(servidor, 'listening');
  const base = `http://127.0.0.1:${servidor.address().port}`;
  return {
    db,
    cfg,
    base,
    fechar: () => new Promise((resolver) => servidor.close(resolver)),
  };
}

async function planilha(itens = [
  ['EPI-001', 'Capacete classe B', 'un', 12, ''],
  ['EPI-002', 'Luva de vaqueta', 'par', 24, ''],
  ['EPC-010', 'Cone de sinalizacao', 'un', 10, 'Refletivo'],
], cabecalho = ['Código', 'Descrição do Material', 'Unidade', 'Quantidade', 'Observação']) {
  const livro = new ExcelJS.Workbook();
  const aba = livro.addWorksheet('Mobilização');
  aba.addRow(['TITULO QUALQUER']);
  aba.addRow(cabecalho);
  for (const item of itens) aba.addRow(item);
  return Buffer.from(await livro.xlsx.writeBuffer());
}

function formulario(buffer, campos = {}) {
  const dados = new FormData();
  dados.set('arquivo', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'mob.xlsx');
  for (const [chave, valor] of Object.entries(campos)) dados.set(chave, valor);
  return dados;
}

async function enviarPlanilha(base, { buffer, campos = {}, rota = '/api/mobilizacoes', chave } = {}) {
  return fetch(`${base}${rota}`, {
    method: 'POST',
    body: formulario(buffer ?? (await planilha()), campos),
    headers: chave ? { 'x-api-key': chave } : {},
  });
}

async function json(resposta) {
  return resposta.json();
}

test('leitura da planilha reconhece acentos, titulo acima do cabecalho e numeros', async () => {
  const { db, base, fechar } = await subirApp();
  try {
    const resposta = await enviarPlanilha(base, {
      campos: { mobilizacao_id: 'MOB-TESTE-1', nome: 'Obra Norte' },
    });
    assert.equal(resposta.status, 201);
    const corpo = await json(resposta);
    assert.equal(corpo.id, 'MOB-TESTE-1');
    assert.equal(corpo.itens_total, 3);
    assert.equal(corpo.itens[0].linha, 3);
    assert.equal(corpo.itens[0].descricao, 'Capacete classe B');
    assert.equal(corpo.itens[0].quantidade_solicitada, 12);

    const notificacao = db.prepare('SELECT * FROM notificacoes WHERE mobilizacao_id = ?').get('MOB-TESTE-1');
    assert.ok(notificacao);
    assert.equal(notificacao.lida_em, null);

    const lista = await json(await fetch(`${base}/api/mobilizacoes?status=abertas`));
    assert.equal(lista.mobilizacoes.length, 1);
    assert.equal(lista.mobilizacoes[0].conferidos, 0);
  } finally {
    await fechar();
  }
});

test('planilha invalida devolve 422 com o problema da linha', async () => {
  const { base, fechar } = await subirApp();
  try {
    const buffer = await planilha([['EPI-001', 'Capacete', 'un', 'abc', '']]);
    const resposta = await enviarPlanilha(base, { buffer });
    assert.equal(resposta.status, 422);
    const corpo = await json(resposta);
    assert.equal(corpo.codigo, 'planilha_invalida');
    assert.match(corpo.detalhes.problemas[0], /linha 3/);
  } finally {
    await fechar();
  }
});

test('arquivo .xls e recusado com mensagem clara', async () => {
  const { base, fechar } = await subirApp();
  try {
    const dados = new FormData();
    dados.set('arquivo', new Blob([Buffer.from('antigo')]), 'mob.xls');
    const resposta = await fetch(`${base}/api/mobilizacoes`, { method: 'POST', body: dados });
    assert.equal(resposta.status, 400);
    assert.equal((await json(resposta)).codigo, 'arquivo_invalido');
  } finally {
    await fechar();
  }
});

test('upload pela API de integracao exige X-API-Key e impede ID duplicado', async () => {
  const { base, fechar } = await subirApp();
  try {
    const semChave = await enviarPlanilha(base, { rota: '/api/integracao/mobilizacoes' });
    assert.equal(semChave.status, 401);

    const primeira = await enviarPlanilha(base, {
      rota: '/api/integracao/mobilizacoes',
      chave: 'chave-teste',
      campos: { mobilizacao_id: 'MOB-INT-1' },
    });
    assert.equal(primeira.status, 201);

    const duplicada = await enviarPlanilha(base, {
      rota: '/api/integracao/mobilizacoes',
      chave: 'chave-teste',
      campos: { mobilizacao_id: 'MOB-INT-1' },
    });
    assert.equal(duplicada.status, 409);
    assert.equal((await json(duplicada)).codigo, 'mobilizacao_duplicada');
  } finally {
    await fechar();
  }
});

test('fluxo completo: iniciar, salvar rascunho, validar e enviar', async () => {
  const { base, fechar } = await subirApp();
  try {
    await enviarPlanilha(base, { campos: { mobilizacao_id: 'MOB-FLUXO', nome: 'Fluxo' } });

    const inicio = await fetch(`${base}/api/mobilizacoes/MOB-FLUXO/separacao`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    assert.equal(inicio.status, 201);
    const separacao = await json(inicio);
    assert.equal(separacao.itens.length, 3);
    assert.equal(separacao.itens[0].disponivel, null);

    const semOperador = await fetch(`${base}/api/separacoes/${separacao.id}/enviar`, { method: 'POST' });
    assert.equal(semOperador.status, 422);

    const parcial = await fetch(`${base}/api/separacoes/${separacao.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operador: 'Maria',
        itens: [{ mobilizacao_item_id: separacao.itens[0].mobilizacao_item_id, disponivel: true, quantidade_separada: 5, patrimonios: ['12345', '67890'] }],
      }),
    });
    assert.equal(parcial.status, 200);
    const salvo = await json(parcial);
    assert.equal(salvo.itens[0].quantidade_separada, 5);
    assert.deepEqual(salvo.itens[0].patrimonios, ['12345', '67890']);
    assert.equal(salvo.itens[0].disponivel, true);

    const incompleto = await fetch(`${base}/api/separacoes/${separacao.id}/enviar`, { method: 'POST' });
    assert.equal(incompleto.status, 422);
    assert.equal((await json(incompleto)).codigo, 'conferencia_incompleta');

    const acima = await fetch(`${base}/api/separacoes/${separacao.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itens: [{ mobilizacao_item_id: separacao.itens[0].mobilizacao_item_id, disponivel: true, quantidade_separada: 999 }] }),
    });
    assert.equal(acima.status, 422);
    assert.equal((await json(acima)).codigo, 'quantidade_acima_do_solicitado');

    const todos = separacao.itens.map((item, indice) => ({
      mobilizacao_item_id: item.mobilizacao_item_id,
      disponivel: indice !== 2,
      quantidade_separada: indice === 1 ? 20 : item.quantidade_solicitada,
      patrimonios: indice === 1 ? ['A1'] : [],
    }));
    const salvarTudo = await fetch(`${base}/api/separacoes/${separacao.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itens: todos }),
    });
    assert.equal(salvarTudo.status, 200);

    const envio = await fetch(`${base}/api/separacoes/${separacao.id}/enviar`, { method: 'POST' });
    assert.equal(envio.status, 201);
    const resultado = await json(envio);
    assert.equal(resultado.payload.mobilizacao_id, 'MOB-FLUXO');
    assert.equal(resultado.payload.separacao_id, separacao.id);
    assert.equal(resultado.payload.resumo.itens_total, 3);
    assert.equal(resultado.payload.resumo.sem_estoque, 1);
    assert.equal(resultado.payload.resumo.parciais, 1);
    assert.equal(resultado.payload.itens[0].estoque_texto, 'Disponível (12/12 un)');
    assert.equal(resultado.payload.itens[1].estoque_texto, 'Parcial (20/24 par) - PAT: A1');
    assert.equal(resultado.payload.itens[2].estoque_texto, 'Sem estoque');

    const mobilizacao = await json(await fetch(`${base}/api/mobilizacoes/MOB-FLUXO`));
    assert.equal(mobilizacao.status, 'concluida');
    assert.equal(mobilizacao.separacao.status, 'enviada');

    const reenvio = await fetch(`${base}/api/separacoes/${separacao.id}/enviar`, { method: 'POST' });
    assert.equal(reenvio.status, 200);
    assert.equal((await json(reenvio)).ja_enviada, true);

    const alterarDepois = await fetch(`${base}/api/separacoes/${separacao.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itens: [] }),
    });
    assert.equal(alterarDepois.status, 409);

    const consulta = await fetch(`${base}/api/integracao/mobilizacoes/MOB-FLUXO/separacao`, { headers: { 'x-api-key': 'chave-teste' } });
    assert.equal(consulta.status, 200);
    const dados = await json(consulta);
    assert.equal(dados.concluida, true);
    assert.equal(dados.itens.length, 3);

    const semChave = await fetch(`${base}/api/integracao/mobilizacoes/MOB-FLUXO/separacao`);
    assert.equal(semChave.status, 401);
  } finally {
    await fechar();
  }
});

test('webhook assina o payload e marca a entrega como enviada', async () => {
  let recebido = null;
  const receptor = createServer((req, res) => {
    let corpo = '';
    req.on('data', (pedaco) => { corpo += pedaco; });
    req.on('end', () => {
      recebido = { corpo, assinatura: req.headers['x-assinatura'], entrega: req.headers['x-entrega-id'] };
      res.writeHead(204).end();
    });
  });
  receptor.listen(0);
  await once(receptor, 'listening');
  const urlWebhook = `http://127.0.0.1:${receptor.address().port}/webhook`;

  const { db, cfg, base, fechar } = await subirApp({ webhookUrl: urlWebhook, webhookSegredo: 'segredo-teste' });
  try {
    await enviarPlanilha(base, { campos: { mobilizacao_id: 'MOB-HOOK' } });
    const separacao = await json(await fetch(`${base}/api/mobilizacoes/MOB-HOOK/separacao`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }));
    const itens = separacao.itens.map((item) => ({
      mobilizacao_item_id: item.mobilizacao_item_id,
      disponivel: false,
      quantidade_separada: 0,
    }));
    await fetch(`${base}/api/separacoes/${separacao.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operador: 'Joao', itens }),
    });
    await fetch(`${base}/api/separacoes/${separacao.id}/enviar`, { method: 'POST' });

    const resultado = await entregarPendentes(db, cfg);
    assert.equal(resultado.enviados, 1);
    assert.ok(recebido);
    assert.equal(recebido.assinatura, assinar(recebido.corpo, 'segredo-teste'));
    const payload = JSON.parse(recebido.corpo);
    assert.equal(payload.mobilizacao_id, 'MOB-HOOK');
    assert.equal(payload.resumo.sem_estoque, 3);

    const entrega = db.prepare('SELECT * FROM webhook_entregas WHERE separacao_id = ?').get(separacao.id);
    assert.equal(entrega.status, 'enviado');
    assert.equal(entrega.resposta_status, 204);
  } finally {
    receptor.close();
    await fechar();
  }
});

test('funcoes de leitura de celula e numero', () => {
  assert.equal(parseNumero('12'), 12);
  assert.equal(parseNumero('12,5'), 12.5);
  assert.equal(parseNumero('1.234,56'), 1234.56);
  assert.equal(parseNumero('1,234.56'), 1234.56);
  assert.equal(parseNumero('1.234'), 1234);
  assert.equal(parseNumero('1.5'), 1.5);
  assert.equal(parseNumero('  '), null);
  assert.equal(parseNumero('abc'), null);
  assert.equal(textoCelula({ richText: [{ text: 'Ca' }, { text: 'pacete' }] }), 'Capacete');
  assert.equal(textoCelula({ formula: 'A1', result: 7 }), '7');
});
