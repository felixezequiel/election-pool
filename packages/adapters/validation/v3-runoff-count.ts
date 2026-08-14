/**
 * V3 (docs/04 §5): um cenário de 2º turno (`kind === 't2'`) tem EXATAMENTE 2
 * candidatos. Mais ou menos que isso não é um 2º turno — é extração errada do
 * cenário. Só se aplica a `t2`; cenários de 1º turno não são checados aqui (é V7
 * que limita a contagem deles). Limite de `@election-pool/contracts`.
 */

import type { ParsedScenario } from '@election-pool/contracts/domain';
import { V3_RUNOFF_CANDIDATE_COUNT } from '@election-pool/contracts/constants';
import { SCENARIO_KIND } from '@election-pool/contracts/enums';
import { ValidationError } from './validation-error.js';

export const validateV3RunoffCount = (scenario: ParsedScenario, tseId: string): void => {
  if (scenario.kind !== SCENARIO_KIND.t2) return;
  const n = scenario.values.length;
  if (n !== V3_RUNOFF_CANDIDATE_COUNT) {
    throw new ValidationError({
      rule: 'V3',
      tseId,
      subject: scenario.label,
      observed: `n=${String(n)} candidatos no 2º turno`,
      limit: `= ${String(V3_RUNOFF_CANDIDATE_COUNT)}`,
    });
  }
};
