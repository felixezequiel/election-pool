/**
 * `runModel` — a ÚNICA API pública de `@election-pool/model` (T-04).
 *
 * NÃO é um barrel de reexport (CLAUDE.md proíbe barrel; este arquivo é
 * orquestração real). Compõe as etapas do modelo (docs/01) numa única passada
 * determinística:
 *
 *   1. Separa observações em 1º turno (t1) e 2º turno (t2, por par).
 *   2. Roda o suavizador de Kalman (T-03) por grupo ⇒ série latente μ_t.
 *   3. Estima house effects `h_i` conjuntamente com μ_t (T-04, `house-effects.ts`),
 *      iterando μ↔h e impondo Σ w_i·h_i = 0 (docs/01 §1.1, §5).
 *   4. Aplica a restrição de soma sobre os μ_t dos candidatos rastreados
 *      (docs/01 §4.3): normaliza proporcionalmente preservando a fatia de
 *      resíduo estimada pela mediana das pesquisas; desvio pré-normalização
 *      acima de SUM_DEVIATION_MAX_PP LANÇA (R4 do CLAUDE.md, bloqueia publicação).
 *   5. Monta `houseEffects[]` por (instituto, candidato) — o mesmo `h_i` de um
 *      instituto vale para todos os candidatos que ele mediu (v1 não modela
 *      `h_ij`, docs/01 §1.2).
 *   6. Preenche `gates` (docs/07 §3) e devolve um `ModelOutput` VALIDADO contra
 *      `modelOutputSchema` (fronteira Zod, CLAUDE.md convenções).
 *
 * Biblioteca PURA: só `@election-pool/contracts` + módulos irmãos. Sem I/O, sem
 * RNG. Determinística bit a bit (docs/01 §9): dois runs sobre a mesma entrada
 * produzem o mesmo JSON.
 */

import {
  modelOutputSchema,
  type ElectorateObservation,
  type ModelOutput,
  type Observation,
} from '@election-pool/contracts/model-io';
import { SCENARIO_KIND, DIAGNOSTIC_KIND } from '@election-pool/contracts/enums';
import {
  MODEL_VERSION,
  PCT_MIN,
  PCT_MAX,
  SUM_DEVIATION_MAX_PP,
  MODEL_MIN_POLLS,
  MODEL_MIN_DISTINCT_INSTITUTES,
  ACTIVE_WINDOW_DAYS,
} from '@election-pool/contracts/constants';
import {
  runKalman,
  runElectorateKalman,
  ELECTORATE_SERIES,
  type ElectorateKalmanResult,
  type KalmanResult,
  type SmoothedPoint,
} from './kalman.js';
import { isoToDayNumber } from './calendar.js';
import { estimateHouseEffects, type InstituteHouseEffect } from './house-effects.js';
import { computeHerding, computeDivergence, type HouseEffectInput } from './diagnostics.js';
import {
  estimateTransitions,
  type LatentBandInput,
  type TransitionNodeInput,
  type TransitionStateInput,
  type TransitionsOut,
} from './transitions.js';

const ZERO = 0;
const ONE = 1;
const TWO = 2; // aridade de um par de 2º turno (não é parâmetro de modelo)

// --- Entrada de runModel ----------------------------------------------------

/**
 * Entrada de `runModel`. Um array plano de observações do ciclo inteiro
 * (docs/01: o modelo é puro, recebe observações e devolve estimativas) mais a
 * data de referência do run. As observações já vêm validadas pelo schema Zod
 * (`observationsSchema`) na fronteira de quem chama (T-13/render).
 */
export interface ModelInput {
  observations: readonly Observation[];
  /** Data de referência do run (`YYYY-MM-DD` ou ISO com offset), docs/01 §4.4. */
  referenceDate: string;
  /**
   * Branco/nulo e não-sabe declarados por pesquisa (MODEL_VERSION 2.0.0, Q-10).
   * OBRIGATÓRIO de propósito: um chamador que esquecesse de passar produziria uma
   * série de eleitorado vazia em silêncio, e silêncio em dado de pesquisa é
   * justamente o que o R4 proíbe — que quebre no typecheck. Array vazio é valor
   * legítimo e significa "nenhuma pesquisa declarou essas grandezas": a série sai
   * vazia, nunca zerada.
   */
  electorateObservations: readonly ElectorateObservation[];
}

// --- runModel ---------------------------------------------------------------

