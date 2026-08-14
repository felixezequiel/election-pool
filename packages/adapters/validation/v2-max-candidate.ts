/**
 * V2 (docs/04 §5): nenhum candidato acima de 70% num cenário. Valor acima disso
 * num levantamento presidencial nacional é quase sempre erro de extração (coluna
 * trocada, dígito colado) — bloqueia (R4). Limite de `@election-pool/contracts`.
 */

import type { ParsedScenario } from '@election-pool/contracts/domain';
import { V2_MAX_CANDIDATE_PCT } from '@election-pool/contracts/constants';
import { ValidationError } from './validation-error.js';
import { fmtPct } from './format.js';

export const validateV2MaxCandidate = (scenario: ParsedScenario, tseId: string): void => {
  for (const value of scenario.values) {
    if (value.valuePct > V2_MAX_CANDIDATE_PCT) {
      throw new ValidationError({
        rule: 'V2',
        tseId,
        subject: `${scenario.label} / ${value.candidateAlias}`,
        observed: `${value.candidateAlias}=${fmtPct(value.valuePct)}`,
        limit: `≤ ${String(V2_MAX_CANDIDATE_PCT)}`,
      });
    }
  }
};
