/**
 * Specs do parser do PoderData contra as CAPTURAS REAIS das 4 rodadas de 2026
 * (`__fixtures__/*.txt`, ver o README de lá). Nenhuma estrutura inventada: o que
 * está aqui é o que o relatório do instituto de fato imprime.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ParseError } from '../poll-source-adapter.js';
import { PtBrNumberError } from '../parse-ptbr-number.js';
import { parsePoderDataReport } from './parse.js';
import { SECTION_TITLE_T1, SECTION_TITLE_T2 } from './constants.js';

const FIXTURES = join(import.meta.dirname, '__fixtures__');
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** As 4 rodadas reais, com o fim de campo declarado na capa de cada relatório. */
const ROUNDS = {
  mai: { file: 'BR-04882-2026-28mai2026.txt', tseId: 'BR-04882/2026', fieldEnd: '2026-05-28' },
  jun: { file: 'BR-05722-2026-24jun2026.txt', tseId: 'BR-05722/2026', fieldEnd: '2026-06-24' },
  jul15: { file: 'BR-00059-2026-15jul2026.txt', tseId: 'BR-00059/2026', fieldEnd: '2026-07-15' },
  jul29: { file: 'BR-07845-2026-29jul2026.txt', tseId: 'BR-07845/2026', fieldEnd: '2026-07-29' },
} as const;

const parseRound = (round: { file: string; fieldEnd: string }) =>
  parsePoderDataReport(read(round.file), round.fieldEnd);

const firstRoundOf = (scenarios: ReturnType<typeof parsePoderDataReport>) => {
  const scenario = scenarios.find((s) => s.kind === 't1_estimulado');
  if (scenario === undefined) throw new Error('cenário de 1º turno ausente');
  return scenario;
};

const valueOf = (scenario: ReturnType<typeof firstRoundOf>, alias: string): number | undefined =>
  scenario.values.find((v) => v.candidateAlias === alias)?.valuePct;

describe('parsePoderDataReport — rodada BR-07845/2026 (campo 26–29/jul/2026)', () => {
  const scenarios = parseRound(ROUNDS.jul29);

  it('extrai o 1º turno estimulado da coluna Total dos cruzamentos', () => {
    const t1 = firstRoundOf(scenarios);
    expect(t1.label).toBe(SECTION_TITLE_T1);
    expect(t1.values).toEqual(
      expect.arrayContaining([
        { candidateAlias: 'Lula', valuePct: 41 },
        { candidateAlias: 'Flávio Bolsonaro', valuePct: 35 },
        { candidateAlias: 'Renan Santos', valuePct: 4 },
        { candidateAlias: 'Ronaldo Caiado', valuePct: 5 },
        { candidateAlias: 'Romeu Zema', valuePct: 3 },
        { candidateAlias: 'Augusto Cury', valuePct: 3 },
      ]),
    );
    expect(t1.values).toHaveLength(6);
  });

  it('traz brancos/nulos e não sabe do 1º turno, porque são publicados', () => {
    const t1 = firstRoundOf(scenarios);
    expect(t1.blankNullPct).toBe(5);
    expect(t1.undecidedPct).toBe(4);
  });

  it('não inventa cenário espontâneo — o instituto não publica um', () => {
    expect(scenarios.some((s) => s.kind === 't1_espontaneo')).toBe(false);
  });

  it('extrai os quatro 2º turnos, cada um com par de 2 e rótulo único', () => {
    const runoffs = scenarios.filter((s) => s.kind === 't2');
    expect(runoffs).toHaveLength(4);
    for (const runoff of runoffs) {
      expect(runoff.t2Pair).toHaveLength(2);
      expect(runoff.values).toHaveLength(2);
      expect(runoff.label.startsWith(SECTION_TITLE_T2)).toBe(true);
    }
    expect(new Set(runoffs.map((s) => s.label)).size).toBe(4);
  });

  it('lê a ONDA CORRENTE (última coluna) do 2º turno Lula x Flávio, não a primeira', () => {
    // A tabela real da série é `Flávio Bolsonaro 42 43 43 43` / `Lula 46 46 45 46`:
    // a primeira coluna é a onda de maio. Ler a coluna errada é o bug que a
    // conferência contra `fieldEnd` existe para impedir.
    const runoff = scenarios.find((s) => s.t2Pair?.includes('Flávio Bolsonaro') === true);
    expect(runoff).toBeDefined();
    expect(runoff?.values).toEqual([
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 43 },
      { candidateAlias: 'Lula', valuePct: 46 },
    ]);
    expect(runoff?.blankNullPct).toBe(9);
    expect(runoff?.undecidedPct).toBe(2);
  });
});

