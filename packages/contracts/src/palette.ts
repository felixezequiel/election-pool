import { z } from 'zod';
import { COLOR_SLOT_MIN, COLOR_SLOT_MAX } from './constants.js';

/**
 * Espectro de candidatos (docs/05 §2.1). 8 slots. Valores otimizados para o
 * fundo escuro (padrão); o tema claro escurece cada um ~12% de luminosidade.
 *
 * Regras não-negociáveis (docs/05 §2.1): cores não são partidárias; a cor segue
 * a entidade (color_slot fixo no cadastro), nunca a posição; cor nunca é o único
 * diferenciador (a UI acrescenta hachura por slot). O slot 8 (grafite) é
 * reservado para "Demais".
 */

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'cor deve ser hex #RRGGBB');

export const colorSlotSchema = z.number().int().min(COLOR_SLOT_MIN).max(COLOR_SLOT_MAX);
export type ColorSlot = z.infer<typeof colorSlotSchema>;

export const paletteEntrySchema = z.object({
  slot: colorSlotSchema,
  name: z.string(),
  dark: hexColor,
  light: hexColor,
});
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;

export const candidatePaletteSchema = z.array(paletteEntrySchema).length(COLOR_SLOT_MAX);
export type CandidatePalette = z.infer<typeof candidatePaletteSchema>;

// docs/05 §2.1 — valores dark são o padrão (--c1..--c8); light = ~-12% luminância.
// O slot é derivado da posição (base COLOR_SLOT_MIN), não escrito à mão, para não
// introduzir literais numéricos 2..8 fora de constants.ts (CLAUDE.md).
const paletteColors: ReadonlyArray<Omit<PaletteEntry, 'slot'>> = [
  { name: 'azul', dark: '#4F93D9', light: '#3281D3' },
  { name: 'laranja', dark: '#E8703F', light: '#E4581F' },
  { name: 'verde', dark: '#3F9E6E', light: '#378B61' },
  { name: 'violeta', dark: '#9B7BEE', light: '#7E55E9' },
  { name: 'ocre', dark: '#D0A93B', light: '#BE982D' },
  { name: 'carmim', dark: '#E15C82', light: '#DB3C69' },
  { name: 'ciano', dark: '#3FB6C9', light: '#33A3B5' },
  { name: 'grafite', dark: '#8791A0', light: '#737F90' }, // reservado para "Demais"
];

export const CANDIDATE_PALETTE: CandidatePalette = candidatePaletteSchema.parse(
  paletteColors.map((color, index) => ({ slot: index + COLOR_SLOT_MIN, ...color })),
);
