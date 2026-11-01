# Brief para a LLM do sistema de origem

Copie o bloco abaixo para a sessão da LLM que trabalha no sistema de origem (o sistema que já controla mobilizações e EPI/EPC). Ajuste os nomes de arquivos/tecnologia.

---

## Tarefa

Integrar o sistema de origem ao serviço de **Separação EPI/EPC** (este repositório), implementando o envio da mobilização e o recebimento da separação.

Leia antes de codar:

1. [`docs/INTEGRACAO.md`](INTEGRACAO.md) — contrato completo, exemplos e códigos de erro.
2. [`docs/openapi.yaml`](openapi.yaml) — especificação das rotas.
3. [`docs/schemas/separacao-concluida.schema.json`](schemas/separacao-concluida.schema.json) — schema do webhook.
4. [`examples/receptor-webhook.mjs`](../examples/receptor-webhook.mjs) e [`examples/preencher-coluna-estoque.mjs`](../examples/preencher-coluna-estoque.mjs) — implementações de referência.

## O que implementar

### 1. Upload da mobilização

- No evento em que o usuário conclui o upload do Excel, chame:

```http
POST {SEPARACAO_BASE_URL}/api/integracao/mobilizacoes
X-API-Key: {INTEGRATION_API_KEY}
Content-Type: multipart/form-data

arquivo=<.xlsx>
mobilizacao_id=<ID já persistido no sistema de origem>
nome=<nome da mobilização>
obra=<opcional>
solicitante=<opcional>
```

- Gere e persista o `mobilizacao_id` **antes** da chamada.
- Em timeout, repita com o **mesmo** `mobilizacao_id`; **409 `mobilizacao_duplicada` = já recebido (sucesso)**.
- Guarde `separacao_id` quando o retorno chegar.
- Mostre ao usuário o ID da mobilização e o status “aguardando separação”.

### 2. Endpoint de webhook

- Rota pública (ou autenticada por HMAC), ex.: `POST /api/webhooks/separacao`.
- Capture o **corpo bruto** antes do parser JSON.
- Valide `X-Assinatura: sha256=<hex>` com HMAC-SHA256 de `WEBHOOK_SECRET`.
- Responda **2xx em < 10 s**; enfileire o processamento se necessário.
- Faça **upsert por `separacao_id`** (idempotente).
- Persista o payload completo para auditoria.

### 3. Preenchimento da aba “Mobilização”

- Localize a aba `Mobilização` e a coluna `Estoque`.
- Para cada `item` do payload, escreva `item.estoque_texto` na **linha `item.linha`**.
- Só grave quando `concluida === true` (webhook) ou `status === "enviada"` (consulta).
- Não reordene linhas. Se o layout mudou, reconcilie por `codigo` somente se for único; senão, sinalize conflito.
- Torne a operação idempotente (sobrescrever o mesmo texto é seguro).

### 4. Reconciliação

- Job periódico (ex.: a cada 15 min) consultando `GET /api/integracao/mobilizacoes/{mobilizacao_id}/separacao` para mobilizações sem retorno.
- Se o webhook estiver `falhou`, chame `POST /api/integracao/webhooks/reprocessar`.
- Registre logs com `mobilizacao_id`, `separacao_id`, `entrega_id` e status HTTP.

## Critérios de aceite

- [ ] Upload de uma planilha de teste cria a mobilização e devolve `201`.
- [ ] Retry do mesmo upload devolve `409` e não duplica nada.
- [ ] O webhook rejeita assinatura inválida (`401`) e aceita a válida.
- [ ] Reentrega do mesmo `separacao_id` não duplica dados.
- [ ] A coluna `Estoque` é preenchida nas linhas corretas com `Disponível`, `Parcial` ou `Sem estoque`.
- [ ] Separação em rascunho **não** altera a planilha.
- [ ] Consulta GET funciona como fallback quando o webhook está desligado.
- [ ] Logs e mensagens de erro citam os IDs e o `codigo` retornado pela API.

## Fora de escopo

- Não alterar as regras de separação deste serviço.
- Não criar mobilização duplicada para “resolver” um 409.
- Não usar descrição/nome como chave de correlação.
- Não gravar a coluna Estoque a partir de rascunho.

## Variáveis de ambiente esperadas no sistema de origem

| Variável | Uso |
| --- | --- |
| `SEPARACAO_BASE_URL` | ex.: `https://separacao.suaempresa.com` |
| `INTEGRATION_API_KEY` | header `X-API-Key` |
| `WEBHOOK_SECRET` | validação HMAC do retorno |
