import { z } from 'zod';
import { pctSchema } from '@election-pool/contracts/branded';
import {
  scenarioKindSchema,
  primaryMethodSchema,
  SCENARIO_KIND,
} from '@election-pool/contracts/enums';
import type { Database } from '../db/pool.js';

/**
 * Leitura da camada normalized/reference para montar o `data.json` (docs/03 §5).
 *
 * NÃO grava nada — só lê (R5: computed é regenerável a partir do raw; o render é
 * um consumidor). Toda linha lida passa por Zod (CLAUDE.md: validação em toda
 * fronteira de banco). As queries são poucas e analíticas, SQL explícito, sem ORM
 * (docs/02 §2).
 *
 * Escopo canônico: o modelo consome o CENÁRIO CANÔNICO por (tse_id, kind, t2_pair)
 * (docs/01 §3). A seleção do canônico é um passo anterior (T-07); aqui apenas
 * lemos `is_canonical = true`. Se nenhum cenário foi marcado canônico, o conjunto
 * de observações vem vazio e o gate de cobertura M-1 reprova — falha alta, não
 * publica (docs/07 §6). O render nunca "adivinha" um canônico.
 */

// --- linhas cruas (schemas estreitos que espelham a query) ------------------

const scenarioResultRowSchema = z.object({
  tseId: z.string(),
  instituteId: z.string(), // registros sem instituto resolvido são excluídos na query
  scenarioKind: scenarioKindSchema,
  t2Pair: z.tuple([z.string(), z.string()]).nullable(),
  fieldStart: z.string(),
  fieldEnd: z.string(),
  sampleSize: z.number().int().positive(),
  candidateId: z.string(),
  valuePct: pctSchema,
});
export type ScenarioResultRow = z.infer<typeof scenarioResultRowSchema>;

const registrationRowSchema = z.object({
  instituteId: z.string(),
  contractorName: z.string(),
  registeredAt: z.string(),
  disclosed: z.boolean(),
});
export type RegistrationRow = z.infer<typeof registrationRowSchema>;

const pollRowSchema = z.object({
  tseId: z.string(),
  instituteId: z.string(),
  contractorName: z.string(),
  contractorType: z.string(),
  fieldStart: z.string(),
  fieldEnd: z.string(),
  sampleSize: z.number().int().positive(),
  marginOfError: z.number().nullable(),
  // Branco/nulo e não-sabe DECLARADOS pela pesquisa, do cenário canônico de 1º
  // turno. `null` = o instituto não publicou a grandeza — que NÃO é zero (R4).
  blankNullPct: z.number().nullable(),
  undecidedPct: z.number().nullable(),
  sourceUrl: z.string(),
});
export type PollRow = z.infer<typeof pollRowSchema>;

/**
 * Branco/nulo e não-sabe por cenário canônico, para virar `ElectorateObservation`
 * (MODEL_VERSION 0.0.4, Q-10). Vem SEPARADO de `ScenarioResultRow` porque não é
 * por candidato: é do cenário inteiro. Uma linha por cenário, não por candidato —
 * juntar as duas coisas na mesma query multiplicaria a grandeza pelo número de
 * candidatos e inflaria a série.
 */
const electorateRowSchema = z.object({
  tseId: z.string(),
  instituteId: z.string(),
  scenarioKind: scenarioKindSchema,
  fieldStart: z.string(),
  fieldEnd: z.string(),
  sampleSize: z.number().int().positive(),
  blankNullPct: pctSchema.nullable(),
  undecidedPct: pctSchema.nullable(),
});
export type ElectorateRow = z.infer<typeof electorateRowSchema>;

const candidateRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  party: z.string().nullable(),
  colorSlot: z.number().int(),
  /**
   * Foto OFICIAL do registro de candidatura no TSE, servida por nós. `null` é
   * comum e legítimo: candidato sem candidatura registrada, casamento ambíguo, ou
   * o TSE não autorizando a publicação. A UI cai para monograma + cor — nunca
   * busca foto em outro lugar (docs/08 §2).
   */
  photoPath: z.string().nullable(),
  photoSourceUrl: z.string().nullable(),
});
export type CandidateRow = z.infer<typeof candidateRowSchema>;

const instituteRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  method: primaryMethodSchema,
});
export type InstituteRow = z.infer<typeof instituteRowSchema>;

const raceRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});
export type RaceRow = z.infer<typeof raceRowSchema>;

export class RenderReadModel {
  constructor(private readonly db: Database) {}

