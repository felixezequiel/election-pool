/**
 * Parser do release do Paraná Pesquisas (docs/04 §1 nível 2: site do próprio
 * instituto). Escrito CONTRA CAPTURA REAL, não contra estrutura suposta —
 * `__fixtures__/README.md` diz de onde veio cada byte, e as duas rodadas
 * congeladas (fev/2026 `BR-07974/2026` e mar/2026 `BR-00873/2026`) foram baixadas
 * do site em 2026-08-17. Essa ordem é a lição da `docs/OPEN-QUESTIONS.md` Q-09.
 *
 * O QUE A FONTE PUBLICA. Um post por rodada na categoria "Pesquisas", com o
 * `tse_id` no próprio título, e um ou mais PDFs anexados. O HTML do post NÃO
 * contém número nenhum — zero `<table>`, zero percentual. Todos os resultados
 * estão no PDF ("deck" de slides). Extraímos só números e rótulos (R3).
 *
 * ANATOMIA DO PDF (verificada nas duas capturas). Uma página por slide:
 *   - Rodapé de TODA página: a sentença de registro da Res.-TSE 23.600/2019 com o
 *     `tse_id`. É o delimitador de página e a declaração de identidade (ver
 *     `tse-registration.ts`).
 *   - Páginas de GRÁFICO: uma corrida contígua de N linhas "só percentual",
 *     imediatamente seguida das N linhas de rótulo, na MESMA ordem. É daqui que
 *     saem 1º turno espontâneo e estimulado.
 *   - Páginas de CRUZAMENTO (sexo/idade/escolaridade/região/Bolsa Família): os
 *     mesmos cenários abertos por subgrupo. NUNCA são cenário canônico — publicar
 *     um subgrupo como total seria erro grave e silencioso. Descartadas pela
 *     presença de rótulo de recorte (`labels.ts`).
 *   - Páginas COMPARATIVAS: tabela rotulada com a série histórica; a ÚLTIMA coluna
 *     é a rodada corrente, e o cabeçalho traz o `tse_id` de cada coluna. Ausência
 *     de um candidato numa coluna vem como `-` (NÃO é zero — docs/04 §4.1).
 *   - Página de 2º turno em GRÁFICO de barra dupla: a extração de texto NÃO
 *     preserva qual par pertence a qual linha de valores (verificado: três
 *     confrontos numa página, rótulos e valores fora de ordem no texto). Por isso
 *     o 2º turno é lido das páginas COMPARATIVAS, que são rotuladas. Se o
 *     documento tiver página de 2º turno e NENHUM 2º turno sair, LANÇAMOS — a
 *     perda nunca é silenciosa (R4).
 *
 * NUNCA PARCIAL: cada cenário é montado inteiro ou o parser lança. Nenhum `?? 0`,
 * nenhum `|| ''`. Candidato ausente não entra; ausência nunca vira zero.
 */

import { scenarioKindSchema } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { parsePtBrPercent } from '../parse-ptbr-number.js';
import { applyLine } from '../base/scenario-lines.js';
import type { LineCategory, ScenarioAccumulator } from '../base/scenario-lines.js';
import type { RawScenario } from '../base/base-adapter.js';
import { classifyLabel, isSegmentLabel, normalizeLabel } from './labels.js';
import {
  confirmRegisteredTseId,
  findTseIds,
  stripRegistrationSentences,
} from './tse-registration.js';

/**
 * Início da sentença de registro. Aparece exatamente uma vez por página (22/22 em
 * fevereiro, 19/19 em março), então serve de delimitador de página no texto que o
 * `unpdf` devolve com as páginas concatenadas por `\n`.
 */
const PAGE_BOUNDARY = 'de acordo com a resolu';

/** Linha que é SÓ um percentual ('42,6%'). Frouxa de propósito: quem valida o */
/** número é o helper único `parsePtBrPercent`, que LANÇA em valor ilegível (R4). */
const PCT_ONLY_LINE = /^\d[\d.,]*\s*%$/;

/** Token de valor numa tabela comparativa: percentual OU o traço de ausência. */
const CELL = /^(?:\d[\d.,]*\s*%|[-‐-―])$/;

