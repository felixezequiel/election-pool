/**
 * Parser do relatório técnico do PoderData (docs/04 §3, fonte 5). A fonte é o PDF
 * `Relatorio-PoderData-Eleitoral-*.pdf` publicado pelo próprio instituto — NUNCA o
 * HTML do Poder360 (ver o cabeçalho de `constants.ts` para a distinção
 * divulgação x matéria). Extraímos só números e rótulos (R3); o PDF bruto vira
 * `raw_documents` como proveniência e não é republicado.
 *
 * ---------------------------------------------------------------------------
 * ESTRUTURA REAL (verificada nas 4 rodadas de 2026 — não é estrutura suposta)
 * ---------------------------------------------------------------------------
 * O texto extraído do PDF tem uma linha por item de layout. Cada página de
 * conteúdo termina com o rodapé `www.poder360.com.br/poderdata`, e a linha
 * SEGUINTE é o título da seção daquela página. É esse par que usamos para
 * reconstruir as fronteiras de página que o `unpdf` perde ao concatenar.
 *
 * Dentro da seção "Intenção de voto no 1º turno" há duas coisas diferentes:
 *
 * (a) UMA página de GRÁFICO com a série histórica das ondas;
 * (b) VÁRIAS páginas de CRUZAMENTO (Sexo, Idade, Instrução, Região, Renda,
 *     Religião, Aprovação), cada uma com linhas `Rótulo 37% 32% 35%` e uma
 *     linha de fechamento `Total 100% 100% 100%`. A ÚLTIMA coluna é o Total —
 *     é o número da manchete.
 *
 * **O 1º turno é lido dos CRUZAMENTOS, nunca do gráfico.** Motivo: no cruzamento
 * o rótulo e o valor estão na MESMA linha do texto extraído, logo não há
 * adivinhação posicional; e como há ~7 cruzamentos, eles se conferem entre si.
 * O gráfico serve de ORÁCULO (conferência), não de fonte.
 *
 * A seção "Intenção de voto no 2º turno" NÃO tem cruzamento: só gráfico, um por
 * par. Aí o gráfico é inevitável, e ele aparece em dois dialetos reais:
 *
 * - `series` — gráfico de linhas com TABELA DE DADOS embaixo (rodada
 *   `BR-07845/2026`): uma linha de ondas (`29-May 24-Jun 15-Jul 29-Jul`) e
 *   depois linhas `Flávio Bolsonaro 42 43 43 43`. Rótulo e valores na mesma
 *   linha ⇒ leitura segura. A onda corrente é a ÚLTIMA coluna.
 * - `bars` — gráfico de barras com rótulos de dado (rodadas `BR-04882/2026`,
 *   `BR-05722/2026`, `BR-00059/2026`): PRIMEIRO todos os valores (um por linha,
 *   por onda), DEPOIS todos os rótulos, DEPOIS as legendas de onda (`mai/26`).
 *   Aqui rótulo e valor NÃO estão na mesma linha: o casamento é POSICIONAL, e um
 *   desalinhamento trocaria candidatos em silêncio — o pior tipo de bug (R4).
 *
 * Por isso o dialeto `bars` só é aceito quando a mesma leitura posicional,
 * aplicada ao gráfico do 1º turno DO MESMO DOCUMENTO, reproduz a coluna Total dos
 * cruzamentos. Aí a convenção de ordem está PROVADA naquele documento, e não
 * suposta. Sem esse oráculo, um 2º turno em `bars` é RECUSADO.
 *
 * A onda corrente é sempre a última, e isso é CONFERIDO contra `fieldEnd` do
 * registro: a última legenda tem de ser o mês (e, quando a legenda traz dia, o
 * dia) do fim de campo. É o mesmo espírito do V6 — impedir que os números de uma
 * onda sejam atribuídos a outra.
 *
 * Não há seção de voto ESPONTÂNEO em nenhuma das 4 rodadas: `t1_espontaneo` fica
 * ausente, e ausência não é zero.
 *
 * Toda falha de leitura LANÇA `ParseError` (R4). Nenhum `?? 0`, nenhum default.
 */