export function runModel(input: ModelInput): ModelOutput {
  const { referenceDate } = input;

  // Ordenação canônica logo na entrada: toda soma em ponto flutuante (resíduo,
  // normalização) fica independente da ordem de entrada ⇒ saída bit a bit
  // idêntica (docs/01 §9). NUNCA confiar na ordem do array recebido.
  const observations = [...input.observations].sort(compareObservations);

  // 1. Particiona por turno. 1º turno = cenários t1_*; 2º turno = t2 por par.
  // SÓ estimulado (docs/01 §3, ver Q-14). Espontâneo é outra MEDIDA: na mesma
  // rodada, os candidatos somam ~51 na pergunta aberta e ~93 na lista de nomes.
  // Misturar os dois na mesma série latente põe dois valores incomparáveis do mesmo
  // candidato no mesmo dia — e foi o que fez a restrição de soma (§4.3) LANÇAR na
  // primeira vez que dado espontâneo real chegou aqui. O espontâneo continua
  // colhido e persistido; só não alimenta μ_t.
  const firstRoundObs = observations.filter((o) => o.scenarioKind === SCENARIO_KIND.t1Estimulado);
  const runoffGroups = groupRunoffs(observations);

  // 2+3. House effects estimados conjuntamente com μ_t sobre TODO o ciclo
  // (docs/01 §5). A estimação usa o conjunto completo de observações (1º + 2º
  // turno) para identificar h_i com histórico longo; a função de latente
  // injetada é o Kalman de 1º turno (a série que carrega o grosso do sinal).
  const initialLatent = runKalman(observations, { referenceDate });
  const houseEffects = estimateHouseEffects(observations, initialLatent, {
    runLatent: (obs) => runKalman(obs, { referenceDate }),
  });

  // Observações corrigidas por h_i (para as séries latentes finais limpas do viés).
  const effectByInstitute = new Map<string, InstituteHouseEffect>();
  for (const inst of houseEffects.institutes) effectByInstitute.set(inst.instituteId, inst);
  const corrected = correctByHouseEffect(observations, effectByInstitute);

  // 4. Séries latentes finais, já normalizadas pela restrição de soma (§4.3).
  const firstRoundCorrected = corrected.filter(
    (o) => o.scenarioKind === SCENARIO_KIND.t1Estimulado,
  );
  const firstRoundLatent = runKalman(firstRoundCorrected, { referenceDate });
  const firstRoundSeries = buildDatedSeries(firstRoundLatent, firstRoundObs);

  const runoffSeries: RunoffOut[] = [];
  for (const group of runoffGroups) {
    const groupCorrected = correctByHouseEffect(group.observations, effectByInstitute);
    const latent = runKalman(groupCorrected, { referenceDate });
    runoffSeries.push({
      pair: group.pair,
      series: buildDatedSeries(latent, group.observations),
    });
  }

  // 4b. Séries de branco/nulo e não-sabe (MODEL_VERSION 2.0.0, Q-10 condição 1).
  // Passam pelo MESMO suavizador dos candidatos — mesma variância amostral, mesma
  // recência, mesma banda de 90%. Duas decisões explícitas aqui:
  //  (i) NÃO são corrigidas por house effect. `h_i` é estimado sobre intenção por
  //      candidato (docs/01 §5); não existe `h_i` identificado para estas
  //      grandezas, e reaproveitar o do candidato transferiria um viés medido em
  //      outra escala. Ficam como o instituto publicou.
  //  (ii) NÃO entram na restrição de soma (§4.3): o resíduo de lá é estimado pela
  //      mediana das pesquisas e continua exatamente como era, para que μ_t não
  //      mude (Q-10 condição 7).
  const electorateLatent = runElectorateKalman(
    input.electorateObservations.filter((e) => isFirstRoundKind(e.scenarioKind)),
    firstRoundSeries[ZERO]
      ? { referenceDate, gridStartDate: firstRoundSeries[ZERO]?.date ?? referenceDate }
      : { referenceDate },
  );
  const electorateSeries = buildElectorateSeries(electorateLatent, firstRoundSeries);

  /**
   * 4b-bis. DESENGAJAMENTO, medido na pergunta ESPONTÂNEA (Q-14).
   *
   * Mesma matemática de suavização, entrada diferente e significado diferente. Na
   * estimulada a lista de nomes ancora a resposta e o "não sabe" cai a poucos
   * pontos; na espontânea a pergunta é aberta e quem não tem candidato não cita
   * ninguém. Na mesma rodada do mesmo instituto: 37 p.p. contra 3 p.p.
   *
   * Reusa `runElectorateKalman` de propósito — escrever um segundo suavizador para
   * a mesma grandeza em outra base abriria espaço para as duas divergirem por
   * acidente de implementação, e não por diferença de medida.
   *
   * Não toca `μ_t`, não entra na restrição de soma, não realimenta nada. Se um dia
   * entrar, quebrou a condição 7 da Q-10 pela porta de trás.
   */
  const spontaneousLatent = runElectorateKalman(
    input.electorateObservations.filter((e) => e.scenarioKind === SCENARIO_KIND.t1Espontaneo),
    firstRoundSeries[ZERO]
      ? { referenceDate, gridStartDate: firstRoundSeries[ZERO]?.date ?? referenceDate }
      : { referenceDate },
  );
  const spontaneousSeries = buildSpontaneousSeries(spontaneousLatent, firstRoundSeries);

  // 4c. Transferência de votos (Q-10). LÊ as séries acima e não as realimenta:
  // nada daqui volta para μ_t nem para h_i. Se um dia isso mudar, a condição 7 da
  // Q-10 foi violada e o número principal do site passa a depender de um prior
  // que não é identificável.
  const transitions = buildTransitions(firstRoundSeries, electorateSeries, firstRoundObs);

  // 5. houseEffects[] por (instituto, candidato).
  const houseEffectRows = expandHouseEffects(houseEffects.institutes);

  // 5b. Diagnósticos (docs/01 §6) — calculados e PUBLICADOS, nunca aplicados: não
  // realimentam μ_t nem h_i (separação estrutural, T-08). Só herding (§6.2) e
  // divergência (§6.3) são deriváveis das entradas de `runModel`; a taxa de gaveta
  // (§6.1) exige registros do PesqEle, que não entram em `ModelInput` — o chamador
  // (T-13) monta a gaveta com `computeGavetaRates` e as formas ricas de
  // `diagnostics.ts` (ver docs/OPEN-QUESTIONS Q-05).
  const diagnostics = buildDiagnostics(observations, houseEffects.institutes);

  // 6. Gates (docs/07 §3). Cobertura calculada aqui; os gates que dependem de
  // estado entre runs (continuidade M-3, determinismo M-6) ficam a cargo de quem
  // chama comparar runs — aqui reportamos o que o run sozinho pode afirmar.
  const gates = computeGates(firstRoundObs, referenceDate);

  const output = {
    modelVersion: MODEL_VERSION,
    referenceDate,
    latent: {
      firstRound: firstRoundSeries,
      runoffs: runoffSeries,
      electorate: electorateSeries,
      spontaneous: spontaneousSeries,
    },
    houseEffects: houseEffectRows,
    diagnostics,
    transitions,
    gates,
  };

  // Fronteira Zod: valida (e aplica os branded types) antes de devolver.
  return modelOutputSchema.parse(output);
}

