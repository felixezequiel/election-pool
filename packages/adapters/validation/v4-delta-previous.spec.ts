import { describe, it, expect } from 'vitest';
import { validateV4DeltaPrevious } from './v4-delta-previous.js';
import { ValidationError } from './validation-error.js';
import { makeScenario, TEST_TSE_ID } from './test-support.js';

/**
 * V4: |Δ vs. rodada anterior do mesmo instituto| ≤ 10 p.p. por candidato. Borda:
 * Δ=10,0 passa (inclusivo); Δ=10,1 falha. Sem baseline ⇒ não dispara.
 */
describe('V4 — delta vs. rodada anterior do instituto', () => {
  const previous = new Map<string, number>([['Lula', 40.0]]);

  it('Δ=10.0 passa (borda inclusiva)', () => {
    const scenario = makeScenario({ values: [['Lula', 50.0]] }); // 40 → 50 = 10.0
    expect(() => validateV4DeltaPrevious(scenario, TEST_TSE_ID, previous)).not.toThrow();
  });

  it('Δ=10.1 falha (logo acima da borda)', () => {
    const scenario = makeScenario({ values: [['Lula', 50.1]] }); // 40 → 50.1 = 10.1
    expect(() => validateV4DeltaPrevious(scenario, TEST_TSE_ID, previous)).toThrow(ValidationError);
  });

  it('queda também conta (valor absoluto do delta)', () => {
    const scenario = makeScenario({ values: [['Lula', 29.9]] }); // 40 → 29.9 = 10.1
    expect(() => validateV4DeltaPrevious(scenario, TEST_TSE_ID, previous)).toThrow(ValidationError);
  });

  it('sem baseline (primeira rodada do instituto) não dispara', () => {
    const scenario = makeScenario({ values: [['Lula', 99.9]] });
    expect(() => validateV4DeltaPrevious(scenario, TEST_TSE_ID, undefined)).not.toThrow();
  });

  it('candidato ausente da rodada anterior é pulado', () => {
    const scenario = makeScenario({ values: [['Tarcísio', 90.0]] });
    expect(() => validateV4DeltaPrevious(scenario, TEST_TSE_ID, previous)).not.toThrow();
  });

  it('a mensagem carrega tse_id, o delta observado e o limite', () => {
    const scenario = makeScenario({ values: [['Lula', 55.0]] }); // Δ=15
    try {
      validateV4DeltaPrevious(scenario, TEST_TSE_ID, previous);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.rule).toBe('V4');
      expect(ve.message).toContain(TEST_TSE_ID);
      expect(ve.message).toContain('Δ=15.00');
      expect(ve.message).toContain('10 p.p.');
    }
  });
});
