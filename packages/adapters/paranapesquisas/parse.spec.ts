/**
 * Specs do parser do Paraná Pesquisas contra a CAPTURA REAL (`__fixtures__/`).
 * Os números esperados abaixo foram LIDOS do release do instituto, não inventados:
 * cada um é conferível no PDF cuja URL está no README das fixtures.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ParseError } from '../poll-source-adapter.js';
import { PtBrNumberError } from '../parse-ptbr-number.js';
import { documentContainsTseId } from '../base/tse-id.js';
import { parseParanaPesquisasPdfText, splitPdfPages } from './parse.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const FEV = fixture('nacional-fev2026-BR-07974.txt');
const MAR = fixture('nacional-mar2026-BR-00873.txt');
const FEV_ID = 'BR-07974/2026';
const MAR_ID = 'BR-00873/2026';
/** Rodada de JANEIRO. Existe no texto de fevereiro, em cabeçalho comparativo. */
const JAN_ID = 'BR-08254/2026';

describe('parseParanaPesquisasPdfText — fevereiro/2026 (BR-07974/2026, captura real)', () => {
  const scenarios = parseParanaPesquisasPdfText(FEV, FEV_ID);

  it('reparte o PDF em uma página por slide pela sentença de registro', () => {
    // 22 páginas no PDF original + o bloco de título que precede a 1ª sentença.
    expect(splitPdfPages(FEV)).toHaveLength(23);
  });

  it('extrai os 5 cenários publicados, na ordem do documento', () => {
    expect(scenarios.map((s) => `${s.kind}|${s.label}`)).toEqual([
      't1_espontaneo|ESPONTÂNEA',
      't1_estimulado|ESTIMULADA – Cenário 1',
      't1_estimulado|ESTIMULADA – Cenário 2',
      't2|COMPARATIVO – Lula x Flávio Bolsonaro',
      't2|COMPARATIVO – Lula x Ratinho Junior',
    ]);
  });

  it('1º turno ESPONTÂNEO: candidato por candidato, com brancos/nulos e não-sabe', () => {
    const espontaneo = scenarios[0];
    expect(espontaneo?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 26.0 },
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 14.8 },
      { candidateAlias: 'Jair Bolsonaro', valuePct: 5.8 },
      { candidateAlias: 'Tarcísio de Freitas', valuePct: 1.3 },
      { candidateAlias: 'Ratinho Junior', valuePct: 0.9 },
      { candidateAlias: 'Ciro Gomes', valuePct: 0.5 },
      { candidateAlias: 'Renan Santos', valuePct: 0.5 },
      { candidateAlias: 'Romeu Zema', valuePct: 0.3 },
      { candidateAlias: 'Ronaldo Caiado', valuePct: 0.3 },
    ]);
    expect(espontaneo?.blankNullPct).toBe(6.1); // 'Ninguém/ Branco/ Nulo'
    expect(espontaneo?.undecidedPct).toBe(42.6); // 'Não sabe/ não opinou'
  });

  it('1º turno ESTIMULADO Cenário 1 bate com o release', () => {
    const c1 = scenarios[1];
    expect(c1?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 39.6 },
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 35.3 },
      { candidateAlias: 'Ratinho Junior', valuePct: 7.6 },
      { candidateAlias: 'Romeu Zema', valuePct: 3.8 },
      { candidateAlias: 'Renan Santos', valuePct: 1.5 },
      { candidateAlias: 'Aldo Rebelo', valuePct: 0.5 },
    ]);
    expect(c1?.blankNullPct).toBe(6.7);
    expect(c1?.undecidedPct).toBe(5.0);
  });

  it('2º turno: os dois confrontos rotulados, com par e brancos/nulos', () => {
    const [primeiro, segundo] = scenarios.filter((s) => s.kind === 't2');
    expect(primeiro?.t2Pair).toEqual(['Flávio Bolsonaro', 'Lula']);
    expect(primeiro?.values).toEqual([
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 44.4 },
      { candidateAlias: 'Lula', valuePct: 43.8 },
    ]);
    expect(primeiro?.blankNullPct).toBe(6.9);
    expect(primeiro?.undecidedPct).toBe(5.0);

    expect(segundo?.t2Pair).toEqual(['Lula', 'Ratinho Junior']);
    expect(segundo?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 43.6 },
      { candidateAlias: 'Ratinho Junior', valuePct: 39.7 },
    ]);
  });

  it('todo cenário de 2º turno tem exatamente 2 candidatos (V3)', () => {
    for (const s of scenarios.filter((x) => x.kind === 't2')) {
      expect(s.values).toHaveLength(2);
      expect(s.t2Pair).toHaveLength(2);
    }
  });

  it('soma de cada cenário fica na faixa de V1 (97–103)', () => {
    for (const s of scenarios) {
      const total =
        s.values.reduce((acc, v) => acc + v.valuePct, 0) +
        (s.blankNullPct ?? 0) +
        (s.undecidedPct ?? 0);
      expect(total).toBeGreaterThanOrEqual(97);
      expect(total).toBeLessThanOrEqual(103);
    }
  });

  it('BORDA — "Outros nomes citados" não vira candidato nem vira zero', () => {
    // O release publica 1,0% em 'Outros nomes citados' na pergunta espontânea.
    // Não há campo para isso em ParsedPoll: fica FORA, e ninguém entra com 0.
    expect(FEV).toContain('Outros nomes citados');
    for (const s of scenarios) {
      expect(s.values.some((v) => /outros/i.test(v.candidateAlias))).toBe(false);
      expect(s.values.every((v) => v.valuePct > 0)).toBe(true);
    }
  });

  it('BORDA — cruzamento demográfico nunca entra como cenário', () => {
    // As páginas 10, 11, 13 e 14 abrem os cenários por sexo/idade/região.
    expect(FEV).toContain('Masculino');
    expect(FEV).toContain('Norte + Centro-Oeste');
    const aliases = scenarios.flatMap((s) => s.values.map((v) => v.candidateAlias));
    for (const segment of ['Masculino', 'Feminino', 'Nordeste', 'PEA', 'Total']) {
      expect(aliases).not.toContain(segment);
    }
    // e nenhum cenário tem mais candidatos do que o release mostra no gráfico
    expect(Math.max(...scenarios.map((s) => s.values.length))).toBe(9);
  });

  it('BORDA — candidato ausente do cenário estimulado não vira zero', () => {
    // Ciro Gomes só aparece na espontânea (0,5%); na comparativa de Cenário 1 a
    // coluna de fevereiro dele é '-'. Não pode entrar em nenhum estimulado.
    const espontaneo = scenarios.find((s) => s.kind === 't1_espontaneo');
    expect(espontaneo?.values.some((v) => v.candidateAlias === 'Ciro Gomes')).toBe(true);
    for (const s of scenarios.filter((x) => x.kind !== 't1_espontaneo')) {
      expect(s.values.some((v) => v.candidateAlias === 'Ciro Gomes')).toBe(false);
    }
  });
});

