/**
 * Classificação dos rótulos que o REAL TIME BIG DATA imprime nos gráficos.
 *
 * POR QUE NÃO USAMOS `base/scenario-lines.ts` DIRETO. O classificador comum
 * (`categorizeLine`) conhece `'branco/nulo'`, `'não sabe/não respondeu'` etc.,
 * mas **não** conhece as grafias que ESTA fonte usa — verificado nos 6
 * documentos reais:
 *
 *   - `Nulo/Branco` (ordem invertida em relação à lista comum) e `NULO/BRANCO`
 *   - `NS/NR` (espontânea) e `NS / NR` (estimulada) — abreviação que a lista
 *     comum não tem
 *   - `NÃO SABE / NÃO RESPONDEU` (2º turno)
 *
 * Com o classificador comum, `Nulo/Branco` e `NS / NR` cairiam no ramo
 * "candidato" e virariam alias desconhecido: o documento inteiro iria para
 * quarentena, em todas as rodadas. Como `packages/adapters/base/**` está fora do
 * escopo desta task, a tabela específica da fonte mora aqui — que é também o
 * lugar certo: grafia é característica da FONTE.
 *
 * A conversão numérica continua no helper ÚNICO do projeto
 * (`parsePtBrPercent`, docs/04 §4.1 "não replique a lógica").
 *
 * Regra dura: o que não está nas tabelas abaixo é tratado como CANDIDATO, com o
 * alias na grafia impressa. Se não estiver cadastrado, o `BaseAdapter` lança
 * `UnknownCandidateError` e a rodada vai para quarentena manual — nunca criamos
 * candidato nem inventamos categoria.
 */

import { parsePtBrPercent } from '../parse-ptbr-number.js';

/**
 * Normaliza para comparação: sem acento, minúsculo, sem espaço em volta de `/`,
 * espaços colapsados, `:` final removido (o 2º turno imprime
 * `"NULO/BRANCO: 6%"`, com dois-pontos).
 */
export const normalizeLabel = (label: string): string =>
  label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .replace(/:$/, '')
    .trim();

/** Grafias de branco/nulo observadas nesta fonte (+ a ordem inversa). */
const BLANK_NULL_LABELS: readonly string[] = [
  'nulo/branco',
  'branco/nulo',
  'nulos/brancos',
  'brancos/nulos',
  'nulo',
  'branco',
];

/** Grafias de não-sabe/não-respondeu observadas nesta fonte. */
const UNDECIDED_LABELS: readonly string[] = [
  'ns/nr',
  'nao sabe/nao respondeu',
  'nao sabe',
  'nao respondeu',
];

export type RealTimeLine =
  | { readonly kind: 'candidate'; readonly alias: string; readonly valuePct: number }
  | { readonly kind: 'blankNull'; readonly valuePct: number }
  | { readonly kind: 'undecided'; readonly valuePct: number };

/**
 * Classifica um par (rótulo impresso, valor cru). LANÇA se o valor não for um
 * percentual pt-BR válido (R4) — nunca devolve 0 nem ignora.
 *
 * O alias do candidato sai na grafia EXATA do documento (só `trim`): normalizar
 * nome de candidato é decisão MANUAL do seed (CLAUDE.md), não do parser. É por
 * isso que `Lula` (espontânea) e `Lula (PT)` (estimulada) são aliases distintos
 * — o documento os imprime distintos, e quem decide que são a mesma pessoa é o
 * cadastro revisado, não uma heurística aqui.
 */
export const classifyRealTimeLine = (label: string, rawValue: string): RealTimeLine => {
  const valuePct = parsePtBrPercent(rawValue);
  const normalized = normalizeLabel(label);
  if (BLANK_NULL_LABELS.includes(normalized)) return { kind: 'blankNull', valuePct };
  if (UNDECIDED_LABELS.includes(normalized)) return { kind: 'undecided', valuePct };
  return { kind: 'candidate', alias: label.trim(), valuePct };
};
