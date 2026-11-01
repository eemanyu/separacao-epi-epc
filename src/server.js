import { config, avisosDeConfiguracao } from './lib/config.js';
import { abrirBanco } from './lib/db.js';
import { entregarPendentes } from './lib/webhook.js';
import { criarApp } from './app.js';

const db = abrirBanco(config.banco);
const app = criarApp({ db, cfg: config });

const servidor = app.listen(config.porta, () => {
  console.log(`Separação EPI/EPC ouvindo em http://localhost:${config.porta}`);
  console.log(`Banco: ${config.banco}`);
  for (const aviso of avisosDeConfiguracao()) console.warn(`[aviso] ${aviso}`);
});

let entregando = false;
const worker = setInterval(async () => {
  if (entregando) return;
  entregando = true;
  try {
    const resultado = await entregarPendentes(db, config);
    if (resultado.enviados || resultado.falhas) {
      console.log(`[webhook] enviados=${resultado.enviados} falhas=${resultado.falhas}`);
    }
  } catch (erro) {
    console.error('[webhook] erro inesperado', erro);
  } finally {
    entregando = false;
  }
}, config.webhookIntervaloMs);
worker.unref();

function encerrar(sinal) {
  console.log(`\n${sinal} recebido, encerrando...`);
  clearInterval(worker);
  servidor.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));