import { scenarioKindSchema } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { parsePtBrPercent } from '../parse-ptbr-number.js';
import { applyLine, categorizeLine } from '../base/scenario-lines.js';
import type { ScenarioAccumulator } from '../base/scenario-lines.js';
import type { RawScenario } from '../base/base-adapter.js';
import {
  ROUNDING_TOLERANCE_PP,
  MAX_CHART_LABEL_CHARS,
  MIN_CROSSTAB_COLUMNS,
  MONTH_ABBREVIATIONS,
  PAGE_FOOTER_ANCHOR,
  SECTION_TITLE_T1,
  SECTION_TITLE_T2,
} from './constants.js';

// --- utilidades de linha ----------------------------------------------------

/** Um token numérico do relatório: 0–999, decimal pt-BR opcional, `%` opcional. */
const NUMBER_TOKEN = /^-?\d{1,3}(?:,\d+)?%?$/;

/**
 * Legenda/rótulo de onda. Três grafias REAIS: `29-Jul` e `29-May` (eixo de
 * gráfico do Excel em inglês), `29/jul` e `mai/26` (pt-BR). A primeira
 * alternativa é dia+mês; a segunda é mês+ano de 2 dígitos.
 */
const WAVE_LABEL = /^(?:(\d{1,2})[-/]([A-Za-zçÇ]{3})|([A-Za-zçÇ]{3})\/(\d{2}))$/;

const normalizeLabel = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const tokensOf = (line: string): string[] => line.split(/\s+/).filter((t) => t.length > 0);

/** Uma linha só de números (rótulo de dado do gráfico, tick de eixo, nº da página). */
const isNumericOnlyLine = (line: string): boolean => {
  const tokens = tokensOf(line);
  return tokens.length > 0 && tokens.every((t) => NUMBER_TOKEN.test(t));
};

interface LabeledValues {
  label: string;
  rawValues: string[];
}

/**
 * Parte uma linha em `rótulo` + `valores` quando ela termina em número(s).
 * Devolve `null` para linha sem número no fim (prosa, cabeçalho de coluna,
 * subtítulo) e para linha só de números — nos dois casos não é linha de dado
 * rotulada. Tokeniza em vez de usar um regex monolítico porque os rótulos reais
 * têm espaço, acento e barra (`Branco/Nulo`, `Não sabe`, `Flávio Bolsonaro`).
 */
const splitLabeledValues = (line: string): LabeledValues | null => {
  const tokens = tokensOf(line);
  let cut = tokens.length;
  while (cut > 0) {
    const token = tokens[cut - 1];
    if (token === undefined || !NUMBER_TOKEN.test(token)) break;
    cut -= 1;
  }
  const rawValues = tokens.slice(cut);
  const labelTokens = tokens.slice(0, cut);
  if (rawValues.length === 0 || labelTokens.length === 0) return null;
  return { label: labelTokens.join(' '), rawValues };
};

const lastOf = (values: readonly string[], context: string): string => {
  const value = values[values.length - 1];
  if (value === undefined) {
    // Inalcançável pelos chamadores (todos checam length antes), mas é a narrow
    // que satisfaz `noUncheckedIndexedAccess` sem inventar um default (R4).
    throw new ParseError(`Lista de valores vazia em ${context}`);
  }
  return value;
};

// --- páginas ----------------------------------------------------------------

interface ReportPage {
  title: string;
  body: readonly string[];
}

/**
 * Reconstrói as páginas a partir do rodapé impresso. O que vem ANTES do primeiro
 * rodapé é a capa (onde mora o "Registro TSE" que o V6 confere) e não é página de
 * conteúdo. Páginas divisórias de seção não têm rodapé e acabam anexadas ao corpo
 * da página anterior — inofensivo, porque suas linhas não são linhas de dado.
 */
