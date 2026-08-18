/**
 * Geometria do painel de TRANSFERÊNCIA de votos (MODEL_VERSION 0.0.4,
 * docs/OPEN-QUESTIONS Q-10). Puro, sem DOM. D3 só para escala; o SVG é nosso
 * (CLAUDE.md — nenhuma biblioteca de gráfico, `d3-sankey` inclusive).
 *
 * ── Por que ISTO e não um diagrama de fitas ────────────────────────────────
 * A primeira versão deste arquivo desenhava um Sankey: nós à esquerda, nós à
 * direita, fitas curvas entre eles. Foi jogada fora depois da medição do run de
 * 2022: o ajuste ao dado desloca ~7 p.p. de ~91 p.p. de massa por passo, ou seja,
 * a MAIOR PARTE do número publicado vem do prior de permanência, não do dado.
 * Uma seta grossa e limpa entre dois nós comunica trajetória medida. Não é o que
 * temos, e desenhar assim seria propaganda com aparência de instrumento.
 *
 * O que sobrou é a linguagem que o resto do site já usa para estimativa incerta
 * (o dot plot de house effect, docs/05 §5): uma FAIXA por relação, na escala
 * real, com o ZERO marcado. Assim:
 *   - a incerteza é o elemento dominante — a faixa é o desenho inteiro;
 *   - "cruza zero" vira uma propriedade VISÍVEL, não um selo que o leitor precisa
 *     acreditar;
 *   - nenhuma seta sugere que sabemos o caminho de alguém.
 *
 * E uma advertência que a UI precisa repetir: `notIdentifiable` NÃO é medida de
 * confiabilidade. Ele diz só que o RUÍDO AMOSTRAL não distingue aquilo de zero
 * (faixa cruzando zero, ou ponto abaixo do piso de visibilidade — T-18). Um fluxo
 * sem o selo pode ser tão priorístico quanto um com — no run de 2022 apenas
 * 34 de 272 fluxos ficaram marcados, e isso não torna os outros 238 medidos. Por
 * isso a geometria trata os dois grupos com o MESMO peso visual, e o marcado só
 * ganha um sinal a mais, nunca o outro grupo ganha ar de sólido.
 */
import { scaleLinear } from 'd3-scale';

export type TransitionStateKind = 'candidate' | 'blank_null' | 'undecided';

export interface TransitionStateMeta {
  id: string;
  kind: TransitionStateKind;
  displayName: string;
  /** Slot de cor da entidade quando é candidatura; null para branco/nulo e não-sabe. */
  colorSlot: number | null;
  /** Foto oficial (só candidatura), para o cabeçalho da matriz; null ⇒ monograma. */
  photoPath?: string | null;
}

export interface TransitionFlowInput {
  from: string;
  to: string;
  /** Ponto percentual DO ELEITORADO (não da origem). Escala 0–100. */
  pp: number;
  lo90: number;
  hi90: number;
  notIdentifiable: boolean;
}

/** Uma relação origem→destino desenhada como faixa. */
export interface FlowRowGeom {
  key: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  pp: number;
  lo90: number;
  hi90: number;
  notIdentifiable: boolean;
  /** Slot de cor da ORIGEM (a entidade de quem o voto sairia); null se neutro. */
  colorSlot: number | null;
  /** Slot usado só para escolher a hachura (neutro cai no grafite). */
  hachuraSlot: number;
  y: number;
  xLo: number;
  xHi: number;
  xMean: number;
}

export interface AxisTickPx {
  pos: number;
  label: string;
  raw: number;
}

export interface TransitionPlotGeometry {
  width: number;
  height: number;
  /** Coluna de rótulo (origem → destino) à esquerda do eixo. */
  labelWidth: number;
  plotLeft: number;
  plotRight: number;
  rowHeight: number;
  rows: FlowRowGeom[];
  /** Posição do zero em px — a referência do painel inteiro. */
  xZero: number;
  xTicks: AxisTickPx[];
  xDomain: [number, number];
  /** Fluxos de permanência (from === to), fora do plot por escala. */
  stays: {
    id: string;
    displayName: string;
    colorSlot: number | null;
    pp: number;
    lo90: number;
    hi90: number;
  }[];
}

