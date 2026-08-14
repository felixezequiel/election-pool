import { describe, it, expect } from 'vitest';
import { validateV5DeltaLatent } from './v5-delta-latent.js';
import { ValidationError } from './validation-error.js';
import { makeScenario, TEST_TSE_ID } from './test-support.js';

/**
 * V5: |Δ vs. μ_t corrente| ≤ 15 p.p. por candidato. Borda: Δ=15,0 passa
 * (inclusivo); Δ=15,1 falha. Sem estimativa latente ⇒ não dispara.
 */
describe('V5 — delta vs. μ_t corrente', () => {
  const latent = new Map<string, number>([['Lula', 40.0]]);

  it('Δ=15.0 passa (borda inclusiva)', () => {
    const scenario = makeScenario({ values: [['Lula', 55.0]] }); // 40 → 55 = 15.0
    expect(() => validateV5DeltaLatent(scenario, TEST_TSE_ID, latent)).not.toThrow();
  });

  it('Δ=15.1 falha (logo acima da borda)', () => {
    const scenario = makeScenario({ values: [['Lula', 55.1]] }); // 40 → 55.1 = 15.1
    expect(() => validateV5DeltaLatent(scenario, TEST_TSE_ID, latent)).toThrow(ValidationError);
  });

  it('sem μ_t (modelo frio) não dispara', () => {
    const scenario = makeScenario({ values: [['Lula', 99.9]] });
    expect(() => validateV5DeltaLatent(scenario, TEST_TSE_ID, undefined)).not.toThrow();
  });

  it('candidato ausente da série latente é pulado', () => {
    const scenario = makeScenario({ values: [['Tarcísio', 90.0]] });
    expect(() => validateV5DeltaLatent(scenario, TEST_TSE_ID, latent)).not.toThrow();
  });

  it('a mensagem carrega tse_id, μ_t observado e o limite', () => {
    const scenario = makeScenario({ values: [['Lula', 60.0]] }); // Δ=20
    try {
      validateV5DeltaLatent(scenario, TEST_TSE_ID, latent);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.rule).toBe('V5');
      expect(ve.message).toContain(TEST_TSE_ID);
      expect(ve.message).toContain('μ_t=40.00');
      expect(ve.message).toContain('15 p.p.');
    }
  });
});
