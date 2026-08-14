import { describe, it, expect } from 'vitest';
import { CANDIDATE_PALETTE, candidatePaletteSchema } from './palette.js';
import { RACES, raceRegistrySchema } from './races.js';
import { COLOR_SLOT_MAX } from './constants.js';

describe('candidate palette (docs/05 §2.1)', () => {
  it('has exactly 8 slots, validates, and each slot has dark + light', () => {
    expect(candidatePaletteSchema.safeParse(CANDIDATE_PALETTE).success).toBe(true);
    expect(CANDIDATE_PALETTE).toHaveLength(COLOR_SLOT_MAX);
  });

  it('exposes contiguous slots 1..8 with two hex variants each', () => {
    const slots = CANDIDATE_PALETTE.map((entry) => entry.slot);
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const entry of CANDIDATE_PALETTE) {
      expect(entry.dark).toMatch(/^#[0-9A-F]{6}$/);
      expect(entry.light).toMatch(/^#[0-9A-F]{6}$/);
      expect(entry.dark).not.toBe(entry.light);
    }
  });

  it('reserves slot 8 (grafite) for "Demais"', () => {
    const last = CANDIDATE_PALETTE[COLOR_SLOT_MAX - 1];
    expect(last?.name).toBe('grafite');
  });
});

describe('race registry (docs/00 §7)', () => {
  it('validates and contains exactly one active race', () => {
    expect(raceRegistrySchema.safeParse(RACES).success).toBe(true);
    const active = RACES.filter((race) => race.status === 'ativo');
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe('presidencia-2026');
  });

  it('has planned races for the CTA block', () => {
    const planned = RACES.filter((race) => race.status === 'planejado');
    expect(planned.length).toBeGreaterThanOrEqual(1);
  });
});
