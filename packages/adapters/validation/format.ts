/**
 * Formatação numérica das mensagens de validação. Duas casas fixas para que a
 * mensagem de erro mostre o valor observado do mesmo jeito que os percentuais são
 * armazenados (`numeric(5,2)`, docs/03) — sem ruído de ponto flutuante do tipo
 * `96.89999999`.
 */

const DECIMALS = 2;

export const fmtPct = (value: number): string => value.toFixed(DECIMALS);
