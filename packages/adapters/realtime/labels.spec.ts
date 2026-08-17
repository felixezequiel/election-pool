/**
 * Tabela de grafias desta fonte. O teste mais importante aqui é o último: ele
 * PROVA por que a tabela local existe, em vez de reusar `base/scenario-lines.ts`.
 */

import { describe, it, expect } from 'vitest';
import { categorizeLine } from '../base/scenario-lines.js';
import { PtBrNumberError } from '../parse-ptbr-number.js';
import { classifyRealTimeLine, normalizeLabel } from './labels.js';

describe('classifyRealTimeLine', () => {
  it('reconhece as grafias de branco/nulo desta fonte', () => {
    // `Nulo/Branco` nos gráficos de barra; `NULO/BRANCO:` no confronto.
    expect(classifyRealTimeLine('Nulo/Branco', '12')).toEqual({ kind: 'blankNull', valuePct: 12 });
    expect(classifyRealTimeLine('NULO/BRANCO:', '6')).toEqual({ kind: 'blankNull', valuePct: 6 });
  });

  it('reconhece as grafias de não-sabe/não-respondeu desta fonte', () => {
    // Três grafias no MESMO documento, uma por tipo de gráfico.
    expect(classifyRealTimeLine('NS/NR', '37')).toEqual({ kind: 'undecided', valuePct: 37 });
    expect(classifyRealTimeLine('NS / NR', '3')).toEqual({ kind: 'undecided', valuePct: 3 });
    expect(classifyRealTimeLine('NÃO SABE / NÃO RESPONDEU:', '6')).toEqual({
      kind: 'undecided',
      valuePct: 6,
    });
  });

  it('preserva a grafia do candidato como impressa, sem normalizar identidade', () => {
    expect(classifyRealTimeLine('Flávio Bolsonaro (PL)', '43')).toEqual({
      kind: 'candidate',
      alias: 'Flávio Bolsonaro (PL)',
      valuePct: 43,
    });
    expect(classifyRealTimeLine('LULA (PT)', '37')).toEqual({
      kind: 'candidate',
      alias: 'LULA (PT)',
      valuePct: 37,
    });
  });

  it('trata "Outros" como alias, não como categoria inventada', () => {
    // Não existe campo de agregado em `ParsedPoll`; descartar o número seria
    // perder dado publicado em silêncio (R4). Vira alias e a decisão é do
    // cadastro manual.
    expect(classifyRealTimeLine('Outros', '2')).toEqual({
      kind: 'candidate',
      alias: 'Outros',
      valuePct: 2,
    });
  });

  it('lança em valor ilegível e em percentual fora de 0–100 (R4)', () => {
    expect(() => classifyRealTimeLine('Lula', '-')).toThrow(PtBrNumberError);
    expect(() => classifyRealTimeLine('Lula', '')).toThrow(PtBrNumberError);
    expect(() => classifyRealTimeLine('Lula', '250')).toThrow(PtBrNumberError);
  });

  it('aceita o percentual com o % colado e com decimal pt-BR', () => {
    expect(classifyRealTimeLine('Lula', '22%').valuePct).toBe(22);
    expect(classifyRealTimeLine('Lula', '22,5%').valuePct).toBe(22.5);
  });

  it('normaliza acento, caixa, espaço em volta da barra e dois-pontos final', () => {
    expect(normalizeLabel('NÃO SABE / NÃO RESPONDEU:')).toBe('nao sabe/nao respondeu');
  });
});

describe('a tabela local e a de base/scenario-lines concordam', () => {
  /**
   * HISTÓRICO: quando este adapter foi escrito, `categorizeLine` de
   * `base/scenario-lines` NÃO conhecia `Nulo/Branco` (ordem invertida) nem
   * `NS / NR`, e classificava os dois como CANDIDATO — o que mandaria toda rodada
   * deste instituto para quarentena. `base/**` estava fora do escopo da task, daí
   * a tabela local.
   *
   * Depois disso, TRÊS institutos (Ipec, Paraná Pesquisas e este) esbarraram na
   * mesma lacuna em capturas reais, e as grafias foram promovidas para o
   * classificador comum, junto de uma normalização que colapsa o espaço em volta
   * da barra. Este teste passou a guardar a CONCORDÂNCIA entre os dois: se algum
   * dia divergirem, a tabela local está mascarando uma regressão no comum — ou o
   * comum passou a discordar de uma grafia que esta fonte imprime de fato.
   */
  it.each([
    ['Nulo/Branco', '12', 'blankNull'],
    ['NS / NR', '3', 'undecided'],
    ['NS/NR', '3', 'undecided'],
  ])('%s é %s tanto no comum quanto no local', (label, value, expected) => {
    expect(categorizeLine(label, value).kind).toBe(expected);
    expect(classifyRealTimeLine(label, value).kind).toBe(expected);
  });
});
