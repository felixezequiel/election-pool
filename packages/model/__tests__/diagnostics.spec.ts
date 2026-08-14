import { describe, it, expect } from 'vitest';
import {
  computeGavetaRates,
  computeHerding,
  computeDivergence,
  computeDiagnostics,
  type RegistrationRecord,
  type HouseEffectInput,
} from '../diagnostics.js';
import { runModel, type ModelInput } from '../index.js';
import { observationSchema, type Observation } from '@election-pool/contracts/model-io';
import {
  HERDING_RATIO_THRESHOLD,
  DIVERGENCE_ABS_PP_THRESHOLD,
  DISCLOSURE_REGISTER_LEAD_DAYS,
  DISCLOSURE_GRACE_DAYS,
} from '@election-pool/contracts/constants';

// --- helpers ----------------------------------------------------------------

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

function reg(input: Partial<RegistrationRecord> & { registeredAt: string }): RegistrationRecord {
  return {
    instituteId: input.instituteId ?? 'inst-a',
    contractorName: input.contractorName ?? 'Contratante X',
    registeredAt: input.registeredAt,
    disclosed: input.disclosed ?? false,
  };
}

function he(input: Partial<HouseEffectInput> & { instituteId: string }): HouseEffectInput {
  return {
    instituteId: input.instituteId,
    effectPp: input.effectPp ?? 0,
    lo90Pp: input.lo90Pp ?? 0,
    hi90Pp: input.hi90Pp ?? 0,
    estimable: input.estimable ?? true,
  };
}

// DISCLOSURE_WINDOW = 5 + 15 = 20 dias. reg em D0, elegível a partir de D0+20.
const WINDOW = DISCLOSURE_REGISTER_LEAD_DAYS + DISCLOSURE_GRACE_DAYS;

// =============================================================================
// §6.1 — gaveta
// =============================================================================

describe('gaveta (docs/01 §6.1)', () => {
  it('institute with 1 registration and 0 disclosures ⇒ rate 1.0 with registered:1', () => {
    // Aceite T-08: a UI precisa distinguir isso de 0,6 sobre 20.
    const registrations = [
      reg({ instituteId: 'inst-a', registeredAt: '2026-05-01', disclosed: false }),
    ];
    const rates = computeGavetaRates(registrations, '2026-06-01'); // > 2026-05-01 + 20

    const instRow = rates.find((r) => r.subjectKind === 'institute' && r.subjectId === 'inst-a');
    expect(instRow).toBeDefined();
    expect(instRow?.rate).toBe(1);
    expect(instRow?.registered).toBe(1);
    expect(instRow?.disclosed).toBe(0);
  });

  it('distinguishes 1.0-over-1 from 0.6-over-20 by carrying registered/disclosed', () => {
    // 20 registros, 8 divulgados ⇒ rate 0.6. Numerador/denominador sempre presentes.
    const registrations: RegistrationRecord[] = [];
    for (let i = 0; i < 20; i++) {
      registrations.push(
        reg({ instituteId: 'inst-b', registeredAt: '2026-05-01', disclosed: i < 8 }),
      );
    }
    const rates = computeGavetaRates(registrations, '2026-06-01');
    const row = rates.find((r) => r.subjectKind === 'institute' && r.subjectId === 'inst-b');
    expect(row?.rate).toBeCloseTo(0.6, 10);
    expect(row?.registered).toBe(20);
    expect(row?.disclosed).toBe(8);
  });

  it('only counts registrations whose disclosure window has passed (reg + 5 + 15)', () => {
    const registrations = [
      reg({ instituteId: 'inst-c', registeredAt: '2026-05-01', disclosed: false }), // janela passou
      reg({ instituteId: 'inst-c', registeredAt: '2026-05-25', disclosed: false }), // janela AINDA não passou
    ];
    // referência exatamente em reg1 + WINDOW: elegível; reg2 + WINDOW ainda no futuro.
    const refDay = `2026-05-${String(1 + WINDOW).padStart(2, '0')}`; // 2026-05-21
    const rates = computeGavetaRates(registrations, refDay);
    const row = rates.find((r) => r.subjectKind === 'institute' && r.subjectId === 'inst-c');
    expect(row?.registered).toBe(1); // só o primeiro conta
    expect(row?.rate).toBe(1);
  });

  it('produces both institute and contractor cuts', () => {
    const registrations = [
      reg({
        instituteId: 'inst-a',
        contractorName: 'Jornal Y',
        registeredAt: '2026-05-01',
        disclosed: true,
      }),
      reg({
        instituteId: 'inst-a',
        contractorName: 'Partido Z',
        registeredAt: '2026-05-01',
        disclosed: false,
      }),
    ];
    const rates = computeGavetaRates(registrations, '2026-06-30');

    const inst = rates.filter((r) => r.subjectKind === 'institute');
    const contractors = rates.filter((r) => r.subjectKind === 'contractor');
    expect(inst).toHaveLength(1);
    expect(inst[0]?.registered).toBe(2);
    expect(inst[0]?.disclosed).toBe(1);
    expect(inst[0]?.rate).toBeCloseTo(0.5, 10);
    // Corte por contratante: taxa diferente conforme quem paga (docs/01 §6.1).
    expect(contractors).toHaveLength(2);
    const jornal = contractors.find((c) => c.subjectId === 'Jornal Y');
    const partido = contractors.find((c) => c.subjectId === 'Partido Z');
    expect(jornal?.rate).toBe(0);
    expect(partido?.rate).toBe(1);
  });

  it('returns nothing when no registration is yet eligible', () => {
    const registrations = [reg({ registeredAt: '2026-05-25', disclosed: false })];
    const rates = computeGavetaRates(registrations, '2026-05-26'); // janela não passou
    expect(rates).toEqual([]);
  });
});

