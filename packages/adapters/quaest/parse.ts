/**
 * Parser da divulgação da Quaest (Genial/Quaest) — docs/04 §3, fonte 3.
 *
 * ## O que a fonte publica, de fato (investigado em 2026-08-17)
 *
 * O PDF de rodada existe (`/relatorios/…` → anexo no WordPress) mas é
 * **inteiramente rasterizado**: nas 197 páginas do relatório de 14/08/2026 a
 * camada de texto tem só títulos e enunciados de pergunta — ZERO percentuais,
 * ZERO nomes de candidato nos gráficos e ZERO número de registro no TSE (a
 * evidência medida está em `__fixtures__/2026-08-14-rodada-1-pdf-probe.json`).
 * Sem OCR — que a v1 não tem, e sem headless (CLAUDE.md) — o PDF não é fonte de
 * número. Por isso o V6 do `BaseAdapter` recusa o PDF: o `tse_id` não está lá.
 *
 * A ÚNICA superfície da fonte primária que traz, em texto, o número de registro
 * no TSE **e** os percentuais da rodada é o **post de blog do próprio instituto**
 * (`quaest.com.br/<slug>/`, assinado pelo CEO). Isso é nível 2 de docs/04 §1
 * (site do próprio instituto) — não é portal de notícia.
 *
 * ## Por que este parser é ESCRITO PARA RECUSAR
 *
 * O post é redação editorial, e a redação MUDA a cada rodada: as duas capturas
 * congeladas (2026-07-15 e 2026-08-05) descrevem o mesmo cenário com sintaxes
 * incompatíveis. E o mesmo post mistura, nas mesmas construções de frase:
 * número nacional da rodada, número da rodada ANTERIOR ("de 28% em julho para
 * 30% em agosto"), número de SUBGRUPO ("81% entre os eleitores … bolsonarista")
 * e números de OUTRAS perguntas (potencial de voto, rejeição, aprovação).
 *
 * A postura, portanto, é a de docs/04 §4.1 levada ao limite: **quatro guardas
 * independentes, e recusa em vez de chute.**
 *
 *  G1. **Escopo de parágrafo.** Só o bloco ANCORADO pela frase com que o
 *      instituto abre aquele cenário é lido. Nenhum percentual de outro
 *      parágrafo entra, jamais.
 *  G2. **Colapso de tendência.** "de A% … para B%" vira B antes de qualquer
 *      leitura. É a única forma de não atribuir a rodada anterior a este
 *      registro — erro que o V6 NÃO pegaria, porque o `tse_id` correto está no
 *      mesmo documento.
 *  G3. **Rótulo estrito, por janela de oração.** O dono de um número tem de ser
 *      um nome próprio dentro da oração que termina no `%`. Sobrando qualquer
 *      percentual sem dono, ou aparecendo marcador de subgrupo/outra pergunta na
 *      janela, o cenário é RECUSADO (não "pulado").
 *  G4. **Aritmética.** A soma do cenário tem de cair em [V1_SUM_MIN,
 *      V1_SUM_MAX] e a contagem de candidatos tem de respeitar V3 (2º turno) /
 *      V7. Uma leitura errada quase sempre estoura a soma.
 *
 * Consequência medida nas capturas: o post de 2026-08-05 é lido inteiro (1º
 * turno estimulado e 2º turno, com brancos/nulos e indecisos); o de 2026-07-15 é
 * RECUSADO em todos os cenários. Recusar é o comportamento certo: naquele post o
 * nome vem DEPOIS do percentual ("frente a 28% de Flávio Bolsonaro") e a
 * decomposição publicada é incompleta (o 2º turno soma 82 — o instituto não
 * publicou o resíduo). Publicar 82 como se fosse um cenário seria o parcial que
 * docs/04 §4 proíbe.
 *
 * Nada aqui deduz valor ausente: candidato que não aparece não entra, e
 * `blankNullPct`/`undecidedPct` ficam `undefined` quando a rodada não os publica
 * (R4 — nunca `?? 0`). O número é sempre convertido pelo helper único
 * (`parsePtBrPercent`), que LANÇA em valor ilegível.
 */

