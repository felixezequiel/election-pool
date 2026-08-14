import { describe, it, expect } from 'vitest';
import { __test } from './types.js';

/**
 * Teste unitário do parser de timestamptz → ISO-8601 -03:00. Não precisa de DB.
 * O offset do Brasil é constante -03:00 desde 2019 (sem horário de verão).
 */

describe('toSaoPauloIso', () => {
  it('formata um instante UTC no offset -03:00', () => {
    // 2026-08-14T13:00:00Z == 10:00 em São Paulo.
    expect(__test.toSaoPauloIso(new Date('2026-08-14T13:00:00Z'))).toBe(
      '2026-08-14T10:00:00-03:00',
    );
  });

  it('cruza a fronteira de dia corretamente', () => {
    // 2026-08-14T02:00:00Z == 2026-08-13T23:00:00-03:00.
    expect(__test.toSaoPauloIso(new Date('2026-08-14T02:00:00Z'))).toBe(
      '2026-08-13T23:00:00-03:00',
    );
  });

  it('faz round-trip: o ISO produzido representa o mesmo instante', () => {
    const utc = new Date('2026-01-01T00:30:00Z');
    const iso = __test.toSaoPauloIso(utc);
    expect(new Date(iso).getTime()).toBe(utc.getTime());
  });
});
