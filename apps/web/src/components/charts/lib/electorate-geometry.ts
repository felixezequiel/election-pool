/**
 * Geometria das séries do ELEITORADO — branco/nulo e não-sabe (MODEL_VERSION
 * 0.0.4, docs/OPEN-QUESTIONS Q-10). Puro, sem DOM, como `latent-geometry.ts`.
 *
 * D3 só para escalas (`scaleTime`/`scaleLinear`), formas (`area`/`line`) e ticks.
 * O `<svg>` é nosso (CLAUDE.md).
 *
 * ── A regra que dita o desenho deste módulo ────────────────────────────────
 * Um ponto `null` significa SEM MEDIDA, e sem medida não é zero. Interpolar por
 * cima do buraco afirmaria "medimos, e o valor caminhou daqui até ali"; desenhar
 * zero afirmaria "ninguém está indeciso". As duas são mentiras diferentes, e a
 * segunda é pior. Por isso a série é quebrada em SEGMENTOS contíguos de pontos
 * medidos: cada segmento tem seu próprio path, e o vão entre eles simplesmente
 * não tem traço — mais os `gapX`, que a UI marca explicitamente como "sem medida".
 *
 * Segmento de um ponto só não produz área nem linha (um path de largura zero é
 * invisível): ele sai em `single`, com as coordenadas para a UI desenhar a marca
 * de ponto isolado. Perder o último ponto medido porque ele ficou sozinho depois
 * de um buraco seria exatamente o silêncio que o R4 proíbe.
 */
import { scaleLinear, scaleTime, type ScaleLinear, type ScaleTime } from 'd3-scale';
import { area, line, curveMonotoneX } from 'd3-shape';
import { timeDay } from 'd3-time';
import type { AxisTick, Margins } from './latent-geometry.js';

/** Banda 90% de uma grandeza do eleitorado numa data. */
export interface ElectorateBand {
  mean: number;
  lo90: number;
  hi90: number;
}

/** Ponto datado; `band: null` = grandeza NÃO medida naquela data. */
export interface ElectoratePoint {
  /** Instante (ms desde a época). */
  t: number;
  band: ElectorateBand | null;
}

/** Uma grandeza do eleitorado ao longo do tempo (branco/nulo, não-sabe). */
export interface ElectorateSeriesInput {
  /** Chave estável da grandeza (namespace de padrões e classes CSS). */
  key: string;
  displayName: string;
  /** Pontos em ordem cronológica. */
  points: ElectoratePoint[];
}

/** Trecho contíguo de pontos MEDIDOS. */
export interface ElectorateSegment {
  /** Path da banda 90% (vazio quando o segmento tem um ponto só). */
  bandPath: string;
  /** Path da linha central (vazio quando o segmento tem um ponto só). */
  centerPath: string;
  /** Coordenadas do ponto isolado, quando o segmento tem tamanho 1. */
  single: { x: number; yMean: number; yLo: number; yHi: number } | null;
}

export interface ElectorateSeriesGeometry {
  key: string;
  displayName: string;
  segments: ElectorateSegment[];
  /** x (px) de cada data SEM medida — a UI marca o vão, não o preenche. */
  gapX: number[];
  /** Último ponto MEDIDO da série (readout e `<desc>`); null se nunca mediu. */
  latest: { t: number; band: ElectorateBand } | null;
  /** Quantas datas ficaram sem medida (usado na prosa acessível). */
  missingCount: number;
}

