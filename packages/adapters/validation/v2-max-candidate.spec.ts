import { describe, it, expect } from 'vitest';
import { validateV2MaxCandidate } from './v2-max-candidate.js';
import { ValidationError } from './validation-error.js';
import { makeScenario, TEST_TSE_ID } from './test-support.js';

/**
 * V2: nenhum candidato > 70%. Borda: 70,0 passa (limite inclusivo), 70,01 falha.
 * A soma do cenário aqui é irrelevante — V2 só olha o teto por candidato.
 */
describe('V2 — teto por candidato', () => {
  it('70.0 passa (borda inclusiva)', () => {
    const scenario = makeScenario({
      values: [
        ['Lula', 70.0],
        ['Tarcísio', 29.0],
      ],
    });
    expect(() => validateV2MaxCandidate(scenario, TEST_TSE_ID)).not.toThrow();
  });

  it('70.01 falha (logo acima do teto)', () => {
    const scenario = makeScenario({
      values: [
        ['Lula', 70.01],
        ['Tarcísio', 20.0],
      ],
    });
    expect(() => validateV2MaxCandidate(scenario, TEST_TSE_ID)).toThrow(ValidationError);
  });

  it('a mensagem carrega tse_id, o candidato observado e o limite', () => {
    const scenario = makeScenario({ values: [['Lula', 71.0]] });
    try {
      validateV2MaxCandidate(scenario, TEST_TSE_ID);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.rule).toBe('V2');
      expect(ve.message).toContain(TEST_TSE_ID);
      expect(ve.message).toContain('Lula=71.00');
      expect(ve.message).toContain('70');
    }
  });
});
