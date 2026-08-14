import { describe, it, expect } from 'vitest';
import { applyLine, categorizeLine } from './scenario-lines.js';
import type { ScenarioAccumulator } from './scenario-lines.js';
import { PtBrNumberError } from '../parse-ptbr-number.js';

describe('categorização de linhas de cenário', () => {
  it('classifica candidato com número pt-BR (38,8 -> 38.8) pelo helper único', () => {
    expect(categorizeLine('Lula', '38,8')).toEqual({
      kind: 'candidate',
      alias: 'Lula',
      valuePct: 38.8,
    });
  });

  it('classifica brancos/nulos e indecisos por rótulo, tolerando acento/caixa', () => {
    expect(categorizeLine('Branco/Nulo', '12,0')).toEqual({ kind: 'blankNull', valuePct: 12 });
    expect(categorizeLine('Não sabe', '7,5')).toEqual({ kind: 'undecided', valuePct: 7.5 });
    expect(categorizeLine('NÃO RESPONDEU', '3,0')).toEqual({ kind: 'undecided', valuePct: 3 });
  });

  it('LANÇA (R4) em valor mal-formado, nunca vira zero', () => {
    expect(() => categorizeLine('Lula', '-')).toThrow(PtBrNumberError);
    expect(() => categorizeLine('Lula', 'N/A')).toThrow(PtBrNumberError);
  });

  it('acumula valores, brancos/nulos e indecisos separadamente', () => {
    const acc: ScenarioAccumulator = { values: [] };
    applyLine(acc, categorizeLine('Lula', '38,8'));
    applyLine(acc, categorizeLine('Branco/Nulo', '12,0'));
    applyLine(acc, categorizeLine('Não sabe', '7,5'));
    expect(acc.values).toEqual([{ candidateAlias: 'Lula', valuePct: 38.8 }]);
    expect(acc.blankNullPct).toBe(12);
    expect(acc.undecidedPct).toBe(7.5);
  });
});
