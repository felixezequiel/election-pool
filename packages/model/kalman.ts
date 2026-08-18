/**
 * Filtro de Kalman + suavizador RTS da série latente μ_t (docs/01 §2, §4).
 *
 * Biblioteca PURA (T-03 / CLAUDE.md): só importa de `@election-pool/contracts` e
 * de Node stdlib. Não toca rede, banco nem `apps/`. Sem RNG. Determinística: dado
 * o mesmo input, a saída é bit a bit idêntica (docs/01 §9).
 *
 * Modelo, por candidato (docs/01 §2 trata os candidatos como independentes no
 * processo; a restrição de soma é aplicada na saída por outra etapa, §4.3):
 *
 *   estado:      μ_t  (escalar, p.p. na escala 0–100)
 *   processo:    μ_t ~ N(μ_{t-1}, σ_process²) por dia          (SIGMA_PROCESS)
 *   observação:  y_it = μ_t + ruído,  Var = deff·σ_sampling² + σ_house_extra²
 *                σ_sampling = sqrt(p(1-p)/n)·100, com p = estimativa CORRENTE de
 *                μ_t (não o valor observado, docs/01 §4.2)
 *   recência:    peso w = exp(-Δdias/τ) aplicado à precisão da observação (§4.4);
 *                Δdias > ACTIVE_WINDOW_DAYS ⇒ observação fora da janela ativa.
 *
 * Como cada candidato é independente no processo, cada série é um filtro de Kalman
 * ESCALAR — exato, não uma aproximação. `linalg.ts` existe para a extensão
 * multivariada futura (docs/OPEN-QUESTIONS Q-03) e para as garantias de simetria.
 */

import type { ElectorateObservation, Observation } from '@election-pool/contracts/model-io';
import {
  SIGMA_PROCESS,
  DEFF,
  SIGMA_HOUSE_EXTRA,
  TAU_RECENCY_DAYS,
  ACTIVE_WINDOW_DAYS,
  CI_Z_90,
  PCT_MIN,
  PCT_MAX,
  MODEL_VERSION,
} from '@election-pool/contracts/constants';
import { isoToDayNumber, dayNumberToIso } from './calendar.js';

// Re-export das utilidades de calendário: são consumidas por outros módulos do
// pacote e pelos testes que já importavam de `./kalman.js`. A aritmética de data
// vive em `calendar.ts` (ver o cabeçalho de lá) para manter o gate de viés honesto.
export { isoToDayNumber, dayNumberToIso } from './calendar.js';

const ZERO = 0;
const ONE = 1;
// Divisor do ponto médio da escala ((PCT_MIN+PCT_MAX)/2). Aritmética estrutural,
// não parâmetro de modelo — nomeada para o gate de viés (docs/07 §5.1) passar honesto.
const MIDPOINT_DIVISOR = 2;

// --- Tipos de saída ---------------------------------------------------------

/** Ponto suavizado de uma série (um candidato, um dia). */
export interface SmoothedPoint {
  /** Data do nó no grid diário, `YYYY-MM-DD`. */
  date: string;
  candidateId: string;
  /** Média suavizada μ_t, escala 0–100, com clamp em [0,100]. */
  mean: number;
  /** Limite inferior do IC 90%, clamp em [0,100]. */
  lo90: number;
  /** Limite superior do IC 90%, clamp em [0,100]. */
  hi90: number;
  /** Variância suavizada (p.p.²), sempre finita e ≥ 0. Diagnóstico p/ T-08. */
  variance: number;
}

/** Resultado do smoother: série por candidato, ordenada por (date, candidateId). */
export interface KalmanResult {
  modelVersion: string;
  referenceDate: string;
  /** Todos os pontos, ordenados deterministicamente por (date, candidateId). */
  points: SmoothedPoint[];
  /** Ids de candidato rastreados, ordenados. */
  candidateIds: string[];
  /** Datas do grid diário, ordenadas, `YYYY-MM-DD`. */
  dates: string[];
}

