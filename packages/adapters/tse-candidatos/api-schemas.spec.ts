/**
 * Parse das capturas REAIS do DivulgaCandContas (ver `__fixtures__/README.md`).
 * Se o TSE mudar a estrutura, é aqui que aparece primeiro.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  eleicaoAtualSchema,
  listaCandidatosSchema,
  candidaturaDetalheSchema,
} from './api-schemas.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8')) as unknown;

describe('eleicao-atual (captura real 2026-08-16)', () => {
  it('extrai a eleição alvo e converte o sq_ELEICAO numérico em string', () => {
    const parsed = eleicaoAtualSchema.parse(fixture('eleicao-atual.json'));
    expect(parsed.eleicao.sq_ELEICAO).toBe('20322002026');
    expect(parsed.eleicao.nr_ANO_REFERENCIA).toBe(2026);
    expect(parsed.eleicao.tp_ABRANGENCIA).toBe('F');
  });

  it('rejeita resposta sem o bloco eleicao em vez de devolver vazio (R4)', () => {
    expect(() => eleicaoAtualSchema.parse({ ues: [] })).toThrow();
  });
});

describe('listagem de candidaturas a Presidente (captura real 2026-08-16)', () => {
  const parsed = listaCandidatosSchema.parse(fixture('candidatos-presidente-2026.json'));

  it('parseia as 13 candidaturas presidenciais nacionais', () => {
    expect(parsed.unidadeEleitoral.sigla).toBe('BR');
    expect(parsed.cargo.codigo).toBe(1);
    expect(parsed.cargo.nome).toBe('Presidente');
    expect(parsed.candidatos).toHaveLength(13);
  });

  it('traz nome de urna, nome completo, número e partido de cada candidatura', () => {
    const lula = parsed.candidatos.find((c) => c.nomeUrna === 'LULA');
    expect(lula).toBeDefined();
    expect(lula?.id).toBe('280002542548');
    expect(lula?.nomeCompleto).toBe('LUIZ INÁCIO LULA DA SILVA');
    expect(lula?.numero).toBe(13);
    expect(lula?.partido.sigla).toBe('PT');
  });

  it('documenta a armadilha: a LISTAGEM não traz foto utilizável', () => {
    // Regressão intencional. Se um dia o TSE passar a preencher a foto na
    // listagem, este teste falha e a gente REMOVE o GET de detalhe de propósito
    // — em vez de descobrir por acaso.
    for (const candidatura of parsed.candidatos) {
      const raw = candidatura as unknown as Record<string, unknown>;
      expect(raw['fotoUrl']).toBeNull();
      expect(raw['fotoUrlPublicavel']).toBe(false);
    }
  });
});

describe('detalhe de candidatura (captura real 2026-08-16)', () => {
  it('é a única resposta com fotoUrl e autorização de publicação', () => {
    const parsed = candidaturaDetalheSchema.parse(fixture('candidato-detalhe-280002542548.json'));
    expect(parsed.id).toBe('280002542548');
    expect(parsed.fotoUrlPublicavel).toBe(true);
    expect(parsed.fotoUrl).toBe(
      'https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/20322002026/280002542548/BR',
    );
  });

  it('aceita candidatura sem foto (campo ausente) sem inventar valor', () => {
    const parsed = candidaturaDetalheSchema.parse({
      id: 1,
      nomeUrna: 'FULANO',
      nomeCompleto: 'FULANO DE TAL',
      numero: 99,
      partido: { sigla: 'XPTO', numero: 99 },
    });
    expect(parsed.fotoUrl).toBeUndefined();
    expect(parsed.fotoUrlPublicavel).toBeUndefined();
  });

  it('rejeita detalhe sem nome em vez de aceitar string vazia', () => {
    expect(() =>
      candidaturaDetalheSchema.parse({
        id: 1,
        nomeUrna: '',
        nomeCompleto: 'FULANO DE TAL',
        numero: 99,
        partido: { sigla: 'XPTO', numero: 99 },
      }),
    ).toThrow();
  });
});