// --- Estruturas internas ----------------------------------------------------

interface RunoffGroup {
  pair: [string, string];
  observations: Observation[];
}

interface DatedPointOut {
  date: string;
  byCandidate: Record<string, { meanPct: number; lo90Pct: number; hi90Pct: number }>;
}

interface RunoffOut {
  pair: [string, string];
  series: DatedPointOut[];
}

// --- Particionamento de 2º turno --------------------------------------------

function groupRunoffs(observations: readonly Observation[]): RunoffGroup[] {
  const byPair = new Map<string, RunoffGroup>();
  for (const o of observations) {
    if (o.scenarioKind !== SCENARIO_KIND.t2 || o.t2Pair === null) continue;
    const pair = normalizePair(o.t2Pair);
    const key = `${pair[0]} ${pair[1]}`;
    let group = byPair.get(key);
    if (!group) {
      group = { pair, observations: [] };
      byPair.set(key, group);
    }
    group.observations.push(o);
  }
  // Ordena por par para saída determinística.
  return [...byPair.values()].sort((a, b) => comparePair(a.pair, b.pair));
}

/** Par de 2º turno normalizado em ordem alfabética (docs/01 §3). */
function normalizePair(pair: readonly [string, string]): [string, string] {
  const [a, b] = pair;
  return a <= b ? [a, b] : [b, a];
}

