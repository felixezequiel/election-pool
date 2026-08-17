/**
 * Resolução de valor de `<select>` do PesqEle POR RÓTULO.
 *
 * Motivo (Q-09, T-15): o id da eleição no `formPesquisa:eleicoes_input` era `81`
 * para "Eleições Gerais 2026" em 2026-08-16, mas esse número é uma chave interna
 * do TSE e muda a cada pleito. Hardcodá-lo faria o job consultar a eleição errada
 * EM SILÊNCIO — o mesmo tipo de falha muda que produziu `seen=0` em T-05. Aqui o
 * rótulo é a fonte da verdade e rótulo não encontrado LANÇA (R4).
 */

import { parse as parseHtml } from 'node-html-parser';

export class PesqEleSelectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PesqEleSelectError';
  }
}

/** Compara rótulos sem acento, sem caixa e sem espaço sobrando. */
const normalize = (raw: string): string =>
  raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Valor do `<option>` cujo texto é `label`, dentro do `<select name=...>`.
 * Select ausente, rótulo ausente ou `value` vazio ⇒ LANÇA.
 */
export const resolveOptionValue = (html: string, selectName: string, label: string): string => {
  const root = parseHtml(html);
  const select = root.querySelector(`select[name="${selectName}"]`);
  if (select === null) {
    throw new PesqEleSelectError(`<select name="${selectName}"> ausente na página do PesqEle`);
  }

  const alvo = normalize(label);
  const options = select.querySelectorAll('option');
  for (const option of options) {
    if (normalize(option.text) !== alvo) continue;
    const value = option.getAttribute('value');
    if (value === undefined || value.length === 0) {
      throw new PesqEleSelectError(`Opção "${label}" de ${selectName} está sem value`);
    }
    return value;
  }

  const disponiveis = options
    .map((o) => o.text.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0)
    .join(' | ');
  throw new PesqEleSelectError(
    `Rótulo "${label}" não existe em ${selectName}. Opções: ${disponiveis}`,
  );
};
