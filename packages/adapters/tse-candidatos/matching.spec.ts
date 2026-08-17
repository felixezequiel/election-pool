/**
 * Casamento determinístico, exercitado contra a LISTA REAL de candidaturas
 * presidenciais de 2026 e contra o seed real de `candidates`/`candidate_aliases`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { listaCandidatosSchema } from './api-schemas.js';
import type { CandidaturaLista } from './api-schemas.js';
import { casarCandidaturas, normalizeNome } from './matching.js';
import type { CandidatoLocal } from './matching.js';

const candidaturasReais: CandidaturaLista[] = listaCandidatosSchema.parse(
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, '__fixtures__', 'candidatos-presidente-2026.json'),
      'utf8',
    ),
  ) as unknown,
).candidatos;

/** Cópia do seed real (apps/api/src/db/seed-data.ts) — mantida aqui à mão. */
const candidatosSeed: CandidatoLocal[] = [
  { id: 'lula', displayName: 'Luiz Inácio Lula da Silva', party: 'PT' },
  { id: 'tarcisio', displayName: 'Tarcísio de Freitas', party: 'Republicanos' },
  { id: 'ratinho-junior', displayName: 'Ratinho Junior', party: 'PSD' },
  { id: 'flavio-bolsonaro', displayName: 'Flávio Bolsonaro', party: 'PL' },
  { id: 'ciro-gomes', displayName: 'Ciro Gomes', party: 'PDT' },
  { id: 'simone-tebet', displayName: 'Simone Tebet', party: 'MDB' },
  { id: 'zema', displayName: 'Romeu Zema', party: 'Novo' },
];

const aliasesSeed = new Map<string, string>([
  ['Lula', 'lula'],
  ['Luiz Inácio Lula da Silva', 'lula'],
  ['Tarcísio', 'tarcisio'],
  ['Tarcísio de Freitas', 'tarcisio'],
  ['Ratinho Junior', 'ratinho-junior'],
  ['Ratinho Jr.', 'ratinho-junior'],
  ['Flávio Bolsonaro', 'flavio-bolsonaro'],
  ['Ciro Gomes', 'ciro-gomes'],
  ['Ciro', 'ciro-gomes'],
  ['Simone Tebet', 'simone-tebet'],
  ['Tebet', 'simone-tebet'],
  ['Romeu Zema', 'zema'],
  ['Zema', 'zema'],
]);

describe('normalizeNome', () => {
  it('remove acento, unifica caixa e colapsa pontuação — nada além disso', () => {
    expect(normalizeNome('Luiz Inácio Lula da Silva')).toBe('LUIZ INACIO LULA DA SILVA');
    expect(normalizeNome('LUIZ INÁCIO LULA DA SILVA')).toBe('LUIZ INACIO LULA DA SILVA');
    expect(normalizeNome('Ratinho Jr.')).toBe('RATINHO JR');
    expect(normalizeNome('  Zema  ')).toBe('ZEMA');
  });

  it('NÃO aproxima nomes distintos (nada de fuzzy)', () => {
    // 'ROMEU ZEMA' e 'ROMEU ZEMA NETO' são strings diferentes e continuam sendo
    // pessoas diferentes para o índice. Só um alias cadastrado por humano casa.
    expect(normalizeNome('Romeu Zema')).not.toBe(normalizeNome('ROMEU ZEMA NETO'));
    expect(normalizeNome('Flávio Bolsonaro')).not.toBe(normalizeNome('FLAVIO NANTES BOLSONARO'));
  });
});

describe('casarCandidaturas contra o registro real de 2026', () => {
  const { matches, alerts } = casarCandidaturas(candidaturasReais, candidatosSeed, aliasesSeed);

  it('casa exatamente os candidatos que existem no registro do TSE', () => {
    expect(matches.map((m) => m.candidateId).sort()).toEqual(['flavio-bolsonaro', 'lula', 'zema']);
  });

  it('cada casamento aponta para a candidatura certa', () => {
    const porId = new Map(matches.map((m) => [m.candidateId, m.candidatura]));
    expect(porId.get('lula')?.id).toBe('280002542548');
    expect(porId.get('flavio-bolsonaro')?.id).toBe('280002551544');
    expect(porId.get('zema')?.id).toBe('280002539826');
  });

  it('candidato nosso sem candidatura vira alerta, nunca chute', () => {
    const semCandidatura = alerts
      .filter((a) => a.kind === 'sem_candidatura')
      .map((a) => a.candidateId)
      .sort();
    expect(semCandidatura).toEqual(['ciro-gomes', 'ratinho-junior', 'simone-tebet', 'tarcisio']);
  });

  it('candidatura do TSE que não rastreamos é registrada como informação', () => {
    const naoRastreadas = alerts.filter((a) => a.kind === 'candidatura_nao_rastreada');
    // 13 candidaturas, 3 casadas.
    expect(naoRastreadas).toHaveLength(10);
    expect(naoRastreadas.map((a) => a.detail)).toContain('RONALDO CAIADO (PSD)');
  });

  it('RONALDO CAIADO (PSD) NÃO vira ratinho-junior só porque o partido bate', () => {
    // Trava de sanidade contra a pior falha possível: partido nunca casa sozinho.
    expect(matches.some((m) => m.candidateId === 'ratinho-junior')).toBe(false);
  });

  it('é idempotente/determinístico: mesma entrada, mesma saída', () => {
    const outra = casarCandidaturas(candidaturasReais, candidatosSeed, aliasesSeed);
    expect(outra.matches.map((m) => `${m.candidateId}:${m.candidatura.id}`)).toEqual(
      matches.map((m) => `${m.candidateId}:${m.candidatura.id}`),
    );
  });
});

