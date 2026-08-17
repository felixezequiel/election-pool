/**
 * Parser da publicação própria do Datafolha (`datafolha.folha.uol.com.br/eleicoes`,
 * nível 2 de docs/04 §1). Escrito DEPOIS de capturar 6 páginas reais da fonte —
 * a ordem que Q-09 ensinou a inverter.
 *
 * O que a fonte realmente publica (ver `__fixtures__/README.md`):
 * - Nenhuma tabela, nenhum `data-*`, nenhum JSON-LD: os percentuais vivem em
 *   PROSA editorial dentro de `[itemprop="articleBody"]`.
 * - O relatório com tabelas é um PDF em host cujo `robots.txt` proíbe todo agente
 *   (docs/04 §6) — fora de alcance.
 * - A mesma forma de superfície (`Nome (48%)`) é usada para intenção de voto, para
 *   REJEIÇÃO, para valor da rodada ANTERIOR (`(tinha 2%)`) e para cruzamento por
 *   segmento (`52% a 37%`). Nada na marcação distingue os quatro.
 *
 * Daí as duas invariantes que governam este arquivo:
 *
 * 1. **Parágrafo sem âncora de cenário é ignorado; parágrafo excluído idem.** Se a
 *    redação mudar e nenhuma âncora casar, o `BaseAdapter` lança "nenhum cenário
 *    extraído" — falha alta, não silêncio.
 * 2. **Todo percentual de um parágrafo ancorado tem de ser ATRIBUÍVEL** a um
 *    candidato nomeado, a brancos/nulos, a indecisos, ou a um parêntese de
 *    comparação. Sobrou um número sem dono ⇒ LANÇA (R4).
 *
 * A invariante 2 é o coração da task. Nas rodadas presidenciais o Datafolha
 * escreve o valor dos dois primeiros colocados atrelado a uma DESCRIÇÃO, não a um
 * nome ("o atual presidente tem 40% …, contra 32% do presidenciável do PL").
 * Resolver essa anáfora exigiria assumir quem é "o atual presidente" ou quem o
 * partido X lança — chute proibido (docs/04 §4.1) e, pior, chute que o V6 não pega,
 * porque o `tse_id` está certo. Então o parser RECUSA o documento inteiro e o
 * registro vai para quarentena, em vez de publicar um cenário sem os dois líderes
 * (ou, muito pior, com o número deles no candidato errado).
 *
 * R3: extraímos NÚMEROS. Nenhum trecho da publicação é guardado — nem como rótulo:
 * o `label` de cada cenário é texto NOSSO, gerado a partir do `kind`.
 */

import { parse as parseHtml } from 'node-html-parser';
import { scenarioKindSchema } from '@election-pool/contracts/enums';
import type { ScenarioKind } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { parsePtBrPercent } from '../parse-ptbr-number.js';
import type { RawScenario, RawScenarioValue } from '../base/base-adapter.js';
import {
  ARTICLE_BODY_SELECTOR,
  BELOW_THRESHOLD_VERBS,
  COMPARISON_LOOKBEHIND_CHARS,
  COMPARISON_MARKERS,
  CUE_WINDOW_CHARS,
  EXCLUDED_PARAGRAPH_MARKERS,
  ILLEGIBLE_VALUE_TOKENS,
  SCENARIO_ANCHORS,
  VALUE_CONNECTORS,
} from './constants.js';

// ─── Texto ───────────────────────────────────────────────────────────────────

/**
 * Versão "achatada" do texto: minúscula e sem diacrítico, para casar marcadores
 * sem depender de acentuação. Preserva o COMPRIMENTO (cada caractere acentuado
 * pré-composto vira um caractere), o que permite usar os offsets do `flat` para
 * fatiar o texto original. A igualdade de tamanho é verificada, nunca suposta.
 */
const flatten = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // Indicadores ordinais viram letra: "2º turno" tem de casar o marcador ASCII.
    // (NFD não decompõe `º`/`ª`, e NFKD mudaria o comprimento — que aqui é sagrado.)
    .replace(/[º]/g, 'o')
    .replace(/[ª]/g, 'a')
    .toLowerCase();

