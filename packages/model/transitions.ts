/**
 * Estimador de TRANSFERÊNCIA DE VOTOS entre estados do eleitorado
 * (MODEL_VERSION 2.0.0, `docs/OPEN-QUESTIONS.md` Q-10). T-18.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LEIA A Q-10 ANTES DE MEXER AQUI. O que segue não é uma medida, é uma
 * estimativa sob suposição, e a suposição faz metade do trabalho.
 *
 * Transferência NÃO é identificável a partir de pesquisa agregada. Com `K`
 * estados há `K²` incógnitas por passo (para onde foi cada pedaço de cada
 * estado) e apenas `K` equações — as marginais do instante seguinte — mais a
 * restrição de soma. É o problema clássico de inferência ecológica: se o
 * "não sabe" cai 4 p.p. e um candidato sobe 4 p.p., os dados agregados são
 * IDÊNTICOS quer 4 p.p. tenham migrado direto, quer 6 tenham migrado e 2 tenham
 * saído para um terceiro que recebeu 2 de outro lugar. Só dado de PAINEL (mesma
 * pessoa, duas ondas) identifica fluxo, e o PesqEle não expõe painel.
 *
 * Consequência assumida, não escondida: **o resultado depende do prior tanto
 * quanto do dado**. Por isso este módulo (a) usa um prior EXPLÍCITO e versionado
 * (`TRANSITION_STICKINESS_PRIOR`), (b) publica esse prior junto do resultado, com
 * uma medida de quanto o dado conseguiu deslocá-lo, (c) publica SEMPRE a banda,
 * que é larga porque a incerteza é grande — estreitá-la para o gráfico ficar
 * bonito seria mentir, e (d) marca `notIdentifiable` todo fluxo cuja banda cruza
 * zero ou que fica abaixo do piso de visibilidade, sem esconder a linha.
 *
 * ── Como o número é produzido ────────────────────────────────────────────────
 *
 * Entre dois nós consecutivos da série latente, com composições `p` (em t) e `q`
 * (em t+1), procuramos a matriz de FLUXO `F` (em p.p. do eleitorado) tal que:
 *
 *     F_ij ≥ 0                    ninguém transfere quantidade negativa
 *     Σ_j F_ij = p_i              linhas somam a massa de origem (⇒ M_ij = F_ij/p_i
 *                                 é uma matriz de transição com linhas somando 1)
 *     Σ_i F_ij = q_j              as marginais reproduzem a série observada em t+1
 *
 * O sistema é subdeterminado (é o polítopo de transporte). Regularizamos com o
 * prior de PERMANÊNCIA — "na ausência de evidência, o eleitor fica onde estava":
 *
 *     F⁰_ij = p_i · s              se i = j     (s = TRANSITION_STICKINESS_PRIOR)
 *     F⁰_ij = p_i · (1−s)/(K−1)    se i ≠ j
 *
 * e escolhemos, dentro do polítopo, o `F` mais próximo de `F⁰` em divergência de
 * Kullback-Leibler. Essa solução é exatamente o ponto fixo do ajuste iterativo
 * proporcional (IPF/RAS: escala linhas, escala colunas, repete), que é
 * determinístico, preserva não-negatividade por construção e converge
 * geometricamente quando as marginais são factíveis. É a solução de "mínima
 * informação discriminante": não inventa estrutura que o dado não pediu.
 *
 * A incerteza vem por BOOTSTRAP determinístico: reamostramos `p` e `q` das
 * BANDAS da série latente (PRNG semeado, semente fixa por passo — docs/07 M-6
 * roda o modelo duas vezes e compara o JSON), re-rodamos o IPF em cada réplica e
 * reportamos `pp ± z₉₀·sd`. A banda NÃO inclui a incerteza sobre o próprio prior
 * — essa é qualitativa e está dita na nota publicada, porque inflá-la com um
 * segundo prior arbitrário só empilharia suposição sobre suposição.
 *
 * ── O que este módulo NÃO faz ────────────────────────────────────────────────
 *
 * Não realimenta nada (Q-10 condição 7): LÊ a série latente e devolve fluxo. Não
 * toca `μ_t` nem `h_i`. Um erro aqui não contamina o número principal do site.
 * Biblioteca pura: sem I/O, sem relógio, sem RNG não semeado.
 */

