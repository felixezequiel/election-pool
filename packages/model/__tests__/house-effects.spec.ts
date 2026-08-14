import { describe, it, expect } from 'vitest';
import {
  estimateHouseEffects,
  applyWeightedSumZero,
  type HouseEffectResult,
} from '../house-effects.js';
import { runModel, type ModelInput } from '../index.js';
import { runKalman } from '../kalman.js';
import { observationSchema, type Observation } from '@election-pool/contracts/model-io';
import { modelOutputSchema } from '@election-pool/contracts/model-io';
import {
  MIN_POLLS_FOR_HOUSE_EFFECT,
  HOUSE_EFFECT_PRIOR_SD,
} from '@election-pool/contracts/constants';

// --- PRNG semeado (só no teste, T-03/T-04 permitem RNG semeado) -------------
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
    return (w >>> 0) / 0x100000000;
  };
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
function isoDay(offsetDays: number, base = '2026-05-01'): string {
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

interface ObsInput {
  candidateId: string;
  valuePct: number;
  fieldMedianDate: string;
  sampleSize: number;
  instituteId: string;
  scenarioKind?: Observation['scenarioKind'];
  t2Pair?: Observation['t2Pair'];
  tseId?: string;
}
function obs(input: ObsInput): Observation {
  return observationSchema.parse({
    tseId: input.tseId ?? 'BR-00001/2026',
    instituteId: input.instituteId,
    candidateId: input.candidateId,
    scenarioKind: input.scenarioKind ?? 't1_estimulado',
    t2Pair: input.t2Pair ?? null,
    fieldMedianDate: input.fieldMedianDate,
    sampleSize: input.sampleSize,
    valuePct: input.valuePct,
  });
}

function runLatentWith(referenceDate: string) {
  return (observations: readonly Observation[]): ReturnType<typeof runKalman> =>
    runKalman(observations, { referenceDate });
}

function estimate(observations: Observation[], referenceDate: string): HouseEffectResult {
  const initial = runKalman(observations, { referenceDate });
  return estimateHouseEffects(observations, initial, {
    runLatent: runLatentWith(referenceDate),
  });
}

function effectOf(res: HouseEffectResult, instituteId: string): number {
  return res.institutes.find((i) => i.instituteId === instituteId)?.effectPp ?? Number.NaN;
}

// ---------------------------------------------------------------------------

describe('applyWeightedSumZero (docs/01 §1.1 — restrição explícita e testável)', () => {
  it('drives the weighted sum to exactly zero within 1e-9', () => {
    const effects = [3, -1, 0.5, 2];
    const weights = [10, 5, 8, 2];
    const mask = [true, true, true, true];
    const projected = applyWeightedSumZero(effects, weights, mask);
    let s = 0;
    for (let i = 0; i < projected.length; i++) s += (weights[i] ?? 0) * (projected[i] ?? 0);
    expect(Math.abs(s)).toBeLessThan(1e-9);
  });

  it('excludes masked-out institutes from the constraint and pins them to 0', () => {
    const effects = [3, -1, 99];
    const weights = [10, 5, 1];
    const mask = [true, true, false];
    const projected = applyWeightedSumZero(effects, weights, mask);
    expect(projected[2]).toBe(0); // masked ⇒ pinned to 0
    // constraint holds over the unmasked set only
    let s = 0;
    for (let i = 0; i < 2; i++) s += (weights[i] ?? 0) * (projected[i] ?? 0);
    expect(Math.abs(s)).toBeLessThan(1e-9);
  });

  it('is idempotent (projecting a projected vector changes nothing)', () => {
    const effects = [1.2, -3.4, 0.7];
    const weights = [4, 4, 4];
    const mask = [true, true, true];
    const once = applyWeightedSumZero(effects, weights, mask);
    const twice = applyWeightedSumZero(once, weights, mask);
    for (let i = 0; i < once.length; i++) {
      expect(twice[i]).toBeCloseTo(once[i] ?? 0, 12);
    }
  });
});

describe('house effect recovery (acceptance: within 0.5 p.p.)', () => {
  it('recovers known per-institute h (weighted-centered) within 0.5 p.p.', () => {
    const rng = makeRng(4242);
    const trueMu = 40; // apoio latente constante do candidato rastreado
    const n = 2500;
    // h por instituto já centrado em peso (contagens iguais ⇒ soma simples = 0).
    const trueH: Record<string, number> = { 'inst-a': 2.5, 'inst-b': -1.5, 'inst-c': -1.0 };
    const institutes = Object.keys(trueH);
    const sd = Math.sqrt(0.2); // ruído pequeno para isolar a recuperação de h
    const observations: Observation[] = [];
    // 30 dias, cada instituto publica todo dia ⇒ w_i iguais.
    for (let day = 0; day < 30; day++) {
      for (const inst of institutes) {
        const value = trueMu + (trueH[inst] ?? 0) + sd * rng.gauss();
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
    }
    const res = estimate(observations, isoDay(30));
    for (const inst of institutes) {
      expect(Math.abs(effectOf(res, inst) - (trueH[inst] ?? 0))).toBeLessThan(0.5);
    }
  });

  it('satisfies Σ w_i·h_i = 0 within 1e-9 on estimated effects', () => {
    const rng = makeRng(99);
    const observations: Observation[] = [];
    const institutes = ['inst-a', 'inst-b', 'inst-c', 'inst-d'];
    const bias: Record<string, number> = {
      'inst-a': 3,
      'inst-b': -2,
      'inst-c': 1,
      'inst-d': -0.5,
    };
    // contagens DESIGUAIS de propósito (peso importa na restrição).
    const pollDays: Record<string, number> = {
      'inst-a': 20,
      'inst-b': 12,
      'inst-c': 8,
      'inst-d': 6,
    };
    for (const inst of institutes) {
      for (let day = 0; day < (pollDays[inst] ?? 0); day++) {
        observations.push(
          obs({
            candidateId: 'cand-1',
            instituteId: inst,
            valuePct: Math.min(100, Math.max(0, 35 + (bias[inst] ?? 0) + 0.3 * rng.gauss())),
            fieldMedianDate: isoDay(day),
            sampleSize: 1800,
          }),
        );
      }
    }
    const res = estimate(observations, isoDay(21));
    let weightedSum = 0;
    for (const inst of res.institutes) {
      if (!inst.estimable) continue;
      weightedSum += inst.nPolls * inst.effectPp;
    }
    expect(Math.abs(weightedSum)).toBeLessThan(1e-9);
  });
});

describe('estimability threshold (acceptance)', () => {
  it('an institute with 2 polls is estimable:false and effect 0', () => {
    expect(MIN_POLLS_FOR_HOUSE_EFFECT).toBe(3); // sanidade do contrato
    const observations: Observation[] = [];
    // inst-big: muitas pesquisas. inst-small: só 2.
    for (let day = 0; day < 15; day++) {
      observations.push(
        obs({
          candidateId: 'cand-1',
          instituteId: 'inst-big',
          valuePct: 40,
          fieldMedianDate: isoDay(day),
          sampleSize: 1500,
        }),
      );
    }
    for (let day = 0; day < 2; day++) {
      observations.push(
        obs({
          candidateId: 'cand-1',
          instituteId: 'inst-small',
          valuePct: 48, // divergente, mas poucas obs
          fieldMedianDate: isoDay(day),
          sampleSize: 1500,
        }),
      );
    }
    const res = estimate(observations, isoDay(15));
    const small = res.institutes.find((i) => i.instituteId === 'inst-small');
    expect(small).toBeDefined();
    expect(small?.estimable).toBe(false);
    expect(small?.effectPp).toBe(0);
    expect(small?.ciHalfWidthPp).toBe(0);
    expect(small?.nPolls).toBe(2);
  });
});

describe('adding an institute only redistributes as the constraint predicts', () => {
  it('the pairwise DIFFERENCE h_a - h_b is stable when a new institute enters', () => {
    const rng = makeRng(2026);
    const baseInstitutes = ['inst-a', 'inst-b'];
    const bias: Record<string, number> = { 'inst-a': 2, 'inst-b': -2, 'inst-c': 1 };
    function build(institutes: string[]): Observation[] {
      const out: Observation[] = [];
      // reinicializa o rng para que a única diferença seja o instituto extra
      const r = makeRng(555);
      for (let day = 0; day < 18; day++) {
        for (const inst of institutes) {
          out.push(
            obs({
              candidateId: 'cand-1',
              instituteId: inst,
              valuePct: Math.min(100, Math.max(0, 38 + (bias[inst] ?? 0) + 0.25 * r.gauss())),
              fieldMedianDate: isoDay(day),
              sampleSize: 2000,
            }),
          );
        }
      }
      return out;
    }
    void rng;
    const without = estimate(build(baseInstitutes), isoDay(18));
    const withNew = estimate(build([...baseInstitutes, 'inst-c']), isoDay(18));

    // A restrição só desloca todos por uma constante (a média ponderada muda ao
    // entrar inst-c). A DIFERENÇA entre dois institutos originais é invariante a
    // esse deslocamento comum ⇒ deve mudar muito pouco.
    const diffWithout = effectOf(without, 'inst-a') - effectOf(without, 'inst-b');
    const diffWith = effectOf(withNew, 'inst-a') - effectOf(withNew, 'inst-b');
    expect(Math.abs(diffWith - diffWithout)).toBeLessThan(0.3);
  });
});

describe('determinism (acceptance: byte-identical output)', () => {
  it('estimateHouseEffects is byte-identical across two runs of shuffled input', () => {
    const rng = makeRng(31415);
    const observations: Observation[] = [];
    const institutes = ['inst-a', 'inst-b', 'inst-c'];
    for (let day = 0; day < 25; day++) {
      for (const inst of institutes) {
        observations.push(
          obs({
            candidateId: day % 2 === 0 ? 'x' : 'y',
            instituteId: inst,
            valuePct: Math.min(100, Math.max(0, 30 + 5 * rng.gauss())),
            fieldMedianDate: isoDay(day),
            sampleSize: 1000 + (day % 4) * 250,
          }),
        );
      }
    }
    const a = estimate(observations, isoDay(25));
    const b = estimate([...observations].reverse(), isoDay(25));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('prior regularization (docs/01 §5)', () => {
  it('pulls a barely-estimable institute toward zero (|h| < unregularized residual)', () => {
    // inst-x tem exatamente MIN pesquisas e é fortemente divergente; o prior
    // N(0, HOUSE_EFFECT_PRIOR_SD²) deve encolher seu h em relação ao resíduo cru.
    expect(HOUSE_EFFECT_PRIOR_SD).toBeGreaterThan(0);
    const observations: Observation[] = [];
    for (let day = 0; day < 20; day++) {
      observations.push(
        obs({
          candidateId: 'cand-1',
          instituteId: 'inst-anchor',
          valuePct: 40,
          fieldMedianDate: isoDay(day),
          sampleSize: 1500,
        }),
      );
    }
    for (let day = 0; day < MIN_POLLS_FOR_HOUSE_EFFECT; day++) {
      observations.push(
        obs({
          candidateId: 'cand-1',
          instituteId: 'inst-x',
          valuePct: 48,
          fieldMedianDate: isoDay(day),
          sampleSize: 300, // n pequeno ⇒ precisão baixa ⇒ prior domina mais
        }),
      );
    }
    const res = estimate(observations, isoDay(20));
    const x = res.institutes.find((i) => i.instituteId === 'inst-x');
    expect(x?.estimable).toBe(true);
    // resíduo cru ~ +8 p.p.; regularizado deve ficar estritamente menor em módulo.
    expect(Math.abs(x?.effectPp ?? 0)).toBeLessThan(8);
    expect(x?.effectPp ?? 0).toBeGreaterThan(0); // ainda positivo (divergente p/ cima)
  });
});

// --- runModel: orquestração completa ---------------------------------------

describe('runModel — output validates against modelOutputSchema', () => {
  function buildInput(): ModelInput {
    const rng = makeRng(2718);
    const observations: Observation[] = [];
    const institutes = ['inst-a', 'inst-b', 'inst-c'];
    // Três candidatos rastreados de 1º turno somando ~85 (resíduo ~15).
    const mus: Record<string, number> = { 'cand-1': 40, 'cand-2': 30, 'cand-3': 15 };
    for (let day = 0; day < 30; day++) {
      const inst = institutes[day % institutes.length] ?? 'inst-a';
      for (const [cand, mu] of Object.entries(mus)) {
        observations.push(
          obs({
            candidateId: cand,
            instituteId: inst,
            valuePct: Math.min(100, Math.max(0, mu + 0.4 * rng.gauss())),
            fieldMedianDate: isoDay(day),
            sampleSize: 1600,
          }),
        );
      }
    }
    // Um cenário de 2º turno cand-1 × cand-2.
    for (let day = 0; day < 20; day++) {
      const inst = institutes[day % institutes.length] ?? 'inst-a';
      const pair: [string, string] = ['cand-1', 'cand-2'];
      observations.push(
        obs({
          candidateId: 'cand-1',
          instituteId: inst,
          valuePct: Math.min(100, Math.max(0, 52 + 0.5 * rng.gauss())),
          fieldMedianDate: isoDay(day),
          sampleSize: 1600,
          scenarioKind: 't2',
          t2Pair: pair,
        }),
      );
      observations.push(
        obs({
          candidateId: 'cand-2',
          instituteId: inst,
          valuePct: Math.min(100, Math.max(0, 44 + 0.5 * rng.gauss())),
          fieldMedianDate: isoDay(day),
          sampleSize: 1600,
          scenarioKind: 't2',
          t2Pair: pair,
        }),
      );
    }
    return { observations, referenceDate: isoDay(30) };
  }

  it('produces a ModelOutput that parses cleanly', () => {
    const out = runModel(buildInput());
    const parsed = modelOutputSchema.safeParse(out);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('assembles firstRound and a runoff series', () => {
    const out = runModel(buildInput());
    expect(out.latent.firstRound.length).toBeGreaterThan(0);
    expect(out.latent.runoffs.length).toBe(1);
    expect(out.latent.runoffs[0]?.pair).toEqual(['cand-1', 'cand-2']);
    // house effects: uma linha por (instituto, candidato) rastreado.
    expect(out.houseEffects.length).toBeGreaterThan(0);
    for (const row of out.houseEffects) {
      expect(row.lo90Pp).toBeLessThanOrEqual(row.hi90Pp);
    }
  });

  it('normalizes tracked candidates: per-date sum sits near the target', () => {
    const out = runModel(buildInput());
    // Para cada data, soma dos meios rastreados + resíduo deve ~100.
    for (const point of out.latent.firstRound) {
      const trackedSum = Object.values(point.byCandidate).reduce((s, c) => s + c.meanPct, 0);
      // resíduo era ~15 p.p.; soma rastreada normalizada deve ficar ~85.
      expect(trackedSum).toBeGreaterThan(75);
      expect(trackedSum).toBeLessThan(95);
    }
    expect(out.gates.sumOk).toBe(true);
    expect(out.gates.coverageOk).toBe(true);
  });

  it('is byte-identical across two runs of the same input (docs/01 §9)', () => {
    const input = buildInput();
    const a = runModel(input);
    const b = runModel({ ...input, observations: [...input.observations].reverse() });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
