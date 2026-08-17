/**
 * Parser dos cenários do REAL TIME BIG DATA, sobre o texto normalizado por
 * layout que `pdf-layout.ts` produz (páginas separadas por `PDF_PAGE_SEPARATOR`).
 *
 * ESTRUTURA REAL DO DOCUMENTO (idêntica nas 6 rodadas capturadas, ver
 * `__fixtures__/README.md`): o deck usa **páginas divisórias** — uma página
 * contendo APENAS o título da seção — e coloca o gráfico da seção na página
 * SEGUINTE.
 *
 *   p1  capa: `PESQUISA REGISTRADA: BR-NNNNN/2026` + data de divulgação
 *   p2  metodologia (n, universo, margem, campo)
 *   p3  perfil da amostra
 *   p4  divisória `ESPONTÂNEA PRESIDENTE`      → p5  gráfico (total)
 *   p6  divisória `ESTIMULADA PRESIDENTE`      → p7  gráfico (total)
 *   p8–p10  recortes de GÊNERO / IDADE / RENDA do estimulado
 *   p11 divisória `SEGUNDO TURNO`              → p12 `CENÁRIO 01` (confronto)
 *   p13 divisória `REJEIÇÃO MÚLTIPLA`          → p14 gráfico
 *   p15 divisória `APROVAÇÃO`                  → p16 gráfico
 *
 * DECISÕES QUE ESSA ESTRUTURA IMPÕE:
 *
 * - **Só o TOTAL entra.** Os recortes (p8–p10) são o mesmo cenário estimulado
 *   quebrado por gênero/idade/renda; não são cenários de pesquisa e não têm
 *   lugar em `ParsedPoll`. Ancorar na divisória — e não em "toda página com
 *   barras" — exclui os recortes por construção. Não é filtro por nome de
 *   recorte (que seria frágil): é a posição na estrutura. E há um motivo extra
 *   para NÃO tentar lê-los: neles o número de rótulos e o número de valores
 *   DIVERGEM (o instituto omite a barra de quem ficou em 0%), então o
 *   pareamento por barra é ambíguo — ler isso seria inventar dado.
 * - **Rejeição e aprovação não entram.** Não são intenção de voto; `ParsedPoll`
 *   só tem cenários de voto (`SCENARIO_KIND`). Ignoramos sem erro: a ausência é
 *   deliberada, não falha.
 * - **Divisória presente e gráfico ausente ⇒ LANÇA.** Isso é mudança de
 *   estrutura (evento esperado, docs/04 §2), nunca "cenário vazio".
 *
 * O `tse_id` NÃO é lido aqui como verdade: a confirmação V6 é do `BaseAdapter`
 * sobre o texto inteiro (a capa traz `BR-NNNNN/2026`).
 */

import { SCENARIO_KIND, scenarioKindSchema } from '@election-pool/contracts/enums';
import type { ScenarioKind } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import type { RawScenario, RawScenarioValue } from '../base/base-adapter.js';
import { PDF_PAGE_SEPARATOR } from './constants.js';
import { classifyRealTimeLine, normalizeLabel } from './labels.js';

/** Linha de dado do gráfico: `"<rótulo> <valor>%"`, com o `%` ancorado no fim. */
const VALUE_LINE = /^(.+?)\s+(\d{1,3}(?:,\d+)?)%$/;

/** Valor sozinho na linha: usado no confronto de 2º turno e no eixo do gráfico. */
const BARE_VALUE_LINE = /^(\d{1,3}(?:,\d+)?)%$/;

/** Rótulo do cenário de 2º turno, como o instituto imprime: `CENÁRIO 01`. */
const CENARIO_LINE = /^cenario \d+$/;

/**
 * Títulos das páginas divisórias que abrem um cenário de VOTO, na forma
 * normalizada. As demais divisórias (`rejeicao multipla`, `aprovacao`) não estão
 * aqui de propósito.
 */
