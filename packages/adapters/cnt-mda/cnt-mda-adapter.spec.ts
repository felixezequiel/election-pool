import { describe, it, expect, beforeAll } from 'vitest';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { makeTempStorage, makeRawFromBytes, makeReg, seedResolver } from '../base/test-support.js';
import {
  makeCntMdaPdf,
  CNT_MDA_ROUND_LINES,
  CNT_MDA_WRONG_TSE_LINES,
  CNT_MDA_UNKNOWN_LINES,
} from './__fixtures__/make-pdf.js';
import { CntMdaAdapter } from './cnt-mda-adapter.js';

const { storage } = makeTempStorage();
const adapter = new CntMdaAdapter({ resolveCandidate: seedResolver, storage });

const rawFor = (lines: readonly string[]): Promise<RawDocument> =>
  makeRawFromBytes(storage, makeCntMdaPdf(lines), 'application/pdf', 'https://cnt.org.br/rel.pdf');

describe('CntMdaAdapter.parse (PDF)', () => {
  let relatorio: RawDocument;
  beforeAll(async () => {
    relatorio = await rawFor(CNT_MDA_ROUND_LINES);
  });

  it('extrai os cenários corretos do relatório PDF (fixture da fonte)', async () => {
    const parsed = await adapter.parse(relatorio, makeReg({ tseId: 'BR-09912/2026' }));
    expect(parsed.tseId).toBe('BR-09912/2026');
    expect(parsed.scenarios).toHaveLength(2);

    const t1 = parsed.scenarios.find((s) => s.kind === 't1_estimulado');
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

  it('candidato ausente do 2º turno NÃO vira zero (Ciro só no 1º)', async () => {
    const parsed = await adapter.parse(relatorio, makeReg({ tseId: 'BR-09912/2026' }));
    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    expect(t2?.values.some((v) => v.candidateAlias === 'Ciro')).toBe(false);
  });

  it('LANÇA (V6) quando o PDF tem o tse_id de OUTRA rodada', async () => {
    const raw = await rawFor(CNT_MDA_WRONG_TSE_LINES);
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-09912/2026' }))).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('LANÇA UnknownCandidateError (quarentena) para alias não cadastrado', async () => {
    const raw = await rawFor(CNT_MDA_UNKNOWN_LINES);
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-09912/2026' }))).rejects.toBeInstanceOf(
      UnknownCandidateError,
    );
  });

  it('canHandle casa pelo instituteId do registro (mda)', () => {
    expect(adapter.canHandle(makeReg({ instituteId: 'mda' }))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
  });
});
