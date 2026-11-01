import path from 'node:path';
import express from 'express';
import { RAIZ, config } from './lib/config.js';
import { ErroHttp } from './lib/erros.js';
import { rotasMobilizacoes } from './routes/mobilizacoes.js';
import { rotasSeparacoes } from './routes/separacoes.js';
import { rotasNotificacoes } from './routes/notificacoes.js';
import { rotasIntegracao } from './routes/integracao.js';

export function criarApp({ db, cfg = config }) {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: '2mb' }));
  app.use(express.static(path.join(RAIZ, 'public')));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, servico: 'separacao-epi-epc', hora: new Date().toISOString() });
  });

  app.use('/api/mobilizacoes', rotasMobilizacoes(db, cfg));
  app.use('/api/separacoes', rotasSeparacoes(db));
  app.use('/api/notificacoes', rotasNotificacoes(db));
  app.use('/api/integracao', rotasIntegracao(db, cfg));

  app.use('/api', (_req, res) => {
    res.status(404).json({ erro: 'Rota não encontrada.', codigo: 'rota_nao_encontrada' });
  });

  app.use((erro, _req, res, _next) => {
    if (erro instanceof ErroHttp || (erro?.status && erro?.codigo)) {
      return res.status(erro.status).json({
        erro: erro.message,
        codigo: erro.codigo,
        ...(erro.detalhes ? { detalhes: erro.detalhes } : {}),
      });
    }
    if (erro?.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        erro: `Arquivo maior que ${cfg.maxUploadMb} MB.`,
        codigo: 'arquivo_grande',
      });
    }
    if (erro?.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ erro: 'Envie apenas um arquivo no campo "arquivo".', codigo: 'arquivo_invalido' });
    }
    if (erro?.type === 'entity.parse.failed') {
      return res.status(400).json({ erro: 'JSON inválido no corpo da requisição.', codigo: 'json_invalido' });
    }
    console.error('[erro não tratado]', erro);
    return res.status(500).json({ erro: 'Erro interno do servidor.', codigo: 'erro_interno' });
  });

  return app;
}
