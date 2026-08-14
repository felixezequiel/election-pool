/**
 * Carrega a série latente μ_t corrente por `candidate_id` (docs/04 §5, V5) a
 * partir das `model_estimates` do run mais recente da corrida. É a ponte entre o
 * modelo (que produz μ_t) e a colheita (que valida contra μ_t): o orquestrador
 * injeta esta função no HarvestJob.
 *
 * "μ_t corrente" = a média do 1º turno no ÚLTIMO nó datado da série (a data de
 * referência do run) — o mesmo ponto que a UI trata como "hoje". Usamos o run mais
 * recente que passou os gates (`gates_passed = true`): validar contra uma série que
 * o próprio pipeline reprovou seria comparar com dado que não publicaríamos. Sem
 * run aprovado ⇒ mapa vazio (modelo frio, V5 não dispara).
 */

import { SCENARIO_KIND } from '@election-pool/contracts/enums';
import type { Database } from '../db/pool.js';

export const makeCurrentLatentProvider =
  (db: Database, raceId: string) => async (): Promise<ReadonlyMap<string, number>> => {
    const rows = await db.query<{ candidate_id: string; mean_pct: number }>(
      `SELECT me.candidate_id, me.mean_pct
         FROM model_estimates me
        WHERE me.run_id = (
                SELECT id FROM model_runs
                 WHERE race_id = $1 AND gates_passed
                 ORDER BY run_at DESC
                 LIMIT 1
              )
          AND me.scenario_kind = $2
          AND me.date = (
                SELECT max(me2.date)
                  FROM model_estimates me2
                 WHERE me2.run_id = me.run_id AND me2.scenario_kind = $2
              )`,
      [raceId, SCENARIO_KIND.t1Estimulado],
    );
    return new Map(rows.map((r) => [r.candidate_id, r.mean_pct]));
  };