export interface ElectorateGeometry {
  width: number;
  height: number;
  margins: Margins;
  innerWidth: number;
  innerHeight: number;
  x: ScaleTime<number, number>;
  y: ScaleLinear<number, number>;
  series: ElectorateSeriesGeometry[];
  xTicks: AxisTick[];
  yTicks: AxisTick[];
  xDomain: [number, number];
  yDomain: [number, number];
  /** Datas (ms) presentes na série, em ordem — base do equivalente textual. */
  dates: number[];
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
const Y_TICK_STEP = 5;
/** Folga vertical (p.p.) acima/abaixo do extremo das bandas. */
const Y_PADDING_PP = 2;
const MS_PER_DAY = 86_400_000;
const PCT_FLOOR = 0;
const PCT_CEIL = 100;

/** Quebra a série em trechos contíguos de pontos medidos. */
function splitSegments(points: ElectoratePoint[]): { t: number; band: ElectorateBand }[][] {
  const out: { t: number; band: ElectorateBand }[][] = [];
  let current: { t: number; band: ElectorateBand }[] = [];
  for (const p of points) {
    if (p.band === null) {
      if (current.length > 0) out.push(current);
      current = [];
      continue;
    }
    current.push({ t: p.t, band: p.band });
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Constrói a geometria das grandezas do eleitorado. `xDomain` pode ser imposto
 * de fora para que este gráfico compartilhe o eixo do tempo com a série latente
 * de candidatos (as duas leituras precisam ser comparáveis coluna a coluna).
 */
export function buildElectorateGeometry(
  series: ElectorateSeriesInput[],
  width: number,
  height: number,
  margins: Margins,
  xDomain?: [number, number],
): ElectorateGeometry {
  const innerWidth = Math.max(0, width - margins.left - margins.right);
  const innerHeight = Math.max(0, height - margins.top - margins.bottom);

  const allT: number[] = [];
  const allV: number[] = [];
  for (const s of series) {
    for (const p of s.points) {
      allT.push(p.t);
      // Ponto sem medida NÃO entra no domínio de valor: ele não tem valor.
      if (p.band) allV.push(p.band.lo90, p.band.hi90, p.band.mean);
    }
  }
  if (allT.length === 0) allT.push(Date.now());
  if (allV.length === 0) allV.push(PCT_FLOOR, Y_TICK_STEP);

  const tMin = xDomain ? xDomain[0] : Math.min(...allT);
  const tMax = xDomain ? xDomain[1] : Math.max(...allT);
  const vMin = Math.max(
    PCT_FLOOR,
    Math.floor((Math.min(...allV) - Y_PADDING_PP) / Y_TICK_STEP) * Y_TICK_STEP,
  );
  const vMax = Math.min(
    PCT_CEIL,
    Math.ceil((Math.max(...allV) + Y_PADDING_PP) / Y_TICK_STEP) * Y_TICK_STEP,
  );

  const x = scaleTime()
    .domain([tMin, tMax])
    .range([margins.left, margins.left + innerWidth]);
  const y = scaleLinear()
    .domain([vMin, vMax])
    .range([margins.top + innerHeight, margins.top]);

  type Measured = { t: number; band: ElectorateBand };
  const bandArea = area<Measured>()
    .x((d) => x(d.t))
    .y0((d) => y(d.band.lo90))
    .y1((d) => y(d.band.hi90))
    .curve(curveMonotoneX);
  const centerLine = line<Measured>()
    .x((d) => x(d.t))
    .y((d) => y(d.band.mean))
    .curve(curveMonotoneX);

  const seriesGeom: ElectorateSeriesGeometry[] = series.map((s) => {
    const segments = splitSegments(s.points).map((seg): ElectorateSegment => {
      const only = seg.length === 1 ? seg[0] : undefined;
      if (only) {
        return {
          bandPath: '',
          centerPath: '',
          single: {
            x: x(only.t),
            yMean: y(only.band.mean),
            yLo: y(only.band.lo90),
            yHi: y(only.band.hi90),
          },
        };
      }
      return {
        bandPath: bandArea(seg) ?? '',
        centerPath: centerLine(seg) ?? '',
        single: null,
      };
    });

    const measured = s.points.filter(
      (p): p is { t: number; band: ElectorateBand } => p.band !== null,
    );
    const last = measured[measured.length - 1];
    return {
      key: s.key,
      displayName: s.displayName,
      segments,
      gapX: s.points.filter((p) => p.band === null).map((p) => x(p.t)),
      latest: last ? { t: last.t, band: last.band } : null,
      missingCount: s.points.length - measured.length,
    };
  });

  // Ticks de X: mesma lógica da série latente (dias inteiros, sem sobreposição).
  const spanDays = Math.max(1, Math.round((tMax - tMin) / MS_PER_DAY));
  const stepDays = Math.max(1, Math.ceil(spanDays / X_TICK_COUNT));
  const dayInterval = timeDay.every(stepDays);
  const rawTicks = dayInterval ? x.ticks(dayInterval) : x.ticks(X_TICK_COUNT);
  const tickCandidates = rawTicks.length > 0 ? rawTicks : x.ticks(X_TICK_COUNT);
  const minGapPx = innerWidth / (X_TICK_COUNT + 1);
  const xTicks: AxisTick[] = [];
  let lastPos = Number.NEGATIVE_INFINITY;
  for (const d of tickCandidates) {
    const pos = x(d);
    if (pos - lastPos < minGapPx) continue;
    xTicks.push({ pos, label: DAY_MONTH.format(d), raw: +d });
    lastPos = pos;
  }

  const yTicks: AxisTick[] = [];
  for (let v = vMin; v <= vMax; v += Y_TICK_STEP) {
    yTicks.push({ pos: y(v), label: PCT_TICK.format(v), raw: v });
  }

  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);

  return {
    width,
    height,
    margins,
    innerWidth,
    innerHeight,
    x,
    y,
    series: seriesGeom,
    xTicks,
    yTicks,
    xDomain: [tMin, tMax],
    yDomain: [vMin, vMax],
    dates,
  };
}