export interface KalmanOptions {
  /**
   * Data de referência do run (`YYYY-MM-DD` ou ISO com offset). O grid vai da
   * menor data observada até esta data. Se omitida, usa a maior data observada.
   */
  referenceDate?: string;
  /**
   * Ids de candidato a rastrear. Se omitido, deriva do conjunto de observações.
   * Passar explicitamente garante saída estável mesmo p/ candidato sem obs.
   */
  candidateIds?: readonly string[];
}

// --- Núcleo estatístico -----------------------------------------------------

/**
 * Variância da observação (docs/01 §4.2), em p.p.², dado o `p` corrente e o `n`.
 * `p` é a estimativa corrente de μ_t na ESCALA 0–100 (não o valor observado).
 * Nunca retorna NaN/Infinity/negativo: `p` é grampeado a [0,100] e `n≥1` já é
 * garantido pelo schema (`sampleSize` int positivo).
 */
export function observationVariance(pPct: number, sampleSize: number): number {
  const pClamped = clamp(pPct, PCT_MIN, PCT_MAX);
  const frac = pClamped / PCT_MAX;
  const n = sampleSize > ZERO ? sampleSize : ONE;
  // σ_sampling² = p(1-p)/n · 100²  (variância do estimador em p.p.²)
  const samplingVar = ((frac * (ONE - frac)) / n) * PCT_MAX * PCT_MAX;
  const v = DEFF * samplingVar + SIGMA_HOUSE_EXTRA * SIGMA_HOUSE_EXTRA;
  return Number.isFinite(v) && v > ZERO ? v : SIGMA_HOUSE_EXTRA * SIGMA_HOUSE_EXTRA;
}

/** Peso de recência exp(-Δdias/τ) (docs/01 §4.4). Δdias em [0, ∞). */
export function recencyWeight(deltaDays: number): number {
  const dd = deltaDays > ZERO ? deltaDays : ZERO;
  const w = Math.exp(-dd / TAU_RECENCY_DAYS);
  return Number.isFinite(w) && w > ZERO ? w : Number.MIN_VALUE;
}

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

// Observação agrupada por dia, já com Δdias medido contra a data de referência.
interface DayObs {
  candidateId: string;
  instituteId: string;
  valuePct: number;
  sampleSize: number;
  deltaDays: number;
}

/**
 * Roda o filtro de Kalman forward + suavizador RTS sobre as observações.
 *
 * Passos:
 *  1. Valida/ordena determinísticamente por (date, instituteId, candidateId).
 *  2. Monta o grid diário [minDate, referenceDate].
 *  3. Para cada candidato, filtra escalarmente dia a dia (predict + N updates),
 *     depois suaviza (RTS backward).
 *  4. Emite {date, candidateId, mean, lo90, hi90}, clamp em [0,100].
 *
 * A banda ALARGA em dias sem observação — comportamento correto (docs/01 §2,
 * T-03): o predict adiciona σ_process² e nada a reduz.
 */