/** Marcador do cenário na página de gráfico. */
const SCENARIO_MARKER = /(ESPONT[ÂA]NEA|ESTIMULADA)/i;

/** Marcador da tabela comparativa. */
const COMPARATIVE_MARKER = /(COMPARATIVO)/i;

/** Rótulo que é cabeçalho/rodapé de slide, nunca categoria de resultado. */
const TRAILER_LABEL = [
  /^base\s*:/,
  /^se as elei/,
  /^em um eventual/,
  /^independente de em quem/,
  /^situacao eleitoral/,
  /^espontanea$/,
  /^estimulada/,
  /^comparativo/,
  /^pesquisa/,
  /^de acordo com a resolu/,
  /^essa pesquisa est/,
  /^superior eleitoral/,
  /^cargo de presidente/,
  /^perfil da amostra/,
  /^\d+$/,
  /^\[prosa/,
];

const normalizePage = (lines: readonly string[]): string => normalizeLabel(lines.join(' '));

/**
 * Reparte o texto do PDF em páginas pelo marcador da sentença de registro.
 * Devolve linhas já aparadas e sem vazias.
 */
export const splitPdfPages = (text: string): string[][] => {
  const pages: string[][] = [];
  let current: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (normalizeLabel(line).includes(PAGE_BOUNDARY) && current.length > 0) {
      pages.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) pages.push(current);
  return pages;
};

/** Separa uma linha em rótulo + células de valor, lendo da direita para a esquerda. */
const stripCells = (line: string): { label: string; cells: string[] } => {
  const tokens = line.split(/\s+/).filter((t) => t.length > 0);
  const cells: string[] = [];
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (last === undefined || !CELL.test(last)) break;
    cells.unshift(last);
    tokens.pop();
  }
  return { label: tokens.join(' '), cells };
};

/** `true` se a linha é (ou começa com) um rótulo de recorte demográfico. */
const isSegmentRow = (line: string): boolean => isSegmentLabel(stripCells(line).label);

type PageKind = 'chart' | 'comparative' | 'runoff_graphic' | 'ignore';

/**
 * Triagem da página. Só sinais POSITIVOS entram: uma página que não prova ser
 * cenário canônico é ignorada, e a rede de segurança são as invariantes do fim de
 * `parseParanaPesquisasPdfText` (que LANÇAM se nada de essencial saiu).
 */
const classifyPage = (lines: readonly string[]): PageKind => {
  const page = normalizePage(lines);
  // Toda página de resultado eleitoral tem este par no título do slide. Exclui
  // perfil da amostra, avaliação de administração e "merece ser reeleito".
  if (!page.includes('situacao eleitoral') || !page.includes('presidente')) return 'ignore';
  if (COMPARATIVE_MARKER.test(page)) {
    // Comparativo com recorte demográfico seria série histórica de subgrupo.
    return lines.some(isSegmentRow) ? 'ignore' : 'comparative';
  }
  // 'turno' fora de comparativo ⇒ o gráfico de barra dupla, cuja extração de
  // texto não preserva o par (ver cabeçalho). Registrado para a invariante.
  if (page.includes('turno')) return 'runoff_graphic';
  const isChart =
    page.includes('base') && (page.includes('espontanea') || page.includes('estimulada'));
  if (!isChart) return 'ignore';
  // Cruzamento: mesmos cenários por subgrupo. Nunca é o número canônico.
  if (lines.some(isSegmentRow)) return 'ignore';
  return 'chart';
};

const isTrailerLabel = (label: string): boolean => {
  const n = normalizeLabel(label);
  return n.length === 0 || TRAILER_LABEL.some((r) => r.test(n));
};

/** Extrai o rótulo do cenário a partir da linha do marcador ('ESTIMULADA – Cenário 1'). */
const scenarioLabelFrom = (lines: readonly string[], marker: RegExp, page: string): string => {
  for (const line of lines) {
    const m = marker.exec(line);
    if (m === null || m.index === undefined) continue;
    const label = line.slice(m.index).trim();
    if (label.length > 0) return label;
  }
  throw new ParseError(
    `Página de resultado sem a linha de rótulo do cenário (esperado ${String(marker)}): "${page}"`,
  );
};