import type { TransitionStateKind } from '@election-pool/contracts/model-io';
import {
  CI_Z_90,
  PCT_MAX,
  PCT_MIN,
  TRANSITION_MIN_STEPS,
  TRANSITION_MIN_VISIBLE_PP,
  TRANSITION_STICKINESS_PRIOR,
} from '@election-pool/contracts/constants';

const ZERO = 0;
const ONE = 1;

// Divisor da média de dois valores ((a+b)/2). Aritmética estrutural, não é
// parâmetro de modelo (mesma convenção de `linalg.ts`).
const PAIR_MEAN_DIVISOR = 2;

// Constantes de IMPLEMENTAÇÃO do IPF: teto de iterações e tolerância de
// convergência das marginais, em p.p. Não são parâmetros do modelo — não mudam o
// ponto fixo, só decidem quando o laço para (mesma convenção de
// `house-effects.ts`, DEFAULT_MAX_ITERATIONS/DEFAULT_TOLERANCE_PP).
const IPF_MAX_ITERATIONS = 500;
const IPF_TOLERANCE_PP = 1e-9;

// Réplicas do bootstrap de incerteza. Numérico, não metodológico: controla o
// erro de Monte Carlo da largura da banda (que cai com 1/√B), não a largura em
// si. 400 réplicas deixam o erro de MC uma ordem de grandeza abaixo do dígito
// publicado, e o custo é linear.
const BOOTSTRAP_DRAWS = 400;

// Semente FIXA do PRNG do bootstrap. Determinismo bit a bit é requisito de gate
// (docs/07 M-6, docs/01 §9): dois runs sobre a mesma entrada têm de produzir o
// mesmo JSON, então nada de `Math.random()`. A semente efetiva de cada passo é
// esta mais o índice do passo — assim um passo não depende de quantos vieram
// antes terem consumido o gerador.
const BOOTSTRAP_SEED = 20260816;

// PRNG `mulberry32`: gerador de 32 bits, determinístico, sem estado global. Os
// números abaixo são as constantes de mistura do algoritmo — aritmética de
// hashing, não parâmetro estatístico. Escritos em decimal porque o gate de viés
// (docs/07 §5.1) só reconhece literal declarado em base 10.
const PRNG_INCREMENT = 1831565813; // 0x6D2B79F5
const PRNG_SHIFT_A = 15;
const PRNG_SHIFT_B = 7;
const PRNG_MULTIPLIER = 61;
const PRNG_DIVISOR = 4294967296; // 2³²

// Box-Muller: z = sqrt(-2·ln u)·cos(2π v).
const MINUS_TWO = -2;
const TWO_PI = Math.PI * PAIR_MEAN_DIVISOR;
// Piso do uniforme para não avaliar ln(0).
const UNIFORM_FLOOR = 1e-12;

// Casas decimais dos números embutidos na NOTA publicada. Só apresentação.
const NOTE_DECIMALS = 2;

// Identificador do método, publicado em `transitions.prior.method` para que o
// leitor saiba qual regularização produziu os números.
const PRIOR_METHOD = 'stickiness-prior-ipf';

// --- Entrada ----------------------------------------------------------------

export interface TransitionStateInput {
  id: string;
  kind: TransitionStateKind;
  displayName: string;
}

export interface LatentBandInput {
  meanPct: number;
  lo90Pct: number;
  hi90Pct: number;
}

/**
 * Um nó da série latente já pronto para o estimador: a composição do eleitorado
 * naquela data. `null` para um estado significa SEM MEDIDA (R4) — o estado
 * simplesmente não participa dos passos que tocam este nó, em vez de entrar
 * como zero e inventar um fluxo.
 */
export interface TransitionNodeInput {
  date: string;
  byState: Readonly<Record<string, LatentBandInput | null | undefined>>;
}

export interface EstimateTransitionsInput {
  states: readonly TransitionStateInput[];
  /** Nós em ordem cronológica. */
  nodes: readonly TransitionNodeInput[];
}

// --- Saída (forma do contrato, com datas ainda como string crua) -------------

export interface TransitionFlowOut {
  from: string;
  to: string;
  pp: number;
  lo90Pp: number;
  hi90Pp: number;
  notIdentifiable: boolean;
}

export interface TransitionStepOut {
  fromDate: string;
  toDate: string;
  flows: TransitionFlowOut[];
}

export interface TransitionsOut {
  states: TransitionStateInput[];
  steps: TransitionStepOut[];
  prior: { method: string; stickiness: number; note: string };
}

// --- Núcleo: IPF sobre o polítopo de transporte ------------------------------

