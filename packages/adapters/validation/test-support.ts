/**
 * Apoio a testes da validação (não é produção; só importado por specs). Constrói
 * `ParsedScenario`/`ParsedPoll` de contrato a partir de valores crus, para os
 * specs exercitarem cada regra na BORDA exata sem montar tipos branded na mão.
 */

import { parsedScenarioSchema, parsedPollSchema } from '@election-pool/contracts/domain';
import type { ParsedScenario, ParsedPoll } from '@election-pool/contracts/domain';
import type { ScenarioKind } from '@election-pool/contracts/enums';

export interface ScenarioSpec {
  kind?: ScenarioKind;
  label?: string;
  values: ReadonlyArray<readonly [alias: string, pct: number]>;
  t2Pair?: readonly [string, string];
  blankNullPct?: number;
  undecidedPct?: number;
}

export const makeScenario = (spec: ScenarioSpec): ParsedScenario =>
  parsedScenarioSchema.parse({
    kind: spec.kind ?? 't1_estimulado',
    label: spec.label ?? 'Cenário 1',
    values: spec.values.map(([candidateAlias, valuePct]) => ({ candidateAlias, valuePct })),
    ...(spec.t2Pair === undefined ? {} : { t2Pair: spec.t2Pair }),
    ...(spec.blankNullPct === undefined ? {} : { blankNullPct: spec.blankNullPct }),
    ...(spec.undecidedPct === undefined ? {} : { undecidedPct: spec.undecidedPct }),
  });

export const makePoll = (scenarios: readonly ScenarioSpec[], tseId = 'BR-06591/2026'): ParsedPoll =>
  parsedPollSchema.parse({
    tseId,
    scenarios: scenarios.map((s) => makeScenario(s)),
  });

export const TEST_TSE_ID = 'BR-06591/2026';
