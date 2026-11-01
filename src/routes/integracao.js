import { createHash, timingSafeEqual } from 'node:crypto';
import express from 'express';
import { obterMobilizacao } from '../lib/servico-mobilizacoes.js';
import { montarPayloadSeparacao, reprocessarFalhas } from '../lib/servico-separacoes.js';
import { agoraIso } from '../lib/ids.js';
import { erro } from '../lib/erros.js';
import { criarHandlerUpload, uploadPlanilha } from './upload.js';

function iguais(a, b) {
  const hashA = createHash('sha256').update(String(a)).digest();
  const hashB = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(hashA, hashB);
}

function exigirChave(cfg) {
  return (req, _res, next) => {
    const recebida = req.get('x-api-key') ?? '';
    if (!recebida || !iguais(recebida, cfg.chaveApi)) {
      return next(erro(401, 'nao_autorizado', 'Header X-API-Key ausente ou inválido.'));
    }
    next();
  };
}

export function rotasIntegracao(db, cfg) {
  const router = express.Router();
  router.use(exigirChave(cfg));

  router.post('/mobilizacoes', uploadPlanilha(cfg).single('arquivo'), criarHandlerUpload(db, cfg));

  router.get('/mobilizacoes/:id', (req, res) => {
    const mobilizacao = obterMobilizacao(db, req.params.id);
    res.json({
      mobilizacao_id: mobilizacao.id,
      nome: mobilizacao.nome,
      obra: mobilizacao.obra,
      solicitante: mobilizacao.solicitante,
      status: mobilizacao.status,
      itens_total: mobilizacao.itens_total,
      criada_em: mobilizacao.criada_em,
      atualizada_em: mobilizacao.atualizada_em,
      separacao: mobilizacao.separacao
        ? {
            separacao_id: mobilizacao.separacao.id,
            status: mobilizacao.separacao.status,
            operador: mobilizacao.separacao.operador,
            enviada_em: mobilizacao.separacao.enviada_em,
          }
        : null,
    });
  });

  router.get('/mobilizacoes/:id/separacao', (req, res) => {
    const mobilizacao = obterMobilizacao(db, req.params.id);
    if (!mobilizacao.separacao) {
      throw erro(404, 'separacao_nao_iniciada', 'A equipe operacional ainda não iniciou a separação desta mobilização.', {
        mobilizacao_id: req.params.id,
      });
    }

    const entrega = db
      .prepare('SELECT id FROM webhook_entregas WHERE separacao_id = ? ORDER BY criada_em LIMIT 1')
      .get(mobilizacao.separacao.id);
    const payload = montarPayloadSeparacao(db, mobilizacao.separacao.id, entrega?.id ?? null);
    res.json({ ...payload, concluida: payload.status === 'enviada', consultado_em: agoraIso() });
  });

  router.post('/webhooks/reprocessar', (_req, res) => {
    res.json(reprocessarFalhas(db));
  });

  return router;
}
