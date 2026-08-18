/**
 * Dados da MATRIZ de transferência (MODEL_VERSION 0.0.4, Q-10). Puro, sem DOM.
 *
 * A matriz é um panorama de→para: origem nas linhas, destino nas colunas. Ela
 * substitui a lista vertical de faixas (ilegível com 10 estados: até 90 relações
 * por passo). O que a lista fazia bem — não sugerir trajetória medida, mostrar a
 * incerteza, marcar `notIdentifiable` — continua valendo célula a célula.
 *
 * Duas decisões que vêm direto da Q-10:
 *
 *  1. PERMANÊNCIA (diagonal, `from === to`) NÃO entra na escala de intensidade das
 *     células cruzadas. Permanência é dezenas de p.p.; fluxo cruzado é décimos. Um
 *     heatmap numa escala só apagaria todo o resto. A diagonal é tratada à parte,
 *     como o painel antigo já separava `stays` de `cross`.
 *  2. A intensidade da célula cruzada escala por `maxCrossAbsPp` (o maior |pp|
 *     entre os cruzados), para o pouco que se move ficar visível — mas o NÚMERO
 *     vai em toda célula, porque cor/intensidade sozinha não é leitura (docs/06 §5).
 */
import type { TransitionFlowInput, TransitionStateMeta } from './transition-geometry.js';

export interface MatrixCell {
  from: string;
  to: string;
  pp: number;
  lo90: number;
  hi90: number;
  notIdentifiable: boolean;
  /** `false` = par sem fluxo estimado neste passo — vira "—", nunca zero (R4). */
  present: boolean;
  /** `from === to`: permanência, tratada fora da escala das cruzadas. */
  isDiagonal: boolean;
}

export interface MatrixRow {
  state: TransitionStateMeta;
  /** Uma célula por estado (mesma ordem de `states`), para a grade alinhar. */
  cells: MatrixCell[];
}

export interface TransitionMatrixData {
  /** Estados na ordem dos DOIS eixos: candidaturas primeiro, depois neutros. */
  states: TransitionStateMeta[];
  rows: MatrixRow[];
  /** Maior |pp| entre as células CRUZADAS (base da intensidade); 0 se não há. */
  maxCrossAbsPp: number;
}

/**
 * Ordena os estados para os eixos: candidaturas primeiro (na ordem recebida, que
 * já é a de exibição), depois branco/nulo e não-sabe. Neutros no fim porque a
 * leitura natural é "de um candidato, para onde foi" — inclusive para os neutros.
 */
function orderStates(states: TransitionStateMeta[]): TransitionStateMeta[] {
  const rank = (s: TransitionStateMeta): number => (s.kind === 'candidate' ? 0 : 1);
  return [...states].sort((a, b) => rank(a) - rank(b));
}

export function buildTransitionMatrix(
  states: TransitionStateMeta[],
  flows: TransitionFlowInput[],
): TransitionMatrixData {
  const ordered = orderStates(states);
  const known = new Set(ordered.map((s) => s.id));
  const byPair = new Map<string, TransitionFlowInput>();
  for (const f of flows) {
    if (known.has(f.from) && known.has(f.to)) byPair.set(`${f.from}__${f.to}`, f);
  }

  let maxCrossAbsPp = 0;
  const rows: MatrixRow[] = ordered.map((from) => ({
    state: from,
    cells: ordered.map((to): MatrixCell => {
      const f = byPair.get(`${from.id}__${to.id}`);
      const isDiagonal = from.id === to.id;
      if (!f) {
        return {
          from: from.id,
          to: to.id,
          pp: 0,
          lo90: 0,
          hi90: 0,
          notIdentifiable: false,
          present: false,
          isDiagonal,
        };
      }
      if (!isDiagonal) maxCrossAbsPp = Math.max(maxCrossAbsPp, Math.abs(f.pp));
      return {
        from: from.id,
        to: to.id,
        pp: f.pp,
        lo90: f.lo90,
        hi90: f.hi90,
        notIdentifiable: f.notIdentifiable,
        present: true,
        isDiagonal,
      };
    }),
  }));

  return { states: ordered, rows, maxCrossAbsPp };
}