  /**
   * Todas as linhas (cenário canônico × resultado) da corrida, para virar
   * `Observation[]`. Junta scenario→result→registration para carregar o instituto,
   * o tamanho de amostra e as datas de campo. Exclui registros sem instituto
   * resolvido (institute_id null) — o modelo identifica por instituto e não pode
   * atribuir house effect a um instituto desconhecido (R4: melhor excluir que
   * inventar).
   */
  async listCanonicalScenarioResults(raceId: string): Promise<ScenarioResultRow[]> {
    const rows = await this.db.query<{
      tse_id: string;
      institute_id: string;
      kind: string;
      t2_pair: string[] | null;
      field_start: string;
      field_end: string;
      sample_size: number;
      candidate_id: string;
      value_pct: number;
    }>(
      `SELECT ps.tse_id, reg.institute_id, ps.kind, ps.t2_pair,
              reg.field_start, reg.field_end, reg.sample_size,
              pr.candidate_id, pr.value_pct
         FROM poll_scenarios ps
         JOIN poll_registrations reg ON reg.tse_id = ps.tse_id
         JOIN poll_results pr ON pr.scenario_id = ps.id
        WHERE reg.race_id = $1
          AND reg.institute_id IS NOT NULL
          AND ps.is_canonical
        ORDER BY ps.tse_id, ps.kind, pr.candidate_id`,
      [raceId],
    );
    return rows.map((r) =>
      scenarioResultRowSchema.parse({
        tseId: r.tse_id,
        instituteId: r.institute_id,
        scenarioKind: r.kind,
        t2Pair: r.t2_pair,
        fieldStart: r.field_start,
        fieldEnd: r.field_end,
        sampleSize: r.sample_size,
        candidateId: r.candidate_id,
        valuePct: r.value_pct,
      }),
    );
  }

  /**
   * Registros do PesqEle da corrida, na forma que a taxa de gaveta consome
   * (docs/01 §6.1). `disclosed = (disclosure_status = 'disclosed')`. Exclui
   * registros sem instituto resolvido (o corte por instituto exige o id).
   */
  async listRegistrations(raceId: string): Promise<RegistrationRow[]> {
    const rows = await this.db.query<{
      institute_id: string;
      contractor_name: string;
      registered_at: string;
      disclosure_status: string;
    }>(
      `SELECT institute_id, contractor_name, registered_at, disclosure_status
         FROM poll_registrations
        WHERE race_id = $1
          AND institute_id IS NOT NULL
        ORDER BY tse_id`,
      [raceId],
    );
    return rows.map((r) =>
      registrationRowSchema.parse({
        instituteId: r.institute_id,
        contractorName: r.contractor_name,
        registeredAt: r.registered_at,
        disclosed: r.disclosure_status === 'disclosed',
      }),
    );
  }

  /**
   * Pesquisas individuais para `data.json`.polls (docs/03 §5, R6: sempre com
   * `tse_id`). Uma linha por (tse_id) com metadata; os valores de 1º/2º turno são
   * montados a partir das linhas de cenário no montador. `sourceUrl` é a URL do
   * raw mais recente (link para a fonte, nunca o texto dela — R3/docs/08 §2.1).
   */
  async listPolls(raceId: string): Promise<PollRow[]> {
    const rows = await this.db.query<{
      tse_id: string;
      institute_id: string;
      contractor_name: string;
      contractor_type: string | null;
      field_start: string;
      field_end: string;
      sample_size: number;
      margin_of_error: number | null;
      blank_null_pct: number | null;
      undecided_pct: number | null;
      source_url: string | null;
    }>(
      `SELECT reg.tse_id, reg.institute_id, reg.contractor_name, reg.contractor_type,
              reg.field_start, reg.field_end, reg.sample_size, reg.margin_of_error,
              -- Branco/nulo e não-sabe do cenário canônico de 1º turno desta
              -- pesquisa. Subquery em vez de JOIN para não multiplicar a linha da
              -- pesquisa quando houver cenário de 2º turno canônico também.
              (SELECT ps.blank_null_pct
                 FROM poll_scenarios ps
                WHERE ps.tse_id = reg.tse_id AND ps.is_canonical
                  AND ps.kind <> $2
                ORDER BY ps.extracted_at DESC
                LIMIT 1) AS blank_null_pct,
              (SELECT ps.undecided_pct
                 FROM poll_scenarios ps
                WHERE ps.tse_id = reg.tse_id AND ps.is_canonical
                  AND ps.kind <> $2
                ORDER BY ps.extracted_at DESC
                LIMIT 1) AS undecided_pct,
              (SELECT rd.url
                 FROM poll_scenarios ps
                 JOIN raw_documents rd ON rd.id = ps.raw_document_id
                WHERE ps.tse_id = reg.tse_id
                ORDER BY rd.fetched_at DESC
                LIMIT 1) AS source_url
         FROM poll_registrations reg
        WHERE reg.race_id = $1
          AND reg.institute_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM poll_scenarios ps
                       WHERE ps.tse_id = reg.tse_id AND ps.is_canonical)
        ORDER BY reg.field_end DESC, reg.tse_id`,
      [raceId, SCENARIO_KIND.t2],
    );
    return rows.map((r) =>
      pollRowSchema.parse({
        tseId: r.tse_id,
        instituteId: r.institute_id,
        contractorName: r.contractor_name,
        // contractor_type é opcional no banco; R6/docs/03 §5 exige string no público.
        // Ausente ⇒ 'desconhecido' (é o enum de "não classificado", não um default numérico).
        contractorType: r.contractor_type ?? 'desconhecido',
        fieldStart: r.field_start,
        fieldEnd: r.field_end,
        sampleSize: r.sample_size,
        marginOfError: r.margin_of_error,
        blankNullPct: r.blank_null_pct,
        undecidedPct: r.undecided_pct,
        // Sem raw associado seria contraditório (só listamos tse_id com cenário canônico),
        // mas por segurança de tipo a query pode devolver null; falha alta adiante.
        sourceUrl: r.source_url ?? '',
      }),
    );
  }