const ROW_HEIGHT = 34;
const PADDING_TOP = 26;
const PADDING_BOTTOM = 34;
/** Folga horizontal (p.p.) além dos extremos das faixas. */
const X_PADDING_PP = 0.08;
const X_TICK_COUNT = 5;
/** Slot de hachura para estado sem cor de candidatura (grafite, docs/05 §2.1). */
const NEUTRAL_HACHURA_SLOT = 8;

const PP_TICK = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Constrói o painel de um passo. Nenhum fluxo é filtrado: os cruzados viram
 * linhas do plot (todos, inclusive os que cruzam zero — Q-10 condição 3) e os de
 * permanência saem à parte, porque em escala comum (dezenas de p.p. contra
 * décimos) eles achatariam tudo o que o painel existe para mostrar.
 */
export function buildTransitionPlot(
  states: TransitionStateMeta[],
  flows: TransitionFlowInput[],
  width = 900,
  labelWidth = 260,
): TransitionPlotGeometry {
  const meta = new Map(states.map((s) => [s.id, s]));
  const known = flows.filter((f) => meta.has(f.from) && meta.has(f.to));

  const cross = known
    .filter((f) => f.from !== f.to)
    // Maior movimento primeiro. Ordenar é apresentação; a cor continua vindo da
    // entidade de origem, então reordenar não repinta nada (docs/05 §2.1 regra 2).
    .sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));

  const stays = known
    .filter((f) => f.from === f.to)
    .map((f) => {
      const m = meta.get(f.from);
      return {
        id: f.from,
        displayName: m?.displayName ?? f.from,
        colorSlot: m?.colorSlot ?? null,
        pp: f.pp,
        lo90: f.lo90,
        hi90: f.hi90,
      };
    });

  const plotLeft = labelWidth;
  const plotRight = width - 16;

  const values = cross.flatMap((f) => [f.lo90, f.hi90, f.pp]);
  // O ZERO entra sempre no domínio: sem ele, "a faixa cruza zero" deixaria de ser
  // uma coisa que se vê e viraria uma coisa que se acredita.
  const min = Math.min(0, ...(values.length > 0 ? values : [0]));
  const max = Math.max(0, ...(values.length > 0 ? values : [0]));
  const xDomain: [number, number] = [min - X_PADDING_PP, max + X_PADDING_PP];

  const x = scaleLinear().domain(xDomain).range([plotLeft, plotRight]);

  const rows: FlowRowGeom[] = cross.map((f, i) => {
    const fromMeta = meta.get(f.from);
    const colorSlot = fromMeta?.colorSlot ?? null;
    return {
      key: `${f.from}__${f.to}`,
      from: f.from,
      to: f.to,
      fromName: fromMeta?.displayName ?? f.from,
      toName: meta.get(f.to)?.displayName ?? f.to,
      pp: f.pp,
      lo90: f.lo90,
      hi90: f.hi90,
      notIdentifiable: f.notIdentifiable,
      colorSlot,
      hachuraSlot: colorSlot ?? NEUTRAL_HACHURA_SLOT,
      y: PADDING_TOP + i * ROW_HEIGHT + ROW_HEIGHT / 2,
      xLo: x(f.lo90),
      xHi: x(f.hi90),
      xMean: x(f.pp),
    };
  });

  const height = PADDING_TOP + rows.length * ROW_HEIGHT + PADDING_BOTTOM;

  const xTicks: AxisTickPx[] = x
    .ticks(X_TICK_COUNT)
    .map((v) => ({ pos: x(v), label: PP_TICK.format(v), raw: v }));

  return {
    width,
    height,
    labelWidth,
    plotLeft,
    plotRight,
    rowHeight: ROW_HEIGHT,
    rows,
    xZero: x(0),
    xTicks,
    xDomain,
    stays,
  };
}
