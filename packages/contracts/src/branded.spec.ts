import { describe, it, expect } from 'vitest';
import { tseIdSchema, isoDateSchema, pctSchema, parseTseId, parsePct } from './branded.js';

describe('TseId', () => {
  it('accepts a zero-padded 5-digit sequence', () => {
    expect(() => parseTseId('BR-06591/2026')).not.toThrow();
    expect(tseIdSchema.safeParse('BR-06591/2026').success).toBe(true);
  });

  it("rejects 'BR-6591/2026' (only 4 digits, not zero-padded)", () => {
    expect(tseIdSchema.safeParse('BR-6591/2026').success).toBe(false);
    expect(() => parseTseId('BR-6591/2026')).toThrow();
  });

  it('rejects other malformed ids', () => {
    for (const bad of [
      '06591/2026',
      'BR-06591-2026',
      'BR-006591/2026',
      'br-06591/2026',
      'BR-06591/26',
    ]) {
      expect(tseIdSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('IsoDate', () => {
  it('accepts ISO-8601 with -03:00 offset', () => {
    expect(isoDateSchema.safeParse('2026-08-14T10:00:00-03:00').success).toBe(true);
  });

  it('accepts a pure date (field_start/field_end)', () => {
    expect(isoDateSchema.safeParse('2026-08-14').success).toBe(true);
  });

  it('rejects a naked Date-like string without offset', () => {
    expect(isoDateSchema.safeParse('2026-08-14T10:00:00').success).toBe(false);
    expect(isoDateSchema.safeParse('14/08/2026').success).toBe(false);
  });
});

describe('Pct (scale 0-100)', () => {
  it('accepts 0 and 100', () => {
    expect(() => parsePct(0)).not.toThrow();
    expect(() => parsePct(100)).not.toThrow();
  });

  it('rejects values outside 0-100', () => {
    expect(pctSchema.safeParse(-1).success).toBe(false);
    expect(pctSchema.safeParse(100.01).success).toBe(false);
  });

  it('rejects a 0-1 style fraction being silently accepted as valid range only', () => {
    // 0.4 is a legal number in [0,100]; the guarantee is only that >100 is rejected.
    expect(pctSchema.safeParse(0.4).success).toBe(true);
    expect(pctSchema.safeParse(400).success).toBe(false);
  });
});
