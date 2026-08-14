/**
 * Único helper de conversão de número em formato pt-BR para `number` (docs/04
 * §4.1: "Um helper único faz isso. Não replique a lógica."). Compartilhado por
 * todos os adapters (PesqEle, nexus, cnt-mda...).
 *
 * Regras (R4 — falha alta, nunca silenciosa):
 * - `'38,8'`  → `38.8`
 * - `'1.234,5'` → `1234.5`  (ponto é separador de milhar em pt-BR)
 * - `'38'`    → `38`
 * - `'  12,00 '` → `12` (espaços nas pontas são tolerados)
 * - Entrada vazia, `'-'`, `'—'`, `'N/A'`, ou qualquer coisa que não seja um
 *   número bem-formado ⇒ LANÇA. Nunca devolve `0`, `NaN` ou `null`.
 *
 * Este helper NÃO decide se um valor ausente vira zero — isso é decisão do
 * adapter (docs/04 §4.1: "Não deduza valor ausente"). Aqui, ausência é erro.
 */

export class PtBrNumberError extends Error {
  constructor(readonly raw: string) {
    super(`Não foi possível interpretar "${raw}" como número pt-BR`);
    this.name = 'PtBrNumberError';
  }
}

/** Aceita apenas dígitos, pontos de milhar e uma única vírgula decimal. */
const PTBR_NUMBER = /^-?(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;

export const parsePtBrNumber = (raw: string): number => {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || !PTBR_NUMBER.test(trimmed)) {
    throw new PtBrNumberError(raw);
  }
  // Remove separadores de milhar, troca vírgula decimal por ponto.
  const normalized = trimmed.replace(/\./g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) {
    throw new PtBrNumberError(raw);
  }
  return value;
};

/**
 * Variante para percentuais: aceita um `%` opcional à direita e valida a faixa
 * 0–100 (escala do projeto, CLAUDE.md). Fora da faixa ⇒ lança.
 */
export const parsePtBrPercent = (raw: string): number => {
  const value = parsePtBrNumber(raw.trim().replace(/\s*%$/, ''));
  if (value < 0 || value > 100) {
    throw new PtBrNumberError(raw);
  }
  return value;
};
