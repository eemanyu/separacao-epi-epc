/** Erro que o middleware final transforma em resposta JSON. */
export class ErroHttp extends Error {
  constructor(status, codigo, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

export function erro(status, codigo, mensagem, detalhes) {
  return new ErroHttp(status, codigo, mensagem, detalhes);
}

export function naoEncontrado(mensagem) {
  return erro(404, 'nao_encontrado', mensagem);
}
