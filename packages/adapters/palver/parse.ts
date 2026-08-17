/**
 * Parser do relatório da Palver (fonte de NÍVEL 2 de docs/04 §1: site do próprio
 * instituto). Escrito CONTRA UMA CAPTURA REAL, congelada em
 * `__fixtures__/relatorio-onda-01.textlayer.txt` — a ordem que a Q-09 manda
 * inverter. Tudo que este arquivo casa foi verificado no PDF de verdade
 * (`BR-06596/2026`, divulgado em 2026-08-10); nada aqui é estrutura suposta.
 *
 * ## O que a captura real mostra
 *
 * O relatório é um DECK de 93 páginas. A camada de texto do PDF contém apenas:
 *
 * - a moldura de página (banners em CAIXA ALTA e o número da página, em linhas
 *   próprias);
 * - as páginas de divisória de seção, no formato `<título><LETRA>` — a letra da
 *   seção fica COLADA no fim do título (`1º Turno (Estimulada)B`);
 * - o sumário, que repete os mesmos títulos com a letra ANTES (`B 1º Turno
 *   (Estimulada)`) — por isso a divisória se reconhece pela letra no FIM, nunca
 *   pelo título solto;
 * - o número de registro no TSE (`BR -06596/2026`, com espaço depois do `BR` —
 *   o `documentContainsTseId` do BaseAdapter tolera o separador);
 * - a prosa de metodologia (ignorada aqui e nunca armazenada — R3).
 *
 * **Os números dos resultados NÃO estão na camada de texto.** As páginas de
 * resultado são gráficos RASTERIZADOS: cada uma delas devolve só a moldura
 * (`RESULTADOS`, o número da página, o banner). Por isso este parser, rodado
 * contra o documento real de hoje, LANÇA — e é o comportamento certo (R4): seção
 * de voto declarada e ilegível é falha alta, nunca cenário vazio ou meio-montado.
 *
 * ## Armadilhas reais que a captura revelou (e que só ela revelaria)
 *
 * 1. `RESULTADOS` casaria como divisória de seção (`RESULTADO` + `S`) e fecharia
 *    todo cenário logo na primeira página de resultado. Daí o descarte de linhas
 *    inteiramente em CAIXA ALTA ANTES de procurar divisória: banner de moldura
 *    nunca é conteúdo. Divisória real sempre tem minúscula (`Turno`, `Rejeição`).
 * 2. A linha `5.000 BR -06596/2026 4,31 95%` (página "Amostra") casa o formato
 *    `<rótulo> <número>`. Ela está FORA de qualquer seção de voto, e por isso é
 *    ignorada: valor só é colhido com uma seção de voto aberta.
 * 3. Depois do 2º turno vêm as seções `Reconhecimento e Rejeição`, `Aprovação e
 *    Avaliação do Governo` etc. — que também são percentuais POR CANDIDATO. Se a
 *    divisória de seção não-voto não fechasse o cenário corrente, rejeição
 *    entraria no agregado como intenção de voto. É o erro mais grave possível
 *    aqui, e é o motivo de o parser rastrear TODA divisória, não só as de voto.
 *
 * ## O que este parser deliberadamente NÃO faz
 *
 * A seção `2º Turno (Estimulada)` do relatório real ocupa 12 páginas, ou seja
 * VÁRIOS pareamentos de 2º turno. Como a camada de texto não traz nenhum
 * delimitador entre eles, não há como saber onde um par termina e o outro começa.
 * Inventar esse delimitador seria exatamente o pecado da Q-09. Então a seção
 * rende UM cenário; se ele vier com número de candidatos diferente de 2, o parser
 * LANÇA dizendo que o delimitador de pareamento é desconhecido. Fica resolvido no
 * dia em que existir uma captura com camada de texto nos resultados.
 */

