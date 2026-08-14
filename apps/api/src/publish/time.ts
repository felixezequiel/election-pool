import { UPDATE_INTERVAL_MINUTES } from '@election-pool/contracts/constants';

/**
 * Tempo do pipeline em `America/Sao_Paulo` (CLAUDE.md: sempre -03:00, ISO-8601
 * com offset). Sem DST no Brasil desde 2019 ⇒ offset constante -03:00. Espelha a
 * convenção de `apps/api/src/db/types.ts` (mesmo formato do que sai do banco).
 *
 * `generatedAt` = instante do run. `nextUpdateAt` = próximo slot de 2h do cron
 * de 2 em 2 horas (docs/02 §3.1), que alimenta a contagem regressiva (docs/06 §9).
 */

const SAO_PAULO_OFFSET = '-03:00';
const OFFSET_MINUTES = 3 * 60; // -03:00 em minutos
const MS_PER_MINUTE = 60 * 1000;

const two = (n: number): string => String(n).padStart(2, '0');

/** Formata um instante UTC como ISO-8601 nos componentes de -03:00. */
export const toSaoPauloIso = (utc: Date): string => {
  const shifted = new Date(utc.getTime() - OFFSET_MINUTES * MS_PER_MINUTE);
  const y = shifted.getUTCFullYear();
  const mo = two(shifted.getUTCMonth() + 1);
  const d = two(shifted.getUTCDate());
  const h = two(shifted.getUTCHours());
  const mi = two(shifted.getUTCMinutes());
  const s = two(shifted.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${SAO_PAULO_OFFSET}`;
};

/** `generatedAt`: o instante `now` formatado em -03:00 (docs/03 §5). */
export const generatedAtIso = (now: Date): string => toSaoPauloIso(now);

/**
 * `nextUpdateAt`: o PRÓXIMO limite de `UPDATE_INTERVAL_MINUTES` (120 min = 2h) a
 * partir de `now`, alinhado a slots de hora par (00:00, 02:00, ... -03:00), que é
 * o que o cron de 2 em 2 horas dispara (docs/02 §3.1). Se `now` cair exatamente
 * num slot, o próximo é o slot seguinte (a contagem regressiva nunca é ≤ 0).
 */
export const nextUpdateAtIso = (now: Date): string => {
  const intervalMs = UPDATE_INTERVAL_MINUTES * MS_PER_MINUTE;
  // Componentes locais -03:00: alinhamos os slots de 2h ao calendário local.
  const localMs = now.getTime() - OFFSET_MINUTES * MS_PER_MINUTE;
  // Épocas de slot são múltiplos de intervalMs contados a partir da meia-noite
  // local; como -03:00 é offset fixo e a época UTC é múltipla de horas, alinhar
  // pela época UTC deslocada preserva o alinhamento a horas pares locais.
  const nextSlotLocalMs = (Math.floor(localMs / intervalMs) + 1) * intervalMs;
  const nextSlotUtc = new Date(nextSlotLocalMs + OFFSET_MINUTES * MS_PER_MINUTE);
  return toSaoPauloIso(nextSlotUtc);
};