/** Aplica um rótulo+valor ao acumulador, ou LANÇA se o rótulo não for categoria. */
const applyLabelled = (
  acc: ScenarioAccumulator,
  candidateOrder: string[],
  label: string,
  valuePct: number,
  where: string,
): void => {
  const kind = classifyLabel(label);
  switch (kind) {
    case 'candidate': {
      const category: LineCategory = { kind: 'candidate', alias: label.trim(), valuePct };
      candidateOrder.push(label.trim());
      applyLine(acc, category);
      return;
    }
    case 'blankNull': {
      if (acc.blankNullPct !== undefined) {
        throw new ParseError(`Dois rótulos de brancos/nulos em "${where}" — estrutura inesperada`);
      }
      applyLine(acc, { kind: 'blankNull', valuePct });
      return;
    }
    case 'undecided': {
      if (acc.undecidedPct !== undefined) {
        throw new ParseError(`Dois rótulos de não-sabe em "${where}" — estrutura inesperada`);
      }
      applyLine(acc, { kind: 'undecided', valuePct });
      return;
    }
    case 'others':
      // 'Outros nomes citados': agregado sem lugar em `ParsedPoll`. Descartado
      // explicitamente (ver `labels.ts`), nunca convertido em candidato nem em 0.
      return;
    case 'segment':
      throw new ParseError(
        `Rótulo de recorte demográfico ("${label}") dentro do cenário "${where}": a página é ` +
          `cruzamento, não resultado canônico. Recusando para não publicar subgrupo como total.`,
      );
  }
};

/** Fecha o cenário: decide o `kind` e, se for 2º turno, exige o par de 2. */
const finalize = (
  kindHint: 'espontaneo' | 'estimulado',
  label: string,
  acc: ScenarioAccumulator,
  candidateOrder: readonly string[],
): RawScenario => {
  const base = {
    label,
    values: acc.values,
    ...(acc.blankNullPct === undefined ? {} : { blankNullPct: acc.blankNullPct }),
    ...(acc.undecidedPct === undefined ? {} : { undecidedPct: acc.undecidedPct }),
  };
  if (kindHint === 'espontaneo') {
    return { kind: scenarioKindSchema.enum.t1_espontaneo, ...base };
  }
  // Estimulada com exatamente DOIS candidatos é confronto de 2º turno. Isto não é
  // suposição: na captura de março/2026 o instituto rebatizou o 2º turno de
  // "Cenário 2" — quem confiasse no rótulo classificaria um segundo turno como
  // primeiro. A ESTRUTURA (dois candidatos) é o sinal confiável.
  if (candidateOrder.length === 2) {
    const [a, b] = candidateOrder;
    if (a === undefined || b === undefined) {
      throw new ParseError(`Cenário de 2º turno "${label}" com par incompleto`);
    }
    return { kind: scenarioKindSchema.enum.t2, ...base, t2Pair: [a, b] };
  }
  return { kind: scenarioKindSchema.enum.t1_estimulado, ...base };
};

/** Página de gráfico: N percentuais contíguos, então os N rótulos na mesma ordem. */
const parseChartPage = (lines: readonly string[]): RawScenario => {
  const page = lines.join(' ');
  const runs: Array<{ start: number; end: number }> = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i++) {
    const line = lines[i];
    const isPct = line !== undefined && PCT_ONLY_LINE.test(line);
    if (isPct && start < 0) start = i;
    if (!isPct && start >= 0) {
      if (i - start >= 2) runs.push({ start, end: i });
      start = -1;
    }
  }
  if (runs.length !== 1) {
    throw new ParseError(
      `Página de cenário com ${String(runs.length)} blocos de percentuais (esperado exatamente 1). ` +
        `A estrutura do PDF mudou — recusando em vez de adivinhar qual bloco é o resultado.`,
    );
  }
  const run = runs[0];
  if (run === undefined) throw new ParseError('Bloco de percentuais não localizado');
  const count = run.end - run.start;
  const labels = lines.slice(run.end, run.end + count);
  if (labels.length !== count) {
    throw new ParseError(
      `Página de cenário com ${String(count)} percentuais e apenas ${String(labels.length)} ` +
        `linhas de rótulo depois deles. Sem correspondência 1-para-1 não há como atribuir ` +
        `valor a candidato — recusando (R4).`,
    );
  }

  const label = scenarioLabelFrom(lines, SCENARIO_MARKER, page);
  const kindHint: 'espontaneo' | 'estimulado' = /ESPONT/i.test(label) ? 'espontaneo' : 'estimulado';
  const acc: ScenarioAccumulator = { values: [] };
  const candidateOrder: string[] = [];
  for (let i = 0; i < count; i++) {
    const rawPct = lines[run.start + i];
    const rawLabel = labels[i];
    if (rawPct === undefined || rawLabel === undefined) {
      throw new ParseError(`Par percentual/rótulo ausente na posição ${String(i)} de "${label}"`);
    }
    if (isTrailerLabel(rawLabel) || PCT_ONLY_LINE.test(rawLabel)) {
      throw new ParseError(
        `"${rawLabel}" não é rótulo de categoria em "${label}" — o bloco de rótulos não bate ` +
          `com o bloco de valores. Estrutura mudou; recusando.`,
      );
    }
    applyLabelled(acc, candidateOrder, rawLabel, parsePtBrPercent(rawPct), label);
  }
  return finalize(kindHint, label, acc, candidateOrder);
};

