import { describe, it, expect } from 'vitest';
import { selectCanonicalScenarios } from './canonical-selection.js';
import type { ScenarioForSelection } from './canonical-selection.js';
import { SCENARIO_KIND } from '@election-pool/contracts/enums';

/**
 * Seleção do cenário canônico (docs/01 §3). A regra é 1→2→3:
 *  1. mais candidatos confirmados; 2. mais nomes no total; 3. primeiro na ordem
 *  de publicação do instituto. 2º turno é pareado por (a,b) e cada par tem seu
 *  canônico.
 */

const t1 = (
  id: string,
  candidateIds: string[],
  extractedAt: string,
  label = id,
): ScenarioForSelection => ({
  id,
  kind: SCENARIO_KIND.t1Estimulado,
  t2Pair: null,
  label,
  extractedAt,
  candidateIds,
});

describe('selectCanonicalScenarios (docs/01 §3)', () => {
  it('regra 1: escolhe o cenário com mais candidatos confirmados', () => {
    const scenarios = [
      t1('a', ['lula', 'tarcisio'], '2026-08-01T10:00:00Z'),
      t1('b', ['lula', 'tarcisio', 'ciro-gomes', 'simone-tebet'], '2026-08-01T10:05:00Z'),
    ];
    const decisions = selectCanonicalScenarios(scenarios);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.scenarioId).toBe('b');
    expect(decisions[0]?.canonicalReason).toContain('regra 1');
  });

  it('regra 3: empate em contagem ⇒ o primeiro na ordem de publicação (extração asc)', () => {
    const scenarios = [
      // Mesma contagem (2) — decide a ordem de publicação: o mais cedo vence.
      t1('later', ['lula', 'tarcisio'], '2026-08-01T12:00:00Z'),
      t1('earlier', ['lula', 'ciro-gomes'], '2026-08-01T09:00:00Z'),
    ];
    const decisions = selectCanonicalScenarios(scenarios);
    expect(decisions[0]?.scenarioId).toBe('earlier');
    expect(decisions[0]?.canonicalReason).toContain('regra 3');
  });

  it('único cenário do grupo é canônico com motivo próprio', () => {
    const decisions = selectCanonicalScenarios([
      t1('solo', ['lula', 'tarcisio'], '2026-08-01T10:00:00Z'),
    ]);
    expect(decisions[0]?.scenarioId).toBe('solo');
    expect(decisions[0]?.canonicalReason).toContain('único cenário');
  });

  it('2º turno: um canônico POR PAR (pares independentes, docs/01 §3)', () => {
    const scenarios: ScenarioForSelection[] = [
      {
        id: 'p1',
        kind: SCENARIO_KIND.t2,
        t2Pair: ['bolsonaro', 'lula'],
        label: 'c1',
        extractedAt: '2026-08-01T10:00:00Z',
        candidateIds: ['lula', 'bolsonaro'],
      },
      {
        id: 'p2',
        kind: SCENARIO_KIND.t2,
        t2Pair: ['lula', 'tarcisio'],
        label: 'c2',
        extractedAt: '2026-08-01T10:00:00Z',
        candidateIds: ['lula', 'tarcisio'],
      },
    ];
    const decisions = selectCanonicalScenarios(scenarios);
    // Dois pares distintos ⇒ dois canônicos.
    expect(decisions.map((d) => d.scenarioId).sort()).toEqual(['p1', 'p2']);
  });

  it('não mistura kind: t1_estimulado e t1_espontaneo são grupos distintos', () => {
    const scenarios: ScenarioForSelection[] = [
      t1('est', ['lula', 'tarcisio', 'ciro-gomes'], '2026-08-01T10:00:00Z'),
      {
        id: 'esp',
        kind: SCENARIO_KIND.t1Espontaneo,
        t2Pair: null,
        label: 'esp',
        extractedAt: '2026-08-01T10:00:00Z',
        candidateIds: ['lula'],
      },
    ];
    const decisions = selectCanonicalScenarios(scenarios);
    // Um canônico por kind ⇒ ambos entram.
    expect(decisions.map((d) => d.scenarioId).sort()).toEqual(['esp', 'est']);
  });

  it('é determinístico: mesma entrada em ordem diferente ⇒ mesma escolha', () => {
    const a = t1('a', ['lula', 'tarcisio'], '2026-08-01T09:00:00Z');
    const b = t1('b', ['lula', 'ciro-gomes'], '2026-08-01T09:00:00Z');
    const forward = selectCanonicalScenarios([a, b]);
    const backward = selectCanonicalScenarios([b, a]);
    expect(forward).toEqual(backward);
  });
});