const DIVIDER_KINDS = new Map<string, ScenarioKind>([
  ['espontanea presidente', SCENARIO_KIND.t1Espontaneo],
  ['estimulada presidente', SCENARIO_KIND.t1Estimulado],
  ['segundo turno', SCENARIO_KIND.t2],
]);

const nonEmptyLines = (page: string): string[] =>
  page
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

interface Divider {
  readonly kind: ScenarioKind;
  /** Título como IMPRESSO, para virar o `label` do cenário. */
  readonly label: string;
}

/**
 * Reconhece uma página divisória: página com UMA única linha, e essa linha é um
 * dos títulos de seção de voto. Exigir página de uma linha é o que separa a
 * divisória de uma menção solta ao mesmo texto dentro de uma página de gráfico
 * (acontece de verdade: em `BR-07696/2026` e `BR-08354/2026` sobra um
 * `CENÁRIO 01` na página do estimulado).
 */
const asDivider = (page: string): Divider | null => {
  const lines = nonEmptyLines(page);
  if (lines.length !== 1) return null;
  const only = lines[0];
  if (only === undefined) return null;
  const kind = DIVIDER_KINDS.get(normalizeLabel(only));
  return kind === undefined ? null : { kind, label: only };
};

interface Accumulator {
  values: RawScenarioValue[];
  blankNullPct?: number;
  undecidedPct?: number;
}

