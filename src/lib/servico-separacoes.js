import { transacao } from './db.js';
import { agoraIso, gerarIdEntrega, gerarIdSeparacao } from './ids.js';
import { erro, naoEncontrado } from './erros.js';

export function iniciarSeparacao(db, mobilizacaoId, operador = null) {
  const mobilizacao = db.prepare('SELECT * FROM mobilizacoes WHERE id = ?').get(mobilizacaoId);
  if (!mobilizacao) throw naoEncontrado(`Mobilização ${mobilizacaoId} não encontrada.`);
  if (!['pendente', 'em_separacao'].includes(mobilizacao.status)) {
    throw erro(409, 'mobilizacao_indisponivel', `Mobilização com status "${mobilizacao.status}" não pode ser separada.`);
  }

  const existente = db.prepare('SELECT * FROM separacoes WHERE mobilizacao_id = ?').get(mobilizacaoId);
  if (existente) {
    if (operador && !existente.operador) {
      db.prepare('UPDATE separacoes SET operador = ?, atualizada_em = ? WHERE id = ?').run(operador, agoraIso(), existente.id);
    }
    return obterSeparacao(db, existente.id);
  }

  const id = gerarIdSeparacao();
  const agora = agoraIso();

  transacao(db, () => {
    db.prepare(
      `INSERT INTO separacoes (id, mobilizacao_id, operador, status, criada_em, atualizada_em)
       VALUES (?, ?, ?, 'rascunho', ?, ?)`,
    ).run(id, mobilizacaoId, operador, agora, agora);

    const inserir = db.prepare(
      `INSERT INTO separacao_itens (separacao_id, mobilizacao_item_id)
       SELECT ?, id FROM mobilizacao_itens WHERE mobilizacao_id = ? ORDER BY linha`,
    );
    inserir.run(id, mobilizacaoId);

    db.prepare(`UPDATE mobilizacoes SET status = 'em_separacao', atualizada_em = ? WHERE id = ?`).run(agora, mobilizacaoId);
  });

  return obterSeparacao(db, id);
}

export function obterSeparacao(db, separacaoId) {
  const separacao = db.prepare('SELECT * FROM separacoes WHERE id = ?').get(separacaoId);
  if (!separacao) throw naoEncontrado(`Separação ${separacaoId} não encontrada.`);

  const mobilizacao = db.prepare('SELECT id, nome, obra, solicitante, status FROM mobilizacoes WHERE id = ?').get(separacao.mobilizacao_id);

  const itens = db
    .prepare(
      `SELECT si.id, si.mobilizacao_item_id, si.disponivel, si.quantidade_separada,
              si.patrimonios, si.observacao,
              mi.linha, mi.codigo, mi.descricao, mi.unidade, mi.quantidade_solicitada,
              mi.observacao AS observacao_material
         FROM separacao_itens si
         JOIN mobilizacao_itens mi ON mi.id = si.mobilizacao_item_id
        WHERE si.separacao_id = ?
        ORDER BY mi.linha`,
    )
    .all(separacaoId);

  return { ...separacao, mobilizacao, itens: itens.map(comPatrimoniosEmLista) };
}

/**
 * Salva o rascunho. Campos ausentes no body permanecem como estao; por isso o
 * autosave do formulario pode enviar so o item alterado.
 */
