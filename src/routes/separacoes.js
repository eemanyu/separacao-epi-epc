import express from 'express';
import { enviarSeparacao, obterSeparacao, salvarSeparacao } from '../lib/servico-separacoes.js';

export function rotasSeparacoes(db) {
  const router = express.Router();

  router.get('/:id', (req, res) => {
    res.json(obterSeparacao(db, req.params.id));
  });

  router.put('/:id', (req, res) => {
    res.json(salvarSeparacao(db, req.params.id, req.body ?? {}));
  });

  router.post('/:id/enviar', (req, res) => {
    const resultado = enviarSeparacao(db, req.params.id);
    res.status(resultado.ja_enviada ? 200 : 201).json(resultado);
  });

  return router;
}
