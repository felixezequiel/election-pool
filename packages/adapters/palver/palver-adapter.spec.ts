import { describe, it, expect, beforeAll } from 'vitest';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { makeTempStorage, makeRawFromBytes, makeReg, seedResolver } from '../base/test-support.js';
import {
  makePalverPdf,
  PALVER_TSE_ID,
  PALVER_ONDA_LINES,
  PALVER_SEM_AGREGADOS_LINES,
  PALVER_WRONG_TSE_LINES,
  PALVER_UNKNOWN_LINES,
} from './__fixtures__/make-pdf.js';
import { PalverAdapter } from './palver-adapter.js';

const { storage } = makeTempStorage();
const adapter = new PalverAdapter({ resolveCandidate: seedResolver, storage });

const rawFor = (lines: readonly string[]): Promise<RawDocument> =>
  makeRawFromBytes(
    storage,
    makePalverPdf(lines),
    'application/pdf',
    'https://www.palver.com.br/api/surveys/voting-intention-2026-august/report',
  );

const regPalver = (): ReturnType<typeof makeReg> =>
  makeReg({ tseId: PALVER_TSE_ID, instituteId: 'palver', instituteRawName: 'Palver' });

describe('PalverAdapter — identidade e descoberta', () => {
  it('canHandle casa pelo instituteId do registro (palver)', () => {
    expect(adapter.id).toBe('palver');
    expect(adapter.instituteId).toBe('palver');
    expect(adapter.canHandle(makeReg({ instituteId: 'palver' }))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
    expect(adapter.canHandle(makeReg({ instituteId: null }))).toBe(false);
  });

  it('discover aponta as URLs REAIS da fonte primária, nunca portal de notícia', async () => {
    const candidates = await adapter.discover(regPalver());
    const urls = candidates.map((c) => c.url);
    expect(urls).toEqual([
      'https://www.palver.com.br/api/surveys/voting-intention-2026-august/report',
      'https://raw.githubusercontent.com/palverdata/pesquisa-palver/main/divulgacao/2026-08-10/relatorio-onda-01.pdf',
      'https://www.palver.com.br/api/surveys/voting-intention-2026-august/press-release',
    ]);
    // Nível 2 de docs/04 §1: só a própria Palver. Nenhum agregador nem imprensa.
    for (const url of urls) {
      expect(url).toMatch(/(^https:\/\/www\.palver\.com\.br\/|palverdata\/pesquisa-palver)/);
    }
    // Todo candidato explica POR QUE aquela URL provavelmente tem o resultado.
    for (const c of candidates) {
      expect(c.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('PalverAdapter.parse (PDF, caminho completo)', () => {
  let onda: RawDocument;
  beforeAll(async () => {
    onda = await rawFor(PALVER_ONDA_LINES);
  });

  it('extrai os três cenários da estrutura sintética (ver __fixtures__/README §4)', async () => {
    const parsed = await adapter.parse(onda, regPalver());
    // O `tseId` devolvido é o do REGISTRO, nunca um valor lido do documento.
    expect(parsed.tseId).toBe(PALVER_TSE_ID);
    expect(parsed.scenarios).toHaveLength(3);

    const estimulado = parsed.scenarios.find((s) => s.kind === 't1_estimulado');
    expect(estimulado?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 44 },
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 40 },
      { candidateAlias: 'Ciro Gomes', valuePct: 5 },
    ]);
    expect(estimulado?.blankNullPct).toBe(7);
    expect(estimulado?.undecidedPct).toBe(4);

    const espontaneo = parsed.scenarios.find((s) => s.kind === 't1_espontaneo');
    expect(espontaneo?.undecidedPct).toBe(33);

    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    expect(t2?.t2Pair).toEqual(['Lula', 'Flávio Bolsonaro']);
    expect(t2?.values).toHaveLength(2);
  });

  it('candidato ausente de um cenário NÃO vira zero', async () => {
    const parsed = await adapter.parse(onda, regPalver());
    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    expect(t2?.values.some((v) => v.candidateAlias === 'Ciro Gomes')).toBe(false);
    const espontaneo = parsed.scenarios.find((s) => s.kind === 't1_espontaneo');
    expect(espontaneo?.values.some((v) => v.candidateAlias === 'Ciro Gomes')).toBe(false);
  });

  it('agregado não publicado fica undefined, nunca 0', async () => {
    const raw = await rawFor(PALVER_SEM_AGREGADOS_LINES);
    const parsed = await adapter.parse(raw, regPalver());
    expect(parsed.scenarios).toHaveLength(1);
    expect(parsed.scenarios[0]?.blankNullPct).toBeUndefined();
    expect(parsed.scenarios[0]?.undecidedPct).toBeUndefined();
  });

  it('LANÇA (V6) quando o PDF é de OUTRA rodada', async () => {
    const raw = await rawFor(PALVER_WRONG_TSE_LINES);
    await expect(adapter.parse(raw, regPalver())).rejects.toBeInstanceOf(ParseError);
  });

  it('LANÇA UnknownCandidateError (quarentena) para alias não cadastrado', async () => {
    const raw = await rawFor(PALVER_UNKNOWN_LINES);
    await expect(adapter.parse(raw, regPalver())).rejects.toBeInstanceOf(UnknownCandidateError);
  });

  it('LANÇA quando o PDF não tem texto extraível (deck só de imagem)', async () => {
    // Um PDF sem nenhum texto é o caso-limite do relatório real levado ao extremo:
    // `extractPdfText` recusa em vez de devolver string vazia (R4).
    const raw = await rawFor([]);
    await expect(adapter.parse(raw, regPalver())).rejects.toBeInstanceOf(ParseError);
  });
});
