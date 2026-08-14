import { z } from 'zod';
import { isoDateSchema, pctSchema } from './branded.js';
import { scenarioKindSchema, diagnosticKindSchema } from './enums.js';

/**
 * Entrada e saída de `packages/model` (docs/01). O modelo é uma biblioteca pura:
 * recebe um array de observações e devolve estimativas. NENHUM tipo aqui pode
 * referenciar banco ou HTTP (CLAUDE.md: packages/model não importa de apps/, e o
 * backtest roda offline). Por isso a observação usa apenas escalares e ids —
 * não `PollRegistration`/`RawDocument`, que carregam proveniência de I/O.
 */

// --- Entrada: Observation[] -------------------------------------------------
// Uma linha "y_it" do modelo (docs/01 §1): valor medido por um instituto para um
// candidato num cenário, na data mediana do campo.
export const observationSchema = z.object({
  tseId: z.string(), // string crua: o modelo não valida forma do TSE, só rastreia proveniência
  instituteId: z.string(),
  candidateId: z.string(),
  scenarioKind: scenarioKindSchema,
  t2Pair: z.tuple([z.string(), z.string()]).nullable(), // par do 2º turno, ordenado; null no 1º turno
  fieldMedianDate: isoDateSchema, // data mediana do campo = tempo t
  sampleSize: z.number().int().positive(),
  valuePct: pctSchema,
});
export type Observation = z.infer<typeof observationSchema>;

export const observationsSchema = z.array(observationSchema);
export type Observations = z.infer<typeof observationsSchema>;

// --- Saída: ModelOutput -----------------------------------------------------
// Ponto da série latente μ_t com banda de credibilidade 90% (docs/01 §2, §4).
export const latentPointSchema = z.object({
  meanPct: pctSchema,
  lo90Pct: pctSchema,
  hi90Pct: pctSchema,
});
export type LatentPoint = z.infer<typeof latentPointSchema>;

export const latentDatedPointSchema = z.object({
  date: isoDateSchema,
  byCandidate: z.record(z.string(), latentPointSchema),
});
export type LatentDatedPoint = z.infer<typeof latentDatedPointSchema>;

export const latentRunoffSeriesSchema = z.object({
  pair: z.tuple([z.string(), z.string()]),
  series: z.array(latentDatedPointSchema),
});
export type LatentRunoffSeries = z.infer<typeof latentRunoffSeriesSchema>;

export const latentSeriesSchema = z.object({
  firstRound: z.array(latentDatedPointSchema),
  runoffs: z.array(latentRunoffSeriesSchema),
});
export type LatentSeries = z.infer<typeof latentSeriesSchema>;

// House effect h_i por instituto × candidato (docs/01 §5).
export const houseEffectSchema = z.object({
  instituteId: z.string(),
  candidateId: z.string(),
  effectPp: z.number(),
  lo90Pp: z.number(),
  hi90Pp: z.number(),
  nPolls: z.number().int(),
  estimable: z.boolean(), // false se n_polls < MIN_POLLS_FOR_HOUSE_EFFECT
});
export type HouseEffect = z.infer<typeof houseEffectSchema>;

// Diagnósticos (docs/01 §6). Não alteram o agregado — são publicados como tal.
export const diagnosticSchema = z.object({
  kind: diagnosticKindSchema,
  subjectId: z.string(), // institute_id ou contractor_name
  value: z.number(),
  n: z.number().int(),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;

// Resultado dos gates de modelo (docs/07 §3).
export const modelGatesSchema = z.object({
  passed: z.boolean(),
  coverageOk: z.boolean(), // M-1
  sumOk: z.boolean(), // M-2
  continuityOk: z.boolean(), // M-3
  bandSanityOk: z.boolean(), // M-4
  convergenceOk: z.boolean(), // M-5
  determinismOk: z.boolean(), // M-6
});
export type ModelGates = z.infer<typeof modelGatesSchema>;

export const modelOutputSchema = z.object({
  modelVersion: z.string(),
  referenceDate: isoDateSchema,
  latent: latentSeriesSchema,
  houseEffects: z.array(houseEffectSchema),
  diagnostics: z.array(diagnosticSchema),
  gates: modelGatesSchema,
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;
