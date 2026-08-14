import { z } from 'zod';
import { PCT_MIN, PCT_MAX, TSE_ID_SEQUENCE_DIGITS } from './constants.js';

/**
 * Branded types. Um `string`/`number` cru nunca deve circular na lógica de
 * negócio quando o domínio exige forma específica (data com offset, id do TSE,
 * percentual 0–100). Cada tipo tem seu validador Zod; o tipo é derivado via
 * `z.infer` — nunca declarado à mão (CLAUDE.md convenções de código).
 */

// --- IsoDate ---------------------------------------------------------------
// CLAUDE.md: datas sempre America/Sao_Paulo, sempre ISO-8601 com offset.
// Nunca `Date` nu em lógica de negócio. Aceita data-hora com offset explícito
// (ex.: 2026-08-14T10:00:00-03:00) ou data pura (ex.: 2026-08-14, para
// field_start/field_end que no banco são `date`).
const isoDateTimeWithOffset =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/;

export const isoDateSchema = z
  .string()
  .refine((value) => isoDateTimeWithOffset.test(value) || isoDateOnly.test(value), {
    message: 'IsoDate deve ser ISO-8601 com offset (ou data pura AAAA-MM-DD)',
  })
  .brand<'IsoDate'>();

export type IsoDate = z.infer<typeof isoDateSchema>;

export const parseIsoDate = (value: string): IsoDate => isoDateSchema.parse(value);

// --- TseId -----------------------------------------------------------------
// docs/03 §2.3: chave canônica do PesqEle, formato 'BR-06591/2026'.
// A sequência é zero-padded com largura fixa (TSE_ID_SEQUENCE_DIGITS). Isso é
// o que faz 'BR-6591/2026' (4 dígitos) ser rejeitado e 'BR-06591/2026' aceito.
const tseIdPattern = new RegExp(`^BR-\\d{${TSE_ID_SEQUENCE_DIGITS}}/\\d{4}$`);

export const tseIdSchema = z
  .string()
  .regex(tseIdPattern, {
    message: `TseId deve ter a forma BR-<${TSE_ID_SEQUENCE_DIGITS} dígitos>/<ano>`,
  })
  .brand<'TseId'>();

export type TseId = z.infer<typeof tseIdSchema>;

export const parseTseId = (value: string): TseId => tseIdSchema.parse(value);

// --- Pct -------------------------------------------------------------------
// CLAUDE.md: percentuais sempre na escala 0–100, nunca 0–1.
export const pctSchema = z.number().min(PCT_MIN).max(PCT_MAX).brand<'Pct'>();

export type Pct = z.infer<typeof pctSchema>;

export const parsePct = (value: number): Pct => pctSchema.parse(value);