export function runKalman(
  observations: readonly Observation[],
  options: KalmanOptions = {},
): KalmanResult {
  // 1. Ordenação determinística. NUNCA confiar em ordem de Map/Object.
  const sorted = [...observations].sort(compareObservations);

  const candidateIds = deriveCandidateIds(sorted, options.candidateIds);

  if (sorted.length === ZERO) {
    return {
      modelVersion: MODEL_VERSION,
      referenceDate: options.referenceDate
        ? dayNumberToIso(isoToDayNumber(options.referenceDate))
        : '',
      points: [],
      candidateIds,
      dates: [],
    };
  }

  // 2. Grid diário. minDay = menor data observada; refDay = referenceDate (ou a
  // maior data observada). refDay nunca é anterior a minDay.
  const dayNumbers = sorted.map((o) => isoToDayNumber(o.fieldMedianDate));
  const minDay = dayNumbers.reduce((a, b) => (b < a ? b : a), dayNumbers[ZERO] ?? ZERO);
  const maxObsDay = dayNumbers.reduce((a, b) => (b > a ? b : a), dayNumbers[ZERO] ?? ZERO);
  const refDay = options.referenceDate ? isoToDayNumber(options.referenceDate) : maxObsDay;
  const gridEnd = refDay >= minDay ? refDay : minDay;
  const nDays = gridEnd - minDay + ONE;

  const dates: string[] = [];
  for (let i = ZERO; i < nDays; i++) dates.push(dayNumberToIso(minDay + i));

  // Índice: dia (0..nDays-1) -> observações daquele dia, por candidato.
  const obsByDay: DayObs[][] = [];
  for (let i = ZERO; i < nDays; i++) obsByDay.push([]);
  for (let k = ZERO; k < sorted.length; k++) {
    const o = sorted[k];
    if (!o) continue;
    const day = (dayNumbers[k] ?? minDay) - minDay;
    if (day < ZERO || day >= nDays) continue;
    const deltaDays = gridEnd - (dayNumbers[k] ?? gridEnd);
    if (deltaDays > ACTIVE_WINDOW_DAYS) continue; // fora da janela ativa (§4.4)
    const bucket = obsByDay[day];
    if (bucket) {
      bucket.push({
        candidateId: o.candidateId,
        instituteId: o.instituteId,
        valuePct: o.valuePct,
        sampleSize: o.sampleSize,
        deltaDays,
      });
    }
  }

  const points: SmoothedPoint[] = [];
  for (const candidateId of candidateIds) {
    const series = smoothCandidate(candidateId, nDays, obsByDay);
    for (let i = ZERO; i < nDays; i++) {
      const mean = series.mean[i] ?? ZERO;
      const variance = series.variance[i] ?? ZERO;
      const sd = Math.sqrt(variance > ZERO ? variance : ZERO);
      const half = CI_Z_90 * sd;
      const date = dates[i] ?? '';
      points.push({
        date,
        candidateId,
        mean: clamp(mean, PCT_MIN, PCT_MAX),
        lo90: clamp(mean - half, PCT_MIN, PCT_MAX),
        hi90: clamp(mean + half, PCT_MIN, PCT_MAX),
        variance,
      });
    }
  }

  // Saída ordenada por (date, candidateId) para determinismo de serialização.
  points.sort((a, b) =>
    a.date < b.date
      ? -ONE
      : a.date > b.date
        ? ONE
        : a.candidateId < b.candidateId
          ? -ONE
          : a.candidateId > b.candidateId
            ? ONE
            : ZERO,
  );

  return {
    modelVersion: MODEL_VERSION,
    referenceDate: dayNumberToIso(gridEnd),
    points,
    candidateIds,
    dates,
  };
}

interface CandidateSeries {
  mean: number[];
  variance: number[];
}

/**
 * Filtro escalar forward + suavização RTS para um candidato.
 *
 * Prior do estado no dia 0: média = primeira observação do candidato (ou o ponto
 * médio da escala se não houver nenhuma), variância inicial larga o suficiente
 * para ser praticamente não-informativa mas finita (garante ausência de NaN).
 */
