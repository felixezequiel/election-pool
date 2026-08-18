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
      /**
       * Caminho da foto OFICIAL do candidato, servida por nós (ex.:
       * `/candidatos/lula.jpg`). A origem é o registro de candidatura no TSE
       * (DivulgaCandContas) — registro público da autoridade eleitoral, mesma
       * natureza do dado do PesqEle. NUNCA foto de imprensa: docs/08 §2 trata
       * imagem de terceiro como obra protegida. `null` quando não há registro
       * casado com segurança — a UI cai para monograma + cor (R4: sem chute).
       */
      photoPath: z.string().nullable(),
      /** Link para o registro de candidatura que originou a foto (proveniência, R6). */
      photoSourceUrl: z.string().nullable(),
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
    /**
     * Branco/nulo e não-sabe como SÉRIES RASTREADAS (MODEL_VERSION 0.0.4, Q-10),
     * não como descarte. São estados do eleitorado com a mesma dignidade de um
     * candidato: é deles que sai (e para eles que vai) a maior parte do movimento.
     * Ponto sem a grandeza medida ⇒ `null`, nunca zero (R4: ausência não é zero).
     */
    electorate: z.array(
      z.object({
        date: z.string(),
        blankNull: meanLoHiSchema.nullable(),
        undecided: meanLoHiSchema.nullable(),
      }),
    ),
  }),

  /**
   * QUANTO DO ELEITORADO AINDA NÃO TEM CANDIDATO — medido na pergunta ESPONTÂNEA.
   *
   * Isto é uma grandeza diferente do `latent.electorate`, e a diferença é o ponto
   * inteiro. Na pergunta estimulada o instituto mostra uma lista de nomes, e a
   * lista ANCORA a resposta: o "não sabe" cai para poucos pontos porque a pessoa
   * reconhece um nome e escolhe. Na espontânea a pergunta é aberta — "em quem você
   * votaria?", sem lista — e quem não tem candidato simplesmente não cita ninguém.
   *
   * Na mesma rodada, medida pelo mesmo instituto no mesmo campo (BR-06833/2026):
   * espontânea 37 p.p. não citam nome contra 3 p.p. de não-sabe na estimulada. Não
   * é ruído de método: é a informação de que mais de um terço do eleitorado ainda
   * não tem escolha própria, que a estimulada esconde por construção.
   *
   * NÃO entra no modelo de `μ_t` (docs/01 §3 e Q-14: espontâneo e estimulado são
   * medidas incomparáveis e agrupá-las quebra a restrição de soma). É série
   * descritiva, publicada como tal.
   *
   * `null` numa ponta = o instituto não publicou aquela grandeza na espontânea —
   * ausência, nunca zero (R4).
   */
  spontaneous: z
    .object({
      series: z.array(
        z.object({
          date: z.string(),
          /** Não citou nenhum nome (o "não sabe/não respondeu" da espontânea). */
          noCandidate: meanLoHiSchema.nullable(),
          /** Citou explicitamente branco, nulo ou "nenhum". */
          blankNull: meanLoHiSchema.nullable(),
          /** Soma dos que citaram ALGUM nome — o complemento do desengajamento. */
          named: meanLoHiSchema.nullable(),
        }),
      ),
      /** Pesquisas espontâneas que sustentam a série (R6: auditabilidade). */
      pollCount: z.number(),
      instituteCount: z.number(),
    })
    .nullable(),

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
      /**
       * Branco/nulo e não-sabe DECLARADOS pela pesquisa (já persistidos em
       * `poll_results`). `null` = o instituto não publicou a grandeza — que é
       * diferente de publicar zero, e a UI precisa distinguir os dois (R4).
       */
      blankNullPct: z.number().nullable(),
      undecidedPct: z.number().nullable(),
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

  /**
   * Transferência de votos entre estados ao longo do tempo (MODEL_VERSION 0.0.4).
   *
   * LEIA A Q-10 ANTES DE CONSUMIR ISTO. Fluxo NÃO é identificável a partir de
   * pesquisa agregada: há K² incógnitas por passo para K equações marginais. O
   * que este campo carrega é uma estimativa SOB PRIOR EXPLÍCITO, não uma medida.
   * Por isso o schema torna obrigatório publicar, junto de cada fluxo, a banda e
   * o `notIdentifiable`; e junto da série, o prior que a produziu. Um consumidor
   * que queira ignorar a incerteza tem de fazer isso deliberadamente.
   *
   * `null` quando não há passos suficientes para estimar (o normal no começo).
   */
  transitions: z
    .object({
      /** Estados do espaço: candidatos + branco/nulo + não-sabe. */
      states: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(['candidate', 'blank_null', 'undecided']),
          displayName: z.string(),
        }),
      ),
      steps: z.array(
        z.object({
          fromDate: z.string(),
          toDate: z.string(),
          /**
           * Fluxos do passo, em pontos percentuais DO ELEITORADO (não da origem):
           * somar todos os `from = X` devolve o tamanho de X em `fromDate`.
           */
          flows: z.array(
            z.object({
              from: z.string(),
              to: z.string(),
              pp: z.number(),
              lo90: z.number(),
              hi90: z.number(),
              /**
               * true quando a banda cruza zero: o fluxo não é distinguível de
               * nada. Publicado assim de propósito (Q-10 condição 3) — a UI deve
               * mostrar como indistinguível, jamais omitir para a seta ficar limpa.
               */
              notIdentifiable: z.boolean(),
            }),
          ),
        }),
      ),
      /** De onde veio a ajuda que tornou o sistema solúvel. Publicado, não escondido. */
      prior: z.object({
        method: z.string(),
        /** Peso do prior de permanência (diagonal). Ver constants.ts. */
        stickiness: z.number(),
        /** Nota NOSSA sobre a limitação, exibida junto do gráfico. */
        note: z.string(),
      }),
    })
    .nullable(),

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