const splitPages = (lines: readonly string[]): ReportPage[] => {
  const pages: ReportPage[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index] !== PAGE_FOOTER_ANCHOR) {
      index += 1;
      continue;
    }
    const title = lines[index + 1];
    if (title === undefined) break; // rodapé na última linha: nada a delimitar
    const body: string[] = [];
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor] !== PAGE_FOOTER_ANCHOR) {
      const line = lines[cursor];
      if (line !== undefined) body.push(line);
      cursor += 1;
    }
    pages.push({ title, body });
    index = cursor;
  }
  return pages;
};

// --- ondas ------------------------------------------------------------------

interface WaveLabel {
  /** `null` quando a legenda só traz mês/ano (`mai/26`). */
  day: number | null;
  month: number;
  raw: string;
}

const parseWaveLabel = (token: string): WaveLabel | null => {
  const match = WAVE_LABEL.exec(token);
  if (match === null) return null;
  const [, dayRaw, monthFromDay, monthOnly] = match;
  const abbreviation = (monthFromDay ?? monthOnly)?.toLowerCase();
  if (abbreviation === undefined) return null;
  const month = MONTH_ABBREVIATIONS.get(abbreviation);
  if (month === undefined) return null;
  return { day: dayRaw === undefined ? null : Number(dayRaw), month, raw: token };
};

/** `true` se TODOS os tokens da linha são rótulo de onda. */
const waveLabelsOfLine = (line: string): WaveLabel[] | null => {
  const tokens = tokensOf(line);
  if (tokens.length === 0) return null;
  const waves: WaveLabel[] = [];
  for (const token of tokens) {
    const wave = parseWaveLabel(token);
    if (wave === null) return null;
    waves.push(wave);
  }
  return waves;
};

/**
 * Dia e mês do fim de campo. Lemos o prefixo `AAAA-MM-DD` da string ISO em vez de
 * construir um `Date` — CLAUDE.md proíbe `Date` nu em lógica de negócio, e aqui a
 * data já está no fuso de registro (America/Sao_Paulo).
 */
const fieldEndDayMonth = (fieldEnd: string): { day: number; month: number } => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(fieldEnd);
  const month = match?.[2];
  const day = match?.[3];
  if (month === undefined || day === undefined) {
    throw new ParseError(`fieldEnd do registro em formato inesperado: "${fieldEnd}"`);
  }
  return { day: Number(day), month: Number(month) };
};

/**
 * Confere que a ÚLTIMA onda do gráfico é a rodada do registro. Sem isto, "pegar a
 * última coluna" seria uma suposição sobre a ordem cronológica do gráfico — e
 * atribuir os números de outra onda é o mesmo erro de classe que o V6 impede.
 */
const confirmCurrentWave = (waves: readonly WaveLabel[], fieldEnd: string, page: string): void => {
  const current = waves[waves.length - 1];
  if (current === undefined) {
    throw new ParseError(`Gráfico em "${page}" sem nenhuma legenda de onda`);
  }
  const { day, month } = fieldEndDayMonth(fieldEnd);
  if (current.month !== month || (current.day !== null && current.day !== day)) {
    throw new ParseError(
      `Última onda do gráfico em "${page}" é "${current.raw}", que não corresponde ao fim de ` +
        `campo do registro (${fieldEnd}). Recusando para não atribuir números de outra onda.`,
    );
  }
};

// --- cruzamentos ------------------------------------------------------------

interface Cell {
  raw: string;
  value: number;
}

const TOTAL_LABEL = 'total';
const FULL_DISTRIBUTION_PCT = 100;

/**
 * Lê a coluna "Total" de uma página de cruzamento. Devolve `null` quando a página
 * NÃO é um cruzamento (sem a linha de fechamento `Total 100% ...`), o que é o
 * sinal de que se trata da página de gráfico da seção.
 *
 * A linha de fechamento é exigida porque é ela que prova que as colunas são uma
 * distribuição fechada em 100 — e, portanto, que a última coluna é o Total do
 * total da amostra, não mais um recorte.
 */
