/**
 * Formatação compartilhada dos gráficos (docs/06 §3).
 *
 * - Percentuais: 1 casa decimal, separador decimal vírgula, escala 0–100.
 * - Datas no corpo: `DD/MM`; ISO completo fica no atributo `datetime`.
 * - Determinístico: o mesmo formatador roda no SSR e no cliente (o scrub e o
 *   tooltip reusam estas funções por texto idêntico), então nenhum número
 *   "pula" ao hidratar.
 *
 * Sem barrel: importe direto deste arquivo (CLAUDE.md).
 */

const PCT_FRACTION_DIGITS = 1;

const pctFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: PCT_FRACTION_DIGITS,
  maximumFractionDigits: PCT_FRACTION_DIGITS,
  useGrouping: false,
});

/** `40.8` → `"40,8"`. Nunca anexa o `%` (o sinal fica fora do numeral). */
export function formatPct(value: number): string {
  return pctFormatter.format(value);
}

/** Inteiro sem agrupamento (ex.: tamanho de amostra `n`). */
export function formatInt(value: number): string {
  return Math.round(value).toString();
}

/** pt-BR com casas decimais arbitrárias, separador vírgula, sem agrupamento. */
export function formatNumber(value: number, decimals: number): string {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: false,
  }).format(value);
}

/**
 * `"2026-08-14"` (ou ISO com hora) → `"14/08"`. Opera sobre a string ISO, sem
 * `Date` nu na lógica (CLAUDE.md): fatia ano-mês-dia da parte de data. Lança se
 * a string não começa por `AAAA-MM-DD` (R4 — falha alta, nunca silenciosa).
 */
export function formatDayMonth(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) {
    throw new Error(`formatDayMonth: ISO inválido "${iso}" — esperado AAAA-MM-DD`);
  }
  return `${match[2]}/${match[3]}`;
}

/** Parte de data pura `AAAA-MM-DD` para o atributo `datetime` de `<time>`. */
export function isoDateOnly(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  if (!match) {
    throw new Error(`isoDateOnly: ISO inválido "${iso}"`);
  }
  return match[1] as string;
}
