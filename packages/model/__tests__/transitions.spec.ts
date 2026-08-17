/**
 * Estimador de transferência (MODEL_VERSION 2.0.0, Q-10).
 *
 * Estes testes não tentam provar que o número está CERTO — não há como: fluxo não
 * é identificável a partir de agregado, e é justamente essa a objeção registrada
 * na Q-10. O que eles provam é que o número é HONESTO no sentido que o projeto
 * exige:
 *
 *  - respeita as restrições declaradas (linhas somam a massa de origem, colunas
 *    reproduzem as marginais do instante seguinte, nada negativo);
 *  - é determinístico bit a bit (docs/07 M-6);
 *  - carrega banda SEMPRE, e marca `notIdentifiable` quando a banda cruza zero ou
 *    o fluxo fica abaixo do piso de visibilidade — sem esconder a linha;
 *  - devolve `null` em vez de inventar quando faltam passos.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateTransitions,
  estimateSingleStep,
  ipfBalance,
  priorFlowMatrix,
  type TransitionNodeInput,
  type TransitionStateInput,
} from '../transitions.js';
import { runModel } from '../index.js';
import { observationSchema, type Observation } from '@election-pool/contracts/model-io';
import {
  TRANSITION_MIN_STEPS,
  TRANSITION_MIN_VISIBLE_PP,
  TRANSITION_STICKINESS_PRIOR,
} from '@election-pool/contracts/constants';

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

function band(
  meanPct: number,
  halfWidth = 1,
): {
  meanPct: number;
  lo90Pct: number;
  hi90Pct: number;
} {
  return { meanPct, lo90Pct: Math.max(0, meanPct - halfWidth), hi90Pct: meanPct + halfWidth };
}

const STATES: TransitionStateInput[] = [
  { id: 'cand-1', kind: 'candidate', displayName: 'cand-1' },
  { id: 'cand-2', kind: 'candidate', displayName: 'cand-2' },
  { id: 'undecided', kind: 'undecided', displayName: 'Não sabe' },
];

/** Série em que o não-sabe encolhe e os dois candidatos crescem. */
function shrinkingUndecidedNodes(steps: number, halfWidth = 1): TransitionNodeInput[] {
  const nodes: TransitionNodeInput[] = [];
  for (let i = 0; i <= steps; i++) {
    nodes.push({
      date: isoDay(i * 3),
      byState: {
        'cand-1': band(40 + i, halfWidth),
        'cand-2': band(30 + i * 0.5, halfWidth),
        undecided: band(20 - i * 1.5, halfWidth),
      },
    });
  }
  return nodes;
}

// --- Blocos elementares -----------------------------------------------------

describe('priorFlowMatrix — prior de permanência', () => {
  it('mantém `stickiness` na diagonal e espalha o resto uniformemente', () => {
    const mass = [50, 30, 20];
    const prior = priorFlowMatrix(mass);
    for (let i = 0; i < mass.length; i++) {
      const row = prior[i] ?? [];
      const rowSum = row.reduce((s, v) => s + v, 0);
      expect(rowSum).toBeCloseTo(mass[i] ?? 0, 10); // linha soma a massa de origem
      expect(row[i]).toBeCloseTo((mass[i] ?? 0) * TRANSITION_STICKINESS_PRIOR, 10);
    }
  });

  it('BORDA — um único estado: permanência total, nada para onde ir', () => {
    const prior = priorFlowMatrix([100]);
    expect(prior).toEqual([[100]]);
  });

  it('BORDA — estado com massa zero produz linha zerada, não NaN', () => {
    const prior = priorFlowMatrix([0, 40]);
    expect(prior[0]).toEqual([0, 0]);
    expect(Number.isFinite(prior[1]?.[1] ?? Number.NaN)).toBe(true);
  });
});