const tryReadCrosstabTotals = (body: readonly string[]): Map<string, Cell> | null => {
  const percentRows: LabeledValues[] = [];
  let hasClosingTotalRow = false;

  for (const line of body) {
    const parsed = splitLabeledValues(line);
    if (parsed === null) continue;
    // Só linhas cujos valores TODOS trazem `%` são linhas de cruzamento. Isso
    // separa, sem ambiguidade, cruzamento de tabela de série (que vem sem `%`).
    if (!parsed.rawValues.every((raw) => raw.endsWith('%'))) continue;
    percentRows.push(parsed);
    if (
      normalizeLabel(parsed.label) === TOTAL_LABEL &&
      parsed.rawValues.every((raw) => parsePtBrPercent(raw) === FULL_DISTRIBUTION_PCT)
    ) {
      hasClosingTotalRow = true;
    }
  }

  if (!hasClosingTotalRow) return null;

  const totals = new Map<string, Cell>();
  for (const row of percentRows) {
    if (normalizeLabel(row.label) === TOTAL_LABEL) continue;
    if (row.rawValues.length < MIN_CROSSTAB_COLUMNS) {
      throw new ParseError(
        `Linha de cruzamento "${row.label}" com ${String(row.rawValues.length)} coluna(s): ` +
          `sem coluna de Total identificável (mínimo ${String(MIN_CROSSTAB_COLUMNS)}).`,
      );
    }
    const raw = lastOf(row.rawValues, `cruzamento "${row.label}"`);
    // Valor ilegível LANÇA aqui (parsePtBrPercent), nunca vira 0 (R4).
    const value = parsePtBrPercent(raw);
    const existing = totals.get(row.label);
    if (existing !== undefined && existing.value !== value) {
      throw new ParseError(
        `Rótulo "${row.label}" aparece duas vezes no mesmo cruzamento com Totais ` +
          `diferentes (${String(existing.value)} e ${String(value)}).`,
      );
    }
    totals.set(row.label, { raw, value });
  }

  if (totals.size === 0) {
    throw new ParseError('Cruzamento sem nenhuma linha de resultado além do fechamento "Total".');
  }
  return totals;
};

/**
 * Funde os ~7 cruzamentos da seção num só conjunto de Totais.
 *
 * Os cruzamentos são REDUNDANTES por construção: a coluna Total de todos é o mesmo
 * marginal. Nas 4 rodadas reais eles concordam em ~250 de ~252 células. As duas
 * exceções são de 1 p.p. e vêm do arredondamento independente que o próprio
 * relatório declara (ver `ROUNDING_TOLERANCE_PP`).
 *
 * A regra, então:
 * - o CONJUNTO DE RÓTULOS tem de ser idêntico em todos (isso é estrutura, não
 *   arredondamento; divergir aqui é leitura desalinhada ⇒ lança);
 * - a amplitude dos valores de um mesmo rótulo tem de caber na tolerância de
 *   arredondamento (⇒ lança acima dela);
 * - o valor publicado é o da MAIORIA ESTRITA. Maioria, e não média, porque o
 *   instituto publica inteiros e a média inventaria um número que ele nunca
 *   imprimiu (2,14%); o valor da maioria é um número que ele de fato imprimiu.
 *   Sem maioria estrita (empate) ⇒ LANÇA: escolher no empate seria decidir por
 *   conta própria qual número o instituto quis dizer.
 */