/**
 * Matriz de fluxo do PRIOR: cada estado mantém `s` da sua massa e espalha o
 * resto uniformemente. Com um único estado ativo não há para onde ir e a
 * permanência é total.
 */
export function priorFlowMatrix(mass: readonly number[]): number[][] {
  const k = mass.length;
  const stay = k > ONE ? TRANSITION_STICKINESS_PRIOR : ONE;
  const leave = k > ONE ? (ONE - TRANSITION_STICKINESS_PRIOR) / (k - ONE) : ZERO;
  const out: number[][] = [];
  for (let i = ZERO; i < k; i++) {
    const row: number[] = [];
    const mi = mass[i] ?? ZERO;
    for (let j = ZERO; j < k; j++) row.push(mi * (i === j ? stay : leave));
    out.push(row);
  }
  return out;
}

/**
 * Ajuste iterativo proporcional (IPF/RAS) de `start` às marginais
 * `rowTargets`/`colTargets`. Devolve a matriz de fluxo do polítopo de transporte
 * mais próxima de `start` em divergência KL.
 *
 * LANÇA se não convergir (R4: falha alta, nunca silenciosa). Com marginais de
 * mesma soma e `start` estritamente positivo isso não acontece; se acontecer, a
 * entrada está degenerada e um número inventado seria pior que um erro.
 */
export function ipfBalance(
  start: readonly (readonly number[])[],
  rowTargets: readonly number[],
  colTargets: readonly number[],
): number[][] {
  const k = rowTargets.length;
  const f = start.map((row) => row.slice());

  for (let iter = ZERO; iter < IPF_MAX_ITERATIONS; iter++) {
    // Escala de linhas: Σ_j F_ij = p_i.
    for (let i = ZERO; i < k; i++) {
      const row = f[i];
      if (!row) continue;
      let sum = ZERO;
      for (let j = ZERO; j < k; j++) sum += row[j] ?? ZERO;
      const target = rowTargets[i] ?? ZERO;
      if (sum <= ZERO) continue; // linha sem massa: alvo também é zero
      const factor = target / sum;
      for (let j = ZERO; j < k; j++) row[j] = (row[j] ?? ZERO) * factor;
    }
    // Escala de colunas: Σ_i F_ij = q_j.
    for (let j = ZERO; j < k; j++) {
      let sum = ZERO;
      for (let i = ZERO; i < k; i++) sum += f[i]?.[j] ?? ZERO;
      const target = colTargets[j] ?? ZERO;
      if (sum <= ZERO) continue;
      const factor = target / sum;
      for (let i = ZERO; i < k; i++) {
        const row = f[i];
        if (row) row[j] = (row[j] ?? ZERO) * factor;
      }
    }
    if (maxMarginalResidual(f, rowTargets, colTargets) < IPF_TOLERANCE_PP) return f;
  }

  const residual = maxMarginalResidual(f, rowTargets, colTargets);
  if (residual < IPF_TOLERANCE_PP) return f;
  throw new Error(
    `transitions: IPF did not converge (max marginal residual ${residual}); ` +
      'degenerate latent composition — refusing to publish an invented flow (R4)',
  );
}

function maxMarginalResidual(
  f: readonly (readonly number[])[],
  rowTargets: readonly number[],
  colTargets: readonly number[],
): number {
  const k = rowTargets.length;
  let worst = ZERO;
  for (let i = ZERO; i < k; i++) {
    const row = f[i];
    let sum = ZERO;
    for (let j = ZERO; j < k; j++) sum += row?.[j] ?? ZERO;
    const d = Math.abs(sum - (rowTargets[i] ?? ZERO));
    if (d > worst) worst = d;
  }
  for (let j = ZERO; j < k; j++) {
    let sum = ZERO;
    for (let i = ZERO; i < k; i++) sum += f[i]?.[j] ?? ZERO;
    const d = Math.abs(sum - (colTargets[j] ?? ZERO));
    if (d > worst) worst = d;
  }
  return Number.isFinite(worst) ? worst : Number.POSITIVE_INFINITY;
}

/**
 * Põe as duas composições na MESMA massa total, a média das duas. Sem isso o
 * polítopo de transporte é vazio (as marginais precisam somar igual) e o IPF não
 * teria solução. A parte do eleitorado que não está em nenhum estado rastreado
 * ("demais", e branco/nulo ou não-sabe quando o instituto não os publica) é
 * absorvida por esse reescalonamento — é uma LIMITAÇÃO declarada, não um ajuste:
 * variação do resíduo não rastreado aparece diluída nos fluxos entre rastreados.
 */