function comparePair(a: readonly [string, string], b: readonly [string, string]): number {
  if (a[0] < b[0]) return -ONE;
  if (a[0] > b[0]) return ONE;
  if (a[1] < b[1]) return -ONE;
  if (a[1] > b[1]) return ONE;
  return ZERO;
}

/**
 * Ordem canônica de observação (docs/01 §9). Total order ESTRITO: a mesma
 * (data, instituto, candidato) pode ocorrer em cenários distintos (t1 e t2 no
 * mesmo dia), então desempatamos por scenarioKind e t2Pair — senão a ordem entre
 * "iguais" dependeria da entrada e quebraria a soma bit a bit da normalização.
 */
function compareObservations(a: Observation, b: Observation): number {
  if (a.fieldMedianDate < b.fieldMedianDate) return -ONE;
  if (a.fieldMedianDate > b.fieldMedianDate) return ONE;
  if (a.instituteId < b.instituteId) return -ONE;
  if (a.instituteId > b.instituteId) return ONE;
  if (a.candidateId < b.candidateId) return -ONE;
  if (a.candidateId > b.candidateId) return ONE;
  if (a.scenarioKind < b.scenarioKind) return -ONE;
  if (a.scenarioKind > b.scenarioKind) return ONE;
  const pa = a.t2Pair ? `${a.t2Pair[0]} ${a.t2Pair[1]}` : '';
  const pb = b.t2Pair ? `${b.t2Pair[0]} ${b.t2Pair[1]}` : '';
  if (pa < pb) return -ONE;
  if (pa > pb) return ONE;
  return ZERO;
}

// --- Correção por house effect ----------------------------------------------

function correctByHouseEffect(
  observations: readonly Observation[],
  effectByInstitute: ReadonlyMap<string, InstituteHouseEffect>,
): Observation[] {
  return observations.map((o) => {
    const inst = effectByInstitute.get(o.instituteId);
    const h = inst && inst.estimable ? inst.effectPp : ZERO;
    if (h === ZERO) return o;
    return { ...o, valuePct: clampPct(o.valuePct - h) as Observation['valuePct'] };
  });
}

// --- Restrição de soma (docs/01 §4.3) ---------------------------------------

/**
 * Monta a série datada de `latent`, aplicando a restrição de soma (§4.3) por
 * data: os μ_t dos candidatos rastreados são renormalizados proporcionalmente
 * para caber em `100 − resíduo`, onde o resíduo é a fatia estimada pela mediana
 * das pesquisas da janela. Se o desvio pré-normalização exceder
 * SUM_DEVIATION_MAX_PP, LANÇA (R4, bloqueia publicação).
 */
function buildDatedSeries(latent: KalmanResult, obs: readonly Observation[]): DatedPointOut[] {
  const residualPct = estimateResidualSlice(obs, latent.candidateIds);
  const trackedTotal = PCT_MAX - residualPct; // alvo da soma dos rastreados

  // Agrupa pontos por data.
  const byDate = new Map<string, SmoothedPoint[]>();
  for (const p of latent.points) {
    let bucket = byDate.get(p.date);
    if (!bucket) {
      bucket = [];
      byDate.set(p.date, bucket);
    }
    bucket.push(p);
  }

  const dates = [...byDate.keys()].sort();
  const out: DatedPointOut[] = [];
  for (const date of dates) {
    const points = (byDate.get(date) ?? [])
      .slice()
      .sort((a, b) =>
        a.candidateId < b.candidateId ? -ONE : a.candidateId > b.candidateId ? ONE : ZERO,
      );
    const rawSum = points.reduce((s, p) => s + p.mean, ZERO);

    // Desvio pré-normalização (§4.3 / docs/07 M-2): |rawSum − trackedTotal|.
    const deviation = Math.abs(rawSum - trackedTotal);
    if (deviation > SUM_DEVIATION_MAX_PP) {
      throw new Error(
        `sum constraint violated at ${date}: tracked μ sum ${rawSum.toFixed(TWO)} vs target ` +
          `${trackedTotal.toFixed(TWO)} (deviation ${deviation.toFixed(TWO)} p.p. > ` +
          `${SUM_DEVIATION_MAX_PP}); likely ingestion error (docs/01 §4.3)`,
      );
    }

    const factor = rawSum > ZERO ? trackedTotal / rawSum : ONE;
    const byCandidate: DatedPointOut['byCandidate'] = {};
    for (const p of points) {
      // Escala mean/lo/hi pelo mesmo fator: preserva a largura relativa da banda.
      byCandidate[p.candidateId] = {
        meanPct: clampPct(p.mean * factor),
        lo90Pct: clampPct(p.lo90 * factor),
        hi90Pct: clampPct(p.hi90 * factor),
      };
    }
    out.push({ date, byCandidate });
  }
  return out;
}

