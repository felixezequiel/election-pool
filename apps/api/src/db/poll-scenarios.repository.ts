import { pollScenarioSchema, pollResultSchema } from '@election-pool/contracts/domain';
import type { PollScenario, PollResult } from '@election-pool/contracts/domain';
import type { Database } from './pool.js';

/**
 * Acesso a `poll_scenarios` e `poll_results` (docs/03 §2.4).
 *
 * `poll_results` é APPEND-ONLY (R5): este repositório só expõe insert e leitura.
 * Não há `update`/`delete` de propósito — a correção de erro de extração cria um
 * novo cenário e marca o antigo como superado. O trigger no banco é a rede de
 * segurança final.
 *
 * Toda linha lida passa pelo schema Zod de contrato antes de virar domínio.
 */

interface PollScenarioRow {
  id: string;
  tse_id: string;
  raw_document_id: string;
  kind: string;
  label: string;
  is_canonical: boolean;
  canonical_reason: string | null;
  t2_pair: string[] | null;
  blank_null_pct: number | null;
  undecided_pct: number | null;
  extracted_at: string;
}

interface PollResultRow {
  scenario_id: string;
  candidate_id: string;
  value_pct: number;
}

const mapScenario = (row: PollScenarioRow): PollScenario =>
  pollScenarioSchema.parse({
    id: row.id,
    tseId: row.tse_id,
    rawDocumentId: row.raw_document_id,
    kind: row.kind,
    label: row.label,
    isCanonical: row.is_canonical,
    canonicalReason: row.canonical_reason,
    t2Pair: row.t2_pair,
    blankNullPct: row.blank_null_pct,
    undecidedPct: row.undecided_pct,
    extractedAt: row.extracted_at,
  });

const mapResult = (row: PollResultRow): PollResult =>
  pollResultSchema.parse({
    scenarioId: row.scenario_id,
    candidateId: row.candidate_id,
    valuePct: row.value_pct,
  });

const SCENARIO_COLUMNS = `
  id, tse_id, raw_document_id, kind, label, is_canonical, canonical_reason,
  t2_pair, blank_null_pct, undecided_pct, extracted_at
`;

export class PollScenariosRepository {
  constructor(private readonly db: Database) {}

  async insertScenario(scenario: PollScenario): Promise<void> {
    await this.db.query(
      `INSERT INTO poll_scenarios
         (id, tse_id, raw_document_id, kind, label, is_canonical, canonical_reason,
          t2_pair, blank_null_pct, undecided_pct, extracted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        scenario.id,
        scenario.tseId,
        scenario.rawDocumentId,
        scenario.kind,
        scenario.label,
        scenario.isCanonical,
        scenario.canonicalReason,
        scenario.t2Pair,
        scenario.blankNullPct,
        scenario.undecidedPct,
        scenario.extractedAt,
      ],
    );
  }

  /**
   * Append-only: apenas insert (R5). O lote inteiro vai num único statement, então
   * ou todas as linhas do cenário entram, ou nenhuma — sem cenário meio-gravado.
   */
  async insertResults(results: readonly PollResult[]): Promise<void> {
    if (results.length === 0) return;
    const values: unknown[] = [];
    const tuples = results.map((result, i) => {
      const base = i * 3;
      values.push(result.scenarioId, result.candidateId, result.valuePct);
      return `($${String(base + 1)}, $${String(base + 2)}, $${String(base + 3)})`;
    });
    await this.db.query(
      `INSERT INTO poll_results (scenario_id, candidate_id, value_pct)
       VALUES ${tuples.join(', ')}`,
      values,
    );
  }

  async findScenarioById(id: string): Promise<PollScenario | null> {
    const rows = await this.db.query<PollScenarioRow>(
      `SELECT ${SCENARIO_COLUMNS} FROM poll_scenarios WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapScenario(row);
  }

  async listCanonicalByTseId(tseId: string): Promise<PollScenario[]> {
    const rows = await this.db.query<PollScenarioRow>(
      `SELECT ${SCENARIO_COLUMNS}
         FROM poll_scenarios
        WHERE tse_id = $1 AND is_canonical
        ORDER BY kind, label`,
      [tseId],
    );
    return rows.map(mapScenario);
  }

  async listResultsByScenario(scenarioId: string): Promise<PollResult[]> {
    const rows = await this.db.query<PollResultRow>(
      `SELECT scenario_id, candidate_id, value_pct
         FROM poll_results
        WHERE scenario_id = $1
        ORDER BY candidate_id`,
      [scenarioId],
    );
    return rows.map(mapResult);
  }
}