interface Paragraph {
  /** Texto como publicado (espaços colapsados), usado para ler a grafia do nome. */
  original: string;
  /** Mesmo texto sem acento e em minúscula, MESMO comprimento. */
  flat: string;
}

const makeParagraph = (raw: string): Paragraph => {
  const original = raw.replace(/\s+/g, ' ').trim();
  const flat = flatten(original);
  if (flat.length !== original.length) {
    // Defensivo: se alguma normalização mudar o tamanho, os offsets deixam de
    // valer e qualquer extração seria pela metade. Melhor lançar (R4).
    throw new ParseError(
      'Normalização alterou o comprimento do parágrafo; offsets inválidos (Datafolha)',
    );
  }
  return { original, flat };
};

/**
 * Corpo da publicação, parágrafo a parágrafo. Restringir ao `articleBody` também
 * é o que dá dente ao V6: o registro TSE precisa estar na publicação, não num
 * teaser de outra rodada no rodapé da página.
 */
export const datafolhaArticleParagraphs = (html: string): string[] => {
  const root = parseHtml(html);
  const body = root.querySelector(ARTICLE_BODY_SELECTOR);
  if (body === null) {
    throw new ParseError(`Publicação do Datafolha sem ${ARTICLE_BODY_SELECTOR} (estrutura mudou?)`);
  }
  const paragraphs = body
    .querySelectorAll('p')
    .map((p) => p.textContent.replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 0);
  if (paragraphs.length === 0) {
    throw new ParseError('Corpo da publicação do Datafolha sem nenhum parágrafo');
  }
  return paragraphs;
};

// ─── Gramática ───────────────────────────────────────────────────────────────

/** Número em pt-BR (só a forma de superfície; a conversão é do helper único). */
const NUM = '\\d{1,3}(?:,\\d+)?';
/** Lacuna dentro da MESMA oração: sem ponto e SEM outro `%` (garante 1 número). */
const GAP = `[^.%]{0,${String(CUE_WINDOW_CHARS)}}?`;
/**
 * Nome próprio no texto achatado; a exigência de maiúscula é feita no original
 * (`extractAlias`). O quantificador é PREGUIÇOSO de propósito: assim "Lula lidera
 * com 40%" casa o conector `lidera com` em vez de engolir "lidera" dentro do nome.
 */
const NAME = "[a-z][a-z'.-]*(?:\\s+(?:d[aeo]s?\\s+)?[a-z][a-z'.-]*){0,3}?";
/** Parêntese de partido: `(PSD)`, `(Republicanos)`. Nunca contém `%`. */
const PARTY = '(?:\\s*\\([^)%]{1,25}\\))?';
/** Conectores, mais longos primeiro para a alternância não parar no prefixo. */
const CONNECTOR = [...VALUE_CONNECTORS]
  .sort((a, b) => b.length - a.length)
  .map((c) => c.replace(/ /g, '\\s+'))
  .join('|');
/** Até dois advérbios minúsculos entre o conector e o valor ("teria hoje 47%"). */
const FILLER = '(?:\\s+[a-z]{1,12}){0,2}';
/**
 * Valor: token curto que TERMINA em `%`. Exigir o `%` evita capturar "2 pontos
 * percentuais" como se fosse percentual. O token é solto de propósito — quem
 * decide se é número é o helper único, que LANÇA em lixo (R4, docs/04 §4.1).
 */
const VALUE = '([^\\s,;.()"\'%]{1,12}?)\\s*%';

/** `Nome (PARTIDO), com 30%` — nome antes do valor. */
const CANDIDATE_BEFORE = new RegExp(
  `(${NAME})${PARTY},?\\s+(?:${CONNECTOR})${FILLER}\\s+${VALUE}`,
  'g',
);
/** `Ciro (6%)` — valor entre parênteses logo após o nome. */
const CANDIDATE_PAREN = new RegExp(`(${NAME})${PARTY}\\s*\\(${VALUE}\\)`, 'g');
/** `ante 42% de João Campos` — valor antes do nome. */
const CANDIDATE_AFTER = new RegExp(`${VALUE}\\s+(?:de|para)\\s+(${NAME})`, 'g');

