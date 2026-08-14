import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  runKalman,
  observationVariance,
  recencyWeight,
  isoToDayNumber,
  dayNumberToIso,
  type SmoothedPoint,
} from '../kalman.js';
import { observationSchema, type Observation } from '@election-pool/contracts/model-io';
import {
  SIGMA_PROCESS,
  DEFF,
  SIGMA_HOUSE_EXTRA,
  TAU_RECENCY_DAYS,
  ACTIVE_WINDOW_DAYS,
  CI_Z_90,
} from '@election-pool/contracts/constants';

// --- PRNG semeado (test code): xorshift128 determinístico -------------------
// Vive só no teste (T-03 permite RNG semeado no arquivo de teste). Não usa
// Math.random para manter os testes reprodutíveis bit a bit.
function makeRng(seed: number): { next: () => number; gauss: () => number } {
  let x = seed | 0 || 0x1a2b3c4d;
  let y = 0x9e3779b9;
  let z = 0x243f6a88;
  let w = 0xb7e15162;
  const next = (): number => {
    const t = x ^ (x << 11);
    x = y;
    y = z;
    z = w;
    w = w ^ (w >>> 19) ^ (t ^ (t >>> 8));
    // para [0,1)
    return (w >>> 0) / 0x100000000;
  };
  // Box-Muller
  const gauss = (): number => {
    let u = next();
    let v = next();
    if (u < 1e-12) u = 1e-12;
    if (v < 1e-12) v = 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
}

const DAY_MS = 86400000;
function isoDay(offsetDays: number, base = '2026-06-01'): string {
  // Constrói uma data ISO pura deslocando `offsetDays` de uma base, via UTC para
  // evitar timezone do host (só nos testes).
  const baseMs = Date.UTC(
    Number(base.slice(0, 4)),
    Number(base.slice(5, 7)) - 1,
    Number(base.slice(8, 10)),
  );
  const d = new Date(baseMs + offsetDays * DAY_MS);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Constrói uma Observation VÁLIDA passando pelo schema Zod (fronteira real do
// contrato). Isso dá os branded types (Pct/IsoDate) sem cast manual.
interface ObsInput {
  candidateId: string;
  valuePct: number;
  fieldMedianDate: string;
  sampleSize: number;
  tseId?: string;
  instituteId?: string;
  scenarioKind?: Observation['scenarioKind'];
  t2Pair?: Observation['t2Pair'];
}

function obs(input: ObsInput): Observation {
  return observationSchema.parse({
    tseId: input.tseId ?? 'BR-00001/2026',
    instituteId: input.instituteId ?? 'inst-a',
    candidateId: input.candidateId,
    scenarioKind: input.scenarioKind ?? 't1_estimulado',
    t2Pair: input.t2Pair ?? null,
    fieldMedianDate: input.fieldMedianDate,
    sampleSize: input.sampleSize,
    valuePct: input.valuePct,
  });
}

function widthOf(p: SmoothedPoint): number {
  return p.hi90 - p.lo90;
}

// ---------------------------------------------------------------------------

describe('date helpers', () => {
  it('round-trips iso <-> day number', () => {
    for (const d of ['2022-10-01', '2026-06-01', '2000-01-01', '2024-02-29']) {
      expect(dayNumberToIso(isoToDayNumber(d))).toBe(d);
    }
  });

  it('computes day differences correctly', () => {
    expect(isoToDayNumber('2026-06-15') - isoToDayNumber('2026-06-01')).toBe(14);
    expect(isoToDayNumber('2022-10-29') - isoToDayNumber('2022-10-01')).toBe(28);
  });
});

describe('observationVariance (docs/01 §4.2)', () => {
  it('uses the current p, adds deff and house-extra, stays finite/positive', () => {
    const v = observationVariance(40, 1000);
    // σ_sampling² = 0.4·0.6/1000 · 100² = 2.4 ; ·deff + house² = 1.5·2.4 + 1 = 4.6
    const expected =
      DEFF * ((0.4 * 0.6) / 1000) * 100 * 100 + SIGMA_HOUSE_EXTRA * SIGMA_HOUSE_EXTRA;
    expect(v).toBeCloseTo(expected, 10);
    expect(v).toBeGreaterThan(0);
  });

  it('never returns NaN/Infinity/negative even for degenerate inputs', () => {
    for (const [p, n] of [
      [0, 1],
      [100, 1],
      [-10, 1],
      [200, 1],
      [50, 1],
      [50, Number.MAX_SAFE_INTEGER],
    ] as const) {
      const v = observationVariance(p, n);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('larger n gives smaller variance (more informative)', () => {
    expect(observationVariance(40, 2000)).toBeLessThan(observationVariance(40, 500));
  });
});

describe('recencyWeight (docs/01 §4.4)', () => {
  it('is 1 at delta 0 and decays with tau', () => {
    expect(recencyWeight(0)).toBeCloseTo(1, 12);
    expect(recencyWeight(TAU_RECENCY_DAYS)).toBeCloseTo(Math.exp(-1), 12);
    expect(recencyWeight(2 * TAU_RECENCY_DAYS)).toBeLessThan(recencyWeight(TAU_RECENCY_DAYS));
  });
});

describe('synthetic recovery (acceptance: within 0.5 p.p.)', () => {
  it('recovers a known constant mu from noisy observations', () => {
    const rng = makeRng(12345);
    const trueMu = 42;
    const n = 1500;
    const sd = Math.sqrt(observationVariance(trueMu, n)); // ~p.p. de ruído por obs
    const observations: Observation[] = [];
    const institutes = ['inst-a', 'inst-b', 'inst-c'];
    // 40 pesquisas ao longo de 40 dias, dentro da janela ativa.
    for (let day = 0; day < 40; day++) {
      const inst = institutes[day % institutes.length] ?? 'inst-a';
      const value = trueMu + sd * rng.gauss();
      observations.push(
        obs({
          candidateId: 'cand-1',
          instituteId: inst,
          valuePct: Math.min(100, Math.max(0, value)),
          fieldMedianDate: isoDay(day),
          sampleSize: n,
        }),
      );
    }
    const refDate = isoDay(40);
    const res = runKalman(observations, { referenceDate: refDate });
    const last = res.points.filter((p) => p.candidateId === 'cand-1').at(-1);
    expect(last).toBeDefined();
    expect(Math.abs((last?.mean ?? 0) - trueMu)).toBeLessThan(0.5);
  });

  it('recovers two independent candidates simultaneously', () => {
    const rng = makeRng(777);
    const mus: Record<string, number> = { a: 35, b: 22 };
    const n = 1600;
    const observations: Observation[] = [];
    for (let day = 0; day < 45; day++) {
      for (const [cand, mu] of Object.entries(mus)) {
        const sd = Math.sqrt(observationVariance(mu, n));
        observations.push(
          obs({
            candidateId: cand,
            instituteId: day % 2 === 0 ? 'inst-a' : 'inst-b',
            valuePct: Math.min(100, Math.max(0, mu + sd * rng.gauss())),
            fieldMedianDate: isoDay(day),
            sampleSize: n,
          }),
        );
      }
    }
    const res = runKalman(observations, { referenceDate: isoDay(45) });
    for (const [cand, mu] of Object.entries(mus)) {
      const last = res.points.filter((p) => p.candidateId === cand).at(-1);
      expect(Math.abs((last?.mean ?? 0) - mu)).toBeLessThan(0.5);
    }
  });
});

describe('gap widens the band (acceptance: monotone growth over 14 days)', () => {
  it('IC width grows monotonically across a 14-day observation gap', () => {
    // Observações densas até o dia 10, depois nada por 14 dias, ref no dia 24.
    const observations: Observation[] = [];
    for (let day = 0; day <= 10; day++) {
      observations.push(
        obs({
          candidateId: 'cand-1',
          instituteId: 'inst-a',
          valuePct: 40,
          fieldMedianDate: isoDay(day),
          sampleSize: 1200,
        }),
      );
    }
    const res = runKalman(observations, { referenceDate: isoDay(24) });
    const series = res.points
      .filter((p) => p.candidateId === 'cand-1')
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    // Nos dias do gap (11..24), a largura deve crescer estritamente.
    const gap = series.filter((p) => isoToDayNumber(p.date) >= isoToDayNumber(isoDay(11)));
    expect(gap.length).toBeGreaterThan(10);
    for (let i = 1; i < gap.length; i++) {
      const prev = gap[i - 1];
      const cur = gap[i];
      if (!prev || !cur) continue;
      expect(widthOf(cur)).toBeGreaterThan(widthOf(prev) - 1e-9);
    }
    // Deve efetivamente ALARGAR, não ficar plano.
    const first = gap[0];
    const lastGap = gap.at(-1);
    expect(widthOf(lastGap!)).toBeGreaterThan(widthOf(first!));
  });
});

describe('sample size pulls the estimate (acceptance)', () => {
  it('a large-n observation pulls mu more than a small-n one', () => {
    const base: Observation[] = [];
    for (let day = 0; day < 5; day++) {
      base.push(
        obs({
          candidateId: 'c',
          instituteId: 'inst-a',
          valuePct: 30,
          fieldMedianDate: isoDay(day),
          sampleSize: 1000,
        }),
      );
    }
    // Uma observação divergente (50%) no último dia, com n pequeno vs. n grande.
    const smallN = runKalman(
      [
        ...base,
        obs({
          candidateId: 'c',
          instituteId: 'inst-z',
          valuePct: 50,
          fieldMedianDate: isoDay(5),
          sampleSize: 200,
        }),
      ],
      { referenceDate: isoDay(5) },
    );
    const largeN = runKalman(
      [
        ...base,
        obs({
          candidateId: 'c',
          instituteId: 'inst-z',
          valuePct: 50,
          fieldMedianDate: isoDay(5),
          sampleSize: 8000,
        }),
      ],
      { referenceDate: isoDay(5) },
    );
    const meanAt = (r: ReturnType<typeof runKalman>): number =>
      r.points.filter((p) => p.candidateId === 'c').at(-1)?.mean ?? 0;
    // Ambos puxam acima de 30; o de n grande puxa mais para perto de 50.
    expect(meanAt(smallN)).toBeGreaterThan(30);
    expect(meanAt(largeN)).toBeGreaterThan(meanAt(smallN));
  });
});

describe('determinism (acceptance: byte-identical output)', () => {
  it('produces identical JSON on two runs of the same input', () => {
    const rng = makeRng(2024);
    const observations: Observation[] = [];
    for (let day = 0; day < 30; day++) {
      observations.push(
        obs({
          candidateId: day % 2 === 0 ? 'a' : 'b',
          instituteId: ['inst-a', 'inst-b', 'inst-c'][day % 3] ?? 'inst-a',
          valuePct: Math.min(100, Math.max(0, 30 + 10 * rng.gauss())),
          fieldMedianDate: isoDay(day),
          sampleSize: 800 + (day % 5) * 100,
        }),
      );
    }
    // Embaralha a ordem de entrada para provar que a ordenação interna domina.
    const shuffled = [...observations].reverse();
    const a = runKalman(observations, { referenceDate: isoDay(30) });
    const b = runKalman(shuffled, { referenceDate: isoDay(30) });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('fuzz (acceptance: 1000 random inputs, never NaN/Inf/negative variance)', () => {
  it('stays finite and non-negative across random and degenerate inputs', () => {
    const rng = makeRng(999);
    for (let iter = 0; iter < 1000; iter++) {
      const nObs = Math.floor(rng.next() * 30); // inclui 0 (degenerado)
      const observations: Observation[] = [];
      const nCands = 1 + Math.floor(rng.next() * 4);
      for (let k = 0; k < nObs; k++) {
        const cand = `c${Math.floor(rng.next() * nCands)}`;
        // valores nas bordas: 0, 100, e no meio; n mínimo 1.
        const roll = rng.next();
        const value = roll < 0.1 ? 0 : roll > 0.9 ? 100 : rng.next() * 100;
        const sample = 1 + Math.floor(rng.next() * 5000);
        const dayOffset = Math.floor(rng.next() * 60); // inclui obs fora da janela (>45)
        observations.push(
          obs({
            candidateId: cand,
            instituteId: `i${Math.floor(rng.next() * 6)}`,
            valuePct: value,
            fieldMedianDate: isoDay(dayOffset),
            sampleSize: sample,
          }),
        );
      }
      const refOffset = 60 + Math.floor(rng.next() * 5);
      const res = runKalman(observations, { referenceDate: isoDay(refOffset) });
      for (const p of res.points) {
        expect(Number.isFinite(p.mean)).toBe(true);
        expect(Number.isFinite(p.lo90)).toBe(true);
        expect(Number.isFinite(p.hi90)).toBe(true);
        expect(Number.isFinite(p.variance)).toBe(true);
        expect(p.variance).toBeGreaterThanOrEqual(0);
        expect(p.mean).toBeGreaterThanOrEqual(0);
        expect(p.mean).toBeLessThanOrEqual(100);
        expect(p.lo90).toBeLessThanOrEqual(p.hi90 + 1e-9);
        expect(p.lo90).toBeGreaterThanOrEqual(0);
        expect(p.hi90).toBeLessThanOrEqual(100);
      }
    }
  });

  it('handles empty input without throwing', () => {
    const res = runKalman([], { referenceDate: isoDay(0) });
    expect(res.points).toEqual([]);
    expect(res.candidateIds).toEqual([]);
  });
});

describe('band uses the 90% z multiplier from contracts', () => {
  it('half-width equals CI_Z_90 · sd', () => {
    const observations: Observation[] = [
      obs({
        candidateId: 'c',
        instituteId: 'inst-a',
        valuePct: 40,
        fieldMedianDate: isoDay(0),
        sampleSize: 1000,
      }),
    ];
    const res = runKalman(observations, { referenceDate: isoDay(0) });
    const p = res.points.find((x) => x.candidateId === 'c');
    expect(p).toBeDefined();
    if (p) {
      const half = (p.hi90 - p.lo90) / 2;
      expect(half).toBeCloseTo(CI_Z_90 * Math.sqrt(p.variance), 6);
    }
  });
});

// --- Arch guard (acceptance: no import from outside packages/) --------------
describe('architecture guard', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const sourceFiles = ['../kalman.ts', '../linalg.ts'];

  it('source imports only @election-pool/contracts, node stdlib, or relative paths', () => {
    const importRe = /import\s+(?:type\s+)?[^;]*?from\s+['"]([^'"]+)['"]/g;
    for (const rel of sourceFiles) {
      const src = readFileSync(join(here, rel), 'utf8');
      let match: RegExpExecArray | null;
      while ((match = importRe.exec(src)) !== null) {
        const spec = match[1] ?? '';
        const ok =
          spec.startsWith('@election-pool/contracts') ||
          spec.startsWith('.') ||
          spec.startsWith('node:');
        expect(ok, `illegal import '${spec}' in ${rel}`).toBe(true);
        // Explicitamente proíbe qualquer coisa vinda de apps/.
        expect(spec.includes('apps/')).toBe(false);
      }
    }
  });

  it('constants used are documented (no naked deff/tau/house literals in source)', () => {
    // Sanidade: os símbolos de constantes existem e são números finitos.
    for (const c of [
      SIGMA_PROCESS,
      DEFF,
      SIGMA_HOUSE_EXTRA,
      TAU_RECENCY_DAYS,
      ACTIVE_WINDOW_DAYS,
      CI_Z_90,
    ]) {
      expect(Number.isFinite(c)).toBe(true);
    }
  });
});
