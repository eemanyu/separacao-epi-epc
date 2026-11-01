import { randomInt } from 'node:crypto';

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function sufixo(tamanho = 6) {
  let saida = '';
  for (let i = 0; i < tamanho; i += 1) saida += ALFABETO[randomInt(ALFABETO.length)];
  return saida;
}

function dataCurta(agora = new Date()) {
  return agora.toISOString().slice(0, 10).replaceAll('-', '');
}

export function gerarIdMobilizacao() {
  return `MOB-${dataCurta()}-${sufixo()}`;
}

export function gerarIdSeparacao() {
  return `SEP-${dataCurta()}-${sufixo()}`;
}

export function gerarIdNotificacao() {
  return `NTF-${dataCurta()}-${sufixo()}`;
}

export function gerarIdEntrega() {
  return `WHE-${dataCurta()}-${sufixo()}`;
}

export function agoraIso() {
  return new Date().toISOString();
}

/**
 * IDs vindos do sistema de origem entram em URLs, nomes de arquivo e no Excel.
 * Aceita apenas caracteres seguros e no maximo 64 posicoes.
 */
export function normalizarIdExterno(valor) {
  const id = String(valor ?? '').trim();
  if (!id) return null;
  if (id.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    const erro = new Error(
      'mobilizacao_id invalido: use ate 64 caracteres (letras, numeros, ponto, hifen, underline ou dois-pontos).',
    );
    erro.status = 400;
    erro.codigo = 'id_invalido';
    throw erro;
  }
  return id;
}
