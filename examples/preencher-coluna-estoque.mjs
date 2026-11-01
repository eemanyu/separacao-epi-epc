/**
 * Preenche a coluna "Estoque" da aba "Mobilização" com o payload de separação.
 *
 *   node examples/preencher-coluna-estoque.mjs separacao.json planilha.xlsx
 *   node examples/preencher-coluna-estoque.mjs separacao.json planilha.xlsx --aba "Mobilização" --coluna Estoque --saida final.xlsx
 *
 * O vínculo é `itens[].linha` (linha real da planilha). Por padrão grava um novo
 * arquivo "<planilha>-estoque.xlsx"; use --sobrescrever para editar o original.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const [arquivoPayload, arquivoPlanilha] = process.argv.slice(2);
if (!arquivoPayload || !arquivoPlanilha) {
  console.error('uso: node examples/preencher-coluna-estoque.mjs <payload.json> <planilha.xlsx> [--aba NOME] [--coluna Estoque] [--saida arquivo.xlsx] [--sobrescrever]');
  process.exit(1);
}

function argumento(nome) {
  const indice = process.argv.indexOf(nome);
  return indice >= 0 ? process.argv[indice + 1] : null;
}

const normalizar = (valor) => String(valor ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const payload = JSON.parse(readFileSync(arquivoPayload, 'utf8'));
const livro = new ExcelJS.Workbook();
await livro.xlsx.readFile(arquivoPlanilha);

const nomeAba = argumento('--aba');
const aba = nomeAba
  ? livro.worksheets.find((w) => normalizar(w.name) === normalizar(nomeAba))
  : livro.worksheets.find((w) => normalizar(w.name).includes('mobiliza'));

if (!aba) {
  console.error(`Aba nao encontrada. Abas disponiveis: ${livro.worksheets.map((w) => w.name).join(', ')}`);
  process.exit(1);
}

// Cabeçalho = primeira linha (1..20) com descrição/material e quantidade.
let linhaCabecalho = null;
for (let numero = 1; numero <= Math.min(20, aba.rowCount); numero += 1) {
  const titulos = [];
  aba.getRow(numero).eachCell({ includeEmpty: false }, (celula) => titulos.push(normalizar(celula.value)));
  if (titulos.some((t) => t.includes('descri') || t === 'material' || t === 'produto') && titulos.some((t) => t.includes('quantidade') || t === 'qtd' || t === 'qtde')) {
    linhaCabecalho = numero;
    break;
  }
}
if (!linhaCabecalho) {
  console.error('Nao encontrei o cabecalho (descricao + quantidade).');
  process.exit(1);
}

const nomeColuna = argumento('--coluna') ?? 'Estoque';
const cabecalho = aba.getRow(linhaCabecalho);
let colunaEstoque = null;
let colunaDescricao = null;
let ultimaColuna = 0;
cabecalho.eachCell({ includeEmpty: false }, (celula, coluna) => {
  const titulo = normalizar(celula.value);
  ultimaColuna = Math.max(ultimaColuna, coluna);
  if (titulo === normalizar(nomeColuna)) colunaEstoque = coluna;
  if (!colunaDescricao && (titulo.includes('descri') || titulo === 'material' || titulo === 'produto' || titulo === 'item')) {
    colunaDescricao = coluna;
  }
});
if (!colunaEstoque) {
  colunaEstoque = ultimaColuna + 1;
  cabecalho.getCell(colunaEstoque).value = nomeColuna;
  cabecalho.getCell(colunaEstoque).font = { bold: true };
}

let gravados = 0;
let divergentes = 0;
if (!colunaDescricao) console.warn('Coluna de descricao nao identificada: conferencia de descricao desativada.');
for (const item of payload.itens) {
  if (item.estoque_texto === null || item.estoque_texto === undefined) continue;
  const linha = aba.getRow(item.linha);
  if (colunaDescricao && item.descricao) {
    const descricaoPlanilha = normalizar(linha.getCell(colunaDescricao).value);
    if (!descricaoPlanilha.includes(normalizar(item.descricao).slice(0, 12))) {
      divergentes += 1;
      console.warn(`linha ${item.linha}: descricao da planilha nao confere com "${item.descricao}" (gravando mesmo assim)`);
    }
  }
  linha.getCell(colunaEstoque).value = item.estoque_texto;
  linha.commit();
  gravados += 1;
}

const destino = argumento('--saida')
  ?? (process.argv.includes('--sobrescrever')
    ? arquivoPlanilha
    : path.join(path.dirname(arquivoPlanilha), `${path.basename(arquivoPlanilha, path.extname(arquivoPlanilha))}-estoque.xlsx`));

await livro.xlsx.writeFile(destino);
console.log(`Aba: ${aba.name} | cabecalho: linha ${linhaCabecalho} | coluna Estoque: ${colunaEstoque}`);
console.log(`Itens gravados: ${gravados}${divergentes ? ` (${divergentes} com aviso de descricao)` : ''}`);
console.log(`Arquivo: ${destino}`);