interface ComparativeResult {
  /** Cenário emitido — só quando é 2º turno (ver cabeçalho do arquivo). */
  scenario?: RawScenario;
  /** `true` quando a tabela é de 1º turno (redundante com a página de gráfico). */
  isFirstRound: boolean;
}

/**
 * Tabela comparativa: cada linha é `<rótulo> <valor>…`, e a ÚLTIMA coluna é a
 * rodada corrente. A correspondência coluna→rodada é CONFIRMADA pelo `tse_id` do
 * cabeçalho: o último `tse_id` fora da sentença de registro tem de ser o do
 * registro. Sem essa confirmação não publicamos nada desta página.
 */
const parseComparativePage = (lines: readonly string[], tseId: string): ComparativeResult => {
  const page = lines.join(' ');
  const label = scenarioLabelFrom(lines, COMPARATIVE_MARKER, page);

  const rows: Array<{ label: string; cells: string[] }> = [];
  const headerLines: string[] = [];
  for (const line of lines) {
    const { label: rowLabel, cells } = stripCells(line);
    if (cells.length > 0 && rowLabel.length > 0 && !isTrailerLabel(rowLabel)) {
      rows.push({ label: rowLabel, cells });
    } else {
      headerLines.push(line);
    }
  }
  if (rows.length === 0) {
    throw new ParseError(`Tabela comparativa "${label}" sem nenhuma linha de valor`);
  }
  const width = rows[0]?.cells.length ?? 0;
  if (rows.some((r) => r.cells.length !== width)) {
    throw new ParseError(
      `Tabela comparativa "${label}" com número de colunas irregular ` +
        `(${rows.map((r) => String(r.cells.length)).join('/')}). Sem grade regular não há como ` +
        `dizer qual coluna é a rodada corrente — recusando.`,
    );
  }

  // Cabeçalho de coluna: o último `tse_id` que NÃO vem da sentença de registro.
  const headerIds = findTseIds(stripRegistrationSentences(headerLines.join(' ')));
  const lastId = headerIds[headerIds.length - 1];
  if (lastId === undefined) {
    throw new ParseError(
      `Tabela comparativa "${label}" sem nenhum tse_id em cabeçalho de coluna: não há como ` +
        `provar que a última coluna é a rodada ${tseId}. Recusando (docs/04 §4.1).`,
    );
  }
  if (lastId !== tseId) {
    throw new ParseError(
      `Tabela comparativa "${label}": a última coluna é ${lastId}, não ${tseId}. Recusando para ` +
        `não atribuir os números da rodada errada.`,
    );
  }

  const acc: ScenarioAccumulator = { values: [] };
  const candidateOrder: string[] = [];
  for (const row of rows) {
    const cell = row.cells[width - 1];
    if (cell === undefined) {
      throw new ParseError(`Linha "${row.label}" sem célula na última coluna de "${label}"`);
    }
    // Traço = o candidato não estava no cenário desta rodada. Fica FORA (docs/04
    // §4.1: "Não deduza valor ausente"). Jamais vira 0.
    if (!/%$/.test(cell)) continue;
    applyLabelled(acc, candidateOrder, row.label, parsePtBrPercent(cell), label);
  }

  if (candidateOrder.length < 2) {
    throw new ParseError(
      `Tabela comparativa "${label}" com ${String(candidateOrder.length)} candidato(s) na coluna ` +
        `de ${tseId} (esperado ao menos 2). Estrutura inesperada — recusando.`,
    );
  }
  if (candidateOrder.length > 2) {
    // 1º turno: os MESMOS números já saíram da página de gráfico com rótulo
    // próprio. Emitir os dois criaria duas linhas `t1_estimulado` para a mesma
    // rodada (labels diferentes passam pelo UNIQUE de docs/03 §2.4) e o modelo
    // contaria a rodada em dobro. A invariante do chamador garante que a página
    // de gráfico existiu.
    return { isFirstRound: true };
  }
  const [a, b] = candidateOrder;
  if (a === undefined || b === undefined) {
    throw new ParseError(`Tabela comparativa "${label}" com par de 2º turno incompleto`);
  }
  return {
    isFirstRound: false,
    scenario: {
      kind: scenarioKindSchema.enum.t2,
      label,
      t2Pair: [a, b],
      values: acc.values,
      ...(acc.blankNullPct === undefined ? {} : { blankNullPct: acc.blankNullPct }),
      ...(acc.undecidedPct === undefined ? {} : { undecidedPct: acc.undecidedPct }),
    },
  };
};