describe('parsePoderDataReport — dialeto de gráfico de barras (3 rodadas reais)', () => {
  it('BR-04882/2026 (uma onda só): 1º turno + 4 cenários de 2º turno', () => {
    const scenarios = parseRound(ROUNDS.mai);
    const t1 = firstRoundOf(scenarios);
    expect(valueOf(t1, 'Lula')).toBe(40);
    expect(valueOf(t1, 'Flávio Bolsonaro')).toBe(35);
    // Joaquim Barbosa concorria em maio: o parser o extrai como alias cru (é o
    // resolver, no BaseAdapter, que decide se ele existe no seed).
    expect(valueOf(t1, 'Joaquim Barbosa')).toBe(3);
    expect(t1.blankNullPct).toBe(6);
    expect(t1.undecidedPct).toBe(3);
    // Maio traz CINCO pares de 2º turno (Flávio, Joaquim, Renan, Romeu, Ronaldo);
    // julho traz quatro. O número de cenários vem do documento, não de uma
    // suposição sobre "quantos pares o instituto costuma publicar".
    expect(scenarios.filter((s) => s.kind === 't2')).toHaveLength(5);
    expect(new Set(scenarios.map((s) => s.label)).size).toBe(6);
  });

  it('BR-05722/2026 (duas ondas): lê a segunda, não a primeira', () => {
    const scenarios = parseRound(ROUNDS.jun);
    const t1 = firstRoundOf(scenarios);
    // Em maio Flávio tinha 35; em junho, 36. Ler 35 aqui seria pegar a onda velha.
    expect(valueOf(t1, 'Flávio Bolsonaro')).toBe(36);
    expect(valueOf(t1, 'Joaquim Barbosa')).toBe(2);
    const runoff = scenarios.find((s) => s.t2Pair?.includes('Flávio Bolsonaro') === true);
    expect(runoff?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 46 },
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 43 },
    ]);
  });

  it('BR-00059/2026 (três ondas): lê a terceira', () => {
    const scenarios = parseRound(ROUNDS.jul15);
    const t1 = firstRoundOf(scenarios);
    expect(valueOf(t1, 'Lula')).toBe(40);
    expect(valueOf(t1, 'Flávio Bolsonaro')).toBe(34);
    expect(valueOf(t1, 'Renan Santos')).toBe(6);
    // Joaquim Barbosa saiu do cenário em julho: AUSENTE, não zero.
    expect(valueOf(t1, 'Joaquim Barbosa')).toBeUndefined();
  });
});