function smoothCandidate(
  candidateId: string,
  nDays: number,
  obsByDay: DayObs[][],
): CandidateSeries {
  // Predições e filtragens (para o passo backward do RTS).
  const predMean = new Array<number>(nDays).fill(ZERO); // μ_{t|t-1}
  const predVar = new Array<number>(nDays).fill(ZERO); // P_{t|t-1}
  const filtMean = new Array<number>(nDays).fill(ZERO); // μ_{t|t}
  const filtVar = new Array<number>(nDays).fill(ZERO); // P_{t|t}

  const q = SIGMA_PROCESS * SIGMA_PROCESS; // variância do processo por dia

  // Prior não-informativo mas finito. A largura de partida é a largura máxima
  // plausível da escala; não é ajuste de modelo, é só um prior difuso.
  const priorMean =
    firstObservedValue(candidateId, obsByDay) ?? (PCT_MIN + PCT_MAX) / MIDPOINT_DIVISOR;
  const priorVar = (PCT_MAX - PCT_MIN) * (PCT_MAX - PCT_MIN); // 100² p.p.²

  for (let t = ZERO; t < nDays; t++) {
    // --- Predict ---
    if (t === ZERO) {
      predMean[t] = priorMean;
      predVar[t] = priorVar;
    } else {
      predMean[t] = filtMean[t - ONE] ?? priorMean;
      predVar[t] = (filtVar[t - ONE] ?? priorVar) + q; // random walk: soma σ_process²
    }

    // --- Update com todas as observações do dia (updates escalares em sequência) ---
    let m = predMean[t] ?? priorMean;
    let p = predVar[t] ?? priorVar;

    const dayObs = obsByDay[t] ?? [];
    // Ordena as observações do dia por (instituteId) para determinismo do produto.
    const forCandidate = dayObs
      .filter((o) => o.candidateId === candidateId)
      .sort((a, b) =>
        a.instituteId < b.instituteId ? -ONE : a.instituteId > b.instituteId ? ONE : ZERO,
      );

    for (const o of forCandidate) {
      // σ_sampling usa o p CORRENTE (m), não o valor observado (docs/01 §4.2).
      const rBase = observationVariance(m, o.sampleSize);
      const w = recencyWeight(o.deltaDays);
      const rEff = rBase / w; // peso na precisão ⇒ divide a variância pela recência
      const denom = p + rEff;
      if (!(denom > ZERO) || !Number.isFinite(denom)) continue;
      const gain = p / denom; // ganho de Kalman escalar
      m = m + gain * (o.valuePct - m);
      p = (ONE - gain) * p;
      if (!Number.isFinite(m)) m = predMean[t] ?? priorMean;
      if (!(p >= ZERO) || !Number.isFinite(p)) p = ZERO; // covariância nunca negativa
    }

    filtMean[t] = m;
    filtVar[t] = p;
  }

  // --- RTS backward smoother ---
  const smMean = new Array<number>(nDays).fill(ZERO);
  const smVar = new Array<number>(nDays).fill(ZERO);
  if (nDays > ZERO) {
    smMean[nDays - ONE] = filtMean[nDays - ONE] ?? priorMean;
    smVar[nDays - ONE] = filtVar[nDays - ONE] ?? priorVar;
  }
  for (let t = nDays - ONE - ONE; t >= ZERO; t--) {
    const pPredNext = predVar[t + ONE] ?? priorVar;
    const c =
      pPredNext > ZERO && Number.isFinite(pPredNext) ? (filtVar[t] ?? priorVar) / pPredNext : ZERO;
    const mNext = smMean[t + ONE] ?? filtMean[t] ?? priorMean;
    const vNext = smVar[t + ONE] ?? filtVar[t] ?? priorVar;
    const mSm = (filtMean[t] ?? priorMean) + c * (mNext - (predMean[t + ONE] ?? priorMean));
    const vSm = (filtVar[t] ?? priorVar) + c * c * (vNext - pPredNext);
    smMean[t] = Number.isFinite(mSm) ? mSm : (filtMean[t] ?? priorMean);
    smVar[t] = Number.isFinite(vSm) && vSm >= ZERO ? vSm : (filtVar[t] ?? priorVar); // nunca negativa
  }

  return { mean: smMean, variance: smVar };
}

// --- Séries de branco/nulo e não-sabe (MODEL_VERSION 0.0.4, Q-10) -----------
//
// Branco/nulo e não-sabe deixam de ser descarte e viram ESTADOS de primeira
// classe (Q-10 condição 1). A matemática é EXATAMENTE a mesma dos candidatos —
// mesma variância amostral (§4.2), mesma ponderação por recência (§4.4), mesma
// banda de 90% (§2/§4): as duas séries passam pelo MESMO `smoothCandidate`.
//
// A diferença é a AUSÊNCIA de medida. `blankNullPct`/`undecidedPct` são
// anuláveis no contrato porque muitos institutos simplesmente não publicam a
// grandeza — e `null` NÃO é zero (R4). Uma observação com valor `null` não vira
// observação nenhuma; um nó do grid sem nenhuma medida na vizinhança sai
// `measured: false`, e o chamador publica `null`, nunca 0.

/**
 * Ids das séries de eleitorado. São os mesmos tokens de
 * `transitionStateKindSchema` (contracts/model-io) para que o estimador de
 * transferência e a série latente falem do mesmo estado sem tradução.
 */
export const ELECTORATE_SERIES = {
  blankNull: 'blank_null',
  undecided: 'undecided',
} as const;
export type ElectorateSeriesId = (typeof ELECTORATE_SERIES)[keyof typeof ELECTORATE_SERIES];

