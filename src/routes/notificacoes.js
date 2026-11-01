import express from 'express';
import { agoraIso } from '../lib/ids.js';
import { contarPendentes } from '../lib/servico-mobilizacoes.js';
import { erro } from '../lib/erros.js';

export function rotasNotificacoes(db) {
  const router = express.Router();

  router.get('/resumo', (_req, res) => {
    const naoLidas = db.prepare('SELECT COUNT(*) AS total FROM notificacoes WHERE lida_em IS NULL').get().total;
    res.json({ nao_lidas: naoLidas, pendentes: contarPendentes(db) });
  });

  router.get('/', (req, res) => {
    const limite = Math.min(Math.max(Number(req.query.limite) || 30, 1), 100);
    const itens = db
      .prepare(
        `SELECT n.*, m.nome AS mobilizacao_nome, m.status AS mobilizacao_status
           FROM notificacoes n
           JOIN mobilizacoes m ON m.id = n.mobilizacao_id
          ORDER BY n.lida_em IS NULL DESC, n.criada_em DESC
          LIMIT ?`,
      )
      .all(limite);
    const naoLidas = db.prepare('SELECT COUNT(*) AS total FROM notificacoes WHERE lida_em IS NULL').get().total;
    res.json({ nao_lidas: naoLidas, notificacoes: itens });
  });

  router.post('/lidas', (_req, res) => {
    const resultado = db.prepare('UPDATE notificacoes SET lida_em = ? WHERE lida_em IS NULL').run(agoraIso());
    res.json({ marcadas: Number(resultado.changes ?? 0) });
  });

  router.post('/:id/lida', (req, res) => {
    const notificacao = db.prepare('SELECT id FROM notificacoes WHERE id = ?').get(req.params.id);
    if (!notificacao) throw erro(404, 'nao_encontrado', `Notificacao ${req.params.id} nao encontrada.`);
    db.prepare('UPDATE notificacoes SET lida_em = COALESCE(lida_em, ?) WHERE id = ?').run(agoraIso(), req.params.id);
    res.json({ id: req.params.id, lida: true });
  });

  return router;
}
