import { z } from 'zod';
import { isoDateSchema, tseIdSchema, pctSchema } from './branded.js';
import { contractorTypeSchema, disclosureStatusSchema, scenarioKindSchema } from './enums.js';

/**
 * Schemas de domínio. Espelham as fronteiras de dados (linha de banco, saída de
 * parser). Tipos derivados via `z.infer` (CLAUDE.md). Nenhum I/O aqui — só forma.
 * Nomes de domínio em português onde o TSE/PesqEle nomeia; nomes técnicos em
 * inglês (CLAUDE.md convenções).
 */

// --- RawDocument (docs/03 §2.2) --------------------------------------------
// Proveniência/depuração. NUNCA servido ao público (R3, docs/08).
export const rawDocumentSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  fetchedAt: isoDateSchema,
  httpStatus: z.number().int(),
  contentType: z.string().nullable(),
  contentHash: z.string(), // sha256 do corpo
  storagePath: z.string(), // caminho no blob local, nunca servido
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
});
export type RawDocument = z.infer<typeof rawDocumentSchema>;

// --- PollRegistration (docs/03 §2.3) — registro do PesqEle ------------------
export const pollRegistrationSchema = z.object({
  tseId: tseIdSchema, // chave canônica
  raceId: z.string(),
  instituteId: z.string().nullable(), // null se alias desconhecido
  instituteRawName: z.string(),
  contractorName: z.string(),
  contractorType: contractorTypeSchema.nullable(),
  registeredAt: isoDateSchema,
  fieldStart: isoDateSchema,
  fieldEnd: isoDateSchema,
  sampleSize: z.number().int().positive(),
  marginOfError: z.number().nullable(), // p.p.
  confidenceLevel: z.number().nullable(), // normalmente 95.00
  costBrl: z.number().nullable(),
  firstSeenAt: isoDateSchema,
  sourceExpiredAt: isoDateSchema.nullable(),
  disclosureStatus: disclosureStatusSchema,
});
export type PollRegistration = z.infer<typeof pollRegistrationSchema>;

// --- PollScenario (docs/03 §2.4) — cenário normalizado ---------------------
export const pollScenarioSchema = z.object({
  id: z.string().uuid(),
  tseId: tseIdSchema,
  rawDocumentId: z.string().uuid(),
  kind: scenarioKindSchema,
  label: z.string(), // rótulo do instituto: 'Cenário 1'
  isCanonical: z.boolean(),
  canonicalReason: z.string().nullable(), // regra aplicada, docs/01 §3
  t2Pair: z.tuple([z.string(), z.string()]).nullable(), // [candidate_id, candidate_id], ordenado
  blankNullPct: pctSchema.nullable(),
  undecidedPct: pctSchema.nullable(),
  extractedAt: isoDateSchema,
});
export type PollScenario = z.infer<typeof pollScenarioSchema>;

// --- PollResult (docs/03 §2.4) — resultado por candidato --------------------
// Append-only no banco (R5). value_pct ∈ [0, 100] garantido por pctSchema.
export const pollResultSchema = z.object({
  scenarioId: z.string().uuid(),
  candidateId: z.string(),
  valuePct: pctSchema,
});
export type PollResult = z.infer<typeof pollResultSchema>;

// --- SourceCandidate (docs/04 §4) — URL candidata da rodada -----------------
export const sourceCandidateSchema = z.object({
  url: z.string().url(),
  reason: z.string(), // por que esta URL provavelmente contém o resultado
});
export type SourceCandidate = z.infer<typeof sourceCandidateSchema>;

// --- ParsedPoll (docs/04 §4) — saída do adapter -----------------------------
// `parse` nunca retorna parcial: ou devolve isto válido, ou lança.
export const parsedScenarioValueSchema = z.object({
  candidateAlias: z.string(),
  valuePct: pctSchema,
});
export type ParsedScenarioValue = z.infer<typeof parsedScenarioValueSchema>;

export const parsedScenarioSchema = z.object({
  kind: scenarioKindSchema,
  label: z.string(),
  t2Pair: z.tuple([z.string(), z.string()]).optional(),
  values: z.array(parsedScenarioValueSchema),
  blankNullPct: pctSchema.optional(),
  undecidedPct: pctSchema.optional(),
});
export type ParsedScenario = z.infer<typeof parsedScenarioSchema>;

export const parsedPollSchema = z.object({
  tseId: tseIdSchema, // deve bater com reg.tseId — se não bater, o adapter lança
  scenarios: z.array(parsedScenarioSchema),
});
export type ParsedPoll = z.infer<typeof parsedPollSchema>;