import {
  V1_SUM_MAX,
  V1_SUM_MIN,
  V3_RUNOFF_CANDIDATE_COUNT,
  V7_MAX_CANDIDATES,
  V7_MIN_CANDIDATES,
} from '@election-pool/contracts/constants';
import { scenarioKindSchema } from '@election-pool/contracts/enums';
import type { ScenarioKind } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { parsePtBrPercent } from '../parse-ptbr-number.js';
import type { RawScenario, RawScenarioValue } from '../base/base-adapter.js';
import {
  QUAEST_BLANK_NULL_KEYWORDS,
  QUAEST_CLAUSE_BOUNDARY_SOURCE,
  QUAEST_DISTRIBUTIVE_MARKER,
  QUAEST_NAME_PARTICLES,
  QUAEST_PERCENT_PATTERN_SOURCE,
  QUAEST_SCENARIO_ANCHORS,
  QUAEST_SCENARIO_LABELS,
  QUAEST_SUBGROUP_MARKERS,
  QUAEST_TREND_PATTERN_SOURCE,
  QUAEST_UNDECIDED_KEYWORDS,
} from './constants.js';

/** Sem acento, minúsculo, espaços colapsados. Usado só para COMPARAR, nunca para gravar. */
const normalize = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const containsAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => haystack.includes(needle));

/** G2: "de A% … para B%" → " B% ". B é o valor corrente; A é a rodada anterior. */
const collapseTrends = (text: string): string =>
  text.replace(new RegExp(QUAEST_TREND_PATTERN_SOURCE, 'gi'), ' $2% ');

/** Trecho de `text` depois da ÚLTIMA fronteira de oração (a janela que precede o `%`). */
const clauseWindowBefore = (text: string): string => {
  const boundary = new RegExp(QUAEST_CLAUSE_BOUNDARY_SOURCE, 'gi');
  let cut = -1;
  let match = boundary.exec(text);
  while (match !== null) {
    cut = match.index + match[0].length;
    match = boundary.exec(text);
  }
  return cut < 0 ? text : text.slice(cut);
};

/** Trecho de `text` até a PRIMEIRA fronteira de oração (a janela que segue o `%`). */
const clauseWindowAfter = (text: string): string => {
  const boundary = new RegExp(QUAEST_CLAUSE_BOUNDARY_SOURCE, 'gi');
  const match = boundary.exec(text);
  return match === null ? text : text.slice(0, match.index);
};

const startsUpperCase = (token: string): boolean => /^[A-ZÀ-Ý]/.test(token);

const isParticle = (token: string): boolean => QUAEST_NAME_PARTICLES.includes(token.toLowerCase());

/**
 * G3: o nome próprio no FIM da janela. Descarta a cauda de verbos/preposições
 * ("… Romeu Zema registra" → "Romeu Zema") e aceita partícula só ENTRE dois
 * tokens capitalizados ("Lula da Silva", "Caiado e Renan"). Artigo capitalizado
 * de início de frase ("O contingente…") não é nome: token de 1 letra é
 * descartado. Devolve string vazia quando não há nome — e aí o chamador RECUSA,
 * nunca adivinha.
 */
