import { createHmac } from 'node:crypto';
import { agoraIso } from './ids.js';

// Backoff entre tentativas: 1min, 5min, 15min, 1h, 6h, 12h, 24h.
const ESPERA_MS = [60_000, 5 * 60_000, 15 * 60_000, 3_600_000, 6 * 3_600_000, 12 * 3_600_000, 24 * 3_600_000];
const MAX_TENTATIVAS = 8;

export function assinar(corpo, segredo) {
  if (!segredo) return null;
  return `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;
}

/**
 * Entrega as separacoes pendentes ao sistema de origem. Chamada pelo worker
 * (src/server.js) e diretamente nos testes. Nunca lanca: cada falha fica
 * registrada na outbox para nova tentativa.
 */
export async function entregarPendentes(db, cfg, opcoes = {}) {
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const agora = opcoes.agora ?? new Date();
  if (!cfg.webhookUrl) return { enviados: 0, falhas: 0, ignorado: true };

  const pendentes = db
    .prepare(
      `SELECT * FROM webhook_entregas
        WHERE status = 'pendente'
          AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em <= ?)
        ORDER BY criada_em
        LIMIT 20`,
    )
    .all(agora.toISOString());

  let enviados = 0;
  let falhas = 0;

  for (const entrega of pendentes) {
    const assinatura = assinar(entrega.payload, cfg.webhookSegredo);
    const tentativa = entrega.tentativas + 1;

    try {
      const resposta = await fetchImpl(cfg.webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-evento': entrega.evento,
          'x-entrega-id': entrega.id,
          'x-tentativa': String(tentativa),
          ...(assinatura ? { 'x-assinatura': assinatura } : {}),
        },
        body: entrega.payload,
        signal: AbortSignal.timeout(10_000),
      });

      if (resposta.ok) {
        db.prepare(
          `UPDATE webhook_entregas
              SET status = 'enviado', tentativas = ?, resposta_status = ?, enviada_em = ?, ultimo_erro = NULL
            WHERE id = ?`,
        ).run(tentativa, resposta.status, agoraIso(), entrega.id);
        enviados += 1;
      } else {
        const corpo = await resposta.text().catch(() => '');
        registrarFalha(db, entrega, tentativa, `HTTP ${resposta.status}: ${corpo.slice(0, 300)}`, agora);
        falhas += 1;
      }
    } catch (erro) {
      registrarFalha(db, entrega, tentativa, erro?.message ?? String(erro), agora);
      falhas += 1;
    }
  }

  return { enviados, falhas, ignorado: false };
}

function registrarFalha(db, entrega, tentativa, mensagem, agora) {
  const esgotou = tentativa >= MAX_TENTATIVAS;
  const espera = ESPERA_MS[Math.min(tentativa - 1, ESPERA_MS.length - 1)];
  const proxima = new Date(agora.getTime() + espera).toISOString();

  db.prepare(
    `UPDATE webhook_entregas
        SET status = ?, tentativas = ?, proxima_tentativa_em = ?, ultimo_erro = ?
      WHERE id = ?`,
  ).run(esgotou ? 'falhou' : 'pendente', tentativa, esgotou ? null : proxima, mensagem.slice(0, 500), entrega.id);
}