const mergeCrosstabs = (crosstabs: ReadonlyArray<Map<string, Cell>>): Map<string, Cell> => {
  const first = crosstabs[0];
  if (first === undefined) {
    throw new ParseError('Nenhum cruzamento de 1º turno no relatório (estrutura mudou?)');
  }
  for (const other of crosstabs.slice(1)) {
    if (other.size !== first.size) {
      throw new ParseError(
        `Cruzamentos de 1º turno discordam no número de rótulos ` +
          `(${String(first.size)} vs ${String(other.size)}).`,
      );
    }
    for (const label of first.keys()) {
      if (!other.has(label)) {
        throw new ParseError(
          `Rótulo "${label}" presente num cruzamento de 1º turno e ausente noutro.`,
        );
      }
    }
  }

  const merged = new Map<string, Cell>();
  for (const label of first.keys()) {
    const cells: Cell[] = [];
    for (const crosstab of crosstabs) {
      const cell = crosstab.get(label);
      if (cell === undefined) {
        throw new ParseError(`Rótulo "${label}" desapareceu de um cruzamento de 1º turno.`);
      }
      cells.push(cell);
    }
    const values = cells.map((cell) => cell.value);
    const spread = Math.max(...values) - Math.min(...values);
    if (spread > ROUNDING_TOLERANCE_PP) {
      throw new ParseError(
        `Cruzamentos de 1º turno discordam no Total de "${label}" em ${String(spread)} p.p. ` +
          `(valores: ${values.join(', ')}), acima da tolerância de arredondamento ` +
          `(${String(ROUNDING_TOLERANCE_PP)} p.p.). Sinal de leitura desalinhada — recusando.`,
      );
    }
    const counts = new Map<number, number>();
    // O `?? 0` aqui inicializa um CONTADOR de frequência, não um dado de pesquisa —
    // não é o default silencioso que o R4 proíbe.
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    let best: { value: number; count: number } | null = null;
    let tied = false;
    for (const [value, count] of counts) {
      if (best === null || count > best.count) {
        best = { value, count };
        tied = false;
      } else if (count === best.count) {
        tied = true;
      }
    }
    if (best === null || tied) {
      throw new ParseError(
        `Cruzamentos de 1º turno empatam no Total de "${label}" (valores: ${values.join(', ')}). ` +
          `Sem maioria não escolhemos por conta própria — recusando.`,
      );
    }
    const winner = cells.find((cell) => cell.value === best.value);
    if (winner === undefined) {
      throw new ParseError(`Não foi possível eleger o Total de "${label}".`);
    }
    merged.set(label, winner);
  }
  return merged;
};

// --- gráficos ---------------------------------------------------------------

type ChartDialect = 'series' | 'bars';

interface ChartEntry {
  label: string;
  raw: string;
}

interface ChartReading {
  dialect: ChartDialect;
  entries: ChartEntry[];
}

/** Índices contíguos das linhas de legenda de onda, e as ondas concatenadas. */
interface WaveBlock {
  firstIndex: number;
  lastIndex: number;
  waves: WaveLabel[];
}

const findWaveBlock = (body: readonly string[], page: string): WaveBlock => {
  const indices: number[] = [];
  const waves: WaveLabel[] = [];
  body.forEach((line, index) => {
    const lineWaves = waveLabelsOfLine(line);
    if (lineWaves === null) return;
    indices.push(index);
    waves.push(...lineWaves);
  });
  const firstIndex = indices[0];
  const lastIndex = indices[indices.length - 1];
  if (firstIndex === undefined || lastIndex === undefined) {
    throw new ParseError(
      `Página "${page}" não é cruzamento nem tem legenda de onda: não há como ler o ` +
        `gráfico (estrutura mudou?).`,
    );
  }
  if (lastIndex - firstIndex + 1 !== indices.length) {
    throw new ParseError(
      `Legendas de onda não contíguas em "${page}": suspeita de falso positivo na detecção.`,
    );
  }
  return { firstIndex, lastIndex, waves };
};

/**
 * Dialeto `series`: depois da linha de ondas vêm linhas `Rótulo n1 n2 ... nW`, com
 * exatamente uma coluna por onda. Devolve `null` se o padrão não estiver lá (então
 * a página é do dialeto `bars`).
 */