// =============================================================================
// §6.2 — herding
// =============================================================================

describe('herding (docs/01 §6.2)', () => {
  it('a window with 3 polls produces no herding result', () => {
    // Aceite T-08: < HERDING_MIN_POLLS (=4) ⇒ sem teste.
    const observations = [
      obs({
        instituteId: 'i1',
        candidateId: 'cand-1',
        valuePct: 40,
        fieldMedianDate: '2026-05-01',
        sampleSize: 1000,
      }),
      obs({
        instituteId: 'i2',
        candidateId: 'cand-1',
        valuePct: 41,
        fieldMedianDate: '2026-05-02',
        sampleSize: 1000,
      }),
      obs({
        instituteId: 'i3',
        candidateId: 'cand-1',
        valuePct: 39,
        fieldMedianDate: '2026-05-03',
        sampleSize: 1000,
      }),
    ];
    expect(computeHerding(observations)).toEqual([]);
  });

  it('synthetic data with dispersion equal to theoretical ⇒ ratio ≈ 1', () => {
    // Construção: p=40, n=1000 ⇒ σ_i² = 4.6. Quatro valores simétricos em torno de
    // 40 com variância amostral (denom n−1) exatamente 4.6 ⇒ ratio ≈ 1.
    // a = sqrt(3·σ²/4). Ver diagnostics.ts §6.2 / house-effects observationVariance.
    const a = Math.sqrt((3 * 4.6) / 4);
    const values = [40 - a, 40 - a, 40 + a, 40 + a];
    const observations = values.map((v, k) =>
      obs({
        instituteId: `i${k}`,
        candidateId: 'cand-1',
        valuePct: v,
        fieldMedianDate: '2026-05-03',
        sampleSize: 1000,
      }),
    );
    const results = computeHerding(observations);
    expect(results).toHaveLength(1);
    expect(results[0]?.nPolls).toBe(4);
    expect(results[0]?.ratio).toBeCloseTo(1, 6);
    expect(results[0]?.flagged).toBe(false); // 1 não é < THRESHOLD (0.5)
  });

  it('flags a window whose dispersion is far below theoretical', () => {
    // Quatro valores quase idênticos (dispersão ~0) ⇒ ratio ≪ THRESHOLD ⇒ flagged.
    const observations = [40.0, 40.01, 39.99, 40.0].map((v, k) =>
      obs({
        instituteId: `i${k}`,
        candidateId: 'cand-1',
        valuePct: v,
        fieldMedianDate: '2026-05-03',
        sampleSize: 1000,
      }),
    );
    const results = computeHerding(observations);
    expect(results).toHaveLength(1);
    expect(results[0]?.ratio).toBeLessThan(HERDING_RATIO_THRESHOLD);
    expect(results[0]?.flagged).toBe(true);
    expect(results[0]?.nPolls).toBe(4);
  });

  it('always carries nPolls of the window', () => {
    const observations = [40, 41, 39, 40, 42].map((v, k) =>
      obs({
        instituteId: `i${k}`,
        candidateId: 'cand-1',
        valuePct: v,
        fieldMedianDate: '2026-05-03',
        sampleSize: 800,
      }),
    );
    const results = computeHerding(observations);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.nPolls).toBe(5);
  });

  it('does not mix scenarios: 4 polls split across scenarios yield no window', () => {
    const observations = [
      obs({
        instituteId: 'i1',
        candidateId: 'cand-1',
        valuePct: 40,
        fieldMedianDate: '2026-05-01',
        sampleSize: 1000,
        scenarioKind: 't1_estimulado',
      }),
      obs({
        instituteId: 'i2',
        candidateId: 'cand-1',
        valuePct: 40,
        fieldMedianDate: '2026-05-01',
        sampleSize: 1000,
        scenarioKind: 't1_estimulado',
      }),
      obs({
        instituteId: 'i3',
        candidateId: 'cand-1',
        valuePct: 40,
        fieldMedianDate: '2026-05-01',
        sampleSize: 1000,
        scenarioKind: 't1_espontaneo',
      }),
      obs({
        instituteId: 'i4',
        candidateId: 'cand-1',
        valuePct: 40,
        fieldMedianDate: '2026-05-01',
        sampleSize: 1000,
        scenarioKind: 't1_espontaneo',
      }),
    ];
    // Cada cenário tem só 2 pesquisas ⇒ nenhuma janela atinge HERDING_MIN_POLLS.
    expect(computeHerding(observations)).toEqual([]);
  });

  it('excludes polls outside the 7-day window from the count', () => {
    // 3 pesquisas em 1 dia + 1 pesquisa 10 dias depois: nenhuma janela de 7 dias
    // reúne as 4 ⇒ sem resultado.
    const observations = [
      obs({
        instituteId: 'i1',
        candidateId: 'cand-1',
        valuePct: 40,
        fieldMedianDate: '2026-05-01',
        sampleSize: 1000,
      }),
      obs({
        instituteId: 'i2',
        candidateId: 'cand-1',
        valuePct: 41,
        fieldMedianDate: '2026-05-01',
        sampleSize: 1000,
      }),
      obs({
        instituteId: 'i3',
        candidateId: 'cand-1',
        valuePct: 39,
        fieldMedianDate: '2026-05-01',
        sampleSize: 1000,
      }),
      obs({
        instituteId: 'i4',
        candidateId: 'cand-1',
        valuePct: 40,
        fieldMedianDate: '2026-05-11',
        sampleSize: 1000,
      }),
    ];
    expect(computeHerding(observations)).toEqual([]);
  });
});