const trailingProperName = (window: string): string => {
  const tokens = window
    .replace(/[(),;:.“”"']/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);

  let end = tokens.length;
  while (end > 0) {
    const token = tokens[end - 1];
    if (token === undefined || startsUpperCase(token)) break;
    end -= 1;
  }
  let start = end;
  while (start > 0) {
    const token = tokens[start - 1];
    if (token === undefined) break;
    if (startsUpperCase(token)) {
      start -= 1;
      continue;
    }
    const previous = start - 2 >= 0 ? tokens[start - 2] : undefined;
    if (isParticle(token) && previous !== undefined && startsUpperCase(previous)) {
      start -= 1;
      continue;
    }
    break;
  }
  while (start < end) {
    const token = tokens[start];
    if (token === undefined) break;
    if (!isParticle(token) && token.length > 1) break;
    start += 1;
  }
  return tokens.slice(start, end).join(' ');
};

/** Uma leitura de cenário: aceita, ou recusada com o motivo (que vira a mensagem do erro). */
type Reading = { ok: true; scenario: RawScenario } | { ok: false; reason: string };

interface Accumulator {
  values: RawScenarioValue[];
  blankNullPct?: number;
  undecidedPct?: number;
}

/**
 * Lê UM bloco ancorado como cenário de `kind`. Devolve `ok: false` com motivo em
 * qualquer sinal de ambiguidade — o chamador decide entre recusar o documento e
 * ignorar o bloco (só ignora quando OUTRO bloco da mesma âncora foi lido).
 */
const readScenarioBlock = (kind: ScenarioKind, block: string): Reading => {
  const text = collapseTrends(block);

  const percent = new RegExp(QUAEST_PERCENT_PATTERN_SOURCE, 'g');
  const marks: Array<{ start: number; end: number; raw: string }> = [];
  let match = percent.exec(text);
  while (match !== null) {
    const raw = match[1];
    if (raw === undefined) return { ok: false, reason: 'percentual sem número capturado' };
    marks.push({ start: match.index, end: percent.lastIndex, raw });
    match = percent.exec(text);
  }
  if (marks.length === 0) return { ok: false, reason: 'bloco ancorado sem nenhum percentual' };

  const acc: Accumulator = { values: [] };
  let cursor = 0;
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    if (mark === undefined) return { ok: false, reason: 'varredura de percentuais inconsistente' };
    const next = marks[i + 1];
    const before = text.slice(cursor, mark.start);
    const after = text.slice(mark.end, next === undefined ? text.length : next.start);
    cursor = mark.end;

    const windowBefore = clauseWindowBefore(before);
    const windowAfter = clauseWindowAfter(after);
    const normBefore = normalize(windowBefore);
    const normAfter = normalize(windowAfter);

    if (
      containsAny(normBefore, QUAEST_SUBGROUP_MARKERS) ||
      containsAny(normAfter, QUAEST_SUBGROUP_MARKERS)
    ) {
      return {
        ok: false,
        reason:
          `percentual ${mark.raw}% está em contexto de subgrupo ou de outra pergunta ` +
          `("${normBefore} | ${normAfter}") — não é o número nacional da rodada`,
      };
    }

    // O helper único converte (e LANÇA em valor ilegível — R4). Não capturamos o
    // erro: valor que não dá para ler não pode virar cenário nenhum.
    const valuePct = parsePtBrPercent(mark.raw);
    const name = trailingProperName(windowBefore);

    // Categoria (brancos/nulos, indecisos) tem precedência pela janela ANTERIOR;
    // a janela seguinte só é consultada quando não há nome ("…, enquanto 4%
    // permanecem indecisos").
    let category: 'blankNull' | 'undecided' | null = null;
    if (containsAny(normBefore, QUAEST_BLANK_NULL_KEYWORDS)) category = 'blankNull';
    else if (containsAny(normBefore, QUAEST_UNDECIDED_KEYWORDS)) category = 'undecided';
    else if (name.length === 0) {
      if (containsAny(normAfter, QUAEST_BLANK_NULL_KEYWORDS)) category = 'blankNull';
      else if (containsAny(normAfter, QUAEST_UNDECIDED_KEYWORDS)) category = 'undecided';
    }

    if (category !== null && name.length > 0) {
      return {
        ok: false,
        reason: `rótulo ambíguo em "${normBefore}": tem categoria e nome próprio ("${name}")`,
      };
    }
    if (category === 'blankNull') {
      if (acc.blankNullPct !== undefined) {
        return { ok: false, reason: 'dois valores de brancos/nulos no mesmo cenário' };
      }
      acc.blankNullPct = valuePct;
      continue;
    }
    if (category === 'undecided') {
      if (acc.undecidedPct !== undefined) {
        return { ok: false, reason: 'dois valores de indecisos no mesmo cenário' };
      }
      acc.undecidedPct = valuePct;
      continue;
    }
    if (name.length === 0) {
      return {
        ok: false,
        reason:
          `percentual ${mark.raw}% sem dono identificável na oração ` +
          `("${normBefore}" | "${normAfter}")`,
      };
    }

    const distributive = normAfter.split(/\s+/).includes(QUAEST_DISTRIBUTIVE_MARKER);
    const names = name
      .split(/\s+e\s+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (names.length > 1 && !distributive) {
      return {
        ok: false,
        reason: `nome composto por "e" sem marcador distributivo ("cada"): "${name}"`,
      };
    }
    for (const alias of names) {
      if (acc.values.some((value) => value.candidateAlias === alias)) {
        return { ok: false, reason: `candidato "${alias}" aparece duas vezes no cenário` };
      }
      acc.values.push({ candidateAlias: alias, valuePct });
    }
  }

  // G4: aritmética. Só os valores EXPLICITAMENTE publicados entram na soma —
  // nada é preenchido para "fechar" o total.
  const total =
    acc.values.reduce((sum, value) => sum + value.valuePct, 0) +
    (acc.blankNullPct ?? 0) +
    (acc.undecidedPct ?? 0);
  if (total < V1_SUM_MIN || total > V1_SUM_MAX) {
    return {
      ok: false,
      reason:
        `soma do cenário = ${String(total)}, fora de [${String(V1_SUM_MIN)}, ${String(V1_SUM_MAX)}] ` +
        `(V1) — a decomposição publicada está incompleta ou a leitura pegou número de outra série`,
    };
  }
  if (kind === scenarioKindSchema.enum.t2) {
    if (acc.values.length !== V3_RUNOFF_CANDIDATE_COUNT) {
      return {
        ok: false,
        reason: `cenário de 2º turno com ${String(acc.values.length)} candidatos (V3 exige ${String(V3_RUNOFF_CANDIDATE_COUNT)})`,
      };
    }
  } else if (acc.values.length < V7_MIN_CANDIDATES || acc.values.length > V7_MAX_CANDIDATES) {
    return {
      ok: false,
      reason: `cenário com ${String(acc.values.length)} candidatos, fora de [${String(V7_MIN_CANDIDATES)}, ${String(V7_MAX_CANDIDATES)}] (V7)`,
    };
  }

  const base: RawScenario = {
    kind,
    label: QUAEST_SCENARIO_LABELS[kind],
    values: acc.values,
    ...(acc.blankNullPct === undefined ? {} : { blankNullPct: acc.blankNullPct }),
    ...(acc.undecidedPct === undefined ? {} : { undecidedPct: acc.undecidedPct }),
  };
  if (kind !== scenarioKindSchema.enum.t2) return { ok: true, scenario: base };

  const [first, second] = acc.values;
  if (first === undefined || second === undefined) {
    return { ok: false, reason: 'cenário de 2º turno sem par completo' };
  }
  return {
    ok: true,
    scenario: { ...base, t2Pair: [first.candidateAlias, second.candidateAlias] },
  };
};

/**
 * Texto do post (um bloco por linha, produzido por `quaestArticleText`) →
 * cenários. LANÇA quando a fonte publicou um cenário que não conseguimos ler
 * inteiro, e quando não há cenário nenhum — nunca devolve lista vazia nem
 * cenário meio-montado.
 */
export const parseQuaestRoundText = (text: string): RawScenario[] => {
  const blocks = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const scenarios: RawScenario[] = [];
  let anchoredAny = false;

  for (const kind of scenarioKindSchema.options) {
    const anchors = QUAEST_SCENARIO_ANCHORS[kind];
    const anchored = blocks.filter((block) => containsAny(normalize(block), anchors));
    if (anchored.length === 0) continue; // cenário não publicado nesta rodada: ausente, não zero
    anchoredAny = true;

    const accepted: RawScenario[] = [];
    const refusals: string[] = [];
    for (const block of anchored) {
      const reading = readScenarioBlock(kind, block);
      if (reading.ok) accepted.push(reading.scenario);
      else refusals.push(reading.reason);
    }

    if (accepted.length > 1) {
      throw new ParseError(
        `Cenário "${kind}" com ${String(accepted.length)} leituras válidas no mesmo post — ` +
          `ambíguo qual é o nacional da rodada. Recusando (docs/04 §4.1).`,
      );
    }
    if (accepted.length === 0) {
      throw new ParseError(
        `Cenário "${kind}" está anunciado no post da Quaest mas não é extraível: ` +
          refusals.join(' | ') +
          `. A divulgação da Quaest é redação editorial e muda de rodada para rodada; ` +
          `recusar é a única alternativa a inventar número (R4, docs/04 §4).`,
      );
    }
    const [only] = accepted;
    if (only === undefined) throw new ParseError(`Cenário "${kind}" perdido na leitura`);
    scenarios.push(only);
  }

  if (!anchoredAny) {
    throw new ParseError(
      'Documento da Quaest sem nenhuma âncora de cenário. As duas formas de divulgação ' +
        'conhecidas são: (a) o PDF de rodada, que é 100% rasterizado e não tem percentual ' +
        'nem registro TSE na camada de texto; e (b) o post de blog do instituto, que tem ' +
        'os dois. Se este documento é o PDF, não há o que extrair sem OCR — e a v1 não ' +
        'faz OCR nem usa headless browser (CLAUDE.md).',
    );
  }
  return scenarios;
};