function toCommonTotal(p: readonly number[], q: readonly number[]): [number[], number[]] | null {
  let sp = ZERO;
  let sq = ZERO;
  for (const v of p) sp += v;
  for (const v of q) sq += v;
  if (!(sp > ZERO) || !(sq > ZERO)) return null;
  const total = (sp + sq) / PAIR_MEAN_DIVISOR;
  return [p.map((v) => (v * total) / sp), q.map((v) => (v * total) / sq)];
}

// --- PRNG determinístico -----------------------------------------------------

function makeRng(seed: number): () => number {
  let a = seed >>> ZERO;
  return (): number => {
    a = (a + PRNG_INCREMENT) >>> ZERO;
    let t = a;
    t = Math.imul(t ^ (t >>> PRNG_SHIFT_A), ONE | t);
    t = (t + Math.imul(t ^ (t >>> PRNG_SHIFT_B), t | PRNG_MULTIPLIER)) ^ t;
    return ((t ^ (t >>> PRNG_SHIFT_A)) >>> ZERO) / PRNG_DIVISOR;
  };
}

function gaussian(rng: () => number): number {
  let u = rng();
  let v = rng();
  if (u < UNIFORM_FLOOR) u = UNIFORM_FLOOR;
  if (v < UNIFORM_FLOOR) v = UNIFORM_FLOOR;
  return Math.sqrt(MINUS_TWO * Math.log(u)) * Math.cos(TWO_PI * v);
}

/**
 * Desvio-padrão implícito na banda de 90% do nó latente. A banda é `média ±
 * z₉₀·sd` (docs/01 §2/§4), então `sd = (hi − lo) / (2·z₉₀)`. Bandas grampeadas em
 * [0,100] ficam assimétricas e este `sd` as trata como simétricas — subestima de
 * leve nos extremos, e é a mesma aproximação que o resto do pipeline usa.
 */
function sdFromBand(band: LatentBandInput): number {
  const width = band.hi90Pct - band.lo90Pct;
  const sd = width / (PAIR_MEAN_DIVISOR * CI_Z_90);
  return Number.isFinite(sd) && sd > ZERO ? sd : ZERO;
}

// --- Um passo ----------------------------------------------------------------

interface StepEstimate {
  fromDate: string;
  toDate: string;
  stateIds: string[];
  /** F_ij em p.p. do eleitorado, na ordem de `stateIds`. */
  flows: number[][];
  /** Desvio-padrão bootstrap de cada F_ij. */
  flowSd: number[][];
  /** Distância de variação total entre F e o fluxo do PRIOR, em p.p. */
  priorDistancePp: number;
  /** Massa total movimentada no passo (Σ F_ij), em p.p. */
  totalMassPp: number;
}