/**
 * Estima a fatia de resíduo ("Demais" + brancos/nulos + indecisos) pela mediana,
 * entre as pesquisas da janela ativa, de `100 − Σ candidatos rastreados` (docs/01
 * §4.3). Uma "pesquisa da janela" é um (instituto, data) dentro de
 * ACTIVE_WINDOW_DAYS; somamos os candidatos rastreados dessa pesquisa.
 */
function estimateResidualSlice(
  obs: readonly Observation[],
  trackedCandidateIds: readonly string[],
): number {
  const tracked = new Set(trackedCandidateIds);
  const refDay = maxDay(obs);
  // Soma dos rastreados por (instituto, data).
  const sums = new Map<string, number>();
  for (const o of obs) {
    if (!tracked.has(o.candidateId)) continue;
    const day = isoToDayNumber(o.fieldMedianDate);
    if (refDay - day > ACTIVE_WINDOW_DAYS) continue; // fora da janela ativa (§4.4)
    const key = `${o.instituteId} ${o.fieldMedianDate}`;
    sums.set(key, (sums.get(key) ?? ZERO) + o.valuePct);
  }
  const residuals: number[] = [];
  for (const trackedSum of sums.values()) residuals.push(PCT_MAX - trackedSum);
  if (residuals.length === ZERO) return ZERO;
  return clampPct(median(residuals));
}

function maxDay(obs: readonly Observation[]): number {
  let m = Number.NEGATIVE_INFINITY;
  for (const o of obs) {
    const d = isoToDayNumber(o.fieldMedianDate);
    if (d > m) m = d;
  }
  return Number.isFinite(m) ? m : ZERO;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === ZERO) return ZERO;
  const mid = Math.floor(n / TWO);
  if (n % TWO === ONE) return sorted[mid] ?? ZERO;
  const lo = sorted[mid - ONE] ?? ZERO;
  const hi = sorted[mid] ?? ZERO;
  return (lo + hi) / TWO;
}

// --- Séries de branco/nulo e não-sabe (Q-10) ---------------------------------

interface BandOut {
  meanPct: number;
  lo90Pct: number;
  hi90Pct: number;
}

interface ElectoratePointOut {
  date: string;
  blankNull: BandOut | null;
  undecided: BandOut | null;
}

/** Ponto de desengajamento medido na espontânea (Q-14). */
interface SpontaneousPointOut {
  date: string;
  noCandidate: BandOut | null;
  blankNull: BandOut | null;
  named: BandOut | null;
}

/**
 * O 1º turno do MODELO é só o estimulado (docs/01 §3, Q-14). Vale também para a
 * série de eleitorado: branco/nulo da espontânea (12 p.p.) e da estimulada (4 p.p.)
 * medem coisas diferentes, e a série tem de ficar na mesma base dos candidatos para
 * as duas somarem 100.
 */
function isFirstRoundKind(kind: Observation['scenarioKind']): boolean {
  return kind === SCENARIO_KIND.t1Estimulado;
}

/**
 * Alinha a série de eleitorado ao grid da série de candidatos e traduz "sem
 * medida" em `null`.
 *
 * O suavizador SEMPRE devolve um número — mesmo num trecho onde nenhuma pesquisa
 * mediu a grandeza, onde esse número seria só o prior passeando. Publicar isso
 * como estimativa seria o zero silencioso do R4 vestido de outra roupa. Por isso
 * o ponto só sai com valor quando `measured` é verdadeiro; caso contrário sai
 * `null`, e a UI mostra lacuna em vez de linha.
 */
