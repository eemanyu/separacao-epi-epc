import { escapar, formatarNumero, iniciarSininho, mostrarToast } from './comum.js';

iniciarSininho();

const formulario = document.getElementById('formulario');
const campoArquivo = document.getElementById('arquivo');
const nomeArquivo = document.getElementById('nome-arquivo');
const resultado = document.getElementById('resultado');

campoArquivo.addEventListener('change', () => {
  nomeArquivo.textContent = campoArquivo.files?.[0]?.name ?? 'Selecionar planilha .xlsx';
});

formulario.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const botao = document.getElementById('enviar');

  if (!campoArquivo.files?.length) {
    mostrarToast('Selecione a planilha .xlsx.', 'erro');
    return;
  }

  const dados = new FormData(formulario);
  botao.disabled = true;
  botao.textContent = 'Enviando…';
  resultado.innerHTML = '';

  try {
    const resposta = await fetch('/api/mobilizacoes', { method: 'POST', body: dados });
    const corpo = await resposta.json().catch(() => null);

    if (!resposta.ok) {
      const detalhes = corpo?.detalhes?.problemas?.length
        ? `<ul>${corpo.detalhes.problemas.map((p) => `<li>${escapar(p)}</li>`).join('')}</ul>`
        : '';
      resultado.innerHTML = `<div class="aviso-caixa erro"><strong>${escapar(corpo?.erro ?? 'Falha no envio.')}</strong>${detalhes}</div>`;
      return;
    }

    formulario.reset();
    nomeArquivo.textContent = 'Selecionar planilha .xlsx';
    resultado.innerHTML = `
      <div class="aviso-caixa ok">
        <strong>Mobilização criada com ${formatarNumero(corpo.itens_total)} item(ns).</strong><br>
        ID: <b>${escapar(corpo.id)}</b> ·
        <a href="/mobilizacao.html?id=${encodeURIComponent(corpo.id)}">Abrir mobilização</a>
      </div>`;
    mostrarToast('Mobilização importada.');
  } catch (falha) {
    resultado.innerHTML = `<div class="aviso-caixa erro">${escapar(falha.message)}</div>`;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Enviar planilha';
  }
});
