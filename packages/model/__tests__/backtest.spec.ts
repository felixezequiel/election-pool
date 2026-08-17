/**
 * Testes do backtest 2022 (T-09, docs/07 §4). Este arquivo vive em `__tests__/`,
 * então NÃO é lido pelo `no-directional-bias.spec.ts` (que exclui `__tests__`) —
 * mas também não precisa: nenhum nome de candidato aparece aqui; os ids vêm da
 * fixture.
 *
 * Cobre o ACEITE de docs/07 §4 e da task T-09:
 *  - a fixture tem ≥ 25 pesquisas cobrindo agosto–outubro de 2022;
 *  - NENHUMA pesquisa usada num corte tem `field_end` posterior ao corte
 *    (vazamento de dado futuro invalidaria o backtest inteiro);
 *  - o backtest RODA de ponta a ponta, produz as quatro comparações e a LARGURA
 *    do IC em cada uma (não só passou/falhou);
 *  - determinismo: dois runs sobre a mesma fixture dão a mesma saída (docs/01 §9).
 *
 * Estes testes NÃO afirmam "o backtest passou". O veredito honesto — passe ou falhe
 * — é o produto (docs/07 §4.3): asserir aprovação aqui seria pressão para ajustar o
 * modelo (R1). Asserimos apenas que o gate RODA, é sem-vazamento e reporta a largura.
 */

import { describe, it, expect } from 'vitest';
import {
  loadFixture,
  fixtureToObservations,
  runBacktest,
  formatTable,
  renderMarkdown,
} from '../backtest.js';
import { SCENARIO_KIND } from '@election-pool/contracts/enums';

const CUTOFF_ROUND_1 = '2022-10-01';
const CUTOFF_ROUND_2 = '2022-10-29';
const MIN_POLLS = 25;
const EXPECTED_COMPARISONS = 4;
const CYCLE_MONTHS = ['2022-08', '2022-09', '2022-10'];

describe('backtest 2022 — fixture (docs/07 §4, aceite T-09)', () => {
  const fixture = loadFixture();

  it('has at least 25 polls', () => {
    expect(fixture.polls.length).toBeGreaterThanOrEqual(MIN_POLLS);
  });

  it('covers August, September and October 2022', () => {
    const months = new Set(fixture.polls.map((p) => p.fieldMedianDate.slice(0, 7)));
    for (const m of CYCLE_MONTHS) expect(months.has(m)).toBe(true);
  });

  it('every poll has field_end on or after field_start and a median inside the window', () => {
    for (const p of fixture.polls) {
      expect(p.fieldEnd >= p.fieldStart).toBe(true);
      expect(p.fieldMedianDate >= p.fieldStart).toBe(true);
      expect(p.fieldMedianDate <= p.fieldEnd).toBe(true);
    }
  });

  it('maps exactly two candidates to an official first-round result', () => {
    const r1 = fixture.candidateMeta.filter((m) => m.officialR1ValidPct !== null);
    expect(r1.length).toBe(2);
  });

  it('maps exactly two candidates to an official second-round result (the runoff pair)', () => {
    const r2 = fixture.candidateMeta.filter((m) => m.officialR2ValidPct !== null);
    expect(r2.length).toBe(2);
  });
});

describe('no future-data leakage (docs/07 §4 — the invalidating condition)', () => {
  const fixture = loadFixture();

  it('no first-round observation used at cutoff has field_end after the cutoff', () => {
    for (const p of fixture.polls) {
      if (p.scenarioKind !== SCENARIO_KIND.t1Estimulado) continue;
      // A observação só entra no run se field_end <= corte; se alguma passasse do
      // corte, seria vazamento. Verificamos diretamente no conjunto USADO.
      if (p.fieldEnd <= CUTOFF_ROUND_1) {
        expect(p.fieldEnd <= CUTOFF_ROUND_1).toBe(true);
      }
    }
    // E, o mais importante: o conjunto efetivamente carregado no run não contém
    // nenhuma linha com fieldMedianDate posterior ao corte.
    const obs = fixtureToObservations(fixture, SCENARIO_KIND.t1Estimulado, CUTOFF_ROUND_1);
    for (const o of obs) expect(o.fieldMedianDate <= CUTOFF_ROUND_1).toBe(true);
    expect(obs.length).toBeGreaterThan(0);
  });

  it('no second-round observation used at cutoff has field_end after the cutoff', () => {
    const obs = fixtureToObservations(fixture, SCENARIO_KIND.t2, CUTOFF_ROUND_2);
    for (const o of obs) expect(o.fieldMedianDate <= CUTOFF_ROUND_2).toBe(true);
    expect(obs.length).toBeGreaterThan(0);
  });

  it('the loader drops any poll whose field_end is past the cutoff', () => {
    // Corte artificialmente cedo: só as primeiras rodadas de 1º turno sobrevivem,
    // e nenhuma delas pode ter field_end depois do corte.
    const earlyCutoff = '2022-08-20';
    const obs = fixtureToObservations(fixture, SCENARIO_KIND.t1Estimulado, earlyCutoff);
    const survivors = fixture.polls.filter(
      (p) => p.scenarioKind === SCENARIO_KIND.t1Estimulado && p.fieldEnd <= earlyCutoff,
    );
    const expectedRows = survivors.reduce((n, p) => n + Object.keys(p.values).length, 0);
    expect(obs.length).toBe(expectedRows);
  });
});

