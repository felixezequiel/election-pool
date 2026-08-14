/**
 * V6 (docs/04 §5, §4.1): o `tse_id` do `ParsedPoll` bate EXATO com o do registro.
 * É a regra que impede o pior bug do sistema — atribuir números da rodada errada.
 *
 * Nota: o `parse()` do adapter (`base/tse-id.ts`) já confirma a identidade e usa
 * `reg.tseId` como verdade, então na colheita normal isto nunca dispara. Mantemos
 * o validador porque o pipeline de REPARSE e chamadas diretas à validação podem
 * receber um `ParsedPoll` de outra origem — a validação bloqueante não presume
 * que quem a chama já garantiu V6. Sem limite numérico (comparação exata).
 */

import type { ParsedPoll } from '@election-pool/contracts/domain';
import { ValidationError } from './validation-error.js';

export const validateV6TseIdMatch = (parsed: ParsedPoll, expectedTseId: string): void => {
  if (parsed.tseId !== expectedTseId) {
    throw new ValidationError({
      rule: 'V6',
      tseId: expectedTseId,
      observed: `tse_id extraído="${parsed.tseId}"`,
      limit: `= "${expectedTseId}" (exato)`,
    });
  }
};