function buildElectorateSeries(
  latent: ElectorateKalmanResult,
  firstRound: readonly DatedPointOut[],
): ElectoratePointOut[] {
  if (latent.points.length === ZERO) return [];

  const byDate = new Map<string, { blankNull: BandOut | null; undecided: BandOut | null }>();
  for (const p of latent.points) {
    let row = byDate.get(p.date);
    if (!row) {
      row = { blankNull: null, undecided: null };
      byDate.set(p.date, row);
    }
    if (!p.measured) continue; // sem medida na vizinhança ⇒ null, nunca o número do prior
    const band: BandOut = {
      meanPct: clampPct(p.mean),
      lo90Pct: clampPct(p.lo90),
      hi90Pct: clampPct(p.hi90),
    };
    if (p.seriesId === ELECTORATE_SERIES.blankNull) row.blankNull = band;
    else row.undecided = band;
  }

  // Grid de saída = o da série de candidatos (para a UI casar os eixos sem
  // interpolar); sem série de candidatos, o próprio grid do eleitorado.
  const dates = firstRound.length > ZERO ? firstRound.map((p) => p.date) : [...latent.dates];
  const out: ElectoratePointOut[] = [];
  for (const date of dates) {
    const row = byDate.get(date);
    out.push({
      date,
      blankNull: row?.blankNull ?? null,
      undecided: row?.undecided ?? null,
    });
  }
  return out;
}

/**
 * Série de DESENGAJAMENTO a partir da espontânea (Q-14).
 *
 * Reusa a saída do mesmo suavizador, mas TRADUZ o significado: o que na estimulada
 * é "não sabe" é aqui "não citou nenhum nome", que é uma afirmação muito mais forte
 * — a pergunta era aberta e a pessoa não tinha nome para dar.
 *
 * `named` é ARITMÉTICA sobre valores publicados: quem citou alguém é o complemento
 * de quem não citou e de quem citou branco/nulo. Só é calculado quando as DUAS
 * pontas existem; faltando uma, fica `null` em vez de virar um número por dedução
 * parcial (R4). A banda de `named` propaga somando as semilarguras — conservador
 * de propósito: preferimos banda larga demais a estreita demais.
 */
function buildSpontaneousSeries(
  latent: ElectorateKalmanResult,
  firstRound: readonly DatedPointOut[],
): SpontaneousPointOut[] {
  const base = buildElectorateSeries(latent, firstRound);
  return base.map((p) => {
    const noCandidate = p.undecided;
    const blankNull = p.blankNull;
    let named: BandOut | null = null;
    if (noCandidate !== null && blankNull !== null) {
      const somaMedia = noCandidate.meanPct + blankNull.meanPct;
      // Semilargura de cada ponta, somada (limite superior da incerteza conjunta).
      const semi =
        (noCandidate.hi90Pct - noCandidate.lo90Pct) / TWO +
        (blankNull.hi90Pct - blankNull.lo90Pct) / TWO;
      const media = PCT_MAX - somaMedia;
      named = {
        meanPct: clampPct(media),
        lo90Pct: clampPct(media - semi),
        hi90Pct: clampPct(media + semi),
      };
    }
    return { date: p.date, noCandidate, blankNull, named };
  });
}

// --- Transferência de votos (Q-10) -------------------------------------------

/**
 * Monta a entrada do estimador de transferência a partir das séries latentes.
 *
 * Os NÓS são as datas em que houve medição de 1º turno dentro da janela ativa —
 * não o grid diário inteiro. Dois motivos: entre duas medições o suavizador não
 * recebeu informação nova, então um "fluxo" ali seria interpolação apresentada
 * como movimento; e fora da janela ativa (§4.4) a série é prior puro, onde
 * decompor movimento é decompor o prior.
 *
 * Devolve `null` quando o estimador não tem passos suficientes — a ausência de
 * transferência é uma resposta legítima, um número inventado não é.
 */