const tryReadSeriesTable = (body: readonly string[], block: WaveBlock): ChartEntry[] | null => {
  const waveCount = block.waves.length;
  const entries: ChartEntry[] = [];
  for (const line of body.slice(block.lastIndex + 1)) {
    const parsed = splitLabeledValues(line);
    if (parsed === null) continue;
    if (parsed.rawValues.length !== waveCount) continue;
    entries.push({
      label: parsed.label,
      raw: lastOf(parsed.rawValues, `série "${parsed.label}"`),
    });
  }
  // Duas linhas é o mínimo de um cenário (V3 exige 2 candidatos no 2º turno).
  return entries.length >= 2 ? entries : null;
};

/**
 * Dialeto `bars`. O corpo da página, no texto real e SEM redação, é:
 *
 *     <enunciado da pergunta, 1–2 linhas de prosa>
 *     <nº da página>
 *     <valores: W blocos de N, um número por linha>
 *     <rótulos: N linhas de texto puro>
 *     <legendas de onda>
 *
 * Lemos de trás para frente, que é a direção em que a estrutura é firme: primeiro
 * os RÓTULOS (linhas de texto curto imediatamente antes das legendas), depois os
 * VALORES (linhas de um número só). O que sobrar ANTES disso é a prosa do
 * enunciado, e é ignorada — não há por que exigir que a pergunta caiba em regra
 * nenhuma.
 *
 * As invariantes abaixo são o que torna a leitura posicional verificável em vez de
 * confiante: `N` vem da contagem de rótulos, `W` da contagem de legendas, e a
 * quantidade de valores tem de ser exatamente `W×N` (ou `W×N+1`, quando o número
 * da página cai junto dos valores — é o que acontece nos 3 relatórios reais).
 * Qualquer outro número LANÇA.
 */
const readBarsChart = (body: readonly string[], block: WaveBlock, page: string): ChartEntry[] => {
  const beforeLegend = body.slice(0, block.firstIndex);

  /** Rótulo de categoria: texto puro e curto. Longo demais é prosa, não rótulo. */
  const isCategoryLabel = (line: string): boolean =>
    !isNumericOnlyLine(line) &&
    splitLabeledValues(line) === null &&
    line.length <= MAX_CHART_LABEL_CHARS;

  let cut = beforeLegend.length;
  const labels: string[] = [];
  while (cut > 0) {
    const line = beforeLegend[cut - 1];
    if (line === undefined || !isCategoryLabel(line)) break;
    labels.unshift(line);
    cut -= 1;
  }

  // Valores: linhas de UM número só, contíguas, logo acima dos rótulos. Uma linha
  // com vários números seria outro tipo de gráfico e a leitura posicional deixaria
  // de valer — então ela encerra o bloco e a contagem abaixo é que decide.
  const numbers: string[] = [];
  while (cut > 0) {
    const line = beforeLegend[cut - 1];
    if (line === undefined) break;
    const tokens = tokensOf(line);
    const token = tokens[0];
    if (tokens.length !== 1 || token === undefined || !NUMBER_TOKEN.test(token)) break;
    numbers.unshift(token);
    cut -= 1;
  }

  const labelCount = labels.length;
  const waveCount = block.waves.length;
  if (labelCount < 2) {
    throw new ParseError(
      `Gráfico de "${page}" com ${String(labelCount)} rótulo(s): abaixo do mínimo de 2.`,
    );
  }
  const expected = waveCount * labelCount;
  let offset = 0;
  if (numbers.length === expected + 1) {
    offset = 1; // a 1ª linha numérica é o número da página impresso no canto
  } else if (numbers.length !== expected) {
    throw new ParseError(
      `Gráfico de "${page}" com ${String(numbers.length)} valores, incompatível com ` +
        `${String(waveCount)} onda(s) × ${String(labelCount)} rótulo(s). ` +
        `Recusando para não desalinhar rótulo e valor.`,
    );
  }

  const start = offset + (waveCount - 1) * labelCount;
  return labels.map((label, index) => {
    const raw = numbers[start + index];
    if (raw === undefined) {
      throw new ParseError(`Valor ausente para "${label}" no gráfico de "${page}".`);
    }
    return { label, raw };
  });
};