function estimateStep(
  from: TransitionNodeInput,
  to: TransitionNodeInput,
  stateIds: readonly string[],
  stepIndex: number,
): StepEstimate | null {
  // Só entram estados COM medida nos dois extremos: um estado sem medida em uma
  // das pontas não gera fluxo nenhum, em vez de entrar como zero (R4).
  const active: string[] = [];
  const bandsFrom: LatentBandInput[] = [];
  const bandsTo: LatentBandInput[] = [];
  for (const id of stateIds) {
    const a = from.byState[id];
    const b = to.byState[id];
    if (!a || !b) continue;
    active.push(id);
    bandsFrom.push(a);
    bandsTo.push(b);
  }
  if (active.length < PAIR_MEAN_DIVISOR) return null; // menos de dois estados: não há transferência a falar

  const p = bandsFrom.map((b) => nonNegative(b.meanPct));
  const q = bandsTo.map((b) => nonNegative(b.meanPct));
  const scaled = toCommonTotal(p, q);
  if (!scaled) return null;
  const [pScaled, qScaled] = scaled;

  const prior = priorFlowMatrix(pScaled);
  const flows = ipfBalance(prior, pScaled, qScaled);

  const k = active.length;
  let priorDistance = ZERO;
  let totalMass = ZERO;
  for (let i = ZERO; i < k; i++) {
    for (let j = ZERO; j < k; j++) {
      const f = flows[i]?.[j] ?? ZERO;
      priorDistance += Math.abs(f - (prior[i]?.[j] ?? ZERO));
      totalMass += f;
    }
  }
  priorDistance = priorDistance / PAIR_MEAN_DIVISOR; // distância de variação total

  // --- Bootstrap determinístico da banda ------------------------------------
  const rng = makeRng(BOOTSTRAP_SEED + stepIndex);
  const sdFrom = bandsFrom.map(sdFromBand);
  const sdTo = bandsTo.map(sdFromBand);
  const sum = zeroMatrix(k);
  const sumSq = zeroMatrix(k);
  let draws = ZERO;
  for (let b = ZERO; b < BOOTSTRAP_DRAWS; b++) {
    const pDraw: number[] = [];
    const qDraw: number[] = [];
    for (let i = ZERO; i < k; i++) {
      pDraw.push(nonNegative((p[i] ?? ZERO) + (sdFrom[i] ?? ZERO) * gaussian(rng)));
      qDraw.push(nonNegative((q[i] ?? ZERO) + (sdTo[i] ?? ZERO) * gaussian(rng)));
    }
    const scaledDraw = toCommonTotal(pDraw, qDraw);
    if (!scaledDraw) continue;
    const [pd, qd] = scaledDraw;
    const drawFlows = ipfBalance(priorFlowMatrix(pd), pd, qd);
    draws++;
    for (let i = ZERO; i < k; i++) {
      const srow = sum[i];
      const qrow = sumSq[i];
      const drow = drawFlows[i];
      if (!srow || !qrow || !drow) continue;
      for (let j = ZERO; j < k; j++) {
        const v = drow[j] ?? ZERO;
        srow[j] = (srow[j] ?? ZERO) + v;
        qrow[j] = (qrow[j] ?? ZERO) + v * v;
      }
    }
  }

  const flowSd = zeroMatrix(k);
  if (draws > ONE) {
    for (let i = ZERO; i < k; i++) {
      const srow = sum[i];
      const qrow = sumSq[i];
      const out = flowSd[i];
      if (!srow || !qrow || !out) continue;
      for (let j = ZERO; j < k; j++) {
        const s = srow[j] ?? ZERO;
        const ss = qrow[j] ?? ZERO;
        const variance = (ss - (s * s) / draws) / (draws - ONE);
        out[j] = variance > ZERO ? Math.sqrt(variance) : ZERO;
      }
    }
  }

  return {
    fromDate: from.date,
    toDate: to.date,
    stateIds: active,
    flows,
    flowSd,
    priorDistancePp: priorDistance,
    totalMassPp: totalMass,
  };
}

function zeroMatrix(k: number): number[][] {
  const out: number[][] = [];
  for (let i = ZERO; i < k; i++) {
    const row: number[] = [];
    for (let j = ZERO; j < k; j++) row.push(ZERO);
    out.push(row);
  }
  return out;
}

function nonNegative(x: number): number {
  return Number.isFinite(x) && x > PCT_MIN ? x : PCT_MIN;
}

// --- API pública --------------------------------------------------------------

/**
 * Estima a transferência entre nós consecutivos da série latente.
 *
 * Devolve `null` — e não uma matriz inventada — quando há menos de
 * `TRANSITION_MIN_STEPS` passos utilizáveis: com tão pouco movimento a decompor,
 * a saída seria o prior puro apresentado como resultado, que é exatamente o que
 * a Q-10 proíbe.
 *
 * Determinística: mesma entrada ⇒ mesmo JSON, bit a bit (docs/07 M-6).
 */
/**
 * Um único passo, exposto para quem precisa comparar dois instantes que NÃO são
 * nós consecutivos de uma mesma série — é o caso do backtest de 1º ⇒ 2º turno
 * (Q-10 condição 6), onde o "depois" vem de outro cenário. Mesma matemática,
 * mesma semente e mesmo prior do passo interno: nenhum caminho especial.
 */
export function estimateSingleStep(
  from: TransitionNodeInput,
  to: TransitionNodeInput,
  stateIds: readonly string[],
  stepIndex: number,
): TransitionStepOut | null {
  const e = estimateStep(from, to, stateIds, stepIndex);
  if (!e) return null;
  return { fromDate: e.fromDate, toDate: e.toDate, flows: buildFlows(e) };
}

