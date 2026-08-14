/**
 * Orquestrador da validação bloqueante de ingestão (docs/04 §5). Roda V1–V7 sobre
 * um `ParsedPoll` ANTES de qualquer INSERT. Falha em QUALQUER regra ⇒ LANÇA
 * `ValidationError` (bloqueia; nada é persistido; o chamador loga em `error` e
 * marca o adapter suspeito — R4). Para na PRIMEIRA falha: uma pesquisa suspeita já
 * está suspeita, não precisamos enumerar todos os problemas dela.
 *
 * Ordem das regras:
 *   1. V6 (identidade) primeiro — se é a rodada errada, o resto é irrelevante.
 *   2. Por cenário, na ordem V7 (contagem) → V1 (soma) → V2 (teto) → V3 (2º turno)
 *      → V4 (Δ instituto) → V5 (Δ μ_t). Estruturais antes das comparativas.
 *
 * V4/V5 dependem de contexto do chamador (`ValidationContext`): rodada anterior
 * do instituto e `μ_t` corrente. Ausentes ⇒ a regra correspondente é pulada (não
 * há baseline). `manuallyApproved` (via `ingest:approve`) pula V4 e V5 — e SÓ elas:
 * aprovar um movimento real não desliga as regras estruturais.
 */

import type { ParsedPoll } from '@election-pool/contracts/domain';
import type { ValidationContext } from './context.js';
import { validateV6TseIdMatch } from './v6-tse-id-match.js';
import { validateV7CandidateCount } from './v7-candidate-count.js';
import { validateV1Sum } from './v1-sum.js';
import { validateV2MaxCandidate } from './v2-max-candidate.js';
import { validateV3RunoffCount } from './v3-runoff-count.js';
import { validateV4DeltaPrevious } from './v4-delta-previous.js';
import { validateV5DeltaLatent } from './v5-delta-latent.js';

export interface ValidateParsedPollArgs {
  readonly parsed: ParsedPoll;
  /** `tse_id` do registro — a VERDADE. V6 confirma o extraído contra este. */
  readonly expectedTseId: string;
  readonly context?: ValidationContext;
}

export const validateParsedPoll = (args: ValidateParsedPollArgs): void => {
  const { parsed, expectedTseId } = args;
  const context = args.context ?? {};
  const tseId = expectedTseId;

  validateV6TseIdMatch(parsed, expectedTseId);

  const skipDeltas = context.manuallyApproved === true;

  for (const scenario of parsed.scenarios) {
    validateV7CandidateCount(scenario, tseId);
    validateV1Sum(scenario, tseId);
    validateV2MaxCandidate(scenario, tseId);
    validateV3RunoffCount(scenario, tseId);
    if (!skipDeltas) {
      validateV4DeltaPrevious(scenario, tseId, context.previousRound);
      validateV5DeltaLatent(scenario, tseId, context.currentLatent);
    }
  }
};