const readChart = (body: readonly string[], fieldEnd: string, page: string): ChartReading => {
  const block = findWaveBlock(body, page);
  confirmCurrentWave(block.waves, fieldEnd, page);
  const series = tryReadSeriesTable(body, block);
  if (series !== null) return { dialect: 'series', entries: series };
  return { dialect: 'bars', entries: readBarsChart(body, block, page) };
};

/**
 * Oráculo: a leitura do gráfico do 1º turno tem de reproduzir a coluna Total dos
 * cruzamentos, rótulo a rótulo. É isso que PROVA, dentro do documento, que a ordem
 * assumida na leitura posicional está certa — e é o que autoriza usar o mesmo
 * dialeto no 2º turno, que não tem cruzamento para conferir.
 */
const checkChartAgainstCrosstabs = (
  chart: ChartReading,
  totals: ReadonlyMap<string, Cell>,
): void => {
  if (chart.entries.length !== totals.size) {
    throw new ParseError(
      `Gráfico de 1º turno tem ${String(chart.entries.length)} rótulos e os cruzamentos ` +
        `${String(totals.size)}: não há como conferir a leitura.`,
    );
  }
  for (const entry of chart.entries) {
    const cell = totals.get(entry.label);
    if (cell === undefined) {
      throw new ParseError(
        `Rótulo "${entry.label}" está no gráfico de 1º turno e não nos cruzamentos.`,
      );
    }
    const chartValue = parsePtBrPercent(entry.raw);
    if (Math.abs(chartValue - cell.value) > ROUNDING_TOLERANCE_PP) {
      throw new ParseError(
        `Gráfico de 1º turno diz ${String(chartValue)} para "${entry.label}" e os ` +
          `cruzamentos dizem ${String(cell.value)}: diferença acima da tolerância de ` +
          `arredondamento (${String(ROUNDING_TOLERANCE_PP)} p.p.). ` +
          `Sinal de leitura desalinhada — recusando.`,
      );
    }
  }
};

// --- montagem dos cenários --------------------------------------------------

const accumulate = (
  entries: ReadonlyArray<{ label: string; raw: string }>,
): ScenarioAccumulator => {
  const acc: ScenarioAccumulator = { values: [] };
  for (const entry of entries) {
    // `categorizeLine` é o classificador comum (brancos/nulos, não sabe, ou
    // candidato) e é ele que converte o número pt-BR. Ilegível ⇒ LANÇA.
    applyLine(acc, categorizeLine(entry.label, entry.raw));
  }
  return acc;
};

const finalize = (
  kind: RawScenario['kind'],
  label: string,
  acc: ScenarioAccumulator,
  t2Pair?: [string, string],
): RawScenario => ({
  kind,
  label,
  values: acc.values,
  ...(t2Pair === undefined ? {} : { t2Pair }),
  ...(acc.blankNullPct === undefined ? {} : { blankNullPct: acc.blankNullPct }),
  ...(acc.undecidedPct === undefined ? {} : { undecidedPct: acc.undecidedPct }),
});

const buildRunoffScenario = (chart: ChartReading, index: number): RawScenario => {
  const acc = accumulate(chart.entries);
  const [first, second] = acc.values;
  if (acc.values.length !== 2 || first === undefined || second === undefined) {
    throw new ParseError(
      `Cenário de 2º turno #${String(index + 1)} com ${String(acc.values.length)} candidato(s): ` +
        `o par tem de ser exatamente 2.`,
    );
  }
  // Rótulo NOSSO, composto dos aliases extraídos — não é prosa do instituto (R3),
  // e é o que dá unicidade a `(tse_id, kind, label)` entre os vários pares.
  const label = `${SECTION_TITLE_T2}: ${first.candidateAlias} x ${second.candidateAlias}`;
  return finalize(scenarioKindSchema.enum.t2, label, acc, [
    first.candidateAlias,
    second.candidateAlias,
  ]);
};

