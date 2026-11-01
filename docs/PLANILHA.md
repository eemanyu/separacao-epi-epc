# Formato da planilha de mobilização

O arquivo deve ser **`.xlsx`** (Excel 2007+). Arquivos `.xls` antigos precisam ser salvos como `.xlsx`.

## Layout aceito

Linhas acima do cabeçalho (título, logo, data) são permitidas: o leitor procura o cabeçalho nas **10 primeiras linhas**.

| A | B | C | D | E |
| --- | --- | --- | --- | --- |
| MOBILIZAÇÃO — OBRA NORTE — LOTE 03 | | | | |
| | | | | |
| Código | Descrição do Material | Unidade | Quantidade | Observação |
| EPI-001 | Capacete de segurança classe B | un | 12 | Com carneira e jugular |
| EPI-002 | Luva de vaqueta reforçada | par | 24 | |
| EPC-010 | Cone de sinalização 75 cm | un | 10 | Refletivo |

A linha 4 do Excel vira `itens[].linha = 4`. **Esse número é o vínculo com a coluna Estoque no retorno.**

## Colunas reconhecidas

A comparação ignora acentos, maiúsculas e pontuação.

| Campo | Cabeçalhos aceitos |
| --- | --- |
| `codigo` | `Codigo`, `Código`, `Cod`, `SKU`, `Codigo do Material`, `Cod material`, `Cod item`, `Part Number` |
| `descricao` | `Descricao`, `Descrição`, `Descrição do Material`, `Descrição material`, `Descrição do item`, `Material`, `Nome`, `Nome do material`, `Item`, `Produto` |
| `unidade` | `Unidade`, `Un`, `Unid`, `Unidade de medida`, `UM`, `Medida` |
| `quantidade` | `Quantidade`, `Qtd`, `Qtde`, `Quantidade necessária`, `Quantidade solicitada`, `Qtd necessária`, `Qtd solicitada`, `Quantidade do material`, `Qtd do material` |
| `observacao` | `Observacao`, `Observações`, `Obs`, `Comentário`, `Comentários`, `Nota` |

Obrigatórias: **descrição** e **quantidade**. Código é opcional (a descrição é usada como fallback).

## Regras

- **Aba:** prefere uma aba cujo nome contenha “Mobiliza”; senão, a primeira aba com cabeçalho válido.
- **Cabeçalho:** primeira linha (entre 1 e 10) com descrição + quantidade.
- **Linhas vazias:** ignoradas.
- **Quantidade:**
  - número do Excel (recomendado) ou texto;
  - vírgula é decimal: `12,5` → `12.5`;
  - `1.234` em texto é interpretado como `1.234` (não como mil duzentos e trinta e quatro). Evite separador de milhar em texto; envie número.
  - ausente, inválida ou negativa → **o arquivo inteiro é rejeitado** com `422 planilha_invalida` e a lista de linhas.
- **Código duplicado:** permitido (linhas diferentes continuam sendo itens diferentes). O vínculo com o retorno é a `linha`.
- **Coluna `Estoque`:** pode já existir; é ignorada no upload e sobrescrita no retorno.
- **Limite:** 5.000 itens por mobilização e 10 MB por arquivo (configurável).
- **Fórmulas:** o leitor usa o valor calculado da célula (`result`).

## Erros comuns

| Mensagem | Causa |
| --- | --- |
| `Cabecalho nao encontrado...` | nenhuma linha 1–10 tem coluna de descrição **e** quantidade |
| `linha 12: quantidade ausente ou invalida` | célula vazia, texto ou número inválido |
| `linha 12: quantidade negativa` | valor < 0 |
| `Nenhum item encontrado abaixo do cabecalho` | só há cabeçalho |
| `Nao foi possivel ler o arquivo...` | arquivo corrompido ou extensão errada |

## Gerar um exemplo

```bash
npm run seed
# cria data/exemplo-mobilizacao.xlsx e envia para o servidor local
```

O script [`scripts/seed.js`](../scripts/seed.js) mostra o layout com título, cabeçalho na linha 3 e 8 itens de EPI/EPC.
