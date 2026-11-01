/**
 * Receptor de webhook de exemplo.
 *
 *   WEBHOOK_SECRET=segredo node examples/receptor-webhook.mjs
 *
 * Ele valida a assinatura HMAC, ignora reentregas da mesma entrega e imprime o
 * resumo. No sistema real, troque o console.log por:
 *   1. upsert por `separacao_id`;
 *   2. gravação da coluna "Estoque" por `itens[].linha`.
 */
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const PORTA = Number(process.env.PORT ?? 4000);
const SEGREDO = process.env.WEBHOOK_SECRET ?? 'segredo';
const CAMINHO = process.env.WEBHOOK_PATH ?? '/webhook';
const entregasVistas = new Set();

function assinaturaValida(corpoBruto, header) {
  if (!SEGREDO) return true;
  const esperada = `sha256=${createHmac('sha256', SEGREDO).update(corpoBruto).digest('hex')}`;
  const a = Buffer.from(esperada);
  const b = Buffer.from(String(header ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

const servidor = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== CAMINHO) {
    res.writeHead(404).end();
    return;
  }

  const pedacos = [];
  req.on('data', (pedaco) => pedacos.push(pedaco));
  req.on('end', () => {
    const corpoBruto = Buffer.concat(pedacos);

    if (!assinaturaValida(corpoBruto, req.headers['x-assinatura'])) {
      console.warn('assinatura invalida');
      res.writeHead(401).end();
      return;
    }

    let payload;
    try {
      payload = JSON.parse(corpoBruto.toString('utf8'));
    } catch {
      res.writeHead(400).end();
      return;
    }

    const entregaId = req.headers['x-entrega-id'];
    if (entregasVistas.has(entregaId)) {
      console.log(`[${entregaId}] reentrega ignorada`);
      res.writeHead(204).end();
      return;
    }
    entregasVistas.add(entregaId);

    console.log('--- separacao.concluida ---');
    console.log(`mobilizacao_id: ${payload.mobilizacao_id}`);
    console.log(`separacao_id:   ${payload.separacao_id}`);
    console.log(`operador:       ${payload.operador}`);
    console.log(`resumo:         ${JSON.stringify(payload.resumo)}`);
    for (const item of payload.itens) {
      console.log(`  linha ${item.linha} | ${item.codigo ?? '-'} | ${item.estoque_texto}`);
    }

    res.writeHead(204).end();
  });
});

servidor.listen(PORTA, () => {
  console.log(`Receptor de webhook em http://localhost:${PORTA}${CAMINHO}`);
  console.log(`Assinatura: ${SEGREDO ? 'HMAC ativo' : 'SEM segredo (apenas teste)'}`);
});
