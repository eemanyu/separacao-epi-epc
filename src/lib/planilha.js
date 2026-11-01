import ExcelJS from 'exceljs';

// Nomes de coluna aceitos (sem acento, minúsculos). A primeira linha das
// primeiras 10 que tiver descrição + quantidade vira o cabeçalho.
const COLUNAS = {
  codigo: [
    'codigo',
    'cod',
    'codigo do material',
    'codigo material',
    'cod material',
    'cod item',
    'sku',
    'part number',
    'partnumber',
  ],
  descricao: [
    'descricao',
    'descricao do material',
    'descricao material',
    'descricao do item',
    'material',
    'nome',
    'nome do material',
    'item',
    'produto',
  ],
  unidade: ['unidade', 'un', 'unid', 'unidade de medida', 'um', 'medida'],
  quantidade: [
    'quantidade',
    'qtd',
    'qtde',
    'quantidade necessaria',
    'quantidade solicitada',
    'qtd necessaria',
    'qtd solicitada',
    'quantidade do material',
    'qtd do material',
  ],
  observacao: ['observacao', 'observacoes', 'obs', 'comentario', 'comentarios', 'nota'],
};

const ALIAS_PARA_CAMPO = new Map();
for (const [campo, aliases] of Object.entries(COLUNAS)) {
  for (const alias of aliases) ALIAS_PARA_CAMPO.set(normalizar(alias), campo);
}

function normalizar(valor) {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Converte o valor cru de uma celula do ExcelJS em texto. */
export function textoCelula(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (Array.isArray(valor.richText)) return valor.richText.map((p) => p.text).join('').trim();
  if (valor.richText) return textoCelula(valor.richText);
  if (valor.result !== undefined) return textoCelula(valor.result);
  if (valor.text !== undefined) return String(valor.text).trim();
  if (valor.error) return '';
  return String(valor).trim();
}

/**
 * Aceita numeros do Excel e texto. Virgula e o separador decimal (pt-BR).
 * Texto com ponto de milhar (`1.234,56`, `1,234.56`, `1.234`) tambem e aceito.
 */
export function parseNumero(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null;
  const bruto = textoCelula(valor);
  if (!bruto) return null;
  const limpo = bruto.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
  if (!limpo) return null;

  const temVirgula = limpo.includes(',');
  const temPonto = limpo.includes('.');
  let normalizado = limpo;

  if (temVirgula && temPonto) {
    // O separador que aparece por ultimo e o decimal.
    const decimal = limpo.lastIndexOf(',') > limpo.lastIndexOf('.') ? ',' : '.';
    const milhar = decimal === ',' ? '.' : ',';
    normalizado = limpo.split(milhar).join('').replace(decimal, '.');
  } else if (temVirgula) {
    normalizado = limpo.replace(',', '.');
  } else if (temPonto && /^-?\d{1,3}(\.\d{3})+$/.test(limpo)) {
    normalizado = limpo.split('.').join('');
  }

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

function mapaCabecalho(linha) {
  const mapa = {};
  const titulos = {};
  linha.eachCell({ includeEmpty: false }, (celula, coluna) => {
    const titulo = textoCelula(celula.value);
    const campo = ALIAS_PARA_CAMPO.get(normalizar(titulo));
    if (campo && !mapa[campo]) {
      mapa[campo] = coluna;
      titulos[campo] = titulo;
    }
  });
  return { mapa, titulos };
}

function acharCabecalho(worksheet) {
  const limite = Math.min(10, worksheet.rowCount);
  for (let numero = 1; numero <= limite; numero += 1) {
    const { mapa, titulos } = mapaCabecalho(worksheet.getRow(numero));
    if (mapa.descricao && mapa.quantidade) return { linha: numero, mapa, titulos };
  }
  return null;
}

function escolherAba(workbook) {
  const abas = workbook.worksheets;
  if (!abas.length) return null;
  const preferida = abas.find((aba) => normalizar(aba.name).includes('mobiliza'));
  if (preferida && acharCabecalho(preferida)) return preferida;
  return abas.find((aba) => acharCabecalho(aba)) ?? preferida ?? abas[0];
}

/**
 * Le a planilha de mobilizacao e devolve os itens normalizados.
 * Lanca ErroPlanilha (status 422) se o layout nao for reconhecido.
 */
export async function lerPlanilhaMobilizacao(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw erroPlanilha('Não foi possível ler o arquivo. Envie um .xlsx válido.');
  }

  const aba = escolherAba(workbook);
  if (!aba) throw erroPlanilha('A planilha não possui nenhuma aba.');

  const cabecalho = acharCabecalho(aba);
  if (!cabecalho) {
    throw erroPlanilha(
      'Cabeçalho não encontrado. A planilha precisa de uma coluna de descrição (ex.: "Descrição do Material") e uma de quantidade (ex.: "Quantidade").',
      { aba: aba.name },
    );
  }

  const itens = [];
  const problemas = [];
  const { mapa, titulos } = cabecalho;

  for (let numero = cabecalho.linha + 1; numero <= aba.rowCount; numero += 1) {
    const linha = aba.getRow(numero);
    const descricao = textoCelula(linha.getCell(mapa.descricao).value);
    const codigo = mapa.codigo ? textoCelula(linha.getCell(mapa.codigo).value) : '';
    if (!descricao && !codigo) continue;

    const quantidade = parseNumero(linha.getCell(mapa.quantidade).value);
    if (quantidade === null) {
      problemas.push(`linha ${numero}: quantidade ausente ou inválida`);
      continue;
    }
    if (quantidade < 0) {
      problemas.push(`linha ${numero}: quantidade negativa`);
      continue;
    }

    const dadosOrigem = {};
    linha.eachCell({ includeEmpty: false }, (celula, coluna) => {
      const titulo = textoCelula(aba.getRow(cabecalho.linha).getCell(coluna).value);
      if (!titulo) return;
      const valor = textoCelula(celula.value);
      if (valor !== '') dadosOrigem[titulo] = valor;
    });

    itens.push({
      linha: numero,
      codigo: codigo || null,
      descricao: descricao || codigo,
      unidade: mapa.unidade ? textoCelula(linha.getCell(mapa.unidade).value) || null : null,
      quantidade_solicitada: quantidade,
      observacao: mapa.observacao ? textoCelula(linha.getCell(mapa.observacao).value) || null : null,
      dados_origem: JSON.stringify(dadosOrigem),
    });

    if (itens.length > 5000) {
      throw erroPlanilha('Limite de 5000 itens por mobilização excedido.', { aba: aba.name });
    }
  }

  if (problemas.length) {
    throw erroPlanilha('Existem linhas com erro na planilha. Corrija e envie novamente.', {
      aba: aba.name,
      problemas: problemas.slice(0, 20),
    });
  }
  if (!itens.length) {
    throw erroPlanilha('Nenhum item encontrado abaixo do cabeçalho.', { aba: aba.name });
  }

  return { aba: aba.name, cabecalhoLinha: cabecalho.linha, titulos, itens };
}

function erroPlanilha(mensagem, detalhes) {
  const erro = new Error(mensagem);
  erro.status = 422;
  erro.codigo = 'planilha_invalida';
  erro.detalhes = detalhes;
  return erro;
}
