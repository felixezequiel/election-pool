/**
 * Geometria da série latente (LatentBandChart) — puro, sem DOM.
 *
 * D3 SÓ para escalas (`scaleTime`/`scaleLinear`), formas (`area`/`line`) e ticks
 * de eixo (`scale.ticks`, que é a lógica de `axis*`). O `<svg>` é renderizado por
 * nós, no template Astro; este módulo devolve strings de path e coordenadas que
 * SSR e cliente compartilham byte a byte (o scrub reusa a mesma escala ⇒ sem
 * "pulo" ao hidratar).
 *
 * A BANDA é o dado principal (docs/05 §1.1): a área 90% é dominante, a linha
 * central é secundária. Este módulo trata as duas como cidadãos separados para
 * que a orquestração de load faça a banda crescer ANTES da linha (docs/05 §6).
 */
import { scaleLinear, scaleTime, type ScaleLinear, type ScaleTime } from 'd3-scale';
import { area, line, curveMonotoneX } from 'd3-shape';
import { timeDay } from 'd3-time';

/** Um ponto datado da série de um candidato. */
export interface LatentSample {
  /** Instante (ms desde a época). */
  t: number;
  mean: number;
  lo90: number;
  hi90: number;
}

/** Série completa de um candidato, já com cor/slot da entidade. */
export interface LatentSeries {
  candidateId: string;
  displayName: string;
  colorSlot: number;
  /**
   * Foto oficial do candidato servida por nós (MODEL_VERSION 0.0.4), ou null
   * quando não há registro casado — nesse caso a UI usa monograma. Fica junto de
   * `displayName` e `colorSlot` porque é a mesma coisa que eles: identidade da
   * entidade, não geometria. Nada aqui usa o campo para desenhar.
   */
  photoPath?: string | null;
  samples: LatentSample[];
}

/** Ponto de pesquisa individual plotado (docs/05 §5: opacidade baixa, r3px). */
export interface PollPoint {
  tseId: string;
  candidateId: string;
  colorSlot: number;
  /** Instante do ponto (mediana do campo). */
  t: number;
  value: number;
  x: number;
  y: number;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface AxisTick {
  /** Coordenada no eixo (px). */
  pos: number;
  /** Rótulo já formatado. */
  label: string;
  /** Valor bruto (ms para tempo, número para valor) — usado no cliente. */
  raw: number;
}

export interface LatentGeometry {
  width: number;
  height: number;
  margins: Margins;
  innerWidth: number;
  innerHeight: number;
  x: ScaleTime<number, number>;
  y: ScaleLinear<number, number>;
  /** Um path de área (banda 90%) por série, na ordem de entrada. */
  bands: { candidateId: string; colorSlot: number; path: string }[];
  /** Um path de linha central por série. */
  centers: { candidateId: string; colorSlot: number; path: string }[];
  points: PollPoint[];
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  /** Domínio de datas usado (ms) — o cliente reconstrói a escala idêntica. */
  xDomain: [number, number];
  yDomain: [number, number];
}

/** Mini-trajetória (sparkline) de um candidato: banda + linha num quadro pequeno. */
export interface Sparkline {
  candidateId: string;
  colorSlot: number;
  bandPath: string;
  linePath: string;
}

/**
 * Mini-trajetórias por candidato, TODAS na MESMA escala (`yDomain`/`xDomain` do
 * gráfico principal), para que "quem oscila e quem não oscila" se compare batendo o
 * olho. Puro, sem DOM. O quadro é pequeno (uns 160×40) — a banda continua sendo o
 * dado; a linha central é secundária, como no gráfico grande.
 */
export function buildSparklines(
  series: LatentSeries[],
  width: number,
  height: number,
  xDomain: [number, number],
  yDomain: [number, number],
  pad = 3,
): Sparkline[] {
  const x = scaleTime()
    .domain(xDomain)
    .range([pad, Math.max(pad, width - pad)]);
  const y = scaleLinear()
    .domain(yDomain)
    .range([height - pad, pad]);
  const bandArea = area<LatentSample>()
    .x((d) => x(d.t))
    .y0((d) => y(d.lo90))
    .y1((d) => y(d.hi90))
    .curve(curveMonotoneX);
  const centerLine = line<LatentSample>()
    .x((d) => x(d.t))
    .y((d) => y(d.mean))
    .curve(curveMonotoneX);
  return series.map((s) => ({
    candidateId: s.candidateId,
    colorSlot: s.colorSlot,
    bandPath: bandArea(s.samples) ?? '',
    linePath: centerLine(s.samples) ?? '',
  }));
}

/** Datas médias de campo de cada pesquisa, em ms. */
export function fieldMidpointMs(fieldStart: string, fieldEnd: string): number {
  const a = Date.parse(`${fieldStart.slice(0, 10)}T00:00:00-03:00`);
  const b = Date.parse(`${fieldEnd.slice(0, 10)}T00:00:00-03:00`);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new Error(`fieldMidpointMs: datas inválidas ${fieldStart}..${fieldEnd}`);
  }
  return a + (b - a) / 2;
}

