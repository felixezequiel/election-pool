/**
 * Parser do REAL TIME BIG DATA sobre as fixtures REAIS (`__fixtures__/*.layout.txt`,
 * congeladas do site do instituto em 2026-08-17).
 *
 * O teste central desta suíte é o do 2º turno: as três rodadas capturadas têm o
 * MESMO layout de confronto e resultados em direções diferentes (em Mato Grosso e
 * Mato Grosso do Sul o finalista da DIREITA lidera; na Bahia lidera o da
 * ESQUERDA). Um parser que lesse a ordem de fluxo do PDF trocaria os dois
 * candidatos em todas as três, e o sinal do erro mudaria de documento para
 * documento — nada que a soma ou as validações V1–V7 pegariam. É o motivo de
 * `pdf-layout.ts` existir.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { SCENARIO_KIND } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { PtBrNumberError } from '../parse-ptbr-number.js';
import { PDF_PAGE_SEPARATOR } from './constants.js';
import { parseRealTimeLayoutText } from './parse.js';
import type { RawScenario } from '../base/base-adapter.js';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8');

const MATO_GROSSO = fixture('02-mato-grosso-BR-06833-2026.layout.txt');
const BAHIA = fixture('03-bahia-BR-05205-2026.layout.txt');
const MATO_GROSSO_DO_SUL = fixture('04-mato-grosso-do-sul-BR-01784-2026.layout.txt');

const byKind = (scenarios: readonly RawScenario[], kind: string): RawScenario => {
  const found = scenarios.find((scenario) => scenario.kind === kind);
  if (found === undefined) throw new Error(`cenário ${kind} ausente`);
  return found;
};

const asPairs = (scenario: RawScenario): Array<[string, number]> =>
  scenario.values.map((value) => [value.candidateAlias, value.valuePct]);

describe('parseRealTimeLayoutText — rodada real de Mato Grosso (BR-06833/2026)', () => {
  const scenarios = parseRealTimeLayoutText(MATO_GROSSO);

  it('extrai exatamente os três cenários de VOTO e ignora rejeição e aprovação', () => {
    expect(scenarios.map((scenario) => scenario.kind)).toEqual([
      SCENARIO_KIND.t1Espontaneo,
      SCENARIO_KIND.t1Estimulado,
      SCENARIO_KIND.t2,
    ]);
  });

  it('extrai o 1º turno espontâneo com os valores publicados', () => {
    const espontaneo = byKind(scenarios, SCENARIO_KIND.t1Espontaneo);
    expect(espontaneo.label).toBe('ESPONTÂNEA PRESIDENTE');
    expect(asPairs(espontaneo)).toEqual([
      ['Lula', 22],
      ['Flávio Bolsonaro', 22],
      ['Renan Santos', 3],
      ['Ronaldo Caiado', 1],
      ['Jair Bolsonaro', 1],
      ['Outros', 2],
    ]);
    expect(espontaneo.blankNullPct).toBe(12);
    expect(espontaneo.undecidedPct).toBe(37);
  });

  it('extrai o 1º turno estimulado com o candidato por linha, sem recorte demográfico', () => {
    const estimulado = byKind(scenarios, SCENARIO_KIND.t1Estimulado);
    expect(estimulado.label).toBe('ESTIMULADA PRESIDENTE');
    expect(asPairs(estimulado)).toEqual([
      ['Flávio Bolsonaro (PL)', 43],
      ['Lula (PT)', 33],
      ['Renan Santos (Missão)', 8],
      ['Ronaldo Caiado (PSD)', 6],
      ['Romeu Zema (Novo)', 1],
      ['Escritor Augusto Cury (Avante)', 1],
      ['Outros', 1],
    ]);
    expect(estimulado.blankNullPct).toBe(4);
    expect(estimulado.undecidedPct).toBe(3);
  });

  it('extrai o 2º turno com o par na ORDEM DA PÁGINA e o valor de cada um', () => {
    const t2 = byKind(scenarios, SCENARIO_KIND.t2);
    expect(t2.label).toBe('CENÁRIO 01');
    expect(t2.t2Pair).toEqual(['LULA (PT)', 'FLÁVIO BOLSONARO (PL)']);
    // O documento tem 37% do lado do Lula (x=511) e 51% do lado do Flávio
    // (x=745), mas o FLUXO do PDF emite 51% primeiro. Ler o fluxo daria
    // Lula 51% — o "pior bug do sistema" sem nenhum sintoma.
    expect(asPairs(t2)).toEqual([
      ['LULA (PT)', 37],
      ['FLÁVIO BOLSONARO (PL)', 51],
    ]);
    expect(t2.blankNullPct).toBe(6);
    expect(t2.undecidedPct).toBe(6);
  });

  it('não injeta zero para candidato ausente de um cenário (ausência ≠ zero)', () => {
    // 'Jair Bolsonaro' só existe na espontânea (pergunta aberta); 'Romeu Zema
    // (Novo)' só na estimulada. Nenhum dos dois aparece com 0 no outro cenário.
    const espontaneoAliases = byKind(scenarios, SCENARIO_KIND.t1Espontaneo).values.map(
      (value) => value.candidateAlias,
    );
    const estimuladoAliases = byKind(scenarios, SCENARIO_KIND.t1Estimulado).values.map(
      (value) => value.candidateAlias,
    );
    expect(espontaneoAliases).toContain('Jair Bolsonaro');
    expect(estimuladoAliases).not.toContain('Jair Bolsonaro');
    expect(estimuladoAliases).toContain('Romeu Zema (Novo)');
    expect(espontaneoAliases).not.toContain('Romeu Zema (Novo)');
    for (const scenario of scenarios) {
      expect(scenario.values.every((value) => value.valuePct > 0)).toBe(true);
    }
  });

  it('ignora a prosa do enunciado e a nota de rodapé grudadas no gráfico', () => {
    // O layout real interleava a nota ("OS CANDIDATOS ... SOMADOS, ATINGIRAM 1%.")
    // com as barras do estimulado. Nenhum pedaço dela virou candidato.
    const aliases = byKind(scenarios, SCENARIO_KIND.t1Estimulado).values.map(
      (value) => value.candidateAlias,
    );
    expect(aliases.some((alias) => alias.includes('ATINGIRAM'))).toBe(false);
    expect(aliases.some((alias) => alias.includes('CANDIDATOS'))).toBe(false);
  });
});

describe('parseRealTimeLayoutText — a mesma estrutura com resultado invertido', () => {
  it('Bahia (BR-05205/2026): o finalista da ESQUERDA lidera', () => {
    const t2 = byKind(parseRealTimeLayoutText(BAHIA), SCENARIO_KIND.t2);
    expect(asPairs(t2)).toEqual([
      ['LULA (PT)', 59],
      ['FLÁVIO BOLSONARO (PL)', 30],
    ]);
  });

  it('Mato Grosso do Sul (BR-01784/2026): o finalista da DIREITA lidera', () => {
    const t2 = byKind(parseRealTimeLayoutText(MATO_GROSSO_DO_SUL), SCENARIO_KIND.t2);
    expect(asPairs(t2)).toEqual([
      ['LULA (PT)', 38],
      ['FLÁVIO BOLSONARO (PL)', 50],
    ]);
  });

  it('o 2º turno concorda com o 1º turno estimulado em quem lidera, nas três rodadas', () => {
    // Coerência interna, sem nenhuma referência a candidato: quem tem o maior
    // valor no estimulado tem o maior valor no confronto. Se o pareamento
    // posicional estivesse trocado, esta relação quebraria em pelo menos uma das
    // rodadas — é o que torna o teste sensível ao bug e cego a política (R2).
    for (const text of [MATO_GROSSO, BAHIA, MATO_GROSSO_DO_SUL]) {
      const scenarios = parseRealTimeLayoutText(text);
      const estimulado = byKind(scenarios, SCENARIO_KIND.t1Estimulado);
      const t2 = byKind(scenarios, SCENARIO_KIND.t2);
      const leaderOf = (scenario: RawScenario): string => {
        const sorted = [...scenario.values].sort((a, b) => b.valuePct - a.valuePct);
        const top = sorted[0];
        if (top === undefined) throw new Error('cenário sem valores');
        // Compara pela pessoa, não pela grafia: caixa e partido variam por gráfico.
        return top.candidateAlias.toLowerCase().replace(/\s*\(.*\)$/, '');
      };
      expect(leaderOf(t2)).toBe(leaderOf(estimulado));
    }
  });
});

describe('parseRealTimeLayoutText — anomalia REAL preservada, não corrigida', () => {
  it('Mato Grosso do Sul: a espontânea publicada soma 110 e sai como está', () => {
    // Medição, não suposição: as 8 barras da espontânea de BR-01784/2026 somam
    // 110 p.p. no gráfico do instituto (conferido nas coordenadas do PDF, cada
    // rótulo com o valor da sua própria barra). O parser NÃO ajusta nem descarta:
    // quem bloqueia é a validação V1 (97 ≤ soma ≤ 103, docs/04 §5), com evento de
    // erro. Ajustar aqui seria exatamente o que R1/R4 proíbem.
    const espontaneo = byKind(
      parseRealTimeLayoutText(MATO_GROSSO_DO_SUL),
      SCENARIO_KIND.t1Espontaneo,
    );
    const total =
      espontaneo.values.reduce((sum, value) => sum + value.valuePct, 0) +
      (espontaneo.blankNullPct ?? 0) +
      (espontaneo.undecidedPct ?? 0);
    expect(total).toBe(110);
  });
});

describe('parseRealTimeLayoutText — falha alta (R4)', () => {
  it('lança quando não há nenhuma página divisória de cenário de voto', () => {
    const onlyCover = MATO_GROSSO.split(PDF_PAGE_SEPARATOR).slice(0, 3).join(PDF_PAGE_SEPARATOR);
    expect(() => parseRealTimeLayoutText(onlyCover)).toThrow(ParseError);
  });

  it('lança quando a divisória existe e a página do gráfico não tem barras', () => {
    const pages = MATO_GROSSO.split(PDF_PAGE_SEPARATOR);
    pages[4] = 'EM OUTUBRO TEREMOS ELEIÇÕES, SE A ELEIÇÃO PARA PRESIDENTE FOSSE HOJE';
    expect(() => parseRealTimeLayoutText(pages.join(PDF_PAGE_SEPARATOR))).toThrow(
      /sem nenhuma barra de candidato/,
    );
  });

  it('lança quando a divisória de 2º turno não é seguida por um confronto', () => {
    const pages = MATO_GROSSO.split(PDF_PAGE_SEPARATOR);
    pages[11] = 'LULA (PT)\nFLÁVIO BOLSONARO (PL)\n37%\n51%';
    expect(() => parseRealTimeLayoutText(pages.join(PDF_PAGE_SEPARATOR))).toThrow(
      /sem nenhuma página de confronto/,
    );
  });

  it('lança quando o confronto tem três nomes para dois percentuais (V3)', () => {
    const pages = MATO_GROSSO.split(PDF_PAGE_SEPARATOR);
    pages[11] = 'CENÁRIO 01\nLULA (PT)\nFLÁVIO BOLSONARO (PL)\nRENAN SANTOS\n37%\n51%';
    expect(() => parseRealTimeLayoutText(pages.join(PDF_PAGE_SEPARATOR))).toThrow(
      /esperado exatamente 2 e 2/,
    );
  });

  it('lança quando um percentual é ilegível — nunca vira 0 nem é ignorado', () => {
    const pages = MATO_GROSSO.split(PDF_PAGE_SEPARATOR);
    // 250% casa o formato de linha de valor mas não é um percentual válido.
    pages[6] = (pages[6] ?? '').replace('Lula (PT) 33%', 'Lula (PT) 250%');
    expect(() => parseRealTimeLayoutText(pages.join(PDF_PAGE_SEPARATOR))).toThrow(PtBrNumberError);
  });

  it('lança quando o confronto traz uma linha rotulada que não é branco/nulo nem não-sabe', () => {
    const pages = MATO_GROSSO.split(PDF_PAGE_SEPARATOR);
    pages[11] = 'CENÁRIO 01\nLULA (PT)\nFLÁVIO BOLSONARO (PL)\n37%\n51%\nRENAN SANTOS: 8%';
    expect(() => parseRealTimeLayoutText(pages.join(PDF_PAGE_SEPARATOR))).toThrow(
      /linha rotulada inesperada/,
    );
  });
});