export function estimateTransitions(input: EstimateTransitionsInput): TransitionsOut | null {
  // Ordem canônica dos estados: toda soma e todo consumo do PRNG passam a ser
  // independentes da ordem em que o chamador montou os arrays (docs/01 §9).
  const states = [...input.states].sort((a, b) => (a.id < b.id ? -ONE : a.id > b.id ? ONE : ZERO));
  const stateIds = states.map((s) => s.id);
  const nodes = input.nodes;

  const estimates: StepEstimate[] = [];
  for (let i = ONE; i < nodes.length; i++) {
    const from = nodes[i - ONE];
    const to = nodes[i];
    if (!from || !to) continue;
    if (from.date >= to.date) continue; // nós fora de ordem ou repetidos não formam passo
    const step = estimateStep(from, to, stateIds, i);
    if (step) estimates.push(step);
  }

  if (estimates.length < TRANSITION_MIN_STEPS) return null;

  const steps: TransitionStepOut[] = estimates.map((e) => ({
    fromDate: e.fromDate,
    toDate: e.toDate,
    flows: buildFlows(e),
  }));

  let priorDistanceSum = ZERO;
  let massSum = ZERO;
  for (const e of estimates) {
    priorDistanceSum += e.priorDistancePp;
    massSum += e.totalMassPp;
  }
  const meanPriorDistance = priorDistanceSum / estimates.length;
  const meanMass = massSum / estimates.length;

  return {
    states,
    steps,
    prior: {
      method: PRIOR_METHOD,
      stickiness: TRANSITION_STICKINESS_PRIOR,
      note: priorNote(meanPriorDistance, meanMass),
    },
  };
}

function buildFlows(e: StepEstimate): TransitionFlowOut[] {
  const out: TransitionFlowOut[] = [];
  const k = e.stateIds.length;
  for (let i = ZERO; i < k; i++) {
    for (let j = ZERO; j < k; j++) {
      const from = e.stateIds[i];
      const to = e.stateIds[j];
      if (from === undefined || to === undefined) continue;
      const pp = e.flows[i]?.[j] ?? ZERO;
      const half = CI_Z_90 * (e.flowSd[i]?.[j] ?? ZERO);
      const lo90Pp = pp - half;
      const hi90Pp = pp + half;
      // Duas formas de "não dá para afirmar que houve fluxo": a banda cruza zero
      // (o dado é compatível com nada ter se movido) ou o ponto está abaixo do
      // piso de visibilidade (é ruído de arredondamento das próprias pesquisas).
      // Nos dois casos o fluxo é PUBLICADO com o rótulo — nunca omitido (Q-10 §3).
      const notIdentifiable = lo90Pp <= ZERO || pp < TRANSITION_MIN_VISIBLE_PP;
      out.push({ from, to, pp, lo90Pp, hi90Pp, notIdentifiable });
    }
  }
  // Ordem determinística de serialização.
  out.sort((a, b) =>
    a.from < b.from ? -ONE : a.from > b.from ? ONE : a.to < b.to ? -ONE : a.to > b.to ? ONE : ZERO,
  );
  return out;
}

/**
 * A nota publicada em `transitions.prior.note` (Q-10 condição 2: "quem lê precisa
 * poder ver de quanto foi a ajuda do prior"). Vai com número, não só adjetivo:
 * quanta massa o ajuste às marginais conseguiu deslocar em relação ao que o prior
 * sozinho diria. O que não foi deslocado É o prior.
 */
function priorNote(meanPriorDistancePp: number, meanMassPp: number): string {
  const moved = meanPriorDistancePp.toFixed(NOTE_DECIMALS);
  const mass = meanMassPp.toFixed(NOTE_DECIMALS);
  // Fração convertida à escala 0–100 (PCT_MAX) só para a leitura da nota.
  const share =
    meanMassPp > ZERO ? ((meanPriorDistancePp / meanMassPp) * PCT_MAX).toFixed(ZERO) : '0';
  return (
    'Estimativa de modelo sob suposição, não medida. Transferência de voto não é ' +
    'identificável a partir de pesquisa agregada (inferência ecológica): há K² incógnitas ' +
    'por passo e apenas K equações marginais, então este número depende do prior tanto ' +
    'quanto do dado. Prior de permanência ("na ausência de evidência o eleitor fica onde ' +
    `estava") com stickiness ${TRANSITION_STICKINESS_PRIOR}, ajustado às marginais das séries ` +
    `latentes por IPF. Em média, o ajuste ao dado deslocou ${moved} p.p. do eleitorado por ` +
    `passo, sobre ${mass} p.p. de massa (${share}% do total); o restante é o prior. A banda ` +
    'de 90% é larga porque a incerteza é grande, e fluxo com banda cruzando zero vem ' +
    'marcado como não distinguível de zero.'
  );
}
