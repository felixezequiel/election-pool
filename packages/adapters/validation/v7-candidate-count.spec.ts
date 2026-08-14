import { describe, it, expect } from 'vitest';
import { validateV7CandidateCount } from './v7-candidate-count.js';
import { ValidationError } from './validation-error.js';
import { makeScenario, TEST_TSE_ID } from './test-support.js';

/**
 * V7: contagem de candidatos ∈ [2, 20]. Bordas: 2 passa, 1 falha (inferior); 20
 * passa, 21 falha (superior). V7 só conta — não olha soma nem teto.
 */
describe('V7 — contagem de candidatos do cenário', () => {
  const withNCandidates = (n: number) =>
    makeScenario({ values: Array.from({ length: n }, (_, i) => [`c${String(i)}`, 1] as const) });

  it('2 candidatos passa (borda inferior inclusiva)', () => {
    expect(() => validateV7CandidateCount(withNCandidates(2), TEST_TSE_ID)).not.toThrow();
  });

  it('1 candidato falha (logo abaixo da borda inferior)', () => {
    expect(() => validateV7CandidateCount(withNCandidates(1), TEST_TSE_ID)).toThrow(
      ValidationError,
    );
  });

  it('20 candidatos passa (borda superior inclusiva)', () => {
    expect(() => validateV7CandidateCount(withNCandidates(20), TEST_TSE_ID)).not.toThrow();
  });

  it('21 candidatos falha (logo acima da borda superior)', () => {
    expect(() => validateV7CandidateCount(withNCandidates(21), TEST_TSE_ID)).toThrow(
      ValidationError,
    );
  });

  it('a mensagem carrega tse_id, contagem observada e o limite', () => {
    try {
      validateV7CandidateCount(withNCandidates(21), TEST_TSE_ID);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.rule).toBe('V7');
      expect(ve.message).toContain(TEST_TSE_ID);
      expect(ve.message).toContain('n=21');
      expect(ve.message).toContain('[2, 20]');
    }
  });
});
