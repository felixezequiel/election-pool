/**
 * Normalização de texto vindo do HTML do PesqEle, compartilhada pelos parsers.
 *
 * Existe como módulo próprio porque a comparação POR RÓTULO é a estratégia que
 * sobrevive aos ids gerados pelo JSF (`j_id_*`), e ela só é confiável se todos os
 * parsers normalizarem do MESMO jeito: NBSP virando espaço, espaços colapsados,
 * ':' final fora, acento e caixa ignorados. Duas normalizações levemente
 * diferentes fariam um rótulo casar num lugar e não casar noutro.
 */

/** NBSP vira espaço, espaços colapsam, pontas aparadas. */
export const cleanText = (raw: string): string =>
  raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Compara rótulos ignorando acento, caixa, espaço e o ':' final. */
export const normalizeLabel = (raw: string): string =>
  cleanText(raw)
    .replace(/:\s*$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