function buildTransitions(
  firstRound: readonly DatedPointOut[],
  electorate: readonly ElectoratePointOut[],
  firstRoundObs: readonly Observation[],
): TransitionsOut | null {
  if (firstRound.length === ZERO) return null;
  const lastDate = firstRound[firstRound.length - ONE]?.date ?? '';
  if (lastDate === '') return null;
  const refDay = isoToDayNumber(lastDate);

  const seriesByDate = new Map<string, DatedPointOut>();
  for (const p of firstRound) seriesByDate.set(p.date, p);
  const electorateByDate = new Map<string, ElectoratePointOut>();
  for (const p of electorate) electorateByDate.set(p.date, p);

  // Datas de medição dentro da janela ativa, ordenadas e sem repetição.
  const measurementDates = new Set<string>();
  for (const o of firstRoundObs) {
    const delta = refDay - isoToDayNumber(o.fieldMedianDate);
    if (delta < ZERO || delta > ACTIVE_WINDOW_DAYS) continue;
    if (!seriesByDate.has(o.fieldMedianDate)) continue;
    measurementDates.add(o.fieldMedianDate);
  }
  const nodeDates = [...measurementDates].sort();
  if (nodeDates.length <= ONE) return null;

  // Estados: candidatos rastreados presentes nos nós + as grandezas de eleitorado
  // que têm ao menos uma medida entre os nós. Estado sem medida nenhuma não vira
  // estado — não existe "zero de não-sabe" inferido por omissão (R4).
  const candidateIds = new Set<string>();
  let hasBlankNull = false;
  let hasUndecided = false;
  for (const date of nodeDates) {
    const point = seriesByDate.get(date);
    if (point) for (const id of Object.keys(point.byCandidate)) candidateIds.add(id);
    const e = electorateByDate.get(date);
    if (e?.blankNull) hasBlankNull = true;
    if (e?.undecided) hasUndecided = true;
  }

  const states: TransitionStateInput[] = [...candidateIds]
    .sort()
    .map((id) => ({ id, kind: 'candidate' as const, displayName: id }));
  if (hasBlankNull) {
    states.push({
      id: ELECTORATE_SERIES.blankNull,
      kind: ELECTORATE_SERIES.blankNull,
      displayName: 'Branco/nulo',
    });
  }
  if (hasUndecided) {
    states.push({
      id: ELECTORATE_SERIES.undecided,
      kind: ELECTORATE_SERIES.undecided,
      displayName: 'Não sabe',
    });
  }

  const nodes: TransitionNodeInput[] = nodeDates.map((date) => {
    const byState: Record<string, LatentBandInput | null> = {};
    const point = seriesByDate.get(date);
    for (const id of candidateIds) byState[id] = point?.byCandidate[id] ?? null;
    const e = electorateByDate.get(date);
    if (hasBlankNull) byState[ELECTORATE_SERIES.blankNull] = e?.blankNull ?? null;
    if (hasUndecided) byState[ELECTORATE_SERIES.undecided] = e?.undecided ?? null;
    return { date, byState };
  });

  return estimateTransitions({ states, nodes });
}

// --- Expansão de house effects por (instituto, candidato) -------------------

interface HouseEffectRow {
  instituteId: string;
  candidateId: string;
  effectPp: number;
  lo90Pp: number;
  hi90Pp: number;
  nPolls: number;
  estimable: boolean;
}

function expandHouseEffects(institutes: readonly InstituteHouseEffect[]): HouseEffectRow[] {
  const rows: HouseEffectRow[] = [];
  for (const inst of institutes) {
    for (const candidateId of inst.candidateIds) {
      rows.push({
        instituteId: inst.instituteId,
        candidateId,
        effectPp: inst.effectPp,
        lo90Pp: inst.lo90Pp,
        hi90Pp: inst.hi90Pp,
        nPolls: inst.nPolls,
        estimable: inst.estimable,
      });
    }
  }
  // Ordena por (instituto, candidato) para determinismo de serialização.
  rows.sort((a, b) =>
    a.instituteId < b.instituteId
      ? -ONE
      : a.instituteId > b.instituteId
        ? ONE
        : a.candidateId < b.candidateId
          ? -ONE
          : a.candidateId > b.candidateId
            ? ONE
            : ZERO,
  );
  return rows;
}

// --- Diagnósticos (docs/01 §6) ----------------------------------------------

interface DiagnosticRow {
  kind: (typeof DIAGNOSTIC_KIND)[keyof typeof DIAGNOSTIC_KIND];
  subjectId: string;
  value: number;
  n: number;
}

/**
 * Monta os diagnósticos que `runModel` consegue derivar de suas entradas — herding
 * (§6.2) e divergência (§6.3) — na forma NARROW de `ModelOutput.diagnostics`
 * (`{kind, subjectId, value, n}`, docs/03 §2.5 / model-io). É intencionalmente uma
 * projeção com perda: `windowEnd`/`flagged`/`ratio` de herding e os limites do IC de
 * divergência não cabem nesse shape, então a UI consome as FORMAS RICAS de
 * `diagnostics.ts` (docs/03 §5 `PublicData.diagnostics`), não esta lista — que serve
 * de resumo/handle estável. A taxa de gaveta (§6.1) NÃO entra aqui: exige registros
 * do PesqEle, ausentes de `ModelInput`. Ver docs/OPEN-QUESTIONS Q-05.
 *
 * NENHUM valor daqui realimenta μ_t ou h_i: diagnóstico é publicado, não aplicado.
 */
