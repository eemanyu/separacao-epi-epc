#!/usr/bin/env bash
# Envia uma planilha de mobilização para o serviço de separação.
#
#   ./examples/enviar-mobilizacao.sh caminho/planilha.xlsx MOB-2026-000123
#
# Variáveis: BASE_URL (padrão http://localhost:3000), INTEGRATION_API_KEY.
set -euo pipefail

BASE="${BASE_URL:-http://localhost:3000}"
CHAVE="${INTEGRATION_API_KEY:-dev-key-change-me}"
ARQUIVO="${1:?uso: $0 planilha.xlsx [mobilizacao_id]}"
ID="${2:-MOB-$(date +%Y%m%d%H%M%S)}"

echo "Enviando $ARQUIVO como $ID para $BASE ..."
resposta=$(curl -sS -w '\n%{http_code}' -X POST "$BASE/api/integracao/mobilizacoes" \
  -H "X-API-Key: $CHAVE" \
  -F "arquivo=@${ARQUIVO}" \
  -F "mobilizacao_id=${ID}" \
  -F "nome=Mobilização ${ID}")

codigo=$(printf '%s' "$resposta" | tail -n1)
corpo=$(printf '%s' "$resposta" | sed '$d')

if [ "$codigo" = "201" ]; then
  echo "OK ($codigo):"
  printf '%s' "$corpo" | python3 -m json.tool
elif [ "$codigo" = "409" ]; then
  echo "Já recebido (409). Trate como sucesso no retry."
else
  echo "Falha ($codigo):"
  printf '%s' "$corpo"
  exit 1
fi
