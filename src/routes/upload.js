import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { lerPlanilhaMobilizacao } from '../lib/planilha.js';
import { criarMobilizacao } from '../lib/servico-mobilizacoes.js';
import { gerarIdMobilizacao, normalizarIdExterno } from '../lib/ids.js';
import { erro } from '../lib/erros.js';

export function uploadPlanilha(cfg) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: cfg.maxUploadMb * 1024 * 1024, files: 1 },
    fileFilter(_req, arquivo, aceitar) {
      const extensao = path.extname(arquivo.originalname ?? '').toLowerCase();
      if (extensao === '.xlsx' || extensao === '.xlsm') return aceitar(null, true);
      const falha = erro(
        400,
        'arquivo_invalido',
        'Formato não suportado. Envie um arquivo .xlsx (Excel 2007+). Arquivos .xls antigos devem ser salvos como .xlsx.',
      );
      return aceitar(falha);
    },
  });
}

function nomeSeguro(nome) {
  return String(nome ?? 'mobilizacao.xlsx')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(-120);
}

/** Handler compartilhado pelo upload da API de integracao e pelo upload da tela. */
export function criarHandlerUpload(db, cfg) {
  return async function handlerUpload(req, res) {
    if (!req.file) throw erro(400, 'arquivo_ausente', 'Envie o arquivo Excel no campo "arquivo" (multipart/form-data).');

    const lido = await lerPlanilhaMobilizacao(req.file.buffer);
    const id = normalizarIdExterno(req.body?.mobilizacao_id) ?? gerarIdMobilizacao();
    const nome = String(req.body?.nome ?? '').trim() || path.basename(req.file.originalname, path.extname(req.file.originalname));

    mkdirSync(cfg.uploads, { recursive: true });
    const caminho = path.join(cfg.uploads, `${id}-${randomUUID().slice(0, 8)}-${nomeSeguro(req.file.originalname)}`);
    writeFileSync(caminho, req.file.buffer);

    try {
      const mobilizacao = criarMobilizacao(db, {
        id,
        nome,
        obra: String(req.body?.obra ?? '').trim() || null,
        solicitante: String(req.body?.solicitante ?? '').trim() || null,
        arquivoNome: req.file.originalname,
        arquivoCaminho: caminho,
        itens: lido.itens,
      });
      res.status(201).json({ ...mobilizacao, planilha: { aba: lido.aba, cabecalho_linha: lido.cabecalhoLinha } });
    } catch (falha) {
      rmSync(caminho, { force: true });
      throw falha;
    }
  };
}
