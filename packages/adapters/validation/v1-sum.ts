/**
 * V1 (docs/04 §5): a soma dos candidatos + brancos/nulos + indecisos de um
 * cenário tem de fechar em [97, 103]. Fora dessa banda o cenário está incompleto
 * ou tem número trocado — bloqueia (R4). Limites de `@election-pool/contracts`.
 */

import type { ParsedScenario } from '@election-pool/contracts/domain';
import { V1_SUM_MIN, V1_SUM_MAX } from '@election-pool/contracts/constants';
import { ValidationError } from './validation-error.js';
import { fmtPct } from './format.js';

export const scenarioSum = (scenario: ParsedScenario): number => {
  const candidates = scenario.values.reduce((acc, v) => acc + v.valuePct, 0);
  const blankNull = scenario.blankNullPct ?? 0;
  const undecided = scenario.undecidedPct ?? 0;
  return candidates + blankNull + undecided;
};

export const validateV1Sum = (scenario: ParsedScenario, tseId: string): void => {
  const sum = scenarioSum(scenario);
  if (sum < V1_SUM_MIN || sum > V1_SUM_MAX) {
    throw new ValidationError({
      rule: 'V1',
      tseId,
      subject: scenario.label,
      observed: `soma=${fmtPct(sum)}`,
      limit: `[${String(V1_SUM_MIN)}, ${String(V1_SUM_MAX)}]`,
    });
  }
};
