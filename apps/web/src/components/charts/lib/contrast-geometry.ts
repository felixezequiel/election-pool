/**
 * Geometria do CONTRASTE entre formas de pergunta — espontânea × estimulada
 * (docs/OPEN-QUESTIONS Q-14). Puro, sem DOM, como `latent-geometry.ts` e
 * `electorate-geometry.ts`.
 *
 * D3 só para a escala (`scaleLinear`). O `<svg>` é nosso (CLAUDE.md).
 *
 * ── O que este módulo desenha, e por que assim ─────────────────────────────
 * Cada FORMA DE PERGUNTA é uma barra do eleitorado inteiro (0 a 100 p.p.), com
 * os segmentos empilhados a partir de ZERO. A ordem dos segmentos é imposta por
 * quem chama, e o primeiro é o ANCORADO: as duas barras começam pela mesma
 * grandeza — "quem não tem candidato naquele cenário" — para que os dois
 * comprimentos saiam da mesma origem e sejam comparáveis a olho. Empilhar essa
 * grandeza no meio da barra destruiria a comparação, que é o objetivo inteiro.
 *
 * ── A banda só aparece no segmento ancorado, de propósito ──────────────────
 * A banda de 90% de um segmento empilhado teria a posição absoluta contaminada
 * pela incerteza dos segmentos anteriores: desenhá-la ali afirmaria uma precisão
 * que a soma não tem. Então a banda é desenhada onde ela é honesta — no segmento
 * que começa em zero — e as outras grandezas medidas levam a sua régua
 * (`<UncertaintyRule>`) no readout em HTML, na MESMA escala 0–100 da barra.
 *
 * ── Ausência não é zero (R4) ───────────────────────────────────────────────
 * Segmento com `band: null` não é desenhado nem vira zero: o que sobra da barra
 * sai em `unaccounted`, que a UI marca como "sem medida". Uma barra que fechasse
 * 100 preenchendo o vão com o segmento vizinho mentiria sobre o que foi medido.
 */
import { scaleLinear, type ScaleLinear } from 'd3-scale';
import { PCT_MAX, PCT_MIN } from '@election-pool/contracts/constants';

/** Banda 90% de uma grandeza, escala 0–100 (CLAUDE.md). */
export interface ContrastBand {
  mean: number;
  lo90: number;
  hi90: number;
}

/**
 * `measured` = grandeza que o instituto perguntou e publicou.
 * `derived`  = aritmética nossa (complemento para 100). Nunca tem a mesma
 * autoridade de uma ponta medida, e o desenho reflete isso (sem banda, sem
 * hachura, contorno tracejado).
 */
export type ContrastSegmentKind = 'measured' | 'derived';

export interface ContrastSegmentInput {
  /** Chave estável (namespace de padrões SVG e classes CSS). */
  key: string;
  label: string;
  kind: ContrastSegmentKind;
  /** `null` = grandeza NÃO medida/derivável naquele cenário. */
  band: ContrastBand | null;
}

export interface ContrastRowInput {
  key: string;
  /** Nome da forma da pergunta (ex.: 'Espontânea'). */
  scenarioLabel: string;
  /** Como a pergunta é feita, em uma linha (ex.: 'pergunta aberta, sem lista'). */
  questionLabel: string;
  /** Data ISO do snapshot; `null` quando a linha não tem medida nenhuma. */
  dateIso: string | null;
  /** Segmentos na ordem de empilhamento; o primeiro é o ancorado em zero. */
  segments: ContrastSegmentInput[];
}

export interface ContrastSegmentGeometry {
  key: string;
  label: string;
  kind: ContrastSegmentKind;
  band: ContrastBand;
  /** Retângulo do valor central, empilhado (px no viewBox). */
  x: number;
  width: number;
  /** Aresta da central — a "linha central" discreta (docs/05 §1.1). */
  centerX: number;
  /** Banda 90% em px; só o segmento ancorado a recebe (ver cabeçalho). */
  bandRect: { x: number; width: number } | null;
}

