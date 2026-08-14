import { describe, it, expect } from 'vitest';
import { generatedAtIso, nextUpdateAtIso, toSaoPauloIso } from './time.js';

/**
 * Datas em -03:00 (CLAUDE.md). `nextUpdateAt` = próximo slot de 2h do cron.
 */

describe('toSaoPauloIso / generatedAtIso', () => {
  it('formats an instant in -03:00 with the fixed offset', () => {
    // 2026-08-14T18:00:00Z = 15:00 em -03:00.
    const iso = toSaoPauloIso(new Date('2026-08-14T18:00:00Z'));
    expect(iso).toBe('2026-08-14T15:00:00-03:00');
    expect(generatedAtIso(new Date('2026-08-14T18:00:00Z'))).toBe('2026-08-14T15:00:00-03:00');
  });
});

describe('nextUpdateAtIso', () => {
  it('returns the next even 2h slot in -03:00', () => {
    // 15:00 -03:00 ⇒ próximo slot par é 16:00 -03:00.
    const now = new Date('2026-08-14T15:00:00-03:00');
    expect(nextUpdateAtIso(now)).toBe('2026-08-14T16:00:00-03:00');
  });

  it('when now is exactly on a slot, returns the following slot (never zero countdown)', () => {
    const now = new Date('2026-08-14T16:00:00-03:00'); // slot par exato
    expect(nextUpdateAtIso(now)).toBe('2026-08-14T18:00:00-03:00');
  });

  it('is always strictly in the future relative to now', () => {
    const now = new Date('2026-08-14T15:37:12-03:00');
    const next = nextUpdateAtIso(now);
    expect(Date.parse(next)).toBeGreaterThan(now.getTime());
    // e a diferença nunca passa do intervalo (120 min).
    expect(Date.parse(next) - now.getTime()).toBeLessThanOrEqual(120 * 60 * 1000);
  });
});