describe('parseParanaPesquisasPdfText — março/2026 (BR-00873/2026, captura real)', () => {
  const scenarios = parseParanaPesquisasPdfText(MAR, MAR_ID);

  it('extrai os 3 cenários publicados', () => {
    expect(scenarios.map((s) => `${s.kind}|${s.label}`)).toEqual([
      't1_espontaneo|ESPONTÂNEA',
      't1_estimulado|ESTIMULADA – Cenário 1',
      't2|COMPARATIVO – Cenário 2',
    ]);
  });

  it('ARMADILHA REAL — o 2º turno rebatizado de "Cenário 2" sai como t2, não t1', () => {
    // Em março o instituto chamou o confronto de 2º turno de "Cenário 2". Quem
    // classificasse pelo rótulo publicaria um 2º turno como 1º turno.
    const runoff = scenarios.find((s) => s.kind === 't2');
    expect(runoff?.label).toContain('Cenário 2');
    expect(runoff?.t2Pair).toEqual(['Flávio Bolsonaro', 'Lula']);
    expect(runoff?.values).toEqual([
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 45.2 },
      { candidateAlias: 'Lula', valuePct: 44.1 },
    ]);
    expect(runoff?.blankNullPct).toBe(6.2);
    expect(runoff?.undecidedPct).toBe(4.5);
  });

  it('1º turno estimulado de março bate com o release', () => {
    expect(scenarios[1]?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 41.3 },
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 37.8 },
      { candidateAlias: 'Ronaldo Caiado', valuePct: 3.6 },
      { candidateAlias: 'Romeu Zema', valuePct: 3.0 },
      { candidateAlias: 'Renan Santos', valuePct: 1.2 },
      { candidateAlias: 'Aldo Rebelo', valuePct: 1.1 },
    ]);
  });

  it('BORDA — coluna com traço é AUSÊNCIA, nunca zero', () => {
    // 'Tereza Cristina' aparece no documento SÓ com '-' na coluna de março (e em
    // todas as outras). Não pode entrar em cenário nenhum — nem com 0.
    expect(MAR).toContain('Tereza Cristina');
    const aliases = scenarios.flatMap((s) => s.values.map((v) => v.candidateAlias));
    expect(aliases).not.toContain('Tereza Cristina');
    expect(aliases).not.toContain('Ciro Gomes');
  });
});