/**
 * Brancos/nulos nas duas ordens observadas (expressão→número e número→expressão).
 *
 * Na primeira, a expressão tem de ABRIR a oração ("… 4%. Brancos ou nulos são 8%").
 * Sem essa âncora, "com 8% de brancos e nulos e 1% indecisos" casaria de novo com o
 * "1%" da oração seguinte e o cenário ganharia dois valores de brancos/nulos.
 */
const BLANK_NULL_PATTERNS = [
  new RegExp(`(?:^|[.;:]\\s*)branco[s]?\\s+(?:e|ou)\\s+nulo[s]?${GAP}${VALUE}`, 'g'),
  new RegExp(`${VALUE}${GAP}(?:em\\s+branco|branco[s]?\\s+(?:e|ou)\\s+nulo[s]?)`, 'g'),
];

/**
 * "não atingiram 1%": limiar declarado pela fonte. O número não é de ninguém — os
 * citados assim ficam FORA do cenário (ausência ≠ zero), e o número é descartado.
 */
const BELOW_THRESHOLD_PATTERN = new RegExp(
  `nao\\s+(?:${BELOW_THRESHOLD_VERBS.map((v) => v.replace(/ /g, '\\s+')).join('|')})\\s*${VALUE}`,
  'g',
);

/** Indecisos / não-resposta, nas duas ordens observadas. */
const UNDECIDED_PATTERNS = [
  new RegExp(`indecis[a-z]*[,:]?\\s+${VALUE}`, 'g'),
  new RegExp(`${VALUE}${GAP}indecis`, 'g'),
  new RegExp(`${VALUE}${GAP}nao\\s+(?:opin|soub|cit|respond)`, 'g'),
  new RegExp(`nao\\s+(?:opin|soub|cit|respond)[a-z]*${GAP}${VALUE}`, 'g'),
];

// ─── Cobertura dos percentuais ───────────────────────────────────────────────

interface PctHit {
  start: number;
  end: number;
  consumed: boolean;
}

const PCT_HIT = new RegExp(`${NUM}\\s*%`, 'g');

const findPctHits = (flat: string): PctHit[] => {
  const hits: PctHit[] = [];
  for (const m of flat.matchAll(PCT_HIT)) {
    if (m.index === undefined) continue;
    hits.push({ start: m.index, end: m.index + m[0].length, consumed: false });
  }
  return hits;
};

/** Hits ainda não atribuídos cujo texto está dentro do trecho `[start, end)`. */
const freeHitsWithin = (hits: PctHit[], start: number, end: number): PctHit[] =>
  hits.filter((h) => !h.consumed && h.start >= start && h.end <= end);

// ─── Classificação de parágrafo ──────────────────────────────────────────────

const includesAny = (flat: string, markers: readonly string[]): boolean =>
  markers.some((marker) => flat.includes(marker));

/**
 * `kind` do cenário anunciado pelo parágrafo, ou `null` se ele não anuncia cenário
 * algum (ou se é um parágrafo que nunca traz intenção de voto: rejeição,
 * cruzamento por segmento, comparação histórica, ficha técnica).
 */
/**
 * Subtítulo em CAIXA ALTA ("NO 2º TURNO, PETISTA TEM 48%, CONTRA 43% DE SENADOR DO
 * PL"). Nunca é fonte de dado: é resumo editorial, e em caixa alta TODA palavra
 * parece nome próprio — sem esta exclusão, "PETISTA" e "SENADOR" entrariam como
 * grafia de candidato. Regra: parágrafo com letras e NENHUMA minúscula é título.
 */
export const isAllCapsHeading = (original: string): boolean => {
  const letters = original.replace(/[^\p{L}]/gu, '');
  return letters.length > 0 && letters === letters.toUpperCase();
};

export const classifyParagraph = (flat: string): ScenarioKind | null => {
  if (includesAny(flat, EXCLUDED_PARAGRAPH_MARKERS)) return null;
  if (includesAny(flat, SCENARIO_ANCHORS.t2)) return scenarioKindSchema.enum.t2;
  if (includesAny(flat, SCENARIO_ANCHORS.t1Espontaneo)) {
    return scenarioKindSchema.enum.t1_espontaneo;
  }
  if (includesAny(flat, SCENARIO_ANCHORS.t1Estimulado)) {
    return scenarioKindSchema.enum.t1_estimulado;
  }
  return null;
};

