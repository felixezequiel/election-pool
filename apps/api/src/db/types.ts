import pg from 'pg';

const { types } = pg;

/**
 * Type parsers do `pg`. Por padrão o `pg` devolve `numeric` como string (preserva
 * precisão) e `timestamptz`/`date` como `Date` (perde offset e assume timezone
 * local). Nenhum dos dois casa com os schemas Zod dos contratos, que esperam
 * `number` para percentuais e `string` ISO-8601 para datas (CLAUDE.md).
 *
 * Aqui registramos parsers determinísticos:
 * - numeric  → number  (valores são numeric(5,2)/(4,2)/(8,4); cabem exatos num
 *   double — a precisão que importa é a do banco, nos CHECK e nas agregações).
 * - timestamptz → string ISO-8601 com offset -03:00 (America/Sao_Paulo).
 * - date     → string 'AAAA-MM-DD' (o próprio texto do Postgres já é assim).
 *
 * Chamar `configurePgTypes()` uma vez, no boot, antes de abrir o pool.
 */

// OIDs estáveis do catálogo do Postgres (pg_type).
const OID_NUMERIC = 1700;
const OID_TIMESTAMPTZ = 1184;
const OID_DATE = 1082;

const SAO_PAULO_OFFSET = '-03:00';

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * Converte o texto de um `timestamptz` do Postgres para ISO-8601 com offset
 * fixo -03:00. O `pg` recebe UTC do servidor; construímos o instante e
 * formatamos nos componentes de São Paulo. Sem DST no Brasil desde 2019, o
 * offset é constante -03:00.
 */
const toSaoPauloIso = (utc: Date): string => {
  // Componentes no fuso -03:00: subtrai 3h do UTC e lê em UTC.
  const shifted = new Date(utc.getTime() - 3 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const mo = two(shifted.getUTCMonth() + 1);
  const d = two(shifted.getUTCDate());
  const h = two(shifted.getUTCHours());
  const mi = two(shifted.getUTCMinutes());
  const s = two(shifted.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}${SAO_PAULO_OFFSET}`;
};

let configured = false;

export const configurePgTypes = (): void => {
  if (configured) return;

  types.setTypeParser(OID_NUMERIC, (value: string): number => Number(value));

  types.setTypeParser(OID_TIMESTAMPTZ, (value: string): string => toSaoPauloIso(new Date(value)));

  // Postgres já entrega `date` como 'AAAA-MM-DD'; mantemos como string crua.
  types.setTypeParser(OID_DATE, (value: string): string => value);

  configured = true;
};

export const __test = { toSaoPauloIso };