export function salvarSeparacao(db, separacaoId, dados = {}) {
  const separacao = db.prepare('SELECT * FROM separacoes WHERE id = ?').get(separacaoId);
  if (!separacao) throw naoEncontrado(`Separação ${separacaoId} não encontrada.`);
  if (separacao.status === 'enviada') {
    throw erro(409, 'separacao_ja_enviada', 'Esta separação já foi enviada e não pode mais ser alterada.');
  }

  const itens = dados.itens ?? [];
  if (!Array.isArray(itens)) throw erro(400, 'itens_invalidos', 'itens deve ser uma lista.');

  const buscarItem = db.prepare(
    `SELECT si.*, mi.quantidade_solicitada, mi.linha, mi.descricao
       FROM separacao_itens si
       JOIN mobilizacao_itens mi ON mi.id = si.mobilizacao_item_id
      WHERE si.separacao_id = ? AND si.mobilizacao_item_id = ?`,
  );
  const atualizarItem = db.prepare(
    `UPDATE separacao_itens
        SET disponivel = ?, quantidade_separada = ?, patrimonios = ?, observacao = ?
      WHERE separacao_id = ? AND mobilizacao_item_id = ?`,
  );

  transacao(db, () => {
    for (const entrada of itens) {
      const itemId = Number(entrada.mobilizacao_item_id ?? entrada.item_id);
      const atual = buscarItem.get(separacaoId, itemId);
      if (!atual) {
        throw erro(400, 'item_invalido', `Item ${entrada.mobilizacao_item_id ?? entrada.item_id} não pertence a esta separação.`);
      }

      const disponivel = normalizarDisponivel(entrada.disponivel, atual.disponivel, atual.linha);
      let quantidade = entrada.quantidade_separada !== undefined
        ? parseQuantidade(entrada.quantidade_separada, atual.linha)
        : atual.quantidade_separada;

      if (disponivel === 0) {
        quantidade = 0;
      }
      if (disponivel === 1) {
        if (quantidade === null) {
          throw erro(422, 'quantidade_obrigatoria', `Linha ${atual.linha}: informe a quantidade separada.`);
        }
        if (quantidade > atual.quantidade_solicitada) {
          throw erro(
            422,
            'quantidade_acima_do_solicitado',
            `Linha ${atual.linha}: quantidade separada (${quantidade}) maior que a solicitada (${atual.quantidade_solicitada}).`,
          );
        }
      }

      const patrimonios = disponivel === 0
        ? null
        : entrada.patrimonios !== undefined
          ? normalizarPatrimonios(entrada.patrimonios)
          : atual.patrimonios;

      const observacao = entrada.observacao !== undefined
        ? String(entrada.observacao ?? '').trim() || null
        : atual.observacao;

      atualizarItem.run(
        disponivel,
        quantidade,
        patrimonios,
        observacao,
        separacaoId,
        itemId,
      );
    }

    const campos = [];
    const valores = [];
    if (dados.operador !== undefined) {
      campos.push('operador = ?');
      valores.push(String(dados.operador ?? '').trim() || null);
    }
    if (dados.observacao !== undefined) {
      campos.push('observacao = ?');
      valores.push(String(dados.observacao ?? '').trim() || null);
    }
    campos.push('atualizada_em = ?');
    valores.push(agoraIso(), separacaoId);

    db.prepare(`UPDATE separacoes SET ${campos.join(', ')} WHERE id = ?`).run(...valores);
  });

  return obterSeparacao(db, separacaoId);
}

export function enviarSeparacao(db, separacaoId) {
  const separacao = db.prepare('SELECT * FROM separacoes WHERE id = ?').get(separacaoId);
  if (!separacao) throw naoEncontrado(`Separação ${separacaoId} não encontrada.`);

  if (separacao.status === 'enviada') {
    const entrega = db.prepare(`SELECT payload FROM webhook_entregas WHERE separacao_id = ? ORDER BY criada_em LIMIT 1`).get(separacaoId);
    return {
      ja_enviada: true,
      separacao: obterSeparacao(db, separacaoId),
      payload: entrega ? JSON.parse(entrega.payload) : null,
    };
  }

  const itens = obterSeparacao(db, separacaoId).itens;
  if (!separacao.operador) {
    throw erro(422, 'operador_obrigatorio', 'Informe o nome do operador antes de enviar a separação.');
  }
  const pendentes = itens.filter((item) => item.disponivel === null);
  if (pendentes.length) {
    throw erro(422, 'conferencia_incompleta', 'Todos os itens precisam ser conferidos antes de enviar.', {
      itens_pendentes: pendentes.map((item) => ({ linha: item.linha, descricao: item.descricao })),
    });
  }

  const semQuantidade = itens.filter(
    (item) => item.disponivel === true && (item.quantidade_separada === null || item.quantidade_separada === undefined),
  );
  if (semQuantidade.length) {
    throw erro(422, 'quantidade_obrigatoria', 'Itens disponíveis precisam de quantidade separada.', {
      itens_pendentes: semQuantidade.map((item) => ({ linha: item.linha, descricao: item.descricao })),
    });
  }

  const entregaId = gerarIdEntrega();
  const enviadaEm = agoraIso();

  const resultado = transacao(db, () => {
    db.prepare(`UPDATE separacoes SET status = 'enviada', enviada_em = ?, atualizada_em = ? WHERE id = ?`)
      .run(enviadaEm, enviadaEm, separacaoId);
    db.prepare(`UPDATE mobilizacoes SET status = 'concluida', atualizada_em = ? WHERE id = ?`)
      .run(enviadaEm, separacao.mobilizacao_id);

    const payload = montarPayloadSeparacao(db, separacaoId, entregaId);
    db.prepare(
      `INSERT INTO webhook_entregas
         (id, separacao_id, evento, payload, status, tentativas, proxima_tentativa_em, criada_em)
       VALUES (?, ?, ?, ?, 'pendente', 0, ?, ?)`,
    ).run(entregaId, separacaoId, payload.evento, JSON.stringify(payload), enviadaEm, enviadaEm);

    return { payload, separacao: obterSeparacao(db, separacaoId) };
  });

  return { ja_enviada: false, ...resultado };
}

