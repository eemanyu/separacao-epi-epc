import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { RAIZ, config } from '../src/lib/config.js';

const ITENS = [
  ['EPI-001', 'Capacete de seguranca classe B', 'un', 12, 'Com carneira e jugular'],
  ['EPI-002', 'Luva de vaqueta reforcada', 'par', 24, ''],
  ['EPI-003', 'Oculos de protecao incolor', 'un', 30, 'Antiembacante'],
  ['EPI-004', 'Botina de seguranca bico composite', 'par', 18, 'Numeros 38 a 44'],
  ['EPI-005', 'Protetor auricular plug', 'par', 40, ''],
  ['EPC-010', 'Cone de sinalizacao 75 cm', 'un', 10, 'Refletivo'],
  ['EPC-011', 'Fita de isolamento zebrada', 'rolo', 6, '100 m'],
  ['EPC-012', 'Extintor ABC 6 kg', 'un', 4, 'Com suporte e placa'],
];

async function gerarPlanilha(destino) {
  const livro = new ExcelJS.Workbook();
  const aba = livro.addWorksheet('Mobilização');
  aba.mergeCells('A1:E1');
  aba.getCell('A1').value = 'MOBILIZACAO - OBRA NORTE - LOTE 03';
  aba.getCell('A1').font = { bold: true, size: 14 };
  aba.getCell('A3').value = 'Codigo';
  aba.getCell('B3').value = 'Descricao do Material';
  aba.getCell('C3').value = 'Unidade';
  aba.getCell('D3').value = 'Quantidade';
  aba.getCell('E3').value = 'Observacao';
  aba.getRow(3).font = { bold: true };
  ITENS.forEach((item, indice) => {
    aba.getRow(4 + indice).values = item;
  });
  aba.columns = [
    { width: 14 },
    { width: 42 },
    { width: 10 },
    { width: 12 },
    { width: 28 },
  ];

  mkdirSync(path.dirname(destino), { recursive: true });
  await livro.xlsx.writeFile(destino);
}

const destino = path.join(RAIZ, 'data', 'exemplo-mobilizacao.xlsx');
await gerarPlanilha(destino);
console.log(`Planilha de exemplo: ${destino}`);

const base = process.env.BASE_URL ?? `http://localhost:${config.porta}`;
const dados = new FormData();
dados.set('arquivo', new Blob([readFileSync(destino)]), 'exemplo-mobilizacao.xlsx');
dados.set('mobilizacao_id', 'MOB-DEMO-001');
dados.set('nome', 'Mobilização Obra Norte - Lote 03');
dados.set('obra', 'Obra Norte');
dados.set('solicitante', 'Equipe de Planejamento');

try {
  const resposta = await fetch(`${base}/api/mobilizacoes`, { method: 'POST', body: dados });
  const corpo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    if (resposta.status === 409) {
      console.log('Mobilização MOB-DEMO-001 já existe (seed idempotente).');
      process.exitCode = 0;
    } else {
      console.error(`Falha ao enviar (${resposta.status}):`, corpo);
      process.exitCode = 1;
    }
  } else {
    console.log(`Mobilização criada: ${corpo.id} (${corpo.itens_total} itens)`);
    console.log(`Abra: ${base}/mobilizacao.html?id=${encodeURIComponent(corpo.id)}`);
  }
} catch {
  console.log(`Servidor não está em ${base}. Suba com "npm start" e importe a planilha em ${base}/importar.html.`);
}
