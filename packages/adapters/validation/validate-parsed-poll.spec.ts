import { describe, it, expect } from 'vitest';
import { validateParsedPoll } from './validate-parsed-poll.js';
import { ValidationError } from './validation-error.js';
import { makePoll, TEST_TSE_ID } from './test-support.js';

/**
 * Orquestrador: roda V1–V7 e bloqueia na PRIMEIRA falha. Cobre a interação das
 * regras, a ordem (V6 antes das de cenário) e o efeito de `manuallyApproved`
 * (pula só V4/V5).
 */
describe('validateParsedPoll (orquestrador)', () => {
  const goodScenario = {
    values: [['Lula', 40] as const, ['Tarcísio', 30] as const],
    blankNullPct: 18,
    undecidedPct: 12, // soma 100 ∈ [97,103]
  };

  it('poll válido passa', () => {
    const poll = makePoll([goodScenario]);
    expect(() => validateParsedPoll({ parsed: poll, expectedTseId: TEST_TSE_ID })).not.toThrow();
  });

  it('V6 dispara antes das regras de cenário quando o tse_id não bate', () => {
    // Soma 40 (violaria V1) e 1 candidato (violaria V7), mas o tse_id errado tem
    // de disparar V6 PRIMEIRO — a ordem é o que este teste garante.
    const poll = makePoll([{ values: [['Lula', 40]] }], 'BR-07777/2026');
    try {
      validateParsedPoll({ parsed: poll, expectedTseId: TEST_TSE_ID });
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      expect((err as ValidationError).rule).toBe('V6'); // V6 primeiro, não V1/V2
    }
  });

  it('bloqueia por V1 quando a soma foge da banda', () => {
    const poll = makePoll([
      {
        values: [
          ['Lula', 40],
          ['Tarcísio', 30],
        ],
      },
    ]); // soma 70
    try {
      validateParsedPoll({ parsed: poll, expectedTseId: TEST_TSE_ID });
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      expect((err as ValidationError).rule).toBe('V1');
    }
  });

  it('V4 dispara com movimento grande vs. rodada anterior do instituto', () => {
    const poll = makePoll([
      {
        values: [
          ['Lula', 60],
          ['Tarcísio', 30],
        ],
        blankNullPct: 5,
        undecidedPct: 5,
      },
    ]);
    const previousRound = new Map([['Lula', 40]]); // Δ=20 > 10
    try {
      validateParsedPoll({
        parsed: poll,
        expectedTseId: TEST_TSE_ID,
        context: { previousRound },
      });
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      expect((err as ValidationError).rule).toBe('V4');
    }
  });

  it('manuallyApproved pula V4/V5 mas NÃO as estruturais', () => {
    const previousRound = new Map([['Lula', 40]]); // Δ=20 dispararia V4
    const movedPoll = makePoll([
      {
        values: [
          ['Lula', 60],
          ['Tarcísio', 30],
        ],
        blankNullPct: 5,
        undecidedPct: 5,
      },
    ]);
    // Com aprovação manual, V4 é pulado ⇒ passa.
    expect(() =>
      validateParsedPoll({
        parsed: movedPoll,
        expectedTseId: TEST_TSE_ID,
        context: { previousRound, manuallyApproved: true },
      }),
    ).not.toThrow();

    // Mas uma soma inválida (V1) continua bloqueando mesmo aprovado.
    const badSumPoll = makePoll([
      {
        values: [
          ['Lula', 40],
          ['Tarcísio', 30],
        ],
      },
    ]); // soma 70
    expect(() =>
      validateParsedPoll({
        parsed: badSumPoll,
        expectedTseId: TEST_TSE_ID,
        context: { previousRound, manuallyApproved: true },
      }),
    ).toThrow(ValidationError);
  });
});