/** Payload usado no webhook e na consulta do sistema de origem. */
export function montarPayloadSeparacao(db, separacaoId, entregaId = null) {
  const separacao = db
    .prepare(
      `SELECT s.*, m.nome AS mobilizacao_nome, m.obra, m.solicitante
         FROM separacoes s JOIN mobilizacoes m ON m.id = s.mobilizacao_id
        WHERE s.id = ?`,
    )
    .get(separacaoId);
  if (!separacao) throw naoEncontrado(`Separação ${separacaoId} não encontrada.`);

  const itens = obterSeparacao(db, separacaoId).itens.map((item) => {
    const disponivel = item.disponivel === null ? null : Boolean(item.disponivel);
    const quantidade = disponivel ? item.quantidade_separada : disponivel === false ? 0 : null;
    return {
      linha: item.linha,
      codigo: item.codigo,
      descricao: item.descricao,
      unidade: item.unidade,
      quantidade_solicitada: item.quantidade_solicitada,
      disponivel,
      quantidade_separada: quantidade,
      patrimonios: item.patrimonios,
      observacao: item.observacao,
      estoque_texto: estoqueTexto({ ...item, disponivel, quantidade_separada: quantidade }),
    };
  });

  const totalSolicitado = somar(itens.map((item) => item.quantidade_solicitada));
  const totalSeparado = somar(itens.map((item) => item.quantidade_separada ?? 0));
  const disponiveis = itens.filter((item) => item.disponivel === true && item.quantidade_separada >= item.quantidade_solicitada);
  const parciais = itens.filter((item) => item.disponivel === true && item.quantidade_separada < item.quantidade_solicitada);
  const semEstoque = itens.filter((item) => item.disponivel === false);

  return {
    evento: 'separacao.concluida',
    entrega_id: entregaId,
    mobilizacao_id: separacao.mobilizacao_id,
    mobilizacao_nome: separacao.mobilizacao_nome,
    obra: separacao.obra,
    separacao_id: separacao.id,
    status: separacao.status,
    operador: separacao.operador,
    observacao: separacao.observacao,
    enviada_em: separacao.enviada_em,
    resumo: {
      itens_total: itens.length,
      disponiveis: disponiveis.length,
      parciais: parciais.length,
      sem_estoque: semEstoque.length,
      quantidade_solicitada_total: totalSolicitado,
      quantidade_separada_total: totalSeparado,
    },
    itens,
  };
}

/** Texto pronto para a coluna "Estoque" da aba "Mobilizacao" do sistema de origem. */
export function estoqueTexto(item) {
  if (item.disponivel === null || item.disponivel === undefined) return null;
  if (item.disponivel === false) return 'Sem estoque';

  const unidade = item.unidade ? ` ${item.unidade}` : '';
  const separada = formatarNumero(item.quantidade_separada ?? 0);
  const solicitada = formatarNumero(item.quantidade_solicitada);
  const situacao = (item.quantidade_separada ?? 0) >= item.quantidade_solicitada ? 'Disponível' : 'Parcial';
  const base = `${situacao} (${separada}/${solicitada}${unidade})`;
  return item.patrimonios?.length ? `${base} - PAT: ${item.patrimonios.join(', ')}` : base;
}

export function reprocessarFalhas(db) {
  const resultado = db
    .prepare(
      `UPDATE webhook_entregas
          SET status = 'pendente', proxima_tentativa_em = ?, ultimo_erro = NULL
        WHERE status = 'falhou'`,
    )
    .run(agoraIso());
  return { reprocessadas: Number(resultado.changes ?? 0) };
}

function normalizarDisponivel(valor, atual, linha) {
  if (valor === undefined) return atual;
  if (valor === null) return null;
  if (valor === true || valor === 1 || valor === '1' || valor === 'true') return 1;
  if (valor === false || valor === 0 || valor === '0' || valor === 'false') return 0;
  throw erro(400, 'disponibilidade_invalida', `Linha ${linha}: disponivel deve ser true, false ou null.`);
}

function parseQuantidade(valor, linha) {
  if (valor === null || valor === '' || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0) {
    throw erro(422, 'quantidade_invalida', `Linha ${linha}: quantidade separada inválida.`);
  }
  return numero;
}

function normalizarPatrimonios(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor ?? '').split(/[,;\n]/);
  const limpos = lista.map((p) => String(p).trim()).filter(Boolean);
  return limpos.length ? limpos.join(', ') : null;
}

function comPatrimoniosEmLista(item) {
  return {
    ...item,
    disponivel: item.disponivel === null ? null : item.disponivel === 1,
    patrimonios: item.patrimonios ? item.patrimonios.split(',').map((p) => p.trim()).filter(Boolean) : [],
  };
}

function formatarNumero(valor) {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(Number(valor) || 0);
}

function somar(valores) {
  return Math.round(valores.reduce((total, valor) => total + (Number(valor) || 0), 0) * 1000) / 1000;
}