/**
 * Extrai todos os cenários do texto do PDF. `tseId` é o do REGISTRO (a verdade) —
 * usado para confirmar a identidade do documento e a coluna corrente das tabelas
 * comparativas. LANÇA em qualquer inconsistência; nunca devolve parcial.
 */
export const parseParanaPesquisasPdfText = (text: string, tseId: string): RawScenario[] => {
  // Antes de qualquer número: o documento tem de DECLARAR-SE registrado sob este
  // `tse_id`. V6 do BaseAdapter não basta nesta fonte (ver `tse-registration.ts`).
  confirmRegisteredTseId(text, tseId);

  const scenarios: RawScenario[] = [];
  let sawRunoffGraphic = false;
  let sawFirstRoundComparative = false;

  for (const page of splitPdfPages(text)) {
    switch (classifyPage(page)) {
      case 'chart':
        scenarios.push(parseChartPage(page));
        break;
      case 'comparative': {
        const result = parseComparativePage(page, tseId);
        if (result.scenario !== undefined) scenarios.push(result.scenario);
        if (result.isFirstRound) sawFirstRoundComparative = true;
        break;
      }
      case 'runoff_graphic':
        sawRunoffGraphic = true;
        break;
      case 'ignore':
        break;
    }
  }

  const kinds = new Set(scenarios.map((s) => s.kind));
  if (
    !kinds.has(scenarioKindSchema.enum.t1_estimulado) &&
    !kinds.has(scenarioKindSchema.enum.t1_espontaneo)
  ) {
    throw new ParseError(
      `Nenhum cenário de 1º turno extraído do release de ${tseId}. O PDF do Paraná Pesquisas ` +
        `sempre traz ao menos a pergunta espontânea e a estimulada — recusando em vez de ` +
        `publicar uma rodada sem o número principal (R4).`,
    );
  }
  if (sawRunoffGraphic && !kinds.has(scenarioKindSchema.enum.t2)) {
    throw new ParseError(
      `O release de ${tseId} tem página de 2º turno, mas nenhum cenário de 2º turno foi ` +
        `extraído. O 2º turno é lido das tabelas comparativas rotuladas; se elas mudaram, a ` +
        `perda não pode passar em silêncio (R4).`,
    );
  }
  if (sawFirstRoundComparative && !kinds.has(scenarioKindSchema.enum.t1_estimulado)) {
    throw new ParseError(
      `O release de ${tseId} tem tabela comparativa de 1º turno, mas nenhum cenário ` +
        `t1_estimulado saiu das páginas de gráfico. Não usamos a comparativa como fonte de 1º ` +
        `turno (duplicaria a rodada), então esta ausência é perda de dado — recusando.`,
    );
  }
  return scenarios;
};