  /** Candidatos referenciados por algum resultado da corrida (docs/03 §5). */
  /**
   * Branco/nulo e não-sabe dos cenários canônicos, uma linha POR CENÁRIO
   * (MODEL_VERSION 0.0.4, Q-10). Vira `ElectorateObservation[]` na entrada do
   * modelo.
   *
   * Duas decisões que valem comentário:
   *
   * - Não juntamos com `listCanonicalScenarioResults`: aquela query devolve uma
   *   linha por CANDIDATO, e branco/nulo é do cenário. Juntar multiplicaria a
   *   grandeza pelo número de candidatos e a série sairia inflada.
   * - Trazemos o cenário mesmo quando as DUAS colunas são `null`. Parece inútil,
   *   mas não é: "este instituto mediu e não publicou a grandeza" é informação
   *   diferente de "este instituto não foi consultado", e é o modelo que decide o
   *   que fazer com a ausência (R4: ausência não é zero, e quem decide não é a
   *   query).
   */
  async listCanonicalElectorate(raceId: string): Promise<ElectorateRow[]> {
    const rows = await this.db.query<{
      tse_id: string;
      institute_id: string;
      kind: string;
      field_start: string;
      field_end: string;
      sample_size: number;
      blank_null_pct: number | null;
      undecided_pct: number | null;
    }>(
      `SELECT ps.tse_id, reg.institute_id, ps.kind,
              reg.field_start, reg.field_end, reg.sample_size,
              ps.blank_null_pct, ps.undecided_pct
         FROM poll_scenarios ps
         JOIN poll_registrations reg ON reg.tse_id = ps.tse_id
        WHERE reg.race_id = $1
          AND ps.is_canonical
          AND reg.institute_id IS NOT NULL
        ORDER BY reg.field_end, ps.tse_id, ps.kind`,
      [raceId],
    );
    return rows.map((r) =>
      electorateRowSchema.parse({
        tseId: r.tse_id,
        instituteId: r.institute_id,
        scenarioKind: r.kind,
        fieldStart: r.field_start,
        fieldEnd: r.field_end,
        sampleSize: r.sample_size,
        blankNullPct: r.blank_null_pct,
        undecidedPct: r.undecided_pct,
      }),
    );
  }

  async listCandidates(raceId: string): Promise<CandidateRow[]> {
    const rows = await this.db.query<{
      id: string;
      display_name: string;
      party: string | null;
      color_slot: number;
      photo_path: string | null;
      photo_source_url: string | null;
    }>(
      `SELECT DISTINCT c.id, c.display_name, c.party, c.color_slot,
              c.photo_path, c.photo_source_url
         FROM candidates c
         JOIN poll_results pr ON pr.candidate_id = c.id
         JOIN poll_scenarios ps ON ps.id = pr.scenario_id
         JOIN poll_registrations reg ON reg.tse_id = ps.tse_id
        WHERE reg.race_id = $1 AND ps.is_canonical
        ORDER BY c.color_slot, c.id`,
      [raceId],
    );
    return rows.map((r) =>
      candidateRowSchema.parse({
        id: r.id,
        displayName: r.display_name,
        party: r.party,
        colorSlot: r.color_slot,
        photoPath: r.photo_path,
        photoSourceUrl: r.photo_source_url,
      }),
    );
  }

  /** Institutos referenciados por algum registro canônico da corrida. */
  async listInstitutes(raceId: string): Promise<InstituteRow[]> {
    const rows = await this.db.query<{
      id: string;
      display_name: string;
      primary_method: string;
    }>(
      `SELECT DISTINCT i.id, i.display_name, i.primary_method
         FROM institutes i
         JOIN poll_registrations reg ON reg.institute_id = i.id
        WHERE reg.race_id = $1
          AND EXISTS (SELECT 1 FROM poll_scenarios ps
                       WHERE ps.tse_id = reg.tse_id AND ps.is_canonical)
        ORDER BY i.id`,
      [raceId],
    );
    return rows.map((r) =>
      instituteRowSchema.parse({
        id: r.id,
        displayName: r.display_name,
        method: r.primary_method,
      }),
    );
  }

  async getRace(raceId: string): Promise<RaceRow | null> {
    const rows = await this.db.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM races WHERE id = $1`,
      [raceId],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : raceRowSchema.parse({ id: row.id, displayName: row.display_name });
  }
}