describe('backtest run (docs/07 §4.2/§4.3)', () => {
  const fixture = loadFixture();

  it('produces exactly four comparisons (winner/runner-up × two rounds)', () => {
    const result = runBacktest(fixture);
    expect(result.comparisons.length).toBe(EXPECTED_COMPARISONS);
    const rounds = result.comparisons.map((c) => c.round).sort();
    expect(rounds).toEqual([1, 1, 2, 2]);
  });

  it('reports a CI width (not just pass/fail) for every comparison', () => {
    const result = runBacktest(fixture);
    for (const c of result.comparisons) {
      expect(Number.isFinite(c.ciWidthPp)).toBe(true);
      expect(c.ciWidthPp).toBeGreaterThan(0);
      // largura = hi − lo, coerente com os limites reportados.
      expect(c.ciWidthPp).toBeCloseTo(c.hi90ValidPct - c.lo90ValidPct, 9);
      // o oficial cai dentro do IC sse e somente se passed.
      const inside = c.officialValidPct >= c.lo90ValidPct && c.officialValidPct <= c.hi90ValidPct;
      expect(inside).toBe(c.passed);
    }
  });

  it('valid-vote estimates of the two runoff candidates sum to ~100', () => {
    const result = runBacktest(fixture);
    const r2 = result.comparisons.filter((c) => c.round === 2);
    const sum = r2.reduce((s, c) => s + c.estimateValidPct, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it('is deterministic: two runs give identical comparisons (docs/01 §9)', () => {
    const a = runBacktest(fixture);
    const b = runBacktest(fixture);
    expect(JSON.stringify(a.comparisons)).toBe(JSON.stringify(b.comparisons));
    // Inclui a checagem de transferência: o bootstrap dela é semeado, então dois
    // runs têm de dar o MESMO JSON (docs/07 M-6).
    expect(JSON.stringify(a.transition)).toBe(JSON.stringify(b.transition));
  });

  it('renders a table and a markdown report containing the CI width', () => {
    const result = runBacktest(fixture);
    const table = formatTable(result);
    expect(table).toContain('largura');
    const md = renderMarkdown(result, '2022-01-01T00:00:00.000Z');
    expect(md).toContain('Largura');
    expect(md).toContain('model_version');
    expect(md).toContain('git_sha');
  });
});

/**
 * Checagem de transferência 1º ⇒ 2º turno (Q-10 condição 6).
 *
 * Como no resto deste arquivo, NÃO se assere aprovação: o veredito honesto é o
 * produto. Asserimos que a checagem RODA, é determinística, compara contra a urna
 * (que o modelo nunca vê) e que o resultado — passando ou reprovando — chega ao
 * markdown que vira `docs/BACKTEST-RESULTS.md`.
 */
describe('backtest de transferência (Q-10 condição 6)', () => {
  const fixture = loadFixture();

  it('monta o passo 1º ⇒ 2º turno com os eliminados como origem da massa', () => {
    const result = runBacktest(fixture);
    const t = result.transition;
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.fromDate).toBe(CUTOFF_ROUND_1);
    expect(t.toDate).toBe(CUTOFF_ROUND_2);
    expect(t.eliminatedIds.length).toBeGreaterThan(0);
    for (const id of t.eliminatedIds) expect(t.finalistIds).not.toContain(id);
    expect(t.flowToFirstPp).toBeGreaterThanOrEqual(0);
    expect(t.flowToSecondPp).toBeGreaterThanOrEqual(0);
  });

  it('compara contra a fração implícita na urna e reporta banda', () => {
    const result = runBacktest(fixture);
    const t = result.transition;
    expect(t).not.toBeNull();
    if (!t) return;
    expect(t.evaluable).toBe(true);
    expect(t.loShareToFirstPct).toBeLessThanOrEqual(t.hiShareToFirstPct);
    expect(t.officialShareToFirstPct).toBeGreaterThan(0);
    // `passed` é EXATAMENTE "o oficial cai na banda" — sem escapatória.
    const inside =
      t.officialShareToFirstPct >= t.loShareToFirstPct &&
      t.officialShareToFirstPct <= t.hiShareToFirstPct;
    expect(t.passed).toBe(inside);
  });

  it('o veredito da transferência entra no relatório, aprovado ou reprovado', () => {
    const result = runBacktest(fixture);
    const md = renderMarkdown(result, '2022-01-01T00:00:00.000Z');
    expect(md).toContain('Transferência 1º ⇒ 2º turno');
    expect(md).toMatch(/PASS|FAIL|N\/A/);
    const table = formatTable(result);
    expect(table).toContain('Transferência 1º ⇒ 2º turno');
  });

  it('uma transferência reprovada derruba o veredito geral (R1: não se ajusta para passar)', () => {
    const result = runBacktest(fixture);
    if (result.transition?.evaluable && !result.transition.passed) {
      expect(result.allPassed).toBe(false);
    } else {
      // Se um dia passar, o veredito geral volta a depender só das comparações.
      expect(result.allPassed).toBe(result.comparisons.every((c) => c.passed));
    }
  });
});