describe('recusas — R4: falha alta, nunca silenciosa', () => {
  it('recusa quando a última onda não é o fim de campo do registro', () => {
    // Mesmo documento, registro de outra rodada: a legenda final (`29-Jul`) não
    // casa com um fim de campo de junho.
    expect(() => parsePoderDataReport(read(ROUNDS.jul29.file), '2026-06-24')).toThrow(ParseError);
    expect(() => parsePoderDataReport(read(ROUNDS.jul29.file), '2026-06-24')).toThrow(
      /não corresponde ao fim de campo/,
    );
  });

  it('recusa quando os cruzamentos discordam entre si', () => {
    // Adultera UM cruzamento: o Total de Lula na página de Idade vai de 41% a 44%.
    const tampered = read(ROUNDS.jul29.file).replace(
      'Lula 33% 39% 41% 47% 41%',
      'Lula 33% 39% 41% 47% 44%',
    );
    expect(tampered).not.toBe(read(ROUNDS.jul29.file));
    expect(() => parsePoderDataReport(tampered, ROUNDS.jul29.fieldEnd)).toThrow(
      /Cruzamentos de 1º turno discordam no Total de "Lula"/,
    );
  });

  it('recusa quando o gráfico e os cruzamentos divergem acima da tolerância', () => {
    // Mexe só na tabela de série do gráfico (a última coluna de Lula: 41 → 47).
    const tampered = read(ROUNDS.jul29.file).replace('Lula 40 40 40 41', 'Lula 40 40 40 47');
    expect(tampered).not.toBe(read(ROUNDS.jul29.file));
    expect(() => parsePoderDataReport(tampered, ROUNDS.jul29.fieldEnd)).toThrow(
      /diferença acima da tolerância de arredondamento/,
    );
  });

  it('resolve por maioria a divergência REAL de 1 p.p. do relatório de junho', () => {
    // Caso real: em `BR-05722/2026`, seis cruzamentos trazem "Joaquim Barbosa 2%",
    // o sétimo ("Aprovação de Lula") traz "3%", e o rótulo do gráfico também traz
    // "3". Isso não pode derrubar a extração (é arredondamento declarado pelo
    // instituto) nem virar uma média inventada: publica-se o valor da maioria.
    const scenarios = parseRound(ROUNDS.jun);
    expect(valueOf(firstRoundOf(scenarios), 'Joaquim Barbosa')).toBe(2);
  });

  it('recusa quando os cruzamentos empatam, em vez de escolher um', () => {
    // Com os 7 cruzamentos reais e a tolerância de 1 p.p. o empate é ARITMETICAMENTE
    // impossível (7 é ímpar e só há dois valores possíveis), então este caso usa um
    // documento MÍNIMO montado com as âncoras reais e DOIS cruzamentos que
    // discordam 1 a 1. Aqui a estrutura é auxiliar; a estrutura real está coberta
    // pelas 4 capturas acima.
    const minimal = [
      'www.poder360.com.br/poderdata',
      SECTION_TITLE_T1,
      'Alfa 50% 50%',
      'Beta 40% 40%',
      'Branco/Nulo 6% 6%',
      'Não sabe 4% 4%',
      'Total 100% 100%',
      'www.poder360.com.br/poderdata',
      SECTION_TITLE_T1,
      'Alfa 51% 51%',
      'Beta 40% 40%',
      'Branco/Nulo 6% 6%',
      'Não sabe 4% 4%',
      'Total 100% 100%',
    ].join('\n');
    expect(() => parsePoderDataReport(minimal, '2026-07-29')).toThrow(/empatam no Total de "Alfa"/);
  });

  it('LANÇA quando um valor está fora da escala 0–100, em vez de aceitar', () => {
    const tampered = read(ROUNDS.jul29.file).replace('Lula 38% 43% 41%', 'Lula 38% 43% 999%');
    expect(tampered).not.toBe(read(ROUNDS.jul29.file));
    expect(() => parsePoderDataReport(tampered, ROUNDS.jul29.fieldEnd)).toThrow(PtBrNumberError);
  });

  it('valor corrompido não vira zero: a linha não é engolida em silêncio', () => {
    // `--%` não é número; a linha deixa de ser linha de cruzamento. O resultado
    // NÃO pode ser "Lula com 0" nem "Lula ausente e o resto publicado": tem de
    // LANÇAR, porque a página passa a discordar das outras seis.
    const tampered = read(ROUNDS.jul29.file).replace('Lula 38% 43% 41%', 'Lula 38% 43% --%');
    expect(tampered).not.toBe(read(ROUNDS.jul29.file));
    expect(() => parsePoderDataReport(tampered, ROUNDS.jul29.fieldEnd)).toThrow(ParseError);
    expect(() => parsePoderDataReport(tampered, ROUNDS.jul29.fieldEnd)).toThrow(
      /discordam no número de rótulos/,
    );
  });

  it('recusa documento sem a seção de 1º turno', () => {
    const withoutFirstRound = read(ROUNDS.jul29.file).replaceAll(SECTION_TITLE_T1, 'Outra seção');
    expect(() => parsePoderDataReport(withoutFirstRound, ROUNDS.jul29.fieldEnd)).toThrow(
      /Nenhum cruzamento/,
    );
  });

  it('recusa texto que não é o relatório (sem o rodapé que delimita a página)', () => {
    expect(() => parsePoderDataReport('Lula 41%\nFlávio Bolsonaro 35%\n', '2026-07-29')).toThrow(
      /Nenhuma página delimitada/,
    );
  });

  it('recusa 2º turno com número de candidatos diferente de 2', () => {
    // Injeta um terceiro candidato na tabela de série de um 2º turno real.
    const tampered = read(ROUNDS.jul29.file).replace(
      'Lula 46 46 45 46\nBranco/Nulo 9 8 9 9',
      'Lula 46 46 45 46\nRenan Santos 1 1 1 1\nBranco/Nulo 9 8 9 9',
    );
    expect(tampered).not.toBe(read(ROUNDS.jul29.file));
    expect(() => parsePoderDataReport(tampered, ROUNDS.jul29.fieldEnd)).toThrow(
      /o par tem de ser exatamente 2/,
    );
  });
});

describe('bordas', () => {
  it('ignora seções que não são intenção de voto, ainda que cheias de percentuais', () => {
    // O relatório real tem `Perfil da amostra`, `2ª alternativa – eleitores de
    // Lula`, `Motivo de voto`, `Potencial de voto`, `Avaliação`, `Aprovação` e um
    // tema do mês. Nenhuma delas pode virar cenário.
    const scenarios = parseRound(ROUNDS.jul29);
    expect(scenarios.map((s) => s.kind)).toEqual(['t1_estimulado', 't2', 't2', 't2', 't2']);
  });

  it('ignora prosa inserida no meio do documento', () => {
    const noisy = read(ROUNDS.jul29.file).replace(
      `${SECTION_TITLE_T1}\n`,
      `${SECTION_TITLE_T1}\nUma linha de texto nossa, sem numero no fim\nOutra linha qualquer\n`,
    );
    const scenarios = parsePoderDataReport(noisy, ROUNDS.jul29.fieldEnd);
    expect(valueOf(firstRoundOf(scenarios), 'Lula')).toBe(41);
  });

  it('é determinístico: reparse do mesmo texto dá o mesmo resultado', () => {
    expect(parseRound(ROUNDS.jul29)).toEqual(parseRound(ROUNDS.jul29));
  });
});