// =============================================================================
// §6.3 — divergência persistente
// =============================================================================

describe('divergence (docs/01 §6.3)', () => {
  it('institute with estimable:false is never marked divergent', () => {
    // Aceite T-08. Mesmo com |h| enorme e IC fora de zero, não-estimável nunca marca.
    const results = computeDivergence([
      he({ instituteId: 'inst-x', effectPp: 9, lo90Pp: 7, hi90Pp: 11, estimable: false }),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.divergent).toBe(false);
  });

  it('flags |h| > threshold when the 90% CI excludes zero', () => {
    const results = computeDivergence([
      he({ instituteId: 'inst-y', effectPp: 4, lo90Pp: 2.5, hi90Pp: 5.5, estimable: true }),
    ]);
    expect(results[0]?.divergent).toBe(true);
    expect(results[0]?.effectPp).toBe(4);
  });

  it('does NOT flag when the 90% CI crosses zero, even if |h| > threshold', () => {
    const results = computeDivergence([
      he({ instituteId: 'inst-z', effectPp: 4, lo90Pp: -0.5, hi90Pp: 8.5, estimable: true }),
    ]);
    expect(results[0]?.divergent).toBe(false);
  });

  it('does NOT flag when |h| ≤ threshold, even if CI excludes zero', () => {
    const results = computeDivergence([
      he({
        instituteId: 'inst-w',
        effectPp: DIVERGENCE_ABS_PP_THRESHOLD,
        lo90Pp: 2,
        hi90Pp: 4,
        estimable: true,
      }),
    ]);
    // |h| = 3 não é > 3 (estritamente maior, docs/01 §6.3).
    expect(results[0]?.divergent).toBe(false);
  });

  it('flags negative divergence symmetrically (below the consensus)', () => {
    const results = computeDivergence([
      he({ instituteId: 'inst-n', effectPp: -4.5, lo90Pp: -6, hi90Pp: -3, estimable: true }),
    ]);
    expect(results[0]?.divergent).toBe(true);
  });
});

// =============================================================================
// separação estrutural — diagnóstico não vaza para latent/houseEffects
// =============================================================================

describe('structural separation (T-08 aceite)', () => {
  function fullCycleInput(): ModelInput {
    const observations: Observation[] = [];
    // Duas séries candidatas, vários institutos, ao longo de ~40 dias, para dar
    // cobertura e house effects estimáveis.
    const institutes = ['i1', 'i2', 'i3'];
    for (let d = 0; d < 40; d += 5) {
      const date = `2026-05-${String(1 + d).padStart(2, '0')}`;
      for (const inst of institutes) {
        observations.push(
          obs({
            instituteId: inst,
            candidateId: 'cand-1',
            valuePct: 40,
            fieldMedianDate: date,
            sampleSize: 1000,
          }),
          obs({
            instituteId: inst,
            candidateId: 'cand-2',
            valuePct: 30,
            fieldMedianDate: date,
            sampleSize: 1000,
          }),
        );
      }
    }
    return { observations, referenceDate: '2026-06-10' };
  }

  it('runModel populates ModelOutput.diagnostics without leaking into latent/houseEffects', () => {
    const output = runModel(fullCycleInput());

    // diagnostics é um array próprio; latent e houseEffects não têm campos de
    // diagnóstico (rate/ratio/flagged/divergent/registered/disclosed).
    expect(Array.isArray(output.diagnostics)).toBe(true);

    const latentJson = JSON.stringify(output.latent);
    const heJson = JSON.stringify(output.houseEffects);
    for (const leak of [
      'rate',
      'ratio',
      'flagged',
      'divergent',
      'registered',
      'disclosed',
      'gaveta',
      'herding',
      'windowEnd',
    ]) {
      expect(latentJson.includes(leak), `latent leaked '${leak}'`).toBe(false);
      expect(heJson.includes(leak), `houseEffects leaked '${leak}'`).toBe(false);
    }

    // E cada diagnóstico segue o shape narrow do contrato (kind/subjectId/value/n).
    for (const d of output.diagnostics) {
      expect(['gaveta', 'herding', 'divergencia']).toContain(d.kind);
      expect(typeof d.subjectId).toBe('string');
      expect(typeof d.value).toBe('number');
      expect(Number.isInteger(d.n)).toBe(true);
    }
  });

  it('computeDiagnostics bundles the three indicators purely, without touching aggregate', () => {
    const input = fullCycleInput();
    const bundle = computeDiagnostics({
      observations: input.observations,
      registrations: [reg({ registeredAt: '2026-05-01', disclosed: false })],
      houseEffects: [he({ instituteId: 'i1', effectPp: 4, lo90Pp: 2, hi90Pp: 6, estimable: true })],
      referenceDate: input.referenceDate,
    });
    expect(bundle.gaveta.length).toBeGreaterThan(0);
    expect(bundle.divergence.some((d) => d.divergent)).toBe(true);
    // O agregado (runModel) roda idêntico com ou sem diagnósticos — determinismo.
    const a = runModel(input);
    const b = runModel(input);
    expect(JSON.stringify(a.latent)).toBe(JSON.stringify(b.latent));
    expect(JSON.stringify(a.houseEffects)).toBe(JSON.stringify(b.houseEffects));
  });
});
