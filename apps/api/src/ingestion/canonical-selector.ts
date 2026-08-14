/**
 * `CanonicalSelector` — aplica a seleção canônica (docs/01 §3, `canonical-selection.ts`)
 * sobre os cenários já persistidos e grava `is_canonical` + `canonical_reason`.
 *
 * Roda no início do ModelJob (docs/02 §3.3), depois do harvest e ANTES do modelo:
 * o harvest grava todo cenário com `is_canonical=false` (não é papel dele decidir);
 * o modelo/render só leem `is_canonical=true`. Sem este passo M-1 reprova e nada
 * publica (LOG T-13).
 *
 * Escreve em `poll_scenarios` (que NÃO é append-only — só `poll_results` é, R5):
 * marcar/desmarcar canônico é metadata de seleção, regenerável, não altera nenhum
 * número de pesquisa. Idempotente: reexecutar reafirma a mesma escolha. A ordem
 * (desmarcar todos os do grupo, depois marcar o vencedor) respeita o índice único
 * parcial `poll_scenarios_one_canonical_idx` — nunca há dois canônicos no ar por
 * (tse_id, kind, t2_pair) durante a transição.
 */

import type { Database } from '../db/pool.js';
import { selectCanonicalScenarios } from './canonical-selection.js';
import type { ScenarioForSelection } from './canonical-selection.js';

const ZERO = 0;

export interface CanonicalSelectionResult {
  /** Nº de pesquisas (tse_id) consideradas. */
  registrationsConsidered: number;
  /** Nº de cenários marcados canônicos neste run. */
  canonicalMarked: number;
}

interface ScenarioRow {
  id: string;
  tse_id: string;
  kind: string;
  t2_pair: string[] | null;
  label: string;
  extracted_at: string;
}

export class CanonicalSelector {
  constructor(private readonly db: Database) {}

  /**
   * Seleciona e persiste o canônico de cada grupo de cada pesquisa da corrida.
   * Uma pesquisa = um `tse_id`; um grupo = (kind, t2_pair). Devolve contagens
   * para o log estruturado do ModelJob.
   */
  async selectForRace(raceId: string): Promise<CanonicalSelectionResult> {
    const scenariosByTse = await this.loadScenariosByTse(raceId);
    let canonicalMarked = ZERO;

    for (const [tseId, scenarios] of scenariosByTse) {
      const decisions = selectCanonicalScenarios(scenarios);
      const canonicalIds = new Set(decisions.map((d) => d.scenarioId));

      // 1. Desmarca todo cenário deste tse_id que NÃO deve ser canônico (evita
      //    dois canônicos no mesmo grupo e limpa escolhas antigas). Um único
      //    UPDATE cobre todos os grupos da pesquisa.
      const allIds = scenarios.map((s) => s.id);
      const nonCanonical = allIds.filter((id) => !canonicalIds.has(id));
      if (nonCanonical.length > ZERO) {
        await this.db.query(
          `UPDATE poll_scenarios
              SET is_canonical = false, canonical_reason = NULL
            WHERE tse_id = $1 AND id = ANY($2::uuid[]) AND is_canonical`,
          [tseId, nonCanonical],
        );
      }

      // 2. Marca cada vencedor com o motivo aplicado.
      for (const decision of decisions) {
        await this.db.query(
          `UPDATE poll_scenarios
              SET is_canonical = true, canonical_reason = $2
            WHERE id = $1`,
          [decision.scenarioId, decision.canonicalReason],
        );
        canonicalMarked++;
      }
    }

    return { registrationsConsidered: scenariosByTse.size, canonicalMarked };
  }

  /**
   * Carrega todos os cenários da corrida agrupados por `tse_id`, na forma mínima
   * que a regra precisa (id, kind, par, label, extração e os candidatos
   * resolvidos). Só entram cenários de registros COM instituto resolvido — o
   * modelo identifica por instituto (mesma exclusão do render, read-model.ts).
   */
  private async loadScenariosByTse(raceId: string): Promise<Map<string, ScenarioForSelection[]>> {
    const scenarioRows = await this.db.query<ScenarioRow>(
      `SELECT ps.id, ps.tse_id, ps.kind, ps.t2_pair, ps.label, ps.extracted_at
         FROM poll_scenarios ps
         JOIN poll_registrations reg ON reg.tse_id = ps.tse_id
        WHERE reg.race_id = $1
          AND reg.institute_id IS NOT NULL
        ORDER BY ps.tse_id, ps.extracted_at, ps.label`,
      [raceId],
    );

    if (scenarioRows.length === ZERO) return new Map();

    const candidateRows = await this.db.query<{ scenario_id: string; candidate_id: string }>(
      `SELECT pr.scenario_id, pr.candidate_id
         FROM poll_results pr
         JOIN poll_scenarios ps ON ps.id = pr.scenario_id
         JOIN poll_registrations reg ON reg.tse_id = ps.tse_id
        WHERE reg.race_id = $1
          AND reg.institute_id IS NOT NULL`,
      [raceId],
    );
    const candidatesByScenario = new Map<string, string[]>();
    for (const row of candidateRows) {
      const bucket = candidatesByScenario.get(row.scenario_id) ?? [];
      bucket.push(row.candidate_id);
      candidatesByScenario.set(row.scenario_id, bucket);
    }

    const byTse = new Map<string, ScenarioForSelection[]>();
    for (const row of scenarioRows) {
      const t2Pair =
        row.t2_pair === null
          ? null
          : ([row.t2_pair[0] ?? '', row.t2_pair[1] ?? ''] as [string, string]);
      const scenario: ScenarioForSelection = {
        id: row.id,
        kind: row.kind,
        t2Pair,
        label: row.label,
        extractedAt: row.extracted_at,
        candidateIds: candidatesByScenario.get(row.id) ?? [],
      };
      const bucket = byTse.get(row.tse_id) ?? [];
      bucket.push(scenario);
      byTse.set(row.tse_id, bucket);
    }
    return byTse;
  }
}
