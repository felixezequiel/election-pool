import { z } from 'zod';
import { PUBLIC_DATA_SCHEMA_VERSION, ROUND_FIRST, ROUND_SECOND } from './constants.js';
import { primaryMethodSchema, raceStatusSchema } from './enums.js';

/**
 * Contrato de saída pública — `data.json` (docs/03 §5). Único artefato público
 * de dado; é a API pública do projeto. Schema EXATO conforme docs/03 §5,
 * incluindo os campos `nextUpdateAt` e `updateIntervalMinutes` (contagem
 * regressiva, docs/06 §9). O RenderJob (docs/02 §3.4) valida contra isto antes
 * do swap atômico; o gate de publicação (docs/07 §6) reprova se não validar.
 *
 * Observação de escala: aqui os números são `number` cru (não `Pct` branded)
 * porque este é o formato serializado servido ao público, tal como escrito em
 * docs/03 §5. Todo percentual continua na escala 0–100 (CLAUDE.md). O campo
 * `nextUpdateAt`/`generatedAt` é `string` ISO-8601 com offset -03:00, também
 * conforme o contrato literal.
 */

const isoWithOffset = z.string(); // docs/03 §5 tipa como `string`; forma validada na origem por IsoDate

const meanLoHiSchema = z.object({
  mean: z.number(),
  lo90: z.number(),
  hi90: z.number(),
});

const latentDatedSchema = z.object({
  date: z.string(),
  byCandidate: z.record(z.string(), meanLoHiSchema),
});

export const publicDataSchema = z.object({
  schemaVersion: z.literal(PUBLIC_DATA_SCHEMA_VERSION),
  generatedAt: isoWithOffset, // ISO-8601 com offset -03:00
  nextUpdateAt: isoWithOffset, // ISO-8601 -03:00 — próximo slot de 2h (docs/06 §9)
  updateIntervalMinutes: z.number(), // 120 — cadência do pipeline (docs/02 §3)
  modelVersion: z.string(),
  gitSha: z.string(),
  race: z.object({ id: z.string(), displayName: z.string() }),

  candidates: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      party: z.string().nullable(),
      colorSlot: z.number(),
    }),
  ),

  institutes: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      method: primaryMethodSchema,
    }),
  ),

  // Série latente — a banda é o dado principal, a média é secundária.
  latent: z.object({
    firstRound: z.array(latentDatedSchema),
    runoffs: z.array(
      z.object({
        pair: z.tuple([z.string(), z.string()]),
        series: z.array(latentDatedSchema),
      }),
    ),
  }),

  // Pesquisas individuais — sempre com tse_id (R6).
  polls: z.array(
    z.object({
      tseId: z.string(),
      instituteId: z.string(),
      contractorName: z.string(),
      contractorType: z.string(),
      fieldStart: z.string(),
      fieldEnd: z.string(),
      sampleSize: z.number(),
      marginOfError: z.number().nullable(),
      firstRound: z.record(z.string(), z.number()).nullable(),
      runoffs: z.array(
        z.object({
          pair: z.tuple([z.string(), z.string()]),
          values: z.record(z.string(), z.number()),
        }),
      ),
      sourceUrl: z.string(), // link para a fonte, nunca o texto dela
    }),
  ),

  houseEffects: z.array(
    z.object({
      instituteId: z.string(),
      candidateId: z.string(),
      effect: z.number(),
      lo90: z.number(),
      hi90: z.number(),
      nPolls: z.number(),
      estimable: z.boolean(),
    }),
  ),

  diagnostics: z.object({
    gaveta: z.array(
      z.object({
        subjectId: z.string(),
        subjectKind: z.enum(['institute', 'contractor']),
        rate: z.number(),
        registered: z.number(),
        disclosed: z.number(),
      }),
    ),
    herding: z.array(
      z.object({
        windowEnd: z.string(),
        ratio: z.number(),
        nPolls: z.number(),
        flagged: z.boolean(),
      }),
    ),
  }),

  // Contexto histórico descritivo (docs/01 §7) — não entra no modelo.
  historicalError: z.array(
    z.object({
      instituteId: z.string(),
      election: z.string(),
      round: z.union([z.literal(ROUND_FIRST), z.literal(ROUND_SECOND)]),
      candidateLabel: z.string(),
      signedErrorPp: z.number(),
    }),
  ),

  // Alimenta o bloco de CTA (docs/00 §7).
  otherRaces: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      status: z.enum([raceStatusSchema.enum.ativo, raceStatusSchema.enum.planejado]),
    }),
  ),

  methodologyNotes: z.array(z.string()), // docs/01 §10, literal
});

export type PublicData = z.infer<typeof publicDataSchema>;
