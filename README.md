# Separação EPI/EPC

Sistema da **equipe operacional** para receber mobilizações, conferir o estoque de EPI/EPC e devolver a separação ao sistema de origem.

O sistema de origem continua sendo o dono da mobilização. Este serviço:

1. recebe a planilha Excel da mobilização pela API (ou pela tela de importação);
2. cria a notificação no sininho da equipe operacional;
3. mostra os materiais e o formulário de conferência;
4. grava a separação com ID próprio;
5. devolve o resultado por **webhook assinado** e por **consulta GET**, já com o texto pronto para a coluna **"Estoque"** da aba **"Mobilização"**.

> **Integração com o outro sistema:** comece por [`docs/INTEGRACAO.md`](docs/INTEGRACAO.md). Ele tem o contrato completo, exemplos de payload, verificação de assinatura e checklist para a LLM que vai implementar o lado de origem.

## Stack

- Node.js **24+** (usa `node:sqlite`, sem serviço de banco separado)
- Express 5 + ExcelJS + multer
- Frontend em HTML/CSS/JS puro (sem build)
- SQLite com WAL

## Rodando

```bash
npm install
cp .env.example .env       # ajuste as chaves
npm start                  # http://localhost:3000
```

Popular com uma mobilização de exemplo (com o servidor rodando):

```bash
npm run seed
# Mobilizacao criada: MOB-DEMO-001 (8 itens)
# Abra: http://localhost:3000/mobilizacao.html?id=MOB-DEMO-001
```

Testes:

```bash
npm test
```

## Telas

| Rota | O que faz |
| --- | --- |
| `/` | Lista de mobilizações em aberto/concluídas, com sino de notificações |
| `/mobilizacao.html?id=MOB-...` | Materiais, formulário de conferência e resumo final |
| `/importar.html` | Upload manual da planilha (fallback/teste; pode ser desligado por env) |

Fluxo do operador: sino → mobilização → **Iniciar separação** → marcar **Tem/Não tem**, quantidade separada e patrimônios → **Concluir separação**. O rascunho é salvo automaticamente.

## API

Todas as rotas devolvem JSON. Erros seguem `{ "erro": "...", "codigo": "...", "detalhes": { ... } }`.

### Operação (usadas pelas telas)

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/mobilizacoes?status=abertas` | Lista (status: `abertas`, `pendente`, `em_separacao`, `concluida`, `cancelada`) |
| POST | `/api/mobilizacoes` | Upload multipart da planilha (tela de importação) |
| GET | `/api/mobilizacoes/:id` | Mobilização + itens + separação |
| POST | `/api/mobilizacoes/:id/separacao` | Cria/abre o rascunho da separação |
| GET | `/api/separacoes/:id` | Separação com itens conferidos |
| PUT | `/api/separacoes/:id` | Salva rascunho (itens e/ou operador) |
| POST | `/api/separacoes/:id/enviar` | Conclui a separação (idempotente) |
| GET | `/api/notificacoes` | Lista do sininho |
| GET | `/api/notificacoes/resumo` | Contadores do sininho |
| POST | `/api/notificacoes/:id/lida` | Marca uma como lida |
| POST | `/api/notificacoes/lidas` | Marca todas como lidas |

### Integração (exigem `X-API-Key`)

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/api/integracao/mobilizacoes` | Envia a planilha e cria a mobilização |
| GET | `/api/integracao/mobilizacoes/:id` | Status da mobilização |
| GET | `/api/integracao/mobilizacoes/:id/separacao` | Payload da separação (rascunho ou concluída) |
| POST | `/api/integracao/webhooks/reprocessar` | Recoloca entregas `falhou` na fila |

A especificação completa está em [`docs/openapi.yaml`](docs/openapi.yaml).

## Configuração

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `DB_PATH` | `./data/separacao.db` | Banco SQLite |
| `UPLOADS_DIR` | `./data/uploads` | Cópia dos Excels recebidos |
| `INTEGRATION_API_KEY` | `dev-key-change-me` | Chave esperada em `X-API-Key` |
| `WEBHOOK_URL` | vazio | Destino do retorno; vazio = entregas ficam pendentes para consulta |
| `WEBHOOK_SECRET` | vazio | Segredo do HMAC (`X-Assinatura: sha256=...`) |
| `WEBHOOK_INTERVALO_MS` | `30000` | Intervalo do worker de reenvio |
| `PERMITIR_UPLOAD_UI` | `true` | Habilita `/importar.html` e `POST /api/mobilizacoes` |
| `MAX_UPLOAD_MB` | `10` | Tamanho máximo da planilha |

O servidor carrega `.env` automaticamente (`node --env-file-if-exists=.env`).

## Como os dados se ligam

```
mobilizacoes.id  (ID da mobilização, vindo do sistema de origem)
   └── mobilizacao_itens.linha  (linha real do Excel)
          └── separacao_itens.mobilizacao_item_id
separacoes.id    (ID da separação, gerado aqui)
```

O retorno traz **`mobilizacao_id` + `separacao_id`** e, para cada item, **`linha`** (linha da planilha), `codigo`, `quantidade_solicitada`, `disponivel`, `quantidade_separada`, `patrimonios` e `estoque_texto`. O sistema de origem casa por `linha` (principal) ou `codigo` (fallback) e escreve a coluna **Estoque**.

Detalhes em [`docs/MODELO-DE-DADOS.md`](docs/MODELO-DE-DADOS.md).

## Estrutura

```
db/schema.sql              Esquema SQLite (idempotente)
src/server.js              Bootstrap + worker do webhook
src/app.js                 Express + tratamento de erros
src/lib/planilha.js        Leitura e normalização do Excel
src/lib/servico-*.js       Regras de negócio (transações)
src/lib/webhook.js         Assinatura HMAC, retry e outbox
src/routes/                Rotas HTTP
public/                    Telas (HTML/CSS/JS sem build)
docs/                      Contrato de integração, modelo, OpenAPI
examples/                  Receptor de webhook e preenchimento da coluna Estoque
scripts/seed.js            Gera e envia uma planilha de exemplo
test/                      Testes de API de ponta a ponta (node:test)
```

## Limitações conhecidas

- As telas de operação não têm autenticação: publique atrás de VPN/rede interna ou de um proxy com login. A API de integração tem chave; o webhook tem HMAC.
- Notificação é por *polling* (15 s) no sininho — simples e suficiente para uma equipe, sem infraestrutura de push.
- Uma separação por mobilização. Reabrir uma separação enviada exige criar um novo fluxo (não implementado de propósito).
- SQLite atende uma equipe pequena. Para várias instâncias, troque a camada de dados por Postgres mantendo os mesmos serviços/rotas.