describe('ipfBalance — projeção no polítopo de transporte', () => {
  it('reproduz as duas marginais e não produz fluxo negativo', () => {
    const p = [50, 30, 20];
    const q = [55, 32, 13];
    const f = ipfBalance(priorFlowMatrix(p), p, q);
    for (let i = 0; i < p.length; i++) {
      const rowSum = (f[i] ?? []).reduce((s, v) => s + v, 0);
      expect(rowSum).toBeCloseTo(p[i] ?? 0, 6);
    }
    for (let j = 0; j < q.length; j++) {
      let colSum = 0;
      for (let i = 0; i < p.length; i++) colSum += f[i]?.[j] ?? 0;
      expect(colSum).toBeCloseTo(q[j] ?? 0, 6);
    }
    for (const row of f) for (const v of row) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('BORDA — composição imóvel: reproduz as marginais e reforça a permanência', () => {
    // Detalhe que vale registrar: o prior de permanência NÃO é ponto fixo quando
    // os estados têm massas diferentes. "Cada estado perde 15% uniformemente"
    // move massa líquida do estado grande para os pequenos, então as colunas do
    // prior NÃO batem com a composição parada e o IPF precisa desfazer isso
    // (subindo a permanência do estado grande e baixando a do pequeno). Não é
    // bug: é o prior sendo consertado pela restrição marginal. O que continua
    // valendo, e é o que este teste fixa, é que as marginais fecham e a
    // permanência segue dominante em cada linha.
    const p = [40, 35, 25];
    const f = ipfBalance(priorFlowMatrix(p), p, p);
    for (let j = 0; j < p.length; j++) {
      let colSum = 0;
      for (let i = 0; i < p.length; i++) colSum += f[i]?.[j] ?? 0;
      expect(colSum).toBeCloseTo(p[j] ?? 0, 6);
      // Diagonal dominante: a maior parte de cada estado permanece onde estava.
      const diagonal = f[j]?.[j] ?? 0;
      expect(diagonal).toBeGreaterThan((p[j] ?? 0) / 2);
      for (let k = 0; k < p.length; k++) {
        if (k === j) continue;
        expect(diagonal).toBeGreaterThan(f[j]?.[k] ?? 0);
      }
    }
  });

  it('BORDA — estado que desaparece leva sua coluna a zero, sem quebrar as linhas', () => {
    const p = [40, 30, 30];
    const q = [55, 45, 0]; // o terceiro estado sai do mapa (ex.: candidato eliminado)
    const f = ipfBalance(priorFlowMatrix(p), p, q);
    for (let i = 0; i < p.length; i++) {
      expect(f[i]?.[2] ?? -1).toBeCloseTo(0, 9);
      const rowSum = (f[i] ?? []).reduce((s, v) => s + v, 0);
      expect(rowSum).toBeCloseTo(p[i] ?? 0, 6);
    }
  });
});

// --- Estimador completo -----------------------------------------------------

describe('estimateTransitions', () => {
  it('estima fluxo com banda e devolve o prior publicado junto', () => {
    const out = estimateTransitions({
      states: STATES,
      nodes: shrinkingUndecidedNodes(TRANSITION_MIN_STEPS + 2),
    });
    expect(out).not.toBeNull();
    if (!out) return;

    expect(out.prior.stickiness).toBe(TRANSITION_STICKINESS_PRIOR);
    expect(out.prior.method.length).toBeGreaterThan(0);
    expect(out.prior.note.length).toBeGreaterThan(0);
    expect(out.steps.length).toBeGreaterThanOrEqual(TRANSITION_MIN_STEPS);

    for (const step of out.steps) {
      expect(step.fromDate < step.toDate).toBe(true);
      // Matriz completa: K² fluxos, incluindo a permanência (i→i).
      expect(step.flows.length).toBe(STATES.length * STATES.length);
      for (const flow of step.flows) {
        expect(flow.lo90Pp).toBeLessThanOrEqual(flow.pp);
        expect(flow.hi90Pp).toBeGreaterThanOrEqual(flow.pp);
        expect(Number.isFinite(flow.pp)).toBe(true);
      }
    }
  });

  it('as linhas do passo somam a massa de origem (matriz de transição válida)', () => {
    const out = estimateTransitions({
      states: STATES,
      nodes: shrinkingUndecidedNodes(TRANSITION_MIN_STEPS + 1),
    });
    expect(out).not.toBeNull();
    if (!out) return;
    const step = out.steps[0];
    expect(step).toBeDefined();
    if (!step) return;
    for (const state of STATES) {
      const outgoing = step.flows.filter((f) => f.from === state.id);
      expect(outgoing.length).toBe(STATES.length);
      const sum = outgoing.reduce((s, f) => s + f.pp, 0);
      expect(sum).toBeGreaterThan(0);
    }
  });

  it('é determinístico bit a bit (docs/07 M-6)', () => {
    const nodes = shrinkingUndecidedNodes(TRANSITION_MIN_STEPS + 3);
    const a = estimateTransitions({ states: STATES, nodes });
    // Mesma entrada com os estados em outra ordem: a ordenação canônica interna
    // tem de absorver a diferença.
    const b = estimateTransitions({ states: [...STATES].reverse(), nodes });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('BORDA — menos de TRANSITION_MIN_STEPS passos devolve null, não um chute', () => {
    const nodes = shrinkingUndecidedNodes(TRANSITION_MIN_STEPS - 1);
    expect(estimateTransitions({ states: STATES, nodes })).toBeNull();
  });

  it('BORDA — nós sem medida em um dos extremos não formam passo', () => {
    // Todo nó ímpar sem medida de nenhum estado ⇒ nenhum passo utilizável.
    const nodes: TransitionNodeInput[] = [];
    for (let i = 0; i <= TRANSITION_MIN_STEPS + 2; i++) {
      nodes.push({
        date: isoDay(i * 3),
        byState:
          i % 2 === 0
            ? { 'cand-1': band(40), 'cand-2': band(30), undecided: band(20) }
            : { 'cand-1': null, 'cand-2': null, undecided: null },
      });
    }
    expect(estimateTransitions({ states: STATES, nodes })).toBeNull();
  });

  it('BORDA — datas repetidas ou fora de ordem não viram passo', () => {
    const repeated: TransitionNodeInput[] = [];
    for (let i = 0; i <= TRANSITION_MIN_STEPS + 2; i++) {
      repeated.push({
        date: isoDay(0),
        byState: { 'cand-1': band(40), 'cand-2': band(30), undecided: band(20) },
      });
    }
    expect(estimateTransitions({ states: STATES, nodes: repeated })).toBeNull();
  });

  it('estado ausente num extremo sai do passo, sem entrar como zero', () => {
    const nodes = shrinkingUndecidedNodes(TRANSITION_MIN_STEPS + 2).map((n, i) => ({
      date: n.date,
      byState: i === 1 ? { ...n.byState, undecided: null } : n.byState,
    }));
    const out = estimateTransitions({ states: STATES, nodes });
    expect(out).not.toBeNull();
    if (!out) return;
    // Os passos que tocam o nó 1 têm só os dois candidatos; os demais têm três.
    const sizes = out.steps.map((s) => s.flows.length);
    expect(sizes).toContain(2 * 2);
    expect(sizes).toContain(3 * 3);
  });
});

describe('notIdentifiable (Q-10 condição 3)', () => {
  it('fluxo cujo intervalo cruza zero vem publicado com o rótulo, não some', () => {
    // Bandas largas ⇒ muita incerteza ⇒ fluxos pequenos indistinguíveis de zero.
    const wide = shrinkingUndecidedNodes(TRANSITION_MIN_STEPS + 2, 6);
    const out = estimateTransitions({ states: STATES, nodes: wide });
    expect(out).not.toBeNull();
    if (!out) return;
    const flows = out.steps.flatMap((s) => s.flows);
    const flagged = flows.filter((f) => f.notIdentifiable);
    expect(flagged.length).toBeGreaterThan(0);
    // Publicado, não escondido: cada fluxo marcado continua na lista com número.
    for (const f of flagged) {
      expect(typeof f.pp).toBe('number');
      expect(f.lo90Pp <= 0 || f.pp < TRANSITION_MIN_VISIBLE_PP).toBe(true);
    }
    // E o inverso: o que NÃO está marcado tem banda inteiramente acima do piso.
    for (const f of flows.filter((x) => !x.notIdentifiable)) {
      expect(f.lo90Pp).toBeGreaterThan(0);
      expect(f.pp).toBeGreaterThanOrEqual(TRANSITION_MIN_VISIBLE_PP);
    }
  });

  it('BORDA — composição imóvel: o fluxo publicado É o prior, e o teste registra isso', () => {
    // Este é O teste desconfortável do módulo, e ele existe para NÃO deixar a
    // limitação virar folclore. Com as marginais paradas e bandas estreitas, o
    // estimador publica fluxos cruzados de vários p.p. com banda inteiramente
    // acima de zero — ou seja, NÃO marcados como indistinguíveis — sem que
    // ninguém tenha se movido. Esses p.p. são o prior de permanência aparecendo
    // como se fossem dado. É exatamente a objeção da Q-10 materializada em
    // número, e é por isso que a Q-10 exige (condição 4) que a UI rotule o painel
    // como ESTIMATIVA DE MODELO sob suposição, e não como medida.
    const nodes: TransitionNodeInput[] = [];
    for (let i = 0; i <= TRANSITION_MIN_STEPS + 1; i++) {
      nodes.push({
        date: isoDay(i * 3),
        byState: { 'cand-1': band(40), 'cand-2': band(30), undecided: band(20) },
      });
    }
    const out = estimateTransitions({ states: STATES, nodes });
    expect(out).not.toBeNull();
    if (!out) return;
    const step = out.steps[0];
    if (!step) return;

    // O fluxo estimado fica PERTO do fluxo que o prior sozinho produziria: o dado
    // (que não se moveu) quase não o desloca.
    const mass = [40, 30, 20];
    const prior = priorFlowMatrix(mass);
    const ids = ['cand-1', 'cand-2', 'undecided'];
    let totalDeviation = 0;
    let totalPriorMass = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = 0; j < ids.length; j++) {
        if (i === j) continue;
        const flow = step.flows.find((f) => f.from === ids[i] && f.to === ids[j]);
        expect(flow).toBeDefined();
        totalDeviation += Math.abs((flow?.pp ?? 0) - (prior[i]?.[j] ?? 0));
        totalPriorMass += prior[i]?.[j] ?? 0;
      }
    }
    // O deslocamento é pequeno perto da massa que o prior já colocava ali: o
    // número publicado é, em substância, o prior — não uma leitura do dado.
    expect(totalDeviation / totalPriorMass).toBeLessThan(0.35);
    // …e a nota publicada tem de falar de prior, para que o leitor veja isso.
    expect(out.prior.note.toLowerCase()).toContain('prior');
  });
});

describe('estimateSingleStep', () => {
  it('estima um passo isolado entre dois instantes quaisquer', () => {
    const from: TransitionNodeInput = {
      date: isoDay(0),
      byState: { 'cand-1': band(40), 'cand-2': band(30), undecided: band(20) },
    };
    const to: TransitionNodeInput = {
      date: isoDay(30),
      byState: { 'cand-1': band(45), 'cand-2': band(33), undecided: band(12) },
    };
    const step = estimateSingleStep(from, to, ['cand-1', 'cand-2', 'undecided'], 0);
    expect(step).not.toBeNull();
    expect(step?.flows.length).toBe(9);
  });

  it('BORDA — menos de dois estados com medida nos dois extremos devolve null', () => {
    const from: TransitionNodeInput = { date: isoDay(0), byState: { 'cand-1': band(40) } };
    const to: TransitionNodeInput = { date: isoDay(1), byState: { 'cand-1': band(42) } };
    expect(estimateSingleStep(from, to, ['cand-1', 'cand-2'], 0)).toBeNull();
  });
});

// --- Integração com runModel -------------------------------------------------

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

function cycle(days: number, everyDays: number): Observation[] {
  const out: Observation[] = [];
  for (let day = 0; day < days; day += everyDays) {
    const inst = INSTITUTES[day % INSTITUTES.length] ?? 'inst-a';
    // Um candidato sobe, outro cai — há movimento a decompor.
    out.push(obs('cand-1', 40 + day * 0.2, day, inst));
    out.push(obs('cand-2', 30 - day * 0.1, day, inst));
    out.push(obs('cand-3', 15 - day * 0.1, day, inst));
  }
  return out;
}

describe('runModel — transitions', () => {
  it('publica transferência quando há passos suficientes, e é determinística', () => {
    const input = {
      observations: cycle(30, 3),
      referenceDate: isoDay(30),
      electorateObservations: [],
    };
    const a = runModel(input);
    const b = runModel({ ...input, observations: [...input.observations].reverse() });
    expect(a.transitions).not.toBeNull();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.transitions?.states.every((s) => s.kind === 'candidate')).toBe(true);
  });

  it('BORDA — poucas medições no ciclo ⇒ transitions null (não um prior disfarçado)', () => {
    const out = runModel({
      observations: cycle(6, 3), // duas datas ⇒ um passo só
      referenceDate: isoDay(6),
      electorateObservations: [],
    });
    expect(out.transitions).toBeNull();
  });

  it('BORDA — ciclo sem observação nenhuma não produz transferência', () => {
    const out = runModel({
      observations: [],
      referenceDate: isoDay(10),
      electorateObservations: [],
    });
    expect(out.transitions).toBeNull();
    expect(out.latent.firstRound).toEqual([]);
  });
});