describe('parseParanaPesquisasPdfText — recusas (R4: falha alta, nunca silenciosa)', () => {
  it('RECUSA o release de fevereiro para a rodada de JANEIRO — e V6 sozinho não recusaria', () => {
    // O texto de fevereiro CONTÉM 'BR-08254/2026' (cabeçalho de coluna
    // comparativa). V6 do BaseAdapter só exige presença do tse_id, então passaria:
    expect(documentContainsTseId(FEV, JAN_ID)).toBe(true);
    // ...e atribuiria os números de fevereiro a janeiro. O parser exige a
    // SENTENÇA DE REGISTRO e recusa.
    expect(() => parseParanaPesquisasPdfText(FEV, JAN_ID)).toThrow(ParseError);
    expect(() => parseParanaPesquisasPdfText(FEV, JAN_ID)).toThrow(/declara-se registrado sob/);
  });

  it('RECUSA quando o tse_id do registro não aparece em lugar nenhum', () => {
    expect(() => parseParanaPesquisasPdfText(FEV, 'BR-99999/2026')).toThrow(ParseError);
  });

  it('RECUSA documento sem a sentença de registro da Res.-TSE 23.600/2019', () => {
    const semSentenca = FEV.replace(/registrada no Tribunal/g, 'divulgada por');
    expect(() => parseParanaPesquisasPdfText(semSentenca, FEV_ID)).toThrow(
      /sem a sentença de registro/,
    );
  });

  it('LANÇA em valor ilegível — nunca cai para 0 (R4)', () => {
    // Corrompe UM percentual do gráfico de Cenário 1 ('39,6%' → '3,9,6%'). A linha
    // continua parecendo percentual, então o helper único é que reprova.
    const corrompido = FEV.replace('39,6%', '3,9,6%');
    expect(corrompido).not.toBe(FEV);
    expect(() => parseParanaPesquisasPdfText(corrompido, FEV_ID)).toThrow(PtBrNumberError);
  });

  it('LANÇA quando o bloco de rótulos não corresponde 1-para-1 ao de valores', () => {
    // Some com um rótulo do gráfico de Cenário 1: o bloco seguinte deixa de bater.
    const semRotulo = FEV.replace('\nAldo Rebelo\n', '\n');
    expect(semRotulo).not.toBe(FEV);
    expect(() => parseParanaPesquisasPdfText(semRotulo, FEV_ID)).toThrow(ParseError);
  });

  it('LANÇA quando o release não tem nenhum cenário de 1º turno', () => {
    // Só as páginas de capa/metodologia/perfil: sentença de registro presente,
    // nenhum resultado. Sucesso silencioso com zero cenário é o bug de Q-09.
    const soCapa = splitPdfPages(FEV)
      .slice(0, 6)
      .map((p) => p.join('\n'))
      .join('\n');
    expect(() => parseParanaPesquisasPdfText(soCapa, FEV_ID)).toThrow(/1º turno/);
  });

  it('LANÇA quando existe página de 2º turno mas nenhuma comparativa dela sobra', () => {
    // Mata os dois cabeçalhos comparativos de 2º turno de fevereiro; a página de
    // gráfico de 2º turno continua lá. A perda não pode passar em silêncio.
    const semComparativoT2 = FEV.replace(/COMPARATIVO – Lula x [^\n]*/g, 'Outra seção');
    expect(() => parseParanaPesquisasPdfText(semComparativoT2, FEV_ID)).toThrow(
      /página de 2º turno/,
    );
  });

  it('LANÇA quando a última coluna comparativa é de outra rodada', () => {
    // Inverte a ordem dos tse_id no cabeçalho da comparativa de 2º turno: a última
    // coluna deixaria de ser a rodada corrente.
    const invertido = FEV.replace(
      'Fev\n2026\nBR-07974/2026\nNão sabe/ Não opinou',
      'Fev\n2026\nBR-08254/2026\nNão sabe/ Não opinou',
    );
    expect(invertido).not.toBe(FEV);
    expect(() => parseParanaPesquisasPdfText(invertido, FEV_ID)).toThrow(/última coluna/);
  });
});