/** Fabrica uma candidatura mínima para os casos de borda. */
const candidatura = (over: Partial<CandidaturaLista> & { id: string }): CandidaturaLista => ({
  nomeUrna: 'FULANO',
  nomeCompleto: 'FULANO DE TAL',
  numero: 99,
  partido: { sigla: 'XPTO', numero: 99 },
  cargo: { codigo: 1, nome: 'Presidente' },
  descricaoSituacao: 'Aguardando julgamento',
  descricaoTotalizacao: 'Concorrendo',
  ...over,
});

describe('casos de borda do casamento', () => {
  it('T1: grafia usada por dois candidatos nossos não casa com nenhum', () => {
    const candidatos: CandidatoLocal[] = [
      { id: 'a', displayName: 'Silva', party: null },
      { id: 'b', displayName: 'Silva', party: null },
    ];
    const { matches, alerts } = casarCandidaturas(
      [candidatura({ id: '1', nomeUrna: 'SILVA', nomeCompleto: 'SILVA' })],
      candidatos,
      new Map(),
    );
    expect(matches).toHaveLength(0);
    expect(alerts.some((a) => a.kind === 'nome_ambiguo')).toBe(true);
  });

  it('T2: nome bate mas partido diverge ⇒ não casa e alerta', () => {
    const { matches, alerts } = casarCandidaturas(
      [candidatura({ id: '1', nomeUrna: 'ZEMA', partido: { sigla: 'PL', numero: 22 } })],
      [{ id: 'zema', displayName: 'Zema', party: 'Novo' }],
      new Map(),
    );
    expect(matches).toHaveLength(0);
    expect(alerts.filter((a) => a.kind === 'partido_divergente')).toHaveLength(1);
    // O alerta específico substitui o genérico: nada de dois alertas pelo mesmo.
    expect(alerts.some((a) => a.kind === 'sem_candidatura')).toBe(false);
  });

  it('T3: duas candidaturas para o mesmo candidato derrubam as duas', () => {
    const { matches, alerts } = casarCandidaturas(
      [
        candidatura({ id: '1', nomeUrna: 'ZEMA', partido: { sigla: 'NOVO', numero: 30 } }),
        candidatura({
          id: '2',
          nomeUrna: 'OUTRO',
          nomeCompleto: 'ZEMA',
          partido: { sigla: 'NOVO', numero: 30 },
        }),
      ],
      [{ id: 'zema', displayName: 'Zema', party: 'Novo' }],
      new Map(),
    );
    expect(matches).toHaveLength(0);
    expect(alerts.some((a) => a.kind === 'candidato_com_multiplas_candidaturas')).toBe(true);
  });

  it('partido ausente de um dos lados não bloqueia o casamento por nome', () => {
    const { matches } = casarCandidaturas(
      [candidatura({ id: '1', nomeUrna: 'ZEMA', partido: { sigla: null, numero: null } })],
      [{ id: 'zema', displayName: 'Zema', party: 'Novo' }],
      new Map(),
    );
    expect(matches.map((m) => m.candidateId)).toEqual(['zema']);
  });

  it('lista vazia de candidaturas não casa ninguém e alerta por candidato', () => {
    const { matches, alerts } = casarCandidaturas(
      [],
      [{ id: 'zema', displayName: 'Zema', party: 'Novo' }],
      new Map(),
    );
    expect(matches).toHaveLength(0);
    expect(alerts).toEqual([
      {
        kind: 'sem_candidatura',
        candidateId: 'zema',
        idCandidatura: null,
        detail: "'Zema' não tem candidatura correspondente no registro do TSE",
      },
    ]);
  });
});