// ─── Extração de um parágrafo ancorado ───────────────────────────────────────

/**
 * Grafia do candidato a partir do trecho casado: mantém apenas a cauda de tokens
 * Capitalizados no ORIGINAL (partículas `de/da/do/dos/e` valem no meio). É o que
 * separa "Seguido por Haddad" de "Haddad", e o que faz descrição anafórica ("o
 * atual presidente", "do presidenciável do PL") NÃO virar candidato: descrição
 * começa em minúscula, então nada sobra e o número fica sem dono — LANÇA.
 */
const PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos']);

const extractAlias = (originalSlice: string): string | null => {
  const tokens = originalSlice.split(/\s+/).filter((t) => t.length > 0);
  const kept: string[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (token === undefined) break;
    const first = token.charAt(0);
    const isCapitalized = first === first.toUpperCase() && first !== first.toLowerCase();
    if (isCapitalized) {
      kept.unshift(token);
      continue;
    }
    // Partícula só continua a cauda se já existe um nome à direita dela.
    if (kept.length > 0 && PARTICLES.has(flatten(token))) {
      kept.unshift(token);
      continue;
    }
    break;
  }
  // Partícula não abre nome ("de Freitas" sozinho não é grafia de candidato).
  while (kept.length > 0) {
    const first = kept[0];
    if (first === undefined || !PARTICLES.has(flatten(first))) break;
    kept.shift();
  }
  return kept.length === 0 ? null : kept.join(' ');
};

const hasDigit = (token: string): boolean => /\d/.test(token);

/**
 * Converte o token de valor em percentual. Token sem dígito que não seja marca de
 * valor suprimido não é alegação de valor (é prosa) e devolve `null` — o número
 * nem existe ali. Token com dígito, ou marca de supressão, vai para o helper
 * único, que LANÇA em lixo (R4): valor ilegível nunca vira 0.
 */
const readValue = (token: string, context: string): number | null => {
  const flatToken = flatten(token);
  const isIllegibleMark = (ILLEGIBLE_VALUE_TOKENS as readonly string[]).includes(flatToken);
  if (!hasDigit(token) && !isIllegibleMark) return null;
  try {
    return parsePtBrPercent(token);
  } catch (cause) {
    throw new ParseError(
      `Valor ilegível "${token}" em "${context}" (Datafolha): não vira 0, o documento é recusado`,
      cause,
    );
  }
};

interface Building {
  kind: ScenarioKind;
  values: RawScenarioValue[];
  blankNullPct?: number;
  undecidedPct?: number;
}

/** Consome o hit do trecho casado, se houver exatamente um livre. */
const claimHit = (hits: PctHit[], start: number, end: number): boolean => {
  const free = freeHitsWithin(hits, start, end);
  if (free.length === 0) return false; // já atribuído por um casamento mais específico
  if (free.length > 1) {
    throw new ParseError(
      `Trecho com mais de um percentual não atribuído em "${String(start)}..${String(end)}" ` +
        `(Datafolha): ambiguidade estrutural, recusando`,
    );
  }
  const [hit] = free;
  if (hit === undefined) return false;
  hit.consumed = true;
  return true;
};

const setOnce = (
  building: Building,
  field: 'blankNullPct' | 'undecidedPct',
  value: number,
): void => {
  const current = building[field];
  if (current !== undefined && current !== value) {
    throw new ParseError(
      `Dois valores diferentes de ${field} no mesmo cenário (${String(current)} e ` +
        `${String(value)}) — Datafolha: recusando em vez de escolher um`,
    );
  }
  building[field] = value;
};

/**
 * Extrai um cenário de um parágrafo ancorado. LANÇA se sobrar percentual sem dono.
 */