/** ms de uma data ISO (parte de data), ancorada em -03:00 (America/Sao_Paulo). */
export function isoDayMs(iso: string): number {
  const ms = Date.parse(`${iso.slice(0, 10)}T00:00:00-03:00`);
  if (Number.isNaN(ms)) throw new Error(`isoDayMs: data inválida "${iso}"`);
  return ms;
}

const DAY_MONTH = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

const PCT_TICK = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const X_TICK_COUNT = 6;
const Y_TICK_STEP = 10;
/** Folga vertical (p.p.) acima/abaixo do extremo das bandas. */
const Y_PADDING_PP = 4;

/**
 * Constrói toda a geometria a partir das séries e dos pontos de pesquisa.
 * `nowMs`/domínio são derivados dos dados; nada é aleatório ⇒ SSR = cliente.
 */
export function buildLatentGeometry(
  series: LatentSeries[],
  polls: Omit<PollPoint, 'x' | 'y'>[],
  width: number,
  height: number,
  margins: Margins,
): LatentGeometry {
  const innerWidth = Math.max(0, width - margins.left - margins.right);
  const innerHeight = Math.max(0, height - margins.top - margins.bottom);

  const allT: number[] = [];
  const allV: number[] = [];
  for (const s of series) {
    for (const p of s.samples) {
      allT.push(p.t);
      allV.push(p.lo90, p.hi90, p.mean);
    }
  }
  for (const p of polls) {
    allT.push(p.t);
    allV.push(p.value);
  }
  if (allT.length === 0) {
    allT.push(Date.now());
  }
  if (allV.length === 0) {
    allV.push(0, 100);
  }

  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const vMin = Math.max(
    0,
    Math.floor((Math.min(...allV) - Y_PADDING_PP) / Y_TICK_STEP) * Y_TICK_STEP,
  );
  const vMax = Math.min(
    100,
    Math.ceil((Math.max(...allV) + Y_PADDING_PP) / Y_TICK_STEP) * Y_TICK_STEP,
  );

  const x = scaleTime()
    .domain([tMin, tMax])
    .range([margins.left, margins.left + innerWidth]);
  const y = scaleLinear()
    .domain([vMin, vMax])
    .range([margins.top + innerHeight, margins.top]);

  const bandArea = area<LatentSample>()
    .x((d) => x(d.t))
    .y0((d) => y(d.lo90))
    .y1((d) => y(d.hi90))
    .curve(curveMonotoneX);

  const centerLine = line<LatentSample>()
    .x((d) => x(d.t))
    .y((d) => y(d.mean))
    .curve(curveMonotoneX);

  const bands = series.map((s) => ({
    candidateId: s.candidateId,
    colorSlot: s.colorSlot,
    path: bandArea(s.samples) ?? '',
  }));
  const centers = series.map((s) => ({
    candidateId: s.candidateId,
    colorSlot: s.colorSlot,
    path: centerLine(s.samples) ?? '',
  }));

  const points: PollPoint[] = polls.map((p) => ({
    ...p,
    x: x(p.t),
    y: y(p.value),
  }));

  // Ticks de X: candidatos vêm de `scale.ticks` do d3 (a lógica de eixo), mas
  // filtramos para não sobrepor rótulos — mantemos um passo mínimo em px entre
  // marcas. `timeDay` garante que cada candidato caia num dia inteiro (limpo).
  const spanDays = Math.max(1, Math.round((tMax - tMin) / 86_400_000));
  const stepDays = Math.max(1, Math.ceil(spanDays / X_TICK_COUNT));
  const dayInterval = timeDay.every(stepDays);
  const rawTicks = dayInterval ? x.ticks(dayInterval) : x.ticks(X_TICK_COUNT);
  const candidates = rawTicks.length > 0 ? rawTicks : x.ticks(X_TICK_COUNT);
  const minGapPx = innerWidth / (X_TICK_COUNT + 1);
  const xTicks: AxisTick[] = [];
  let lastPos = Number.NEGATIVE_INFINITY;
  for (const d of candidates) {
    const pos = x(d);
    if (pos - lastPos < minGapPx) continue;
    xTicks.push({ pos, label: DAY_MONTH.format(d), raw: +d });
    lastPos = pos;
  }

  const yTicks: AxisTick[] = [];
  for (let v = vMin; v <= vMax; v += Y_TICK_STEP) {
    yTicks.push({ pos: y(v), label: PCT_TICK.format(v), raw: v });
  }

  return {
    width,
    height,
    margins,
    innerWidth,
    innerHeight,
    x,
    y,
    bands,
    centers,
    points,
    xTicks,
    yTicks,
    xDomain: [tMin, tMax],
    yDomain: [vMin, vMax],
  };
}