/**
 * Extrai os cenários do texto do relatório do PoderData. `fieldEnd` é o fim de
 * campo do REGISTRO (`PollRegistration.fieldEnd`) e serve para confirmar que a
 * onda lida é a da rodada. LANÇA em qualquer leitura duvidosa; nunca devolve
 * parcial nem preenche ausência com zero.
 */
export const parsePoderDataReport = (text: string, fieldEnd: string): RawScenario[] => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const pages = splitPages(lines);
  if (pages.length === 0) {
    throw new ParseError(
      `Nenhuma página delimitada por "${PAGE_FOOTER_ANCHOR}" no PDF do PoderData ` +
        `(estrutura mudou?).`,
    );
  }

  const crosstabs: Array<Map<string, Cell>> = [];
  let firstRoundChart: ChartReading | null = null;
  const runoffCharts: ChartReading[] = [];

  for (const page of pages) {
    if (page.title === SECTION_TITLE_T1) {
      const crosstab = tryReadCrosstabTotals(page.body);
      if (crosstab !== null) {
        crosstabs.push(crosstab);
        continue;
      }
      const chart = readChart(page.body, fieldEnd, page.title);
      if (firstRoundChart !== null) {
        throw new ParseError(
          'Mais de uma página de gráfico na seção de 1º turno: qual é a da rodada? Recusando.',
        );
      }
      firstRoundChart = chart;
      continue;
    }
    if (page.title === SECTION_TITLE_T2) {
      runoffCharts.push(readChart(page.body, fieldEnd, page.title));
    }
  }

  if (crosstabs.length === 0) {
    throw new ParseError(
      `Nenhum cruzamento em "${SECTION_TITLE_T1}" no PDF do PoderData. O 1º turno só é ` +
        `lido dos cruzamentos (o gráfico é conferência), então sem eles não há número ` +
        `confiável — recusando em vez de ler o gráfico às cegas.`,
    );
  }
  const totals = mergeCrosstabs(crosstabs);

  let barsProvenByOracle = false;
  if (firstRoundChart !== null) {
    checkChartAgainstCrosstabs(firstRoundChart, totals);
    barsProvenByOracle = firstRoundChart.dialect === 'bars';
  }
  if (!barsProvenByOracle && runoffCharts.some((chart) => chart.dialect === 'bars')) {
    throw new ParseError(
      'Cenário de 2º turno em gráfico de barras (rótulo e valor em linhas separadas) sem ' +
        'oráculo que prove a ordem no gráfico de 1º turno do mesmo documento. ' +
        'Decodificar posicionalmente aqui poderia trocar candidatos em silêncio — recusando.',
    );
  }

  const scenarios: RawScenario[] = [];
  const firstRoundEntries = [...totals].map(([label, cell]) => ({ label, raw: cell.raw }));
  scenarios.push(
    finalize(
      scenarioKindSchema.enum.t1_estimulado,
      SECTION_TITLE_T1,
      accumulate(firstRoundEntries),
    ),
  );
  runoffCharts.forEach((chart, index) => {
    scenarios.push(buildRunoffScenario(chart, index));
  });

  const labels = new Set<string>();
  for (const scenario of scenarios) {
    if (labels.has(scenario.label)) {
      throw new ParseError(
        `Rótulo de cenário repetido: "${scenario.label}". ` +
          `Dois cenários com o mesmo rótulo colidiriam em (tse_id, kind, label).`,
      );
    }
    labels.add(scenario.label);
  }
  return scenarios;
};
