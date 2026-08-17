/**
 * Testes do parser da Quaest contra as CAPTURAS REAIS de `__fixtures__/`
 * (proveniência no README de lá). O que estes testes provam, e o que não
 * provam, está dito no README: fixture é foto; o teste ao vivo é
 * `quaest.live.spec.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PtBrNumberError } from '../parse-ptbr-number.js';
import { ParseError } from '../poll-source-adapter.js';
import { quaestArticleBlocks, quaestArticleText } from './article-body.js';
import { parseQuaestRoundText } from './parse.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const POST_AGOSTO = fixture('2026-08-05-post-rodada-nacional.html');
const POST_JULHO = fixture('2026-07-15-post-rodada-nacional.html');
const PDF_TEXTLAYER = fixture('2026-08-14-rodada-1-pdf-textlayer.txt');

describe('quaestArticleBlocks (estrutura real do post)', () => {
  it('isola o corpo do artigo e devolve um bloco por parágrafo', () => {
    const blocks = quaestArticleBlocks(POST_AGOSTO);
    expect(blocks.length).toBeGreaterThan(0);
    // O parágrafo de cenário e o de metodologia (com o registro TSE) estão lá.
    expect(blocks.some((b) => b.includes('cenário estimulado de primeiro turno'))).toBe(true);
    expect(blocks.some((b) => b.includes('BR-06591/2026'))).toBe(true);
    // Nada de menu/rodapé/cookies: o seletor do corpo do artigo já os exclui.
    expect(blocks.some((b) => b.includes('Solicite um orçamento'))).toBe(false);
  });

  it('LANÇA quando o contêiner do corpo do artigo não existe (estrutura mudou)', () => {
    expect(() => quaestArticleBlocks('<html><body><p>Lula 39%</p></body></html>')).toThrow(
      ParseError,
    );
  });
});

describe('parseQuaestRoundText — post real de 2026-08-05 (caminho feliz)', () => {
  const scenarios = parseQuaestRoundText(quaestArticleText(POST_AGOSTO));

  it('extrai o 1º turno estimulado com os valores publicados', () => {
    const t1 = scenarios.find((s) => s.kind === 't1_estimulado');
    expect(t1?.values).toEqual([
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 30 },
      { candidateAlias: 'Luiz Inácio Lula da Silva', valuePct: 39 },
      { candidateAlias: 'Ronaldo Caiado', valuePct: 4 },
      { candidateAlias: 'Renan Santos', valuePct: 4 },
      { candidateAlias: 'Romeu Zema', valuePct: 2 },
    ]);
    expect(t1?.blankNullPct).toBe(8);
    expect(t1?.undecidedPct).toBe(10);
  });

  it('não pega o número da rodada ANTERIOR na construção "de 28% em julho para 30% em agosto"', () => {
    const t1 = scenarios.find((s) => s.kind === 't1_estimulado');
    const flavio = t1?.values.find((v) => v.candidateAlias === 'Flávio Bolsonaro');
    // 28 é julho (rodada anterior); 30 é agosto (esta rodada). O V6 não pegaria
    // essa troca — o tse_id certo está no mesmo documento.
    expect(flavio?.valuePct).toBe(30);
    const lula = t1?.values.find((v) => v.candidateAlias === 'Luiz Inácio Lula da Silva');
    expect(lula?.valuePct).toBe(39); // "oscilou de 40% para 39%"
  });

  it('distribui um único percentual entre os dois nomes marcados com "cada"', () => {
    const t1 = scenarios.find((s) => s.kind === 't1_estimulado');
    // "Ronaldo Caiado e Renan Santos somam 4% das intenções de voto cada"
    expect(t1?.values.filter((v) => v.valuePct === 4).map((v) => v.candidateAlias)).toEqual([
      'Ronaldo Caiado',
      'Renan Santos',
    ]);
  });

  it('extrai o 2º turno com o par, brancos/nulos e indecisos', () => {
    const t2 = scenarios.find((s) => s.kind === 't2');
    expect(t2?.t2Pair).toEqual(['Flávio', 'Lula']);
    expect(t2?.values).toEqual([
      { candidateAlias: 'Flávio', valuePct: 39 },
      { candidateAlias: 'Lula', valuePct: 44 },
    ]);
    expect(t2?.blankNullPct).toBe(13);
    expect(t2?.undecidedPct).toBe(4);
  });

  it('ausência ≠ zero: o espontâneo não foi publicado nesta rodada e simplesmente não existe', () => {
    expect(scenarios.map((s) => s.kind)).toEqual(['t1_estimulado', 't2']);
    expect(scenarios.some((s) => s.kind === 't1_espontaneo')).toBe(false);
  });

  it('rótulos são NOSSOS e estáveis (não copiam prosa do instituto)', () => {
    expect(scenarios.map((s) => s.label)).toEqual(['1º turno estimulado', '2º turno']);
  });

  it('não confunde o parágrafo de SUBGRUPO que casa a mesma âncora de 2º turno', () => {
    const blocks = quaestArticleBlocks(POST_AGOSTO);
    const subgrupo = blocks.filter((b) => b.includes('direita não-bolsonarista'));
    expect(subgrupo.length).toBeGreaterThan(0); // o parágrafo está na captura
    const t2 = scenarios.find((s) => s.kind === 't2');
    // 81 / 95 / 29 são apoio por segmento; nenhum deles entra no cenário nacional.
    expect(t2?.values.map((v) => v.valuePct)).toEqual([39, 44]);
  });
});

describe('parseQuaestRoundText — post real de 2026-07-15 (recusa documentada)', () => {
  it('LANÇA: a redação mudou e a decomposição publicada é incompleta', () => {
    expect(() => parseQuaestRoundText(quaestArticleText(POST_JULHO))).toThrow(ParseError);
  });

  it('a mensagem diz QUAL cenário e POR QUE, para virar quarentena e não mistério', () => {
    let message = '';
    try {
      parseQuaestRoundText(quaestArticleText(POST_JULHO));
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('t1_estimulado');
    // "…frente a 28% de Flávio Bolsonaro": o nome vem DEPOIS do percentual.
    expect(message).toContain('sem dono identificável');
  });
});

describe('parseQuaestRoundText — camada de texto REAL do PDF de rodada', () => {
  it('LANÇA: o PDF é rasterizado, não há âncora de cenário nem percentual', () => {
    expect(() => parseQuaestRoundText(PDF_TEXTLAYER)).toThrow(ParseError);
    expect(() => parseQuaestRoundText(PDF_TEXTLAYER)).toThrow(/sem nenhuma âncora de cenário/);
  });

  it('a camada de texto não tem percentual nem número de registro (o que motiva a recusa)', () => {
    expect(PDF_TEXTLAYER).not.toMatch(/\d{1,3},\d/);
    expect(PDF_TEXTLAYER).not.toMatch(/BR[-\s]?\d{3,6}\/\d{4}/);
    // Tem os títulos das páginas — só isso.
    expect(PDF_TEXTLAYER).toContain('Intenção de voto para Presidente - 1º turno');
  });
});

describe('parseQuaestRoundText — bordas', () => {
  /** Mutação MÍNIMA da captura real, para exercitar uma borda sem inventar fonte. */
  const mutate = (from: string, to: string): string =>
    quaestArticleText(POST_AGOSTO).replace(from, to);

  it('valor fora da escala 0–100 LANÇA no helper único (R4), nunca é truncado', () => {
    const text = mutate('para 30% em agosto', 'para 300% em agosto');
    expect(() => parseQuaestRoundText(text)).toThrow(PtBrNumberError);
  });

  it('número ilegível LANÇA e, sobretudo, NÃO cai no valor da rodada anterior', () => {
    // "30%" → "3O%" (letra O). O valor de agosto some; sobra "28% em julho".
    // O parser recusa o cenário em vez de publicar 28 como se fosse desta rodada.
    const text = mutate('para 30% em agosto', 'para 3O% em agosto');
    expect(() => parseQuaestRoundText(text)).toThrow(ParseError);
    expect(() => parseQuaestRoundText(text)).not.toThrow(/30/);
  });

  it('percentual publicado sem dono identificável LANÇA em vez de ser descartado', () => {
    const text = mutate('Romeu Zema registra 2%', 'o restante do campo registra 2%');
    expect(() => parseQuaestRoundText(text)).toThrow(/sem dono identificável/);
  });

  it('decomposição que não fecha em [97,103] é RECUSADA (nunca publicada parcial)', () => {
    // Remove os indecisos (10 p.p.) do parágrafo: a soma cai para 87.
    const text = mutate('O contingente de eleitores indecisos se fixa em 10%, e', 'E');
    expect(() => parseQuaestRoundText(text)).toThrow(/fora de \[97, 103\]/);
  });

  it('nome composto por "e" sem o marcador "cada" é ambíguo e LANÇA', () => {
    const text = mutate(
      'somam 4% das intenções de voto cada',
      'somam 4% das intenções de voto juntos',
    );
    expect(() => parseQuaestRoundText(text)).toThrow(/sem marcador distributivo/);
  });

  it('2º turno com um candidato só é recusado (V3)', () => {
    const text = mutate(', e Lula oscila de 45% para 44%', '');
    expect(() => parseQuaestRoundText(text)).toThrow(ParseError);
  });

  it('texto sem nenhum bloco LANÇA em vez de devolver lista vazia', () => {
    expect(() => parseQuaestRoundText('   \n  \n')).toThrow(ParseError);
  });
});