const applyLine = (acc: Accumulator, label: string, rawValue: string): void => {
  const line = classifyRealTimeLine(label, rawValue);
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

const finalize = (
  kind: ScenarioKind,
  label: string,
  acc: Accumulator,
  t2Pair?: readonly [string, string],
): RawScenario => ({
  kind,
  label,
  values: acc.values,
  ...(t2Pair === undefined ? {} : { t2Pair: [t2Pair[0], t2Pair[1]] as [string, string] }),
  ...(acc.blankNullPct === undefined ? {} : { blankNullPct: acc.blankNullPct }),
  ...(acc.undecidedPct === undefined ? {} : { undecidedPct: acc.undecidedPct }),
});

/**
 * Gráfico de barras (1º turno espontâneo/estimulado): cada barra virou uma linha
 * `"<rótulo> <valor>%"` no passo de layout. Linhas sem esse formato são eixo
 * (`0%`, `10%`, ...) ou prosa (enunciado da pergunta, nota de rodapé) e são
 * ignoradas — não carregam dado de barra.
 *
 * Nenhuma barra reconhecida ⇒ LANÇA: divisória sem gráfico é mudança de
 * estrutura, não cenário vazio.
 */
const parseBarChartPage = (page: string, kind: ScenarioKind, label: string): RawScenario => {
  const acc: Accumulator = { values: [] };
  for (const line of nonEmptyLines(page)) {
    const match = VALUE_LINE.exec(line);
    if (match === null) continue;
    const [, rawLabel, rawValue] = match;
    if (rawLabel === undefined || rawValue === undefined) continue;
    applyLine(acc, rawLabel, rawValue);
  }
  if (acc.values.length === 0) {
    throw new ParseError(
      `Página de "${label}" sem nenhuma barra de candidato reconhecida ` +
        `(estrutura do PDF do REAL TIME BIG DATA mudou?)`,
    );
  }
  return finalize(kind, label, acc);
};

/**
 * Confronto de 2º turno. O layout é diferente do gráfico de barras: os dois
 * nomes numa faixa, os dois percentuais em outra, e branco/nulo e não-sabe como
 * linhas rotuladas (`NULO/BRANCO: 6%`).
 *
 * O pareamento é POSICIONAL, esquerda→direita: `pdf-layout.ts` já ordenou cada
 * faixa por `x`, então o 1º nome corresponde ao 1º percentual. Isto é o que
 * impede a troca de candidatos que a ordem de fluxo do PDF causaria (ver o
 * cabeçalho de `pdf-layout.ts`).
 *
 * Exigimos exatamente 2 nomes e 2 percentuais (V3, docs/04 §5). Qualquer outra
 * contagem LANÇA — com 3 nomes e 2 valores não existe pareamento honesto.
 */
const parseFaceOffPage = (page: string, kind: ScenarioKind): RawScenario | null => {
  const lines = nonEmptyLines(page);
  const label = lines.find((line) => CENARIO_LINE.test(normalizeLabel(line)));
  if (label === undefined) return null;

  const names: string[] = [];
  const bareValues: string[] = [];
  const acc: Accumulator = { values: [] };

  for (const line of lines) {
    if (line === label) continue;
    const bare = BARE_VALUE_LINE.exec(line);
    if (bare !== null) {
      const [, rawValue] = bare;
      if (rawValue !== undefined) bareValues.push(rawValue);
      continue;
    }
    const labelled = VALUE_LINE.exec(line);
    if (labelled === null) {
      // Linha de texto puro nesta página é nome de finalista.
      names.push(line);
      continue;
    }
    const [, rawLabel, rawValue] = labelled;
    if (rawLabel === undefined || rawValue === undefined) continue;
    const classified = classifyRealTimeLine(rawLabel, rawValue);
    if (classified.kind === 'candidate') {
      throw new ParseError(
        `Cenário de 2º turno "${label}" com linha rotulada inesperada: "${line}". ` +
          `No layout de confronto só branco/nulo e não-sabe vêm rotulados.`,
      );
    }
    applyLine(acc, rawLabel, rawValue);
  }

  if (names.length !== 2 || bareValues.length !== 2) {
    throw new ParseError(
      `Cenário de 2º turno "${label}" com ${String(names.length)} nome(s) e ` +
        `${String(bareValues.length)} percentual(is): esperado exatamente 2 e 2 ` +
        `(V3, docs/04 §5). Sem pareamento inequívoco, nada é extraído.`,
    );
  }

  const [firstName, secondName] = names;
  const [firstValue, secondValue] = bareValues;
  if (
    firstName === undefined ||
    secondName === undefined ||
    firstValue === undefined ||
    secondValue === undefined
  ) {
    throw new ParseError(`Cenário de 2º turno "${label}" com par incompleto`);
  }

  applyLine(acc, firstName, firstValue);
  applyLine(acc, secondName, secondValue);
  return finalize(kind, label, acc, [firstName.trim(), secondName.trim()]);
};

/**
 * Texto normalizado por layout → cenários crus. LANÇA se nenhum cenário de voto
 * for reconhecido (documento de outro tipo, ou estrutura mudou).
 */
export const parseRealTimeLayoutText = (text: string): RawScenario[] => {
  const pages = text.split(PDF_PAGE_SEPARATOR);
  const scenarios: RawScenario[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (page === undefined) continue;
    const divider = asDivider(page);
    if (divider === null) continue;

    if (divider.kind === scenarioKindSchema.enum.t2) {
      // Podem existir vários cenários de 2º turno, um por página, até a próxima
      // divisória. Consumimos enquanto a página trouxer um rótulo `CENÁRIO NN`.
      let consumed = 0;
      for (let next = index + 1; next < pages.length; next += 1) {
        const target = pages[next];
        if (target === undefined || asDivider(target) !== null) break;
        const scenario = parseFaceOffPage(target, divider.kind);
        if (scenario === null) break;
        scenarios.push(scenario);
        consumed += 1;
      }
      if (consumed === 0) {
        throw new ParseError(
          `Divisória "${divider.label}" sem nenhuma página de confronto ` +
            `(estrutura do PDF do REAL TIME BIG DATA mudou?)`,
        );
      }
      continue;
    }

    const target = pages[index + 1];
    if (target === undefined) {
      throw new ParseError(`Divisória "${divider.label}" é a última página, sem gráfico`);
    }
    scenarios.push(parseBarChartPage(target, divider.kind, divider.label));
  }

  if (scenarios.length === 0) {
    throw new ParseError(
      'Nenhum cenário de voto reconhecido no PDF do REAL TIME BIG DATA ' +
        '(sem páginas divisórias de espontânea/estimulada/2º turno)',
    );
  }
  return scenarios;
};
