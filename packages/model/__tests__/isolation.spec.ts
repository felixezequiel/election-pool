/**
 * Condição 7 da Q-10, provada em vez de prometida.
 *
 * "Nada de transferência entra na estimativa de `μ_t` nem nos house effects. O
 * modelo de fluxo LÊ a série latente e não a realimenta. Assim, um erro no fluxo
 * não contamina o número principal do site."
 *
 * Duas provas, porque uma sozinha não basta:
 *
 *  1. CONTRA O PASSADO. `__fixtures__/pre-v2-latent.json` foi gerado com o código
 *     ANTERIOR ao MODEL_VERSION 0.0.4, rodando esta mesma entrada. Se `μ_t` ou
 *     `h_i` tivessem mudado um bit por causa da v2, a comparação abaixo quebra.
 *     É a única forma de testar "saiu idêntico ao que saía antes": guardar o que
 *     saía antes.
 *  2. CONTRA A ENTRADA NOVA. Rodar com e sem `electorateObservations` tem de dar
 *     exatamente o mesmo `latent.firstRound`, `latent.runoffs` e `houseEffects`.
 *     Branco/nulo e não-sabe são estados rastreados, não uma correção do número
 *     principal.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runModel, type ModelInput } from '../index.js';
import {
  electorateObservationSchema,
  observationSchema,
  type ElectorateObservation,
  type Observation,
} from '@election-pool/contracts/model-io';

const here = dirname(fileURLToPath(import.meta.url));

interface FrozenBaseline {
  seed: number;
  referenceDate: string;
  firstRound: unknown;
  runoffs: unknown;
  houseEffects: unknown;
}

function loadFrozen(): FrozenBaseline {
  const raw = readFileSync(join(here, '..', '__fixtures__', 'pre-v2-latent.json'), 'utf8');
  return JSON.parse(raw) as FrozenBaseline;
}

// --- Reconstrução BIT A BIT da entrada usada para congelar o baseline --------
// O PRNG e a montagem são cópias exatas de `house-effects.spec.ts` (mesma
// semente 2718). Qualquer divergência aqui invalidaria a comparação — por isso
// nada de "aproximadamente a mesma entrada".

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

function obs(input: {
  candidateId: string;
  valuePct: number;
  fieldMedianDate: string;
  sampleSize: number;
  instituteId: string;
  scenarioKind?: Observation['scenarioKind'];
  t2Pair?: Observation['t2Pair'];
}): Observation {
  return observationSchema.parse({
    tseId: 'BR-00001/2026',
    instituteId: input.instituteId,
    candidateId: input.candidateId,
    scenarioKind: input.scenarioKind ?? 't1_estimulado',
    t2Pair: input.t2Pair ?? null,
    fieldMedianDate: input.fieldMedianDate,
    sampleSize: input.sampleSize,
    valuePct: input.valuePct,
  });
}

function frozenObservations(): Observation[] {
  const rng = makeRng(2718);
  const observations: Observation[] = [];
  const institutes = ['inst-a', 'inst-b', 'inst-c'];
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
  return observations;
}

function electorateObs(day: number, instituteId: string): ElectorateObservation {
  return electorateObservationSchema.parse({
    tseId: 'BR-00001/2026',
    instituteId,
    scenarioKind: 't1_estimulado',
    fieldMedianDate: isoDay(day),
    sampleSize: 1600,
    blankNullPct: 6,
    undecidedPct: 9,
  });
}

describe('isolamento do modelo de transferência (Q-10 condição 7)', () => {
  it('μ_t e house effects saem IDÊNTICOS ao baseline pré-0.0.4 congelado', () => {
    const frozen = loadFrozen();
    const input: ModelInput = {
      observations: frozenObservations(),
      referenceDate: frozen.referenceDate,
      electorateObservations: [],
    };
    const out = runModel(input);

    expect(JSON.stringify(out.latent.firstRound)).toBe(JSON.stringify(frozen.firstRound));
    expect(JSON.stringify(out.latent.runoffs)).toBe(JSON.stringify(frozen.runoffs));
    expect(JSON.stringify(out.houseEffects)).toBe(JSON.stringify(frozen.houseEffects));
  });

  it('a chegada de branco/nulo e não-sabe não move μ_t nem h_i em um bit', () => {
    const observations = frozenObservations();
    const referenceDate = isoDay(30);
    const withoutElectorate = runModel({
      observations,
      referenceDate,
      electorateObservations: [],
    });
    const institutes = ['inst-a', 'inst-b', 'inst-c'];
    const withElectorate = runModel({
      observations,
      referenceDate,
      electorateObservations: Array.from({ length: 30 }, (_unused, day) =>
        electorateObs(day, institutes[day % institutes.length] ?? 'inst-a'),
      ),
    });

    expect(JSON.stringify(withElectorate.latent.firstRound)).toBe(
      JSON.stringify(withoutElectorate.latent.firstRound),
    );
    expect(JSON.stringify(withElectorate.latent.runoffs)).toBe(
      JSON.stringify(withoutElectorate.latent.runoffs),
    );
    expect(JSON.stringify(withElectorate.houseEffects)).toBe(
      JSON.stringify(withoutElectorate.houseEffects),
    );

    // …e a série nova de fato apareceu: o teste acima não passa por vacuidade.
    expect(withElectorate.latent.electorate.length).toBeGreaterThan(0);
    expect(withoutElectorate.latent.electorate.length).toBe(0);
  });

  it('nenhum vocabulário de fluxo vaza para dentro de latent ou houseEffects', () => {
    // Prova estrutural complementar: `transitions` é um ramo FOLHA do output.
    // Se algum dia o fluxo virasse insumo do agregado, o vocabulário dele
    // apareceria no ramo principal — e aqui quebra antes de chegar ao site.
    const out = runModel({
      observations: frozenObservations(),
      referenceDate: isoDay(30),
      electorateObservations: [],
    });
    const latentJson = JSON.stringify(out.latent);
    const heJson = JSON.stringify(out.houseEffects);
    for (const token of ['"flows"', '"notIdentifiable"', '"stickiness"', '"pp"', '"prior"']) {
      expect(latentJson.includes(token), `latent leaked ${token}`).toBe(false);
      expect(heJson.includes(token), `houseEffects leaked ${token}`).toBe(false);
    }
    expect(out.transitions).not.toBeNull();
  });
});
