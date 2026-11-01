import { transacao } from './db.js';
import { agoraIso, gerarIdMobilizacao, gerarIdNotificacao } from './ids.js';
import { erro, naoEncontrado } from './erros.js';

const STATUS_VALIDOS = ['pendente', 'em_separacao', 'concluida', 'cancelada'];

/**
 * Cria a mobilizacao + itens + notificacao do sininho numa unica transacao.
 * O ID vem do sistema de origem; se ausente, e gerado aqui.
 */
export function criarMobilizacao(db, dados) {
  const id = dados.id ?? gerarIdMobilizacao();
  const agora = agoraIso();
  const nome = (dados.nome ?? '').trim() || `Mobilização ${id}`;

  if (!dados.itens?.length) throw erro(422, 'sem_itens', 'A mobilização precisa de pelo menos um item.');

  return transacao(db, () => {
    const existente = db.prepare('SELECT id FROM mobilizacoes WHERE id = ?').get(id);
    if (existente) {
      throw erro(409, 'mobilizacao_duplicada', `Já existe uma mobilização com o id ${id}.`, { mobilizacao_id: id });
    }

    db.prepare(
      `INSERT INTO mobilizacoes
         (id, nome, obra, solicitante, status, arquivo_nome, arquivo_caminho, itens_total, criada_em, atualizada_em)
       VALUES (?, ?, ?, ?, 'pendente', ?, ?, ?, ?, ?)`,
    ).run(
      id,
      nome,
      dados.obra ?? null,
      dados.solicitante ?? null,
      dados.arquivoNome ?? null,
      dados.arquivoCaminho ?? null,
      dados.itens.length,
      agora,
      agora,
    );

    const inserirItem = db.prepare(
      `INSERT INTO mobilizacao_itens
         (mobilizacao_id, linha, codigo, descricao, unidade, quantidade_solicitada, observacao, dados_origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of dados.itens) {
      inserirItem.run(
        id,
        item.linha,
        item.codigo ?? null,
        item.descricao,
        item.unidade ?? null,
        item.quantidade_solicitada,
        item.observacao ?? null,
        item.dados_origem ?? null,
      );
    }

    const notificacaoId = gerarIdNotificacao();
    db.prepare(
      `INSERT INTO notificacoes (id, mobilizacao_id, tipo, titulo, mensagem, criada_em)
       VALUES (?, ?, 'mobilizacao_pendente', ?, ?, ?)`,
    ).run(
      notificacaoId,
      id,
      'Nova mobilização para separar',
      `${nome} - ${dados.itens.length} item(ns)`,
      agora,
    );

    return { ...obterMobilizacao(db, id), notificacao_id: notificacaoId };
  });
}

export function listarMobilizacoes(db, filtro = {}) {
  const status = filtro.status ?? null;
  if (status && status !== 'abertas' && !STATUS_VALIDOS.includes(status)) {
    throw erro(400, 'status_invalido', `status deve ser um de: ${STATUS_VALIDOS.join(', ')} ou "abertas".`);
  }

  const where = status === 'abertas'
    ? `m.status IN ('pendente', 'em_separacao')`
    : `(? IS NULL OR m.status = ?)`;

  return db
    .prepare(
      `SELECT m.id, m.nome, m.obra, m.solicitante, m.status, m.itens_total, m.criada_em, m.atualizada_em,
              s.id AS separacao_id, s.status AS separacao_status, s.operador,
              (SELECT COUNT(*) FROM separacao_itens si
                WHERE si.separacao_id = s.id AND si.disponivel IS NOT NULL) AS conferidos
         FROM mobilizacoes m
         LEFT JOIN separacoes s ON s.mobilizacao_id = m.id
        WHERE ${where}
        ORDER BY m.criada_em DESC`,
    )
    .all(...(status === 'abertas' ? [] : [status, status]));
}

export function obterMobilizacao(db, id) {
  const mobilizacao = db
    .prepare(
      `SELECT id, nome, obra, solicitante, status, arquivo_nome, itens_total, criada_em, atualizada_em
         FROM mobilizacoes WHERE id = ?`,
    )
    .get(id);
  if (!mobilizacao) throw naoEncontrado(`Mobilização ${id} não encontrada.`);

  const itens = db
    .prepare('SELECT * FROM mobilizacao_itens WHERE mobilizacao_id = ? ORDER BY linha')
    .all(id);

  const separacao = db.prepare('SELECT * FROM separacoes WHERE mobilizacao_id = ?').get(id) ?? null;
  if (separacao) {
    separacao.itens = db
      .prepare('SELECT * FROM separacao_itens WHERE separacao_id = ? ORDER BY mobilizacao_item_id')
      .all(separacao.id);
  }

  return { ...mobilizacao, itens, separacao };
}

export function contarPendentes(db) {
  return db
    .prepare(`SELECT COUNT(*) AS total FROM mobilizacoes WHERE status IN ('pendente', 'em_separacao')`)
    .get().total;
}
