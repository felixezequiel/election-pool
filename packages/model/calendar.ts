/**
 * Aritmética de calendário determinística, isolada do modelo estatístico.
 *
 * Existe para uma razão específica: as conversões ISO ⇄ número-de-dia usam
 * inteiros que NÃO são parâmetros de modelo — são posições de fatia da string
 * `YYYY-MM-DD`, a época UTC (`1970`) e o radix `10` do `parseInt`. O gate de
 * viés (`docs/07` §5.1) proíbe literal numérico não declarado no código do
 * MODELO. Em vez de enfraquecer o grep para tolerar esses números, nós os
 * nomeamos aqui como constantes de calendário, honestamente separadas de
 * qualquer prior/peso do modelo. `kalman.ts`/`house-effects.ts` importam daqui.
 *
 * Toda aritmética é em UTC (`Date.UTC`/`getUTC*`): UTC não tem horário de verão
 * nem depende do timezone do host, então é bit a bit reprodutível (`docs/01`
 * §9). Biblioteca pura: só Node stdlib, nenhum import de contracts ou apps.
 */

// Índices de fatia de `YYYY-MM-DD`: ano [0,4), mês [5,7), dia [8,10).
const YEAR_END = 4;
const MONTH_START = 5;
const MONTH_END = 7;
const DAY_START = 8;
const DAY_END = 10;

// Base numérica decimal do `parseInt` (evita interpretação octal de '08'/'09').
const DECIMAL_RADIX = 10;

// Época UTC (Unix): 1º de janeiro de 1970. Referência do número-de-dia.
const EPOCH_YEAR = 1970;
const JANUARY_INDEX = 0; // `Date.UTC` usa mês 0-based
const FIRST_DAY_OF_MONTH = 1;
const SECOND_DAY_OF_MONTH = 2;

// Um dia após a época = exatamente 86_400_000 ms; deriva ms/dia sem literal solto.
const MS_PER_DAY =
  Date.UTC(EPOCH_YEAR, JANUARY_INDEX, SECOND_DAY_OF_MONTH) -
  Date.UTC(EPOCH_YEAR, JANUARY_INDEX, FIRST_DAY_OF_MONTH);

const MONTH_INDEX_OFFSET = 1; // meses ISO são 1-based; `Date.UTC` é 0-based
const MONTH_WIDTH = 2; // largura zero-padded de mês e dia em `YYYY-MM-DD`
const DAY_WIDTH = 2;

/**
 * Converte uma string ISO (`YYYY-MM-DD` ou `YYYY-MM-DDTHH:MM:SS±HH:MM`) no número
 * de dias UTC desde a época, usando SÓ a componente de data. Determinística.
 * Lança em data inválida (R4 do CLAUDE.md: falha alta, nunca silenciosa).
 */
export function isoToDayNumber(iso: string): number {
  const y = Number.parseInt(iso.slice(0, YEAR_END), DECIMAL_RADIX);
  const m = Number.parseInt(iso.slice(MONTH_START, MONTH_END), DECIMAL_RADIX);
  const d = Number.parseInt(iso.slice(DAY_START, DAY_END), DECIMAL_RADIX);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new Error(`isoToDayNumber: data ISO inválida '${iso}'`);
  }
  const ms = Date.UTC(y, m - MONTH_INDEX_OFFSET, d);
  if (!Number.isFinite(ms)) throw new Error(`isoToDayNumber: data ISO inválida '${iso}'`);
  return Math.round(ms / MS_PER_DAY);
}

/** Inversa de `isoToDayNumber`: número de dias UTC ⇒ `YYYY-MM-DD`. */
export function dayNumberToIso(dayNumber: number): string {
  const date = new Date(dayNumber * MS_PER_DAY);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + MONTH_INDEX_OFFSET;
  const day = date.getUTCDate();
  return `${pad(year, YEAR_END)}-${pad(month, MONTH_WIDTH)}-${pad(day, DAY_WIDTH)}`;
}

function pad(n: number, width: number): string {
  let s = String(n);
  while (s.length < width) s = `0${s}`;
  return s;
}
