import { describe, it, expect } from 'vitest';
import { validateV6TseIdMatch } from './v6-tse-id-match.js';
import { ValidationError } from './validation-error.js';
import { makePoll } from './test-support.js';

/**
 * V6: o `tse_id` do `ParsedPoll` bate EXATO com o do registro. Borda de igualdade:
 * mesmo id passa; qualquer diferença (outra rodada) falha.
 */
describe('V6 — identidade do tse_id', () => {
  it('tse_id idêntico passa', () => {
    const poll = makePoll([{ values: [['Lula', 40]] }], 'BR-06591/2026');
    expect(() => validateV6TseIdMatch(poll, 'BR-06591/2026')).not.toThrow();
  });

  it('tse_id de outra rodada falha', () => {
    const poll = makePoll([{ values: [['Lula', 40]] }], 'BR-07777/2026');
    expect(() => validateV6TseIdMatch(poll, 'BR-06591/2026')).toThrow(ValidationError);
  });

  it('a mensagem carrega o tse_id esperado, o extraído e a regra de igualdade', () => {
    const poll = makePoll([{ values: [['Lula', 40]] }], 'BR-07777/2026');
    try {
      validateV6TseIdMatch(poll, 'BR-06591/2026');
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      const ve = err as ValidationError;
      expect(ve.rule).toBe('V6');
      expect(ve.message).toContain('BR-06591/2026');
      expect(ve.message).toContain('BR-07777/2026');
      expect(ve.message).toContain('exato');
    }
  });
});
