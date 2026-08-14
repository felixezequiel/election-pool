/**
 * V4 (docs/04 §5): a variação de um candidato vs. a rodada ANTERIOR do MESMO
 * instituto não passa de 10 p.p. Um salto maior costuma ser erro, mas PODE ser
 * movimento real (desistência, escândalo) — por isso a resolução é HUMANA, via
 * `pnpm ingest:approve` (docs/04 §5). NÃO se relaxa o limite. Limite de
 * `@election-pool/contracts`.
 *
 * A baseline (rodada anterior por alias) vem do CHAMADOR (`ValidationContext`),
 * pois exige I/O ao banco — a validação em si é pura. Sem baseline (primeira
 * rodada do instituto) não há o que comparar: a regra não dispara.
 */

import type { ParsedScenario } from '@election-pool/contracts/domain';
import { V4_MAX_DELTA_SAME_INSTITUTE_PP } from '@election-pool/contracts/constants';
import type { PreviousRoundByAlias } from './context.js';
import { ValidationError } from './validation-error.js';
import { fmtPct } from './format.js';

export const validateV4DeltaPrevious = (
  scenario: ParsedScenario,
  tseId: string,
  previousRound: PreviousRoundByAlias | undefined,
): void => {
  if (previousRound === undefined) return;
  for (const value of scenario.values) {
    const before = previousRound.get(value.candidateAlias);
    if (before === undefined) continue; // candidato sem rodada anterior: nada a comparar
    const delta = Math.abs(value.valuePct - before);
    if (delta > V4_MAX_DELTA_SAME_INSTITUTE_PP) {
      throw new ValidationError({
        rule: 'V4',
        tseId,
        subject: `${scenario.label} / ${value.candidateAlias}`,
        observed:
          `${value.candidateAlias}: ${fmtPct(before)}→${fmtPct(value.valuePct)} ` +
          `(Δ=${fmtPct(delta)} p.p.)`,
        limit: `≤ ${String(V4_MAX_DELTA_SAME_INSTITUTE_PP)} p.p. vs. rodada anterior do instituto`,
      });
    }
  }
};