import { SCENARIO_KIND } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { applyLine, categorizeLine } from '../base/scenario-lines.js';
import type { ScenarioAccumulator } from '../base/scenario-lines.js';
import type { RawScenario } from '../base/base-adapter.js';

/**
 * Linha de valor: `<rótulo> <número pt-BR>`. Mesmo formato do relatório em PDF do
 * cnt-mda — a conversão do número em si é do helper único
 * (`parsePtBrPercent`, via `categorizeLine`), nunca reimplementada aqui.
 */
const VALUE_LINE = /^(.+?)\s+(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*%?$/;

/**
 * Divisória de seção: título com a letra da seção COLADA no fim
 * (`1º Turno (Estimulada)B`, `RejeiçãoD`). A letra tem de vir imediatamente após
 * um caractere não-espaço — `A 1º Turno (Espontânea)` (a linha do sumário) não
 * casa, e é justamente essa a diferença que impede o sumário de abrir cenário.
 */
const SECTION_DIVIDER = /^(.{2,60}?)(\S)([A-Z])$/u;

/**
 * `º` é o indicador ordinal (U+00BA) e não decompõe para `o` em NFD; por isso a
 * comparação de título aceita `º`, `°` ou `o`. Idem para o espaço extra que a
 * extração às vezes injeta dentro dos parênteses (`( Estimulada)` aparece assim
 * no sumário do relatório real).
 */
const T1_ESPONTANEA = /^1[º°o]?\s*turno\s*\(\s*espontanea\s*\)$/;
const T1_ESTIMULADA = /^1[º°o]?\s*turno\s*\(\s*estimulada\s*\)$/;
const T2_ESTIMULADA = /^2[º°o]?\s*turno\s*\(\s*estimulada\s*\)$/;

const normalize = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * `true` para linha de moldura de página: banner inteiramente em CAIXA ALTA
 * (`RESULTADOS`, `PESQUISA PALVER | AGOSTO/2026`, `METODOLOGIA`) ou número de
 * página solto. Descartada ANTES de qualquer outra regra — ver armadilha 1 no
 * cabeçalho. Um título de divisória real sempre tem letra minúscula.
 */
const isPageFurniture = (line: string): boolean => {
  if (/^\d{1,3}$/.test(line)) return true;
  return !/\p{Ll}/u.test(line) && /\p{L}/u.test(line);
};

/** Seção de voto reconhecida, ou `null` para seção que não é intenção de voto. */
const scenarioKindForTitle = (title: string): RawScenario['kind'] | null => {
  const n = normalize(title);
  if (T1_ESPONTANEA.test(n)) return SCENARIO_KIND.t1Espontaneo;
  if (T1_ESTIMULADA.test(n)) return SCENARIO_KIND.t1Estimulado;
  if (T2_ESTIMULADA.test(n)) return SCENARIO_KIND.t2;
  return null;
};

interface SectionDivider {
  /** Título da seção sem a letra colada, como a fonte grafa. */
  title: string;
}

const matchSectionDivider = (line: string): SectionDivider | null => {
  const m = SECTION_DIVIDER.exec(line);
  if (m === null) return null;
  const [, head, lastChar] = m;
  if (head === undefined || lastChar === undefined) return null;
  const title = `${head}${lastChar}`;
  // Título tem de conter letra minúscula: é o que separa divisória de banner.
  if (!/\p{Ll}/u.test(title)) return null;
  return { title };
};

interface Building {
  kind: RawScenario['kind'];
  label: string;
  acc: ScenarioAccumulator;
  /** Aliases na ordem de aparição — é a ordem do par de 2º turno. */
  candidateOrder: string[];
}

const finalize = (b: Building): RawScenario => {
  const base: RawScenario = {
    kind: b.kind,
    label: b.label,
    values: b.acc.values,
    ...(b.acc.blankNullPct === undefined ? {} : { blankNullPct: b.acc.blankNullPct }),
    ...(b.acc.undecidedPct === undefined ? {} : { undecidedPct: b.acc.undecidedPct }),
  };
  if (b.kind !== SCENARIO_KIND.t2) return base;

  if (b.candidateOrder.length !== 2) {
    // A seção de 2º turno do relatório real cobre VÁRIOS pareamentos e a camada de
    // texto não traz delimitador entre eles (ver cabeçalho). Recusar é o certo:
    // fatiar por conta própria seria inventar estrutura.
    throw new ParseError(
      `Seção de 2º turno "${b.label}" rendeu ${String(b.candidateOrder.length)} candidatos ` +
        `(V3 exige exatamente 2). A Palver publica vários pareamentos na mesma seção e a ` +
        `camada de texto do PDF não traz delimitador entre eles — recusando em vez de ` +
        `adivinhar onde um par termina.`,
    );
  }
  const [a, c] = b.candidateOrder;
  if (a === undefined || c === undefined) {
    throw new ParseError(`Seção de 2º turno "${b.label}" com par incompleto`);
  }
  return { ...base, t2Pair: [a, c] };
};

/**
 * Extrai os cenários do texto do relatório da Palver.
 *
 * LANÇA quando:
 * - nenhuma seção de intenção de voto é declarada (estrutura mudou);
 * - uma seção de voto é declarada mas não rende nenhum valor — o caso do
 *   documento real de hoje, cujos resultados são imagem. Descartar a seção em
 *   silêncio seria perda silenciosa de dado, que é o que o R4 proíbe.
 */
export const parsePalverReportText = (text: string): RawScenario[] => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const scenarios: RawScenario[] = [];
  /** Seções de voto declaradas, para diferenciar "estrutura mudou" de "sem texto". */
  const declaradas: string[] = [];
  let current: Building | null = null;

  /** Fecha o cenário corrente. Seção declarada sem nenhum valor LANÇA (R4). */
  const flush = (): void => {
    if (current === null) return;
    if (current.acc.values.length === 0) {
      throw new ParseError(
        `Seção "${current.label}" do relatório da Palver foi declarada mas não rendeu ` +
          `nenhum valor. No relatório publicado as páginas de resultado são gráficos ` +
          `RASTERIZADOS — a camada de texto do PDF só tem a moldura de página. Sem OCR ` +
          `(fora de escopo na v1) não há número a extrair. Recusando em vez de descartar ` +
          `a seção em silêncio (R4).`,
      );
    }
    scenarios.push(finalize(current));
    current = null;
  };

  for (const line of lines) {
    // Moldura de página primeiro: banner em caixa alta casaria como divisória.
    if (isPageFurniture(line)) continue;

    const divider = matchSectionDivider(line);
    if (divider !== null) {
      // TODA divisória fecha o cenário corrente — inclusive as de seção que NÃO é
      // intenção de voto (rejeição, aprovação). Ver armadilha 3 no cabeçalho.
      flush();
      const kind = scenarioKindForTitle(divider.title);
      if (kind !== null) {
        declaradas.push(divider.title);
        current = { kind, label: divider.title, acc: { values: [] }, candidateOrder: [] };
      }
      continue;
    }

    if (current === null) continue; // fora de seção de voto: nada é colhido

    const m = VALUE_LINE.exec(line);
    if (m === null) continue; // prosa/nota de rodapé sem número: ignorada
    const [, label, rawValue] = m;
    if (label === undefined || rawValue === undefined) continue;
    const categorized = categorizeLine(label, rawValue);
    if (categorized.kind === 'candidate') {
      current.candidateOrder.push(categorized.alias);
    }
    applyLine(current.acc, categorized);
  }
  flush();

  if (declaradas.length === 0) {
    throw new ParseError(
      'Nenhuma seção de intenção de voto ("1º/2º Turno (Espontânea|Estimulada)") no texto ' +
        'do relatório da Palver. A estrutura da fonte mudou, ou o documento não é o ' +
        'relatório da rodada.',
    );
  }
  return scenarios;
};
