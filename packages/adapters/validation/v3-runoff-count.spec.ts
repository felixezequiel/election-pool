import { describe, it, expect } from 'vitest';
import { validateV3RunoffCount } from './v3-runoff-count.js';
import { ValidationError } from './validation-error.js';
import { makeScenario, TEST_TSE_ID } from './test-support.js';

/**
 * V3: cenário de 2º turno tem EXATAMENTE 2 candidatos. Borda: 2 passa; 3 (e 1)
 * falham. Só se aplica a `kind === 't2'` — 1º turno passa livre por esta regra.
 */
describe('V3 — 2º turno com exatamente 2 candidatos', () => {
  it('t2 com 2 candidatos passa (borda exata)', () => {
    const scenario = makeScenario({
      kind: 't2',
      t2Pair: ['lula', 'tarcisio'],
      values: [
        ['Lula', 52.0],
        ['Tarcísio', 48.0],
      ],
    });
    expect(() => validateV3RunoffCount(scenario, TEST_TSE_ID)).not.toThrow();
  });

  it('t2 com 3 candidatos falha (logo acima da borda)', () => {
    const scenario = makeScenario({
      kind: 't2',
      t2Pair: ['lula', 'tarcisio'],
      values: [
        ['Lula', 40.0],
        ['Tarcísio', 35.0],
        ['Ciro', 25.0],
      ],
    });
    expect(() => validateV3RunoffCount(scenario, TEST_TSE_ID)).toThrow(ValidationError);
  });

  it('1º turno com 3 candidatos NÃO é checado por V3', () => {
    const scenario = makeScenario({
      kind: 't1_estimulado',
      values: [
        ['Lula', 40.0],
        ['Tarcísio', 30.0],
        ['Ciro', 20.0],
      ],
    });
    expect(() => validateV3RunoffCount(scenario, TEST_TSE_ID)).not.toThrow();
  });

  it('a mensagem carrega tse_id, contagem observada e o limite', () => {
    const scenario = makeScenario({
      kind: 't2',
      t2Pair: ['lula', 'tarcisio'],
      values: [['Lula', 100.0]],
    });
    try {
      validateV3RunoffCount(scenario, TEST_TSE_ID);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.rule).toBe('V3');
      expect(ve.message).toContain(TEST_TSE_ID);
      expect(ve.message).toContain('n=1');
      expect(ve.message).toContain('= 2');
    }
  });
});
