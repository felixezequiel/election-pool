import { describe, it, expect } from 'vitest';
import { validateV1Sum } from './v1-sum.js';
import { ValidationError } from './validation-error.js';
import { makeScenario, TEST_TSE_ID } from './test-support.js';

/**
 * V1: soma ∈ [97, 103]. Aceite explícito de T-07: 96,9 falha; 97,0 passa; 103,0
 * passa; 103,1 falha. Somamos candidatos + brancos/nulos + indecisos.
 */
describe('V1 — soma do cenário', () => {
  // A soma-alvo é distribuída entre dois candidatos para respeitar o teto de 100
  // por valor (pctSchema) — nenhum valor isolado passa de 100, mas a SOMA atinge
  // a borda exata que o aceite exige (96,9 / 97,0 / 103,0 / 103,1).
  const scenarioSumming = (total: number) => {
    const half = total / 2;
    return makeScenario({
      values: [
        ['Lula', half],
        ['Tarcísio', total - half],
      ],
    });
  };

  it('97.0 passa (borda inferior inclusiva)', () => {
    expect(() => validateV1Sum(scenarioSumming(97.0), TEST_TSE_ID)).not.toThrow();
  });

  it('96.9 falha (logo abaixo da borda inferior)', () => {
    expect(() => validateV1Sum(scenarioSumming(96.9), TEST_TSE_ID)).toThrow(ValidationError);
  });

  it('103.0 passa (borda superior inclusiva)', () => {
    expect(() => validateV1Sum(scenarioSumming(103.0), TEST_TSE_ID)).not.toThrow();
  });

  it('103.1 falha (logo acima da borda superior)', () => {
    expect(() => validateV1Sum(scenarioSumming(103.1), TEST_TSE_ID)).toThrow(ValidationError);
  });

  it('soma inclui brancos/nulos e indecisos', () => {
    const scenario = makeScenario({
      values: [
        ['Lula', 40],
        ['Tarcísio', 30],
      ],
      blankNullPct: 15,
      undecidedPct: 12, // 40+30+15+12 = 97 → passa
    });
    expect(() => validateV1Sum(scenario, TEST_TSE_ID)).not.toThrow();
  });

  it('a mensagem carrega tse_id, valor observado e limite', () => {
    try {
      validateV1Sum(scenarioSumming(96.9), TEST_TSE_ID);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const ve = err as ValidationError;
      expect(ve.rule).toBe('V1');
      expect(ve.tseId).toBe(TEST_TSE_ID);
      expect(ve.message).toContain(TEST_TSE_ID);
      expect(ve.message).toContain('96.90');
      expect(ve.message).toContain('[97, 103]');
    }
  });
});
