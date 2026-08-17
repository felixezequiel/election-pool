import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { ParseError } from '../poll-source-adapter.js';
import { PtBrNumberError } from '../parse-ptbr-number.js';
import { documentContainsTseId } from '../base/tse-id.js';
import { parsePalverReportText } from './parse.js';
import {
  PALVER_TSE_ID,
  PALVER_PREAMBULO_LINES,
  PALVER_ONDA_LINES,
  PALVER_SEM_AGREGADOS_LINES,
  PALVER_T2_MULTI_PAIR_LINES,
  PALVER_NO_SECTION_LINES,
} from './__fixtures__/make-pdf.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

/** Camada de texto REAL do relatório publicado (`BR-06596/2026`, 2026-08-10). */
const RELATORIO_REAL = fixture('relatorio-onda-01.textlayer.txt');
/** Camada de texto REAL do press release da mesma onda. */
const PRESS_RELEASE_REAL = fixture('press-release-onda-01.textlayer.txt');

const asText = (lines: readonly string[]): string => lines.join('\n');

describe('captura REAL da Palver (o que a fonte publica hoje)', () => {
  // Este bloco é a asserção que faltou em T-05 (Q-09): ele fala sobre a FONTE, não
  // sobre uma fixture inventada com o formato que o parser espera.

  it('o registro TSE está na camada de texto dos DOIS documentos (V6 viável)', () => {
    // No relatório o PDF devolve `BR -06596/2026`, COM espaço depois do `BR`; no
    // press release, sem espaço. As duas grafias têm de confirmar.
    expect(RELATORIO_REAL).toContain('BR -06596/2026');
    expect(PRESS_RELEASE_REAL).toContain('BR-06596/2026');
    expect(documentContainsTseId(RELATORIO_REAL, PALVER_TSE_ID)).toBe(true);
    expect(documentContainsTseId(PRESS_RELEASE_REAL, PALVER_TSE_ID)).toBe(true);
  });

  it('recusa a rodada errada mesmo com o documento real em mãos (V6)', () => {
    expect(documentContainsTseId(RELATORIO_REAL, 'BR-06597/2026')).toBe(false);
    expect(documentContainsTseId(RELATORIO_REAL, 'BR-6596/2026')).toBe(false);
  });

  it('o relatório real DECLARA as três seções de voto', () => {
    expect(RELATORIO_REAL).toContain('1º Turno (Espontânea)A');
    expect(RELATORIO_REAL).toContain('1º Turno (Estimulada)B');
    expect(RELATORIO_REAL).toContain('2º Turno (Estimulada)C');
  });

  it('LANÇA no relatório real: as páginas de resultado são gráficos rasterizados', () => {
    // O bloqueio de verdade desta fonte, provado contra a fonte. Falha alta (R4):
    // seção declarada e ilegível nunca vira cenário vazio nem é descartada calada.
    let erro: unknown;
    try {
      parsePalverReportText(RELATORIO_REAL);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ParseError);
    expect((erro as ParseError).message).toContain('RASTERIZADOS');
    expect((erro as ParseError).message).toContain('1º Turno (Espontânea)');
  });

  it('o press release real não traz seção de voto alguma (só registro e metodologia)', () => {
    expect(() => parsePalverReportText(PRESS_RELEASE_REAL)).toThrow(ParseError);
    expect(() => parsePalverReportText(PRESS_RELEASE_REAL)).toThrow(
      /Nenhuma seção de intenção de voto/,
    );
  });
});

