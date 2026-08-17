/**
 * Extração de cenários a partir de LINHAS de texto (`Alias  38,8`). Usado pelo
 * adapter de PDF (cnt-mda), onde a extração de texto do PDF devolve uma linha por
 * item. O nexus, que tem HTML estruturado, usa seu próprio caminho — mas a
 * classificação de "brancos/nulos" e "indecisos" é comum e mora aqui.
 *
 * Regras (R4, docs/04 §4.1):
 * - Número em pt-BR converte pelo helper único (`parsePtBrPercent`). Lixo ⇒ lança.
 * - "Branco/Nulo", "Nulo", "Nenhum" viram `blankNullPct`. "Não sabe/Não respondeu",
 *   "Indeciso" viram `undecidedPct`. Tudo mais é candidato (alias cru).
 * - Candidato ausente do cenário simplesmente não entra — jamais vira 0.
 * - Uma linha "rótulo + número" que não casa o formato numérico NÃO é engolida em
 *   silêncio quando parece um item de resultado: ou é claramente não-dado (sem
 *   número) e é ignorada, ou tem número mal-formado e o helper lança.
 */

import { parsePtBrPercent } from '../parse-ptbr-number.js';
import type { RawScenarioValue } from './base-adapter.js';

/** Rótulos que representam brancos/nulos (não são candidato). */
const BLANK_NULL_LABELS = [
  'branco/nulo',
  'brancos/nulos',
  'branco e nulo',
  'brancos e nulos',
  'nulo',
  'nulos',
  'branco',
  'brancos',
  'nenhum',
  'nenhum deles',
  'nenhum/nao sabe', // só quando a fonte funde os dois num rótulo explícito
  // Grafias COLHIDAS de release real, uma a uma (não especulação):
  'nulo/branco', // Real Time Big Data — ordem invertida
  'branco ou nulo', // Ipec
  'brancos ou nulos',
  'nenhum/branco/nulo', // Paraná Pesquisas
  'nenhum/branco',
  'branco/nulo/nenhum',
  'voto em branco ou nulo',
];

/** Rótulos que representam indecisos / não-resposta. */
const UNDECIDED_LABELS = [
  'nao sabe',
  'nao sabe/nao respondeu',
  'nao sabe / nao respondeu',
  'nao respondeu',
  'nao responderam',
  'indeciso',
  'indecisos',
  'nao opinaram',
  'nao opinou',
  // Grafias COLHIDAS de release real, uma a uma (não especulação):
  'ns/nr', // Real Time Big Data — abreviação do deck
  'nao sabem ou preferem nao opinar', // Ipec
  'nao sabe/nao opinou', // Paraná Pesquisas
  'nao sabe/nao opina',
  'nao sabe ou nao opinou',
  'nao sabe/prefere nao responder',
  'nao sabe/nao quis responder',
  'nao declarado',
];

/**
 * Normaliza o rótulo para comparação: sem acento, minúsculo, espaço colapsado —
 * e SEM espaço em volta de `/`. Essa última regra não é cosmética: institutos
 * grafam `Nenhum/ Branco/ Nulo` e `NS / NR` com espaço depois da barra, e sem
 * colapsar isso o rótulo não casa a lista e o item vira CANDIDATO. O sintoma é um
 * candidato fantasma chamado "Nenhum/ Branco/ Nulo" carregando os votos brancos —
 * ou, se o alias não resolver, a pesquisa inteira em quarentena. Três institutos
 * (Ipec, Paraná Pesquisas, Real Time) esbarraram nisto em capturas reais.
 */
const normalizeLabel = (label: string): string =>
  label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

export type LineCategory =
  | { kind: 'candidate'; alias: string; valuePct: number }
  | { kind: 'blankNull'; valuePct: number }
  | { kind: 'undecided'; valuePct: number };

/**
 * Interpreta um par (rótulo, valor bruto) já separado pela fonte. O `label` é a
 * grafia crua (alias de candidato preservado como veio); `rawValue` é o número em
 * pt-BR. Classifica em candidato/brancos-nulos/indecisos. LANÇA se `rawValue` não
 * for número pt-BR válido (R4).
 */
export const categorizeLine = (label: string, rawValue: string): LineCategory => {
  const valuePct = parsePtBrPercent(rawValue);
  const normalized = normalizeLabel(label);
  if (BLANK_NULL_LABELS.includes(normalized)) {
    return { kind: 'blankNull', valuePct };
  }
  if (UNDECIDED_LABELS.includes(normalized)) {
    return { kind: 'undecided', valuePct };
  }
  return { kind: 'candidate', alias: label.trim(), valuePct };
};

/** Acumulador de um cenário sendo montado a partir de linhas categorizadas. */
export interface ScenarioAccumulator {
  values: RawScenarioValue[];
  blankNullPct?: number;
  undecidedPct?: number;
}

/** Aplica uma linha categorizada ao acumulador do cenário corrente. */
export const applyLine = (acc: ScenarioAccumulator, line: LineCategory): void => {
  switch (line.kind) {
    case 'candidate':
      acc.values.push({ candidateAlias: line.alias, valuePct: line.valuePct });
      break;
    case 'blankNull':
      acc.blankNullPct = line.valuePct;
      break;
    case 'undecided':
      acc.undecidedPct = line.valuePct;
      break;
  }
};
