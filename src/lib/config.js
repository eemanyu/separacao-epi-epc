import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function numero(valor, padrao) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : padrao;
}

export const config = {
  porta: numero(process.env.PORT, 3000),
  banco: process.env.DB_PATH ?? path.join(RAIZ, 'data', 'separacao.db'),
  uploads: process.env.UPLOADS_DIR ?? path.join(RAIZ, 'data', 'uploads'),
  // Chave usada pelo sistema de origem nas rotas /api/integracao/*.
  chaveApi: process.env.INTEGRATION_API_KEY ?? 'dev-key-change-me',
  chaveApiPadrao: !process.env.INTEGRATION_API_KEY,
  // Webhook de retorno. Sem URL, as entregas ficam pendentes e podem ser
  // consultadas pela API de integracao.
  webhookUrl: process.env.WEBHOOK_URL ?? '',
  webhookSegredo: process.env.WEBHOOK_SECRET ?? '',
  webhookIntervaloMs: numero(process.env.WEBHOOK_INTERVALO_MS, 30_000),
  // Upload pela tela do operador (alem do upload pela API de integracao).
  permitirUploadUi: process.env.PERMITIR_UPLOAD_UI !== 'false',
  maxUploadMb: numero(process.env.MAX_UPLOAD_MB, 10),
};

export function avisosDeConfiguracao() {
  const avisos = [];
  if (config.chaveApiPadrao) {
    avisos.push(
      'INTEGRATION_API_KEY não definida: usando "dev-key-change-me". Defina uma chave real antes de expor o serviço.',
    );
  }
  if (!config.webhookUrl) {
    avisos.push(
      'WEBHOOK_URL não definida: as separações serão gravadas e consultáveis, mas o sistema de origem não receberá o aviso automático.',
    );
  }
  if (!config.webhookSegredo) {
    avisos.push('WEBHOOK_SECRET não definida: o webhook será enviado sem assinatura HMAC.');
  }
  return avisos;
}