const extractScenario = (paragraph: Paragraph, kind: ScenarioKind): Building | null => {
  const { original, flat } = paragraph;
  const hits = findPctHits(flat);
  if (hits.length === 0) return null; // parágrafo de anúncio, sem número: não é cenário
  const building: Building = { kind, values: [] };

  // 1. Parênteses de comparação: o número lá dentro é de OUTRA rodada. Consumimos
  //    (para não sobrar sem dono) e descartamos — jamais entra como valor atual.
  //    O marcador pode estar DENTRO do parêntese ("(tinha 2%)") ou imediatamente
  //    antes dele ("…ao levantamento anterior (37%)").
  for (const m of flat.matchAll(/\(([^)]*)\)/g)) {
    const inner = m[1];
    if (m.index === undefined || inner === undefined) continue;
    const lookbehind = flat
      .slice(Math.max(0, m.index - COMPARISON_LOOKBEHIND_CHARS), m.index)
      .replace(/^[\s\S]*[.)%]/, '');
    if (!includesAny(inner, COMPARISON_MARKERS) && !includesAny(lookbehind, COMPARISON_MARKERS)) {
      continue;
    }
    for (const hit of freeHitsWithin(hits, m.index, m.index + m[0].length)) {
      hit.consumed = true;
    }
  }

  // 2. Brancos/nulos e indecisos ANTES de candidato: senão um "PL, com 9% de
  //    brancos e nulos" viraria candidato "PL".
  // 1b. Limiar declarado ("não atingiram 1%"): número sem dono POR DECLARAÇÃO da
  //     fonte. Consumimos e descartamos; ninguém entra com esse valor.
  for (const m of flat.matchAll(BELOW_THRESHOLD_PATTERN)) {
    if (m.index === undefined) continue;
    for (const hit of freeHitsWithin(hits, m.index, m.index + m[0].length)) {
      hit.consumed = true;
    }
  }

  // `readValue` vem ANTES de consumir o hit: valor ilegível ("--%") não produz hit
  // numérico, e só lançaria se lido primeiro. É o que impede o silêncio.
  for (const pattern of BLANK_NULL_PATTERNS) {
    for (const m of flat.matchAll(pattern)) {
      const token = m[1];
      if (m.index === undefined || token === undefined) continue;
      const value = readValue(token, m[0]);
      if (value === null) continue;
      if (!claimHit(hits, m.index, m.index + m[0].length)) continue;
      setOnce(building, 'blankNullPct', value);
    }
  }
  for (const pattern of UNDECIDED_PATTERNS) {
    for (const m of flat.matchAll(pattern)) {
      const token = m[1];
      if (m.index === undefined || token === undefined) continue;
      const value = readValue(token, m[0]);
      if (value === null) continue;
      if (!claimHit(hits, m.index, m.index + m[0].length)) continue;
      setOnce(building, 'undecidedPct', value);
    }
  }

  // 3. Candidatos. Ordem de aparição no parágrafo (é a ordem do par de 2º turno).
  const claimed: { position: number; alias: string; valuePct: number }[] = [];
  const candidatePatterns: { pattern: RegExp; nameGroup: 1 | 2; valueGroup: 1 | 2 }[] = [
    { pattern: CANDIDATE_BEFORE, nameGroup: 1, valueGroup: 2 },
    { pattern: CANDIDATE_PAREN, nameGroup: 1, valueGroup: 2 },
    { pattern: CANDIDATE_AFTER, nameGroup: 2, valueGroup: 1 },
  ];
  for (const { pattern, nameGroup, valueGroup } of candidatePatterns) {
    for (const m of flat.matchAll(pattern)) {
      const nameFlat = m[nameGroup];
      const token = m[valueGroup];
      if (m.index === undefined || nameFlat === undefined || token === undefined) continue;
      // Grafia do nome vem do ORIGINAL, no mesmo offset (o `flat` preserva tamanho).
      const nameStart = m.index + m[0].indexOf(nameFlat);
      const alias = extractAlias(original.slice(nameStart, nameStart + nameFlat.length));
      if (alias === null) continue; // descrição anafórica, não nome: número fica sem dono
      const value = readValue(token, m[0]);
      if (value === null) continue;
      if (!claimHit(hits, m.index, m.index + m[0].length)) continue;
      claimed.push({ position: m.index, alias, valuePct: value });
    }
  }
  claimed.sort((a, b) => a.position - b.position);
  for (const { alias, valuePct } of claimed) {
    // Ausência ≠ zero: só entra quem a publicação nomeia COM valor. Candidato que
    // "não atingiu 1%" não tem número publicado e por isso não entra (docs/04 §4.1).
    building.values.push({ candidateAlias: alias, valuePct });
  }

  // 4. Invariante: nenhum percentual sem dono. É o que recusa a rodada em que o
  //    valor do líder está preso a uma descrição em vez de um nome.
  const orphans = hits.filter((h) => !h.consumed);
  if (orphans.length > 0) {
    const shown = orphans.map((h) => original.slice(h.start, h.end).trim()).join(', ');
    throw new ParseError(
      `Percentual sem candidato nomeado na publicação do Datafolha (${shown}). ` +
        `A fonte atrela o valor a uma descrição (cargo/partido) e não a um nome; ` +
        `atribuir exigiria chute (docs/04 §4.1). Documento recusado — nunca parcial.`,
    );
  }
  // Sem um único candidato NOMEADO com valor, o parágrafo não é cenário — é
  // resumo/observação (ex.: "78% não souberam dizer em quem votariam"). Ignorar é
  // seguro justamente porque o passo 4 já garantiu que nenhum número ficou sem
  // explicação: se houvesse valor de candidato preso a uma descrição, ele teria
  // sobrado e lançado ali.
  if (building.values.length === 0) return null;
  return building;
};

