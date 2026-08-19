/**
 * Condição 7 da Q-10 ("nada de transferência/eleitorado entra em `μ_t` nem nos
 * house effects; o fluxo LÊ a série latente e não a realimenta") + regressão do
 * latente.
 *
 * ATENÇÃO — dois testes que provam COISAS DIFERENTES; não os confunda:
 *
 *  1. ISOLAMENTO (a prova real da condição 7). Rodar com e sem
 *     `electorateObservations` tem de dar EXATAMENTE o mesmo `latent.firstRound`,
 *     `latent.runoffs` e `houseEffects`. É uma comparação de dois runs na MESMA
 *     versão do modelo, então NÃO depende de nenhum baseline congelado e continua
 *     válida a cada mudança de modelo. Se a chegada de branco/nulo/não-sabe movesse
 *     o número principal um bit, aqui quebra.
 *  2. REGRESSÃO DO LATENTE (baseline congelado). `__fixtures__/pre-v2-latent.json`
 *     guarda a série latente da versão CORRENTE do modelo para esta entrada fixa.
 *     Serve para pegar mudança NÃO INTENCIONAL no latente. Uma mudança de modelo
 *     DELIBERADA (com MODEL_VERSION nova e justificativa, R1) regenera este
 *     baseline — é o caso da 0.0.5, que somou o viés comum `b_t` e alargou a banda
 *     de propósito (as MÉDIAS e os house effects continuam idênticos; ver o `note`
 *     no arquivo). Este teste NÃO prova "não vaza" — isso é o teste 1; ele prova
 *     "não mudou por acidente".
 *
 * Antes da 0.0.5 estas duas coisas estavam FUNDIDAS num só teste "saiu idêntico ao
 * que saía antes", o que fazia uma mudança legítima de modelo parecer violação da
 * condição 7. Foram separadas: o isolamento (teste 1) é o invariante permanente; a
 * regressão (teste 2) acompanha a versão.
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
  modelVersion?: string;
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
  it('a série latente e os house effects batem com o baseline congelado da versão corrente', () => {
    // REGRESSÃO (teste 2 do cabeçalho): pega mudança NÃO INTENCIONAL no latente. O
    // baseline é da versão corrente do modelo; uma mudança deliberada (nova
    // MODEL_VERSION + justificativa, R1) regenera o arquivo. NÃO é a prova de "não
    // vaza" — essa é o teste de dois runs abaixo.
    const frozen = loadFrozen();
    const input: ModelInput = {
      observations: frozenObservations(),
      referenceDate: frozen.referenceDate,
      electorateObservations: [],
    };
    const out = runModel(input);

    // Sanidade: o baseline é da MESMA versão do modelo. Se alguém subir a
    // MODEL_VERSION sem regenerar o arquivo, isto aponta a causa em vez de deixar a
    // comparação de série falhar com um diff enorme e mudo.
    expect(out.modelVersion).toBe(frozen.modelVersion);

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
