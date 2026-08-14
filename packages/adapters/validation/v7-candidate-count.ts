/**
 * V7 (docs/04 §5): a contagem de candidatos de um cenário fica em [2, 20]. Menos
 * de 2 não é uma corrida; mais de 20 num cenário presidencial é ruído de extração
 * (linhas de rodapé, totais, notas). Bloqueia (R4). Limites de
 * `@election-pool/contracts`.
 *
 * A spec fala em "cenário canônico", mas a seleção do canônico é passo posterior
 * ao harvest (os cenários entram `is_canonical=false`, ver harvest.job.ts). Como
 * a validação roda ANTES de qualquer INSERT, aplicamos V7 a TODO cenário extraído
 * — é o superconjunto de qualquer futuro canônico, então nada que violaria V7 no
 * canônico escapa. V3 já cobre a contagem exata do 2º turno.
 */

import type { ParsedScenario } from '@election-pool/contracts/domain';
import { V7_MIN_CANDIDATES, V7_MAX_CANDIDATES } from '@election-pool/contracts/constants';
import { ValidationError } from './validation-error.js';

export const validateV7CandidateCount = (scenario: ParsedScenario, tseId: string): void => {
  const n = scenario.values.length;
  if (n < V7_MIN_CANDIDATES || n > V7_MAX_CANDIDATES) {
    throw new ValidationError({
      rule: 'V7',
      tseId,
      subject: scenario.label,
      observed: `n=${String(n)} candidatos`,
      limit: `[${String(V7_MIN_CANDIDATES)}, ${String(V7_MAX_CANDIDATES)}]`,
    });
  }
};
