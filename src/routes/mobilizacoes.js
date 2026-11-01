import express from 'express';
import { listarMobilizacoes, obterMobilizacao } from '../lib/servico-mobilizacoes.js';
import { iniciarSeparacao } from '../lib/servico-separacoes.js';
import { erro } from '../lib/erros.js';
import { criarHandlerUpload, uploadPlanilha } from './upload.js';

export function rotasMobilizacoes(db, cfg) {
  const router = express.Router();
  const upload = uploadPlanilha(cfg);
  const handlerUpload = criarHandlerUpload(db, cfg);

  router.get('/', (req, res) => {
    res.json({ mobilizacoes: listarMobilizacoes(db, { status: req.query.status }) });
  });

  router.post(
    '/',
    (req, _res, next) => {
      if (!cfg.permitirUploadUi) {
        return next(erro(403, 'upload_desabilitado', 'Upload pela tela desabilitado. Use a API de integracao.'));
      }
      next();
    },
    upload.single('arquivo'),
    handlerUpload,
  );

  router.get('/:id', (req, res) => {
    res.json(obterMobilizacao(db, req.params.id));
  });

  router.post('/:id/separacao', (req, res) => {
    const operador = String(req.body?.operador ?? '').trim() || null;
    res.status(201).json(iniciarSeparacao(db, req.params.id, operador));
  });

  return router;
}