const ELECTORATE_SERIES_IDS: readonly ElectorateSeriesId[] = [
  ELECTORATE_SERIES.blankNull,
  ELECTORATE_SERIES.undecided,
];

export interface ElectorateSmoothedPoint {
  date: string;
  seriesId: ElectorateSeriesId;
  mean: number;
  lo90: number;
  hi90: number;
  variance: number;
  /**
   * `false` ⇒ nenhuma pesquisa mediu esta grandeza dentro de ACTIVE_WINDOW_DAYS
   * deste nó. O número existiria (o suavizador sempre devolve algo), mas seria
   * prior puro. Quem publica DEVE emitir `null` (R4), nunca o número nem 0.
   */
  measured: boolean;
}

export interface ElectorateKalmanResult {
  modelVersion: string;
  referenceDate: string;
  dates: string[];
  /** Ordenado por (date, seriesId) — determinismo de serialização (docs/01 §9). */
  points: ElectorateSmoothedPoint[];
}

export interface ElectorateKalmanOptions {
  referenceDate?: string;
  /**
   * Início do grid. Serve para alinhar a série de eleitorado ao grid da série de
   * candidatos: sem isso, as duas começariam em datas diferentes e a UI teria de
   * casar eixos na mão. Nunca ENCURTA o grid — o início efetivo é o menor entre
   * este e a primeira medida de eleitorado.
   */
  gridStartDate?: string;
}

/**
 * Suaviza as séries de branco/nulo e não-sabe com o MESMO filtro dos candidatos.
 * Determinística e sem I/O, como o resto do módulo.
 */
export function runElectorateKalman(
  observations: readonly ElectorateObservation[],
  options: ElectorateKalmanOptions = {},
): ElectorateKalmanResult {
  const sorted = [...observations].sort(compareElectorateObservations);

  const hasGridStart = options.gridStartDate !== undefined && options.gridStartDate !== '';
  const hasRef = options.referenceDate !== undefined && options.referenceDate !== '';

  if (sorted.length === ZERO || !hasRef) {
    return {
      modelVersion: MODEL_VERSION,
      referenceDate: hasRef ? dayNumberToIso(isoToDayNumber(options.referenceDate ?? '')) : '',
      dates: [],
      points: [],
    };
  }

  const refDay = isoToDayNumber(options.referenceDate ?? '');
  const obsDays = sorted.map((o) => isoToDayNumber(o.fieldMedianDate));
  let minDay = obsDays.reduce((a, b) => (b < a ? b : a), obsDays[ZERO] ?? refDay);
  if (hasGridStart) {
    const startDay = isoToDayNumber(options.gridStartDate ?? '');
    if (startDay < minDay) minDay = startDay;
  }
  const gridEnd = refDay >= minDay ? refDay : minDay;
  const nDays = gridEnd - minDay + ONE;

  const dates: string[] = [];
  for (let i = ZERO; i < nDays; i++) dates.push(dayNumberToIso(minDay + i));

  // Índice dia -> observações do dia, com a série no lugar do candidato. Um valor
  // `null` NÃO gera entrada: ausência de medida não é medida de zero (R4).
  const obsByDay: DayObs[][] = [];
  for (let i = ZERO; i < nDays; i++) obsByDay.push([]);
  // Dias (índice no grid) em que cada série foi efetivamente medida.
  const measuredDays = new Map<ElectorateSeriesId, number[]>();
  for (const id of ELECTORATE_SERIES_IDS) measuredDays.set(id, []);

  for (let k = ZERO; k < sorted.length; k++) {
    const o = sorted[k];
    if (!o) continue;
    const absDay = obsDays[k] ?? minDay;
    const day = absDay - minDay;
    if (day < ZERO || day >= nDays) continue;
    const deltaDays = gridEnd - absDay;
    if (deltaDays > ACTIVE_WINDOW_DAYS) continue; // mesma janela ativa dos candidatos (§4.4)
    const bucket = obsByDay[day];
    if (!bucket) continue;
    const pairs: readonly (readonly [ElectorateSeriesId, number | null])[] = [
      [ELECTORATE_SERIES.blankNull, o.blankNullPct],
      [ELECTORATE_SERIES.undecided, o.undecidedPct],
    ];
    for (const [seriesId, value] of pairs) {
      if (value === null) continue; // o instituto não publicou a grandeza
      bucket.push({
        candidateId: seriesId,
        instituteId: o.instituteId,
        valuePct: value,
        sampleSize: o.sampleSize,
        deltaDays,
      });
      measuredDays.get(seriesId)?.push(day);
    }
  }

  const points: ElectorateSmoothedPoint[] = [];
  for (const seriesId of ELECTORATE_SERIES_IDS) {
    const days = measuredDays.get(seriesId) ?? [];
    if (days.length === ZERO) continue; // série inexistente ⇒ nenhum ponto (nunca zeros)
    const series = smoothCandidate(seriesId, nDays, obsByDay);
    for (let i = ZERO; i < nDays; i++) {
      const mean = series.mean[i] ?? ZERO;
      const variance = series.variance[i] ?? ZERO;
      const sd = Math.sqrt(variance > ZERO ? variance : ZERO);
      const half = CI_Z_90 * sd;
      points.push({
        date: dates[i] ?? '',
        seriesId,
        mean: clamp(mean, PCT_MIN, PCT_MAX),
        lo90: clamp(mean - half, PCT_MIN, PCT_MAX),
        hi90: clamp(mean + half, PCT_MIN, PCT_MAX),
        variance,
        measured: hasMeasurementNear(days, i),
      });
    }
  }

  points.sort((a, b) =>
    a.date < b.date
      ? -ONE
      : a.date > b.date
        ? ONE
        : a.seriesId < b.seriesId
          ? -ONE
          : a.seriesId > b.seriesId
            ? ONE
            : ZERO,
  );

  return { modelVersion: MODEL_VERSION, referenceDate: dayNumberToIso(gridEnd), dates, points };
}

