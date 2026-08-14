/**
 * V5 (docs/04 §5): a variação de um candidato vs. a série latente corrente `μ_t`
 * não passa de 15 p.p. Como V4, um estouro pode ser movimento real e a resolução
 * é HUMANA (`pnpm ingest:approve`), nunca relaxamento do limite. Limite de
 * `@election-pool/contracts`.
 *
 * O `μ_t` corrente por alias vem do CHAMADOR (`ValidationContext`), calculado
 * pelo modelo. Sem estimativa ainda (modelo frio, primeiros dados) não há
 * baseline: a regra não dispara.
 */

import type { ParsedScenario } from '@election-pool/contracts/domain';
import { V5_MAX_DELTA_VS_LATENT_PP } from '@election-pool/contracts/constants';
import type { CurrentLatentByAlias } from './context.js';
import { ValidationError } from './validation-error.js';
import { fmtPct } from './format.js';

export const validateV5DeltaLatent = (
  scenario: ParsedScenario,
  tseId: string,
  currentLatent: CurrentLatentByAlias | undefined,
): void => {
  if (currentLatent === undefined) return;
  for (const value of scenario.values) {
    const mu = currentLatent.get(value.candidateAlias);
    if (mu === undefined) continue; // candidato sem estimativa latente: nada a comparar
    const delta = Math.abs(value.valuePct - mu);
    if (delta > V5_MAX_DELTA_VS_LATENT_PP) {
      throw new ValidationError({
        rule: 'V5',
        tseId,
        subject: `${scenario.label} / ${value.candidateAlias}`,
        observed:
          `${value.candidateAlias}: μ_t=${fmtPct(mu)} vs. observado ${fmtPct(value.valuePct)} ` +
          `(Δ=${fmtPct(delta)} p.p.)`,
        limit: `≤ ${String(V5_MAX_DELTA_VS_LATENT_PP)} p.p. vs. μ_t corrente`,
      });
    }
  }
};
