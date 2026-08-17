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

/**
 * Branco/nulo e não-sabe declarados por uma pesquisa (MODEL_VERSION 2.0.0, Q-10).
 * Vêm SEPARADOS de `Observation` de propósito: não são por candidato, são do
 * cenário inteiro. `null` significa "o instituto não publicou a grandeza" — que
 * NÃO é zero (R4). O modelo trata `null` como ausência de medida, não como 0.
 */
export const electorateObservationSchema = z.object({
  tseId: z.string(),
  instituteId: z.string(),
  scenarioKind: scenarioKindSchema,
  fieldMedianDate: isoDateSchema,
  sampleSize: z.number().int().positive(),
  blankNullPct: pctSchema.nullable(),
  undecidedPct: pctSchema.nullable(),
});
export type ElectorateObservation = z.infer<typeof electorateObservationSchema>;
export const electorateObservationsSchema = z.array(electorateObservationSchema);

// --- Transferência de votos (MODEL_VERSION 2.0.0, Q-10) ---------------------
// LEIA A Q-10: fluxo NÃO é identificável a partir de agregado. O schema obriga a
// carregar a banda e o veredito de identificabilidade junto de cada número, para
// que seja impossível consumir a média sem ver a incerteza que ela esconde.

/**
 * Estados do espaço de transferência. Objeto nomeado + schema derivado dele, no
 * mesmo padrão de `enums.ts`: o valor gravado no banco e o rótulo usado no código
 * saem da MESMA fonte, e o CHECK da migration é gerado a partir daqui.
 */
export const TRANSITION_STATE_KIND = {
  candidate: 'candidate',
  blankNull: 'blank_null',
  undecided: 'undecided',
} as const;

export const transitionStateKindSchema = z.enum([
  TRANSITION_STATE_KIND.candidate,
  TRANSITION_STATE_KIND.blankNull,
  TRANSITION_STATE_KIND.undecided,
]);
export type TransitionStateKind = z.infer<typeof transitionStateKindSchema>;

export const transitionFlowSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Fluxo em p.p. DO ELEITORADO (não da origem). */
  pp: z.number(),
  lo90Pp: z.number(),
  hi90Pp: z.number(),
  /** Banda cruza zero ⇒ indistinguível de nada. Publicado, nunca omitido. */
  notIdentifiable: z.boolean(),
});
export type TransitionFlow = z.infer<typeof transitionFlowSchema>;

export const transitionStepSchema = z.object({
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  flows: z.array(transitionFlowSchema),
});
export type TransitionStep = z.infer<typeof transitionStepSchema>;

export const transitionsSchema = z.object({
  states: z.array(
    z.object({ id: z.string(), kind: transitionStateKindSchema, displayName: z.string() }),
  ),
  steps: z.array(transitionStepSchema),
  prior: z.object({ method: z.string(), stickiness: z.number(), note: z.string() }),
});
export type Transitions = z.infer<typeof transitionsSchema>;

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

/**
 * Ponto da série de branco/nulo e não-sabe (MODEL_VERSION 2.0.0, Q-10). São
 * estados rastreados com a mesma dignidade de um candidato. `null` = sem medida
 * suficiente naquele ponto; nunca 0 (R4).
 */
export const latentElectoratePointSchema = z.object({
  date: isoDateSchema,
  blankNull: latentPointSchema.nullable(),
  undecided: latentPointSchema.nullable(),
});
export type LatentElectoratePoint = z.infer<typeof latentElectoratePointSchema>;

/**
 * Ponto da série de DESENGAJAMENTO, medida na pergunta ESPONTÂNEA (Q-14).
 *
 * Separada de `latentElectoratePointSchema` porque mede outra coisa: lá é o
 * branco/nulo e o não-sabe da pergunta ESTIMULADA, onde a lista de nomes ancora a
 * resposta; aqui é a pergunta aberta, onde quem não tem candidato não cita nome.
 * A diferença entre as duas é grande e informativa (37 vs. 3 p.p. na mesma rodada),
 * então juntá-las num campo só apagaria justamente o que interessa.
 */
export const latentSpontaneousPointSchema = z.object({
  date: isoDateSchema,
  /** Não citou nenhum nome. */
  noCandidate: latentPointSchema.nullable(),
  /** Citou branco, nulo ou "nenhum" explicitamente. */
  blankNull: latentPointSchema.nullable(),
  /** Soma dos que citaram algum nome. */
  named: latentPointSchema.nullable(),
});
export type LatentSpontaneousPoint = z.infer<typeof latentSpontaneousPointSchema>;

export const latentSeriesSchema = z.object({
  firstRound: z.array(latentDatedPointSchema),
  runoffs: z.array(latentRunoffSeriesSchema),
  electorate: z.array(latentElectoratePointSchema),
  /** Desengajamento medido na espontânea. Vazio quando ninguém publicou espontânea. */
  spontaneous: z.array(latentSpontaneousPointSchema),
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
  /** null quando não há passos suficientes para estimar (TRANSITION_MIN_STEPS). */
  transitions: transitionsSchema.nullable(),
  gates: modelGatesSchema,
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;