export interface ContrastRowGeometry {
  key: string;
  scenarioLabel: string;
  questionLabel: string;
  dateIso: string | null;
  segments: ContrastSegmentGeometry[];
  /** Soma das centrais desenhadas (p.p.) — o que a barra consegue explicar. */
  accountedPct: number;
  /** Trecho sem medida, em px, ou `null` quando a barra fecha 100. */
  unaccounted: { x: number; width: number; pct: number } | null;
}

export interface ContrastGeometry {
  width: number;
  height: number;
  x: ScaleLinear<number, number>;
  rows: ContrastRowGeometry[];
  /** Marcas do eixo: valor em p.p. e posição como FRAÇÃO da largura (0–1). */
  ticks: { pct: number; fraction: number }[];
}

/**
 * Largura do viewBox das barras. Alto o suficiente para arredondamento de px não
 * aparecer, e IGUAL em todas as linhas: é o que garante que as duas barras e o
 * eixo em HTML fiquem em registro (a mesma coluna é o mesmo p.p. nas duas).
 */
export const CONTRAST_VIEW_WIDTH = 1000;
/** Altura do viewBox de UMA barra. */
export const CONTRAST_VIEW_HEIGHT = 56;
/** Espessura da barra dentro do viewBox (sobra vira respiro acima/abaixo). */
export const CONTRAST_BAR_HEIGHT = 40;
/** Passo das marcas do eixo, em p.p. — 5 marcas de 20 cabem em 375px. */
const TICK_STEP_PCT = 20;

/** Um p.p. de tolerância: abaixo disso o vão é arredondamento, não ausência. */
const UNACCOUNTED_MIN_PP = 0.05;

export function buildContrastGeometry(
  rows: ContrastRowInput[],
  width: number = CONTRAST_VIEW_WIDTH,
): ContrastGeometry {
  const x = scaleLinear().domain([PCT_MIN, PCT_MAX]).range([0, width]);

  const rowsGeom: ContrastRowGeometry[] = rows.map((row) => {
    const segments: ContrastSegmentGeometry[] = [];
    let cursorPct = PCT_MIN;
    let anchored = true;

    /**
     * Sem a grandeza ancorada não há barra: os segmentos seguintes desenhados a
     * partir de zero fingiriam ser ela. A linha inteira vira "sem medida" — que
     * é a leitura verdadeira quando ninguém perguntou aquilo naquela data.
     */
    const anchorMissing = row.segments[0]?.band === null || row.segments.length === 0;

    for (const seg of anchorMissing ? [] : row.segments) {
      if (!seg.band) {
        // Sem medida: não desenha, não empilha, não vira zero (R4). O buraco
        // aparece em `unaccounted`, rotulado como ausência.
        anchored = false;
        continue;
      }
      const startPct = cursorPct;
      const endPct = cursorPct + seg.band.mean;
      segments.push({
        key: seg.key,
        label: seg.label,
        kind: seg.kind,
        band: seg.band,
        x: x(startPct),
        width: Math.max(0, x(endPct) - x(startPct)),
        centerX: x(endPct),
        // Banda só no segmento ancorado em zero E só se for medida.
        bandRect:
          anchored && seg.kind === 'measured'
            ? { x: x(seg.band.lo90), width: Math.max(0, x(seg.band.hi90) - x(seg.band.lo90)) }
            : null,
      });
      cursorPct = endPct;
      anchored = false;
    }

    const accountedPct = cursorPct;
    const restPct = PCT_MAX - accountedPct;
    return {
      key: row.key,
      scenarioLabel: row.scenarioLabel,
      questionLabel: row.questionLabel,
      dateIso: row.dateIso,
      segments,
      accountedPct,
      unaccounted:
        restPct > UNACCOUNTED_MIN_PP
          ? { x: x(accountedPct), width: Math.max(0, x(PCT_MAX) - x(accountedPct)), pct: restPct }
          : null,
    };
  });

  const ticks: { pct: number; fraction: number }[] = [];
  for (let pct = PCT_MIN; pct <= PCT_MAX; pct += TICK_STEP_PCT) {
    ticks.push({ pct, fraction: (pct - PCT_MIN) / (PCT_MAX - PCT_MIN) });
  }

  return { width, height: CONTRAST_VIEW_HEIGHT, x, rows: rowsGeom, ticks };
}