describe('parsePalverReportText sobre estrutura SINTÉTICA (ver __fixtures__/README §4)', () => {
  it('extrai os três cenários com kind, rótulo e agregados', () => {
    const scenarios = parsePalverReportText(asText(PALVER_ONDA_LINES));
    expect(scenarios.map((s) => s.kind)).toEqual(['t1_espontaneo', 't1_estimulado', 't2']);
    expect(scenarios.map((s) => s.label)).toEqual([
      '1º Turno (Espontânea)',
      '1º Turno (Estimulada)',
      '2º Turno (Estimulada)',
    ]);

    const [espontaneo, estimulado, t2] = scenarios;
    expect(espontaneo?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 31 },
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 27 },
    ]);
    expect(espontaneo?.blankNullPct).toBe(9);
    expect(espontaneo?.undecidedPct).toBe(33);

    expect(estimulado?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 44 },
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 40 },
      { candidateAlias: 'Ciro Gomes', valuePct: 5 },
    ]);
    expect(t2?.t2Pair).toEqual(['Lula', 'Flávio Bolsonaro']);
  });

  it('candidato ausente do 2º turno NÃO vira zero (Ciro só no 1º)', () => {
    const scenarios = parsePalverReportText(asText(PALVER_ONDA_LINES));
    const t2 = scenarios.find((s) => s.kind === 't2');
    expect(t2?.values).toHaveLength(2);
    expect(t2?.values.some((v) => v.candidateAlias === 'Ciro Gomes')).toBe(false);
  });

  it('percentuais de REJEIÇÃO ficam fora do agregado (a divisória fecha o cenário)', () => {
    // Armadilha 4 do README: rejeição também é percentual por candidato. Se
    // vazasse, viraria intenção de voto — o pior erro possível nesta fonte.
    const scenarios = parsePalverReportText(asText(PALVER_ONDA_LINES));
    expect(scenarios).toHaveLength(3);
    const todos = scenarios.flatMap((s) => s.values.map((v) => v.valuePct));
    expect(todos).not.toContain(52); // 'Lula 52,0' está na seção de rejeição
    expect(todos).not.toContain(48);
    expect(todos).not.toContain(39);
  });

  it('o sumário e as tabelas de metodologia não produzem cenário nem valor', () => {
    // O sumário grafa `B 1º Turno (Estimulada)` (letra ANTES) e a página de amostra
    // tem `5.000 BR -06596/2026 4,31 95%`, em formato de linha de valor. Nenhum dos
    // dois pode virar dado. Aqui só o preâmbulo é parseado.
    expect(() => parsePalverReportText(asText(PALVER_PREAMBULO_LINES))).toThrow(
      /Nenhuma seção de intenção de voto/,
    );
  });

  it('branco/nulo e não-sabe ausentes viram undefined, nunca zero', () => {
    const scenarios = parsePalverReportText(asText(PALVER_SEM_AGREGADOS_LINES));
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0]?.blankNullPct).toBeUndefined();
    expect(scenarios[0]?.undecidedPct).toBeUndefined();
    expect(scenarios[0]?.values).toHaveLength(2);
  });

  it('LANÇA quando a seção de 2º turno tem mais de um pareamento', () => {
    expect(() => parsePalverReportText(asText(PALVER_T2_MULTI_PAIR_LINES))).toThrow(ParseError);
    expect(() => parsePalverReportText(asText(PALVER_T2_MULTI_PAIR_LINES))).toThrow(
      /vários pareamentos na mesma seção/,
    );
  });

  it('LANÇA quando nenhuma seção de intenção de voto é declarada', () => {
    expect(() => parsePalverReportText(asText(PALVER_NO_SECTION_LINES))).toThrow(
      /Nenhuma seção de intenção de voto/,
    );
  });

  it('LANÇA em percentual fora da faixa 0–100 (R4: nunca clampa, nunca vira 0)', () => {
    const acima = [
      'REGISTRO NO TSE:',
      'BR -06596/2026',
      '1º Turno (Estimulada)B',
      'RESULTADOS',
      '22',
      'Lula 999',
    ];
    const negativo = [...acima.slice(0, 5), 'Lula -5'];
    expect(() => parsePalverReportText(asText(acima))).toThrow(PtBrNumberError);
    expect(() => parsePalverReportText(asText(negativo))).toThrow(PtBrNumberError);
  });
});
