import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { makeTempStorage, makeRawFromBytes, makeReg, seedResolver } from '../base/test-support.js';
import { NexusAdapter } from './nexus-adapter.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const { storage } = makeTempStorage();
const adapter = new NexusAdapter({ resolveCandidate: seedResolver, storage });

const rawFor = (name: string): Promise<RawDocument> =>
  makeRawFromBytes(storage, fixture(name), 'text/html', 'https://nexus.fsb.com.br/estudo');

describe('NexusAdapter.parse (HTML)', () => {
  let round: RawDocument;
  beforeAll(async () => {
    round = await rawFor('round.html');
  });

  it('extrai os cenários corretos da rodada (fixture real da fonte)', async () => {
    const parsed = await adapter.parse(round, makeReg({ tseId: 'BR-06591/2026' }));
    expect(parsed.tseId).toBe('BR-06591/2026');
    expect(parsed.scenarios).toHaveLength(2);

    const t1 = parsed.scenarios.find((s) => s.kind === 't1_estimulado');
    expect(t1?.label).toBe('Cenário 1 — Estimulado');
    expect(t1?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 38.8 },
      { candidateAlias: 'Tarcísio', valuePct: 29.1 },
      { candidateAlias: 'Ciro', valuePct: 7.4 },
      { candidateAlias: 'Tebet', valuePct: 5.2 },
    ]);
    expect(t1?.blankNullPct).toBe(12);
    expect(t1?.undecidedPct).toBe(7.5);

    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    expect(t2?.t2Pair).toEqual(['Lula', 'Tarcísio']);
    expect(t2?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 47.3 },
      { candidateAlias: 'Tarcísio', valuePct: 42.1 },
    ]);
  });

  it('candidato ausente do 2º turno NÃO vira zero (Ciro só aparece no 1º)', async () => {
    const parsed = await adapter.parse(round, makeReg({ tseId: 'BR-06591/2026' }));
    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    expect(t2?.values.some((v) => v.candidateAlias === 'Ciro')).toBe(false);
    // e ninguém foi inserido com 0
    expect(t2?.values.every((v) => v.valuePct > 0)).toBe(true);
  });

  it('LANÇA (V6) quando o documento tem o tse_id de OUTRA rodada', async () => {
    const raw = await rawFor('wrong-tse-id.html');
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }))).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('LANÇA UnknownCandidateError (quarentena) para alias não cadastrado', async () => {
    const raw = await rawFor('unknown-candidate.html');
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }))).rejects.toBeInstanceOf(
      UnknownCandidateError,
    );
  });

  it('canHandle casa pelo instituteId do registro', () => {
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'quaest' }))).toBe(false);
  });

  it('discover aponta o índice de estudos divulgados (não busca)', async () => {
    const candidates = await adapter.discover(makeReg());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.url).toBe('https://nexus.fsb.com.br/estudos-divulgados');
  });
});