/** Existe medida a no máximo ACTIVE_WINDOW_DAYS deste nó (para trás ou para frente)? */
function hasMeasurementNear(measuredDayIndexes: readonly number[], dayIndex: number): boolean {
  for (const d of measuredDayIndexes) {
    if (Math.abs(d - dayIndex) <= ACTIVE_WINDOW_DAYS) return true;
  }
  return false;
}

function compareElectorateObservations(a: ElectorateObservation, b: ElectorateObservation): number {
  if (a.fieldMedianDate < b.fieldMedianDate) return -ONE;
  if (a.fieldMedianDate > b.fieldMedianDate) return ONE;
  if (a.instituteId < b.instituteId) return -ONE;
  if (a.instituteId > b.instituteId) return ONE;
  if (a.tseId < b.tseId) return -ONE;
  if (a.tseId > b.tseId) return ONE;
  if (a.scenarioKind < b.scenarioKind) return -ONE;
  if (a.scenarioKind > b.scenarioKind) return ONE;
  return ZERO;
}

function firstObservedValue(candidateId: string, obsByDay: DayObs[][]): number | undefined {
  for (const day of obsByDay) {
    for (const o of day) {
      if (o.candidateId === candidateId) return o.valuePct;
    }
  }
  return undefined;
}

// --- Ordenação / derivação --------------------------------------------------

/** Ordem canônica (date, instituteId, candidateId) — docs/01 §9, T-03 armadilhas. */
function compareObservations(a: Observation, b: Observation): number {
  if (a.fieldMedianDate < b.fieldMedianDate) return -ONE;
  if (a.fieldMedianDate > b.fieldMedianDate) return ONE;
  if (a.instituteId < b.instituteId) return -ONE;
  if (a.instituteId > b.instituteId) return ONE;
  if (a.candidateId < b.candidateId) return -ONE;
  if (a.candidateId > b.candidateId) return ONE;
  return ZERO;
}

function deriveCandidateIds(
  sorted: readonly Observation[],
  explicit?: readonly string[],
): string[] {
  if (explicit && explicit.length > ZERO) return [...explicit].sort();
  const set = new Set<string>();
  for (const o of sorted) set.add(o.candidateId);
  return [...set].sort();
}