// ─── Rótulo e finalização ────────────────────────────────────────────────────

/**
 * Rótulo NOSSO (R3, docs/08: nada de prosa de terceiro em campo servível). O
 * Datafolha não numera cenário em prosa; identificamos por `kind` e, no 2º turno,
 * pelo par — que é naturalmente único dentro da rodada.
 */
const labelFor = (
  kind: ScenarioKind,
  pair: [string, string] | undefined,
  ordinal: number,
): string => {
  if (kind === scenarioKindSchema.enum.t2 && pair !== undefined) {
    return `2º turno — ${pair[0]} x ${pair[1]}`;
  }
  const base =
    kind === scenarioKindSchema.enum.t1_espontaneo ? '1º turno espontâneo' : '1º turno estimulado';
  return ordinal === 1 ? base : `${base} — cenário ${String(ordinal)}`;
};

const finalize = (building: Building, ordinal: number): RawScenario => {
  let pair: [string, string] | undefined;
  if (building.kind === scenarioKindSchema.enum.t2) {
    const aliases = building.values.map((v) => v.candidateAlias);
    const [a, b] = aliases;
    if (aliases.length !== 2 || a === undefined || b === undefined) {
      throw new ParseError(
        `Cenário de 2º turno com ${String(aliases.length)} candidatos (esperado 2) — Datafolha`,
      );
    }
    pair = [a, b];
  }
  return {
    kind: building.kind,
    label: labelFor(building.kind, pair, ordinal),
    values: building.values,
    ...(pair === undefined ? {} : { t2Pair: pair }),
    ...(building.blankNullPct === undefined ? {} : { blankNullPct: building.blankNullPct }),
    ...(building.undecidedPct === undefined ? {} : { undecidedPct: building.undecidedPct }),
  };
};

/**
 * Parseia o texto do corpo da publicação (parágrafos separados por linha em
 * branco, como `documentToText` entrega) em cenários. Nenhum cenário reconhecido ⇒
 * devolve vazio e o `BaseAdapter` LANÇA (nenhum cenário extraído).
 */
export const parseDatafolhaText = (text: string): RawScenario[] => {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map(makeParagraph);

  const scenarios: RawScenario[] = [];
  const ordinalByKind = new Map<ScenarioKind, number>();
  for (const paragraph of paragraphs) {
    if (isAllCapsHeading(paragraph.original)) continue;
    const kind = classifyParagraph(paragraph.flat);
    if (kind === null) continue;
    const building = extractScenario(paragraph, kind);
    if (building === null) continue;
    const ordinal = (ordinalByKind.get(kind) ?? 0) + 1;
    ordinalByKind.set(kind, ordinal);
    scenarios.push(finalize(building, ordinal));
  }
  return scenarios;
};

/** Conveniência para quem tem o HTML em mão (specs, reparse manual). */
export const parseDatafolhaHtml = (html: string): RawScenario[] =>
  parseDatafolhaText(datafolhaArticleParagraphs(html).join('\n\n'));