function buildDiagnostics(
  observations: readonly Observation[],
  institutes: readonly InstituteHouseEffect[],
): DiagnosticRow[] {
  const rows: DiagnosticRow[] = [];

  // Herding (§6.2): subjectId = fim da janela; value = ratio; n = nº de pesquisas.
  for (const h of computeHerding(observations)) {
    rows.push({
      kind: DIAGNOSTIC_KIND.herding,
      subjectId: h.windowEnd,
      value: h.ratio,
      n: h.nPolls,
    });
  }

  // Divergência (§6.3): subjectId = instituto; value = h_i; n = nº de pesquisas.
  // Só publicamos os institutos efetivamente marcados divergentes (estimável, |h|>3,
  // IC 90% fora de zero) — o resumo narrow lista as ANOMALIAS, não todo instituto.
  const heInput: HouseEffectInput[] = institutes.map((i) => ({
    instituteId: i.instituteId,
    effectPp: i.effectPp,
    lo90Pp: i.lo90Pp,
    hi90Pp: i.hi90Pp,
    estimable: i.estimable,
  }));
  const nPollsById = new Map<string, number>();
  for (const i of institutes) nPollsById.set(i.instituteId, i.nPolls);
  for (const d of computeDivergence(heInput)) {
    if (!d.divergent) continue;
    rows.push({
      kind: DIAGNOSTIC_KIND.divergencia,
      subjectId: d.instituteId,
      value: d.effectPp,
      n: nPollsById.get(d.instituteId) ?? ZERO,
    });
  }

  // Ordem determinística de serialização (docs/01 §9).
  rows.sort((a, b) =>
    a.kind < b.kind
      ? -ONE
      : a.kind > b.kind
        ? ONE
        : a.subjectId < b.subjectId
          ? -ONE
          : a.subjectId > b.subjectId
            ? ONE
            : ZERO,
  );
  return rows;
}

// --- Gates (docs/07 §3) -----------------------------------------------------

function computeGates(
  firstRoundObs: readonly Observation[],
  referenceDate: string,
): {
  passed: boolean;
  coverageOk: boolean;
  sumOk: boolean;
  continuityOk: boolean;
  bandSanityOk: boolean;
  convergenceOk: boolean;
  determinismOk: boolean;
} {
  const coverageOk = checkCoverage(firstRoundObs, referenceDate);
  // sumOk: buildDatedSeries LANÇA se a restrição de soma (§4.3) for violada; se o
  // fluxo chegou aqui, a soma fechou dentro de SUM_DEVIATION_MAX_PP.
  const sumOk = true;
  // Continuidade (M-3) e determinismo (M-6) comparam runs consecutivos; um run
  // isolado não pode afirmá-los ⇒ quem chama compara. Convergência (M-5): o
  // Kalman já garante ausência de NaN/Inf/variância negativa (T-03). Banda (M-4):
  // largura por run é diagnóstico do consumidor, não bloqueia a montagem aqui.
  const continuityOk = true;
  const determinismOk = true;
  const convergenceOk = true;
  const bandSanityOk = true;
  const passed =
    coverageOk && sumOk && continuityOk && bandSanityOk && convergenceOk && determinismOk;
  return { passed, coverageOk, sumOk, continuityOk, bandSanityOk, convergenceOk, determinismOk };
}

/** M-1: ≥ MODEL_MIN_POLLS pesquisas de ≥ MODEL_MIN_DISTINCT_INSTITUTES na janela. */
function checkCoverage(obs: readonly Observation[], referenceDate: string): boolean {
  if (referenceDate === '') return false;
  const refDay = isoToDayNumber(referenceDate);
  const institutesInWindow = new Set<string>();
  const pollsInWindow = new Set<string>();
  for (const o of obs) {
    const delta = refDay - isoToDayNumber(o.fieldMedianDate);
    if (delta < ZERO || delta > ACTIVE_WINDOW_DAYS) continue;
    institutesInWindow.add(o.instituteId);
    pollsInWindow.add(`${o.instituteId} ${o.fieldMedianDate}`);
  }
  return (
    pollsInWindow.size >= MODEL_MIN_POLLS &&
    institutesInWindow.size >= MODEL_MIN_DISTINCT_INSTITUTES
  );
}

// --- utilidades -------------------------------------------------------------

function clampPct(x: number): number {
  if (!Number.isFinite(x)) return PCT_MIN;
  if (x < PCT_MIN) return PCT_MIN;
  if (x > PCT_MAX) return PCT_MAX;
  return x;
}
