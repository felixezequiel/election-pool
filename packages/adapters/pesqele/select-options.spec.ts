import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveOptionValue, PesqEleSelectError } from './select-options.js';
import { FIELD, ELEICAO_LABEL, ABRANGENCIA_LABEL } from './constants.js';

const listPage = readFileSync(
  fileURLToPath(new URL('./__fixtures__/01-listar30dias-page.html', import.meta.url)),
  'utf8',
);

describe('resolução do filtro por RÓTULO (nunca por id hardcoded)', () => {
  it('resolve "Eleições Gerais 2026" para o id que o TSE usa hoje', () => {
    // 81 na captura de 2026-08-16 — o teste prova que o número VEM da página,
    // não do código: mudou o pleito, muda o id, e nada aqui precisa mudar.
    expect(resolveOptionValue(listPage, FIELD.eleicaoSelect, ELEICAO_LABEL)).toBe('81');
  });

  it('resolve "BRASIL" para a UF de abrangência nacional', () => {
    expect(resolveOptionValue(listPage, FIELD.abrangenciaSelect, ABRANGENCIA_LABEL)).toBe('BR');
  });

  it('casa o rótulo ignorando acento e caixa', () => {
    expect(resolveOptionValue(listPage, FIELD.eleicaoSelect, 'eleicoes gerais 2026')).toBe('81');
  });

  it('LANÇA quando o rótulo da eleição não existe (não cai num id default)', () => {
    expect(() => resolveOptionValue(listPage, FIELD.eleicaoSelect, 'Eleições Gerais 2030')).toThrow(
      PesqEleSelectError,
    );
    expect(() => resolveOptionValue(listPage, FIELD.eleicaoSelect, 'Eleições Gerais 2030')).toThrow(
      /não existe/,
    );
  });

  it('a mensagem do erro lista as opções disponíveis (para o humano decidir)', () => {
    try {
      resolveOptionValue(listPage, FIELD.eleicaoSelect, 'Eleições Gerais 2030');
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      expect((err as Error).message).toContain('Eleições Gerais 2026');
    }
  });

  it('LANÇA quando o próprio <select> some da página', () => {
    expect(() => resolveOptionValue('<html></html>', FIELD.eleicaoSelect, ELEICAO_LABEL)).toThrow(
      /ausente/,
    );
  });
});
