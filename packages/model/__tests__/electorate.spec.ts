/**
 * Séries de branco/nulo e não-sabe (MODEL_VERSION 2.0.0, Q-10 condição 1).
 *
 * O que estes testes protegem, em ordem de importância:
 *
 *  1. `null` NUNCA vira 0 (R4). Nem quando o instituto não publica a grandeza,
 *     nem quando o nó do grid está longe de qualquer medida. Um zero silencioso
 *     numa série de indecisos derruba a média e ninguém percebe.
 *  2. A matemática é a MESMA dos candidatos: banda de 90% em volta da média,
 *     alargando onde falta observação.
 *  3. A série sai alinhada ao grid da série de candidatos.
 */

import { describe, it, expect } from 'vitest';
import { runElectorateKalman, ELECTORATE_SERIES } from '../kalman.js';
import { runModel } from '../index.js';
import {
  electorateObservationSchema,
  observationSchema,
  type ElectorateObservation,
  type Observation,
} from '@election-pool/contracts/model-io';
import { ACTIVE_WINDOW_DAYS } from '@election-pool/contracts/constants';

const DAY_MS = 86400000;
function isoDay(offsetDays: number, base = '2026-05-01'): string {
  const d = new Date(
    Date.UTC(Number(base.slice(0, 4)), Number(base.slice(5, 7)) - 1, Number(base.slice(8, 10))) +
      offsetDays * DAY_MS,
  );
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

function eobs(input: {
  day: number;
  instituteId: string;
  blankNullPct: number | null;
  undecidedPct: number | null;
  sampleSize?: number;
}): ElectorateObservation {
  return electorateObservationSchema.parse({
    tseId: 'BR-00001/2026',
    instituteId: input.instituteId,
    scenarioKind: 't1_estimulado',
    fieldMedianDate: isoDay(input.day),
    sampleSize: input.sampleSize ?? 1600,
    blankNullPct: input.blankNullPct,
    undecidedPct: input.undecidedPct,
  });
}

function obs(candidateId: string, valuePct: number, day: number, instituteId: string): Observation {
  return observationSchema.parse({
    tseId: 'BR-00001/2026',
    instituteId,
    candidateId,
    scenarioKind: 't1_estimulado',
    t2Pair: null,
    fieldMedianDate: isoDay(day),
    sampleSize: 1600,
    valuePct,
  });
}

const INSTITUTES = ['inst-a', 'inst-b', 'inst-c'];

/** Ciclo curto com três institutos medindo três candidatos todos os dias. */
function candidateObservations(days: number): Observation[] {
  const out: Observation[] = [];
  for (let day = 0; day < days; day++) {
    const inst = INSTITUTES[day % INSTITUTES.length] ?? 'inst-a';
    out.push(obs('cand-1', 40, day, inst));
    out.push(obs('cand-2', 30, day, inst));
    out.push(obs('cand-3', 15, day, inst));
  }
  return out;
}

describe('runElectorateKalman — branco/nulo e não-sabe como estados de 1ª classe', () => {
  it('suaviza as duas séries com banda de 90% em torno do nível medido', () => {
    const observations = [
      eobs({ day: 0, instituteId: 'inst-a', blankNullPct: 6, undecidedPct: 10 }),
      eobs({ day: 3, instituteId: 'inst-b', blankNullPct: 7, undecidedPct: 9 }),
      eobs({ day: 6, instituteId: 'inst-c', blankNullPct: 6.5, undecidedPct: 9.5 }),
    ];
    const result = runElectorateKalman(observations, { referenceDate: isoDay(6) });

    const last = result.points.filter((p) => p.date === isoDay(6));
    expect(last.length).toBe(2);
    for (const p of last) {
      expect(p.lo90).toBeLessThanOrEqual(p.mean);
      expect(p.hi90).toBeGreaterThanOrEqual(p.mean);
      expect(p.hi90).toBeGreaterThan(p.lo90); // banda com largura real, não colapsada
      expect(p.measured).toBe(true);
    }
    const blank = last.find((p) => p.seriesId === ELECTORATE_SERIES.blankNull);
    const undecided = last.find((p) => p.seriesId === ELECTORATE_SERIES.undecided);
    expect(blank?.mean).toBeGreaterThan(4);
    expect(blank?.mean).toBeLessThan(9);
    expect(undecided?.mean).toBeGreaterThan(7);
    expect(undecided?.mean).toBeLessThan(12);
  });

  it('BORDA — grandeza não publicada (`null`) não vira série nem zero', () => {
    // Todos os institutos publicam não-sabe; nenhum publica branco/nulo.
    const observations = [
      eobs({ day: 0, instituteId: 'inst-a', blankNullPct: null, undecidedPct: 11 }),
      eobs({ day: 2, instituteId: 'inst-b', blankNullPct: null, undecidedPct: 12 }),
      eobs({ day: 4, instituteId: 'inst-c', blankNullPct: null, undecidedPct: 10 }),
    ];
    const result = runElectorateKalman(observations, { referenceDate: isoDay(4) });

    expect(result.points.some((p) => p.seriesId === ELECTORATE_SERIES.blankNull)).toBe(false);
    const undecided = result.points.filter((p) => p.seriesId === ELECTORATE_SERIES.undecided);
    expect(undecided.length).toBeGreaterThan(0);
    // E nenhum ponto da série existente foi contaminado por um zero fantasma.
    for (const p of undecided) expect(p.mean).toBeGreaterThan(0);
  });

  it('BORDA — entrada vazia devolve série vazia, não uma série de zeros', () => {
    const result = runElectorateKalman([], { referenceDate: isoDay(10) });
    expect(result.points).toEqual([]);
    expect(result.dates).toEqual([]);
  });

  it('BORDA — nó distante de qualquer medida sai `measured: false`', () => {
    // Uma única medida no dia 0; o grid vai até bem depois da janela ativa.
    const far = ACTIVE_WINDOW_DAYS * 2 + 10;
    const observations = [
      eobs({ day: far - 1, instituteId: 'inst-a', blankNullPct: 5, undecidedPct: 8 }),
    ];
    const result = runElectorateKalman(observations, {
      referenceDate: isoDay(far),
      gridStartDate: isoDay(0),
    });
    const early = result.points.filter((p) => p.date === isoDay(0));
    expect(early.length).toBeGreaterThan(0);
    for (const p of early) expect(p.measured).toBe(false);
    const late = result.points.filter((p) => p.date === isoDay(far));
    for (const p of late) expect(p.measured).toBe(true);
  });
});

describe('runModel — latent.electorate', () => {
  it('publica a série com banda e `null` onde não há medida', () => {
    const days = 20;
    const electorateObservations: ElectorateObservation[] = [];
    // Só a segunda metade do ciclo declara as grandezas.
    for (let day = 10; day < days; day++) {
      electorateObservations.push(
        eobs({
          day,
          instituteId: INSTITUTES[day % INSTITUTES.length] ?? 'inst-a',
          blankNullPct: 6,
          undecidedPct: 9,
        }),
      );
    }
    const out = runModel({
      observations: candidateObservations(days),
      referenceDate: isoDay(days),
      electorateObservations,
    });

    expect(out.latent.electorate.length).toBe(out.latent.firstRound.length);
    const last = out.latent.electorate[out.latent.electorate.length - 1];
    expect(last?.blankNull).not.toBeNull();
    expect(last?.undecided).not.toBeNull();
    expect(last?.blankNull?.lo90Pct).toBeLessThanOrEqual(last?.blankNull?.meanPct ?? 0);
    expect(last?.undecided?.hi90Pct).toBeGreaterThanOrEqual(last?.undecided?.meanPct ?? 0);
  });

  it('BORDA — sem nenhuma observação de eleitorado a série sai vazia (nunca zerada)', () => {
    const out = runModel({
      observations: candidateObservations(10),
      referenceDate: isoDay(10),
      electorateObservations: [],
    });
    expect(out.latent.electorate).toEqual([]);
  });

  it('BORDA — trecho do grid longe da única medida sai `null`, o resto sai com valor', () => {
    const days = ACTIVE_WINDOW_DAYS + 20;
    const out = runModel({
      observations: candidateObservations(days),
      referenceDate: isoDay(days),
      // Medida única, perto do fim: o começo do grid fica a mais de uma janela
      // ativa de distância e lá a série seria só o prior passeando.
      electorateObservations: [
        eobs({ day: days - 5, instituteId: 'inst-a', blankNullPct: 5, undecidedPct: 8 }),
      ],
    });
    const first = out.latent.electorate[0];
    expect(first?.blankNull).toBeNull();
    expect(first?.undecided).toBeNull();
    const last = out.latent.electorate[out.latent.electorate.length - 1];
    expect(last?.blankNull).not.toBeNull();
    expect(last?.undecided).not.toBeNull();
  });

  it('BORDA — medida antiga demais (fora da janela ativa) não gera série alguma', () => {
    const days = ACTIVE_WINDOW_DAYS + 20;
    const out = runModel({
      observations: candidateObservations(days),
      referenceDate: isoDay(days),
      electorateObservations: [
        eobs({ day: 0, instituteId: 'inst-a', blankNullPct: 5, undecidedPct: 8 }),
      ],
    });
    // Nenhuma medida utilizável ⇒ série vazia. Vazio é a resposta honesta; uma
    // linha de zeros ou de prior extrapolado seria o que o R4 proíbe.
    expect(out.latent.electorate).toEqual([]);
  });
});
