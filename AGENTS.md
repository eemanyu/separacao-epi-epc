# AGENTS.md — Separação EPI/EPC

Instruções para agentes (humanos ou LLMs) que trabalharem neste repositório.

## Comandos

```bash
npm install
npm start          # http://localhost:3000 (carrega .env se existir)
npm run dev        # watch mode
npm test           # node:test, banco em memória
npm run seed       # gera data/exemplo-mobilizacao.xlsx e envia para o servidor local
```

Node **24+** (usa `node:sqlite`). Não há build de frontend.

## Estrutura

- `db/schema.sql` — fonte da verdade do banco. Alterações devem ser idempotentes (`IF NOT EXISTS`) e retrocompatíveis.
- `src/lib/` — regras de negócio em funções puras de banco (`criarMobilizacao`, `iniciarSeparacao`, `salvarSeparacao`, `enviarSeparacao`, `montarPayloadSeparacao`).
- `src/routes/` — HTTP fino; sem regra de negócio.
- `src/lib/webhook.js` — assinatura, retry e outbox.
- `public/` — telas em HTML/CSS/JS puro, sem framework e sem etapa de build.
- `docs/INTEGRACAO.md` — **contrato público**. É o que outra equipe/LLM lê.

## Regras

1. **Não quebre o contrato** sem atualizar, no mesmo commit:
   - `docs/INTEGRACAO.md`
   - `docs/openapi.yaml`
   - `docs/schemas/separacao-concluida.schema.json`
   - testes em `test/`
2. `itens[].linha` é a chave de correspondência com a planilha de origem. Nunca renumere linhas.
3. O payload do webhook é congelado no envio. Mudanças de conteúdo exigem novo evento/versão, não reescrita silenciosa.
4. Toda escrita multi-tabela usa `transacao()` (`src/lib/db.js`).
5. Erros de API seguem `{ erro, codigo, detalhes? }` com `codigo` estável em `snake_case`.
6. Validação fica no servidor; o frontend é conveniência. Não confie em `disponivel`/quantidade vindos do cliente.
7. Mensagens de UI em português; código e nomes de API em português consistente com o existente.
8. Escape todo texto interpolado no HTML (`escapar()` em `public/assets/comum.js`).
9. Novas variáveis de ambiente entram em `.env.example` e no README.
10. Teste de ponta a ponta para qualquer mudança no fluxo upload → separação → webhook.

## Decisões já tomadas (não “melhore” sem pedir)

- Uma separação por mobilização (`UNIQUE (mobilizacao_id)`).
- Notificação por polling de 15 s, não WebSocket/SSE.
- SQLite; sem ORM.
- Sem autenticação nas telas internas (documentado como limitação).
- Sem upload em partes, sem fila externa: outbox no próprio SQLite.
