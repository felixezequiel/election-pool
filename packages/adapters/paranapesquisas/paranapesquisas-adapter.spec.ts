/**
 * Specs do `ParanaPesquisasAdapter` pelo caminho de PRODUÇÃO inteiro: bytes de PDF
 * no blob → `extractPdfText` (`unpdf`) → V6 do `BaseAdapter` → parser → validação
 * Zod do `ParsedPoll`. O conteúdo do PDF é a captura REAL do instituto,
 * reembalada por `__fixtures__/make-pdf.ts` (ver o README das fixtures).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import {
  makeTempStorage,
  makeRawFromBytes,
  makeReg,
  seedCandidateAliases,
} from '../base/test-support.js';
import { resolverFromMap } from '../base/candidate-resolver.js';
import { ParanaPesquisasAdapter } from './paranapesquisas-adapter.js';
import { makeParanaPesquisasPdf } from './__fixtures__/make-pdf.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const FEV = fixture('nacional-fev2026-BR-07974.txt');
const MAR = fixture('nacional-mar2026-BR-00873.txt');
const FEV_ID = 'BR-07974/2026';
const MAR_ID = 'BR-00873/2026';

/**
 * Resolver do teste = aliases do seed (T-02) MAIS os quatro nomes que a captura
 * real traz e o seed NÃO tem. Isto está aqui de propósito, e é um ACHADO a
 * reportar: com o `seed-data.ts` de hoje (7 candidatos), esta rodada iria para
 * QUARENTENA por `UnknownCandidateError` — comportamento CORRETO (docs/04 §4.1:
 * "Nunca crie candidato automaticamente"), mas que impede a ingestão até o dono do
 * seed cadastrar os aliases. O adapter não cria candidato; só relata.
 */
const REAL_ALIASES_MISSING_FROM_SEED: ReadonlyArray<readonly [string, string]> = [
  ['Jair Bolsonaro', 'jair-bolsonaro'],
  ['Renan Santos', 'renan-santos'],
  ['Ronaldo Caiado', 'ronaldo-caiado'],
  ['Aldo Rebelo', 'aldo-rebelo'],
];

const resolveCandidate = resolverFromMap(
  new Map<string, string>([...seedCandidateAliases, ...REAL_ALIASES_MISSING_FROM_SEED]),
);

const { storage } = makeTempStorage();
const adapter = new ParanaPesquisasAdapter({ resolveCandidate, storage });

const rawPdfFor = (text: string, url: string): Promise<RawDocument> =>
  makeRawFromBytes(storage, makeParanaPesquisasPdf(text), 'application/pdf', url);

const regFor = (tseId: string) => makeReg({ tseId, instituteId: 'paranapesquisas' });

describe('ParanaPesquisasAdapter — identidade e roteamento', () => {
  it('id e instituteId são os do registro do instituto', () => {
    expect(adapter.id).toBe('paranapesquisas');
    expect(adapter.instituteId).toBe('paranapesquisas');
  });

  it('canHandle casa pelo instituteId do registro', () => {
    expect(adapter.canHandle(regFor(FEV_ID))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
  });
});

describe('ParanaPesquisasAdapter.parse (PDF real de fevereiro/2026)', () => {
  let raw: RawDocument;
  beforeAll(async () => {
    raw = await rawPdfFor(
      FEV,
      'https://paranapesquisas.com.br/wp-content/uploads/2026/02/Nacional_Fev261.pdf',
    );
  });

  it('devolve ParsedPoll válido com o tse_id do registro e os 5 cenários', async () => {
    const parsed = await adapter.parse(raw, regFor(FEV_ID));
    expect(parsed.tseId).toBe(FEV_ID);
    expect(parsed.scenarios).toHaveLength(5);
    expect(parsed.scenarios.map((s) => s.kind)).toEqual([
      't1_espontaneo',
      't1_estimulado',
      't1_estimulado',
      't2',
      't2',
    ]);
  });

  it('1º turno estimulado, candidato por candidato, com o registro TSE confirmado', async () => {
    const parsed = await adapter.parse(raw, regFor(FEV_ID));
    const c1 = parsed.scenarios.find((s) => s.label.includes('Cenário 1'));
    expect(c1?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 39.6 },
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 35.3 },
      { candidateAlias: 'Ratinho Junior', valuePct: 7.6 },
      { candidateAlias: 'Romeu Zema', valuePct: 3.8 },
      { candidateAlias: 'Renan Santos', valuePct: 1.5 },
      { candidateAlias: 'Aldo Rebelo', valuePct: 0.5 },
    ]);
    expect(c1?.blankNullPct).toBe(6.7);
    expect(c1?.undecidedPct).toBe(5.0);
  });

  it('2º turno vem com o par de candidatos', async () => {
    const parsed = await adapter.parse(raw, regFor(FEV_ID));
    const t2 = parsed.scenarios.filter((s) => s.kind === 't2');
    expect(t2.map((s) => s.t2Pair)).toEqual([
      ['Flávio Bolsonaro', 'Lula'],
      ['Lula', 'Ratinho Junior'],
    ]);
  });

  it('LANÇA (V6 + sentença de registro) para a rodada de janeiro, citada no comparativo', async () => {
    await expect(adapter.parse(raw, regFor('BR-08254/2026'))).rejects.toBeInstanceOf(ParseError);
  });

  it('LANÇA (V6) quando o tse_id do registro não está no documento', async () => {
    await expect(adapter.parse(raw, regFor('BR-99999/2026'))).rejects.toBeInstanceOf(ParseError);
  });

  it('LANÇA UnknownCandidateError (quarentena) quando um alias não está cadastrado', async () => {
    const semAldo = new ParanaPesquisasAdapter({
      storage,
      resolveCandidate: resolverFromMap(new Map(seedCandidateAliases)),
    });
    await expect(semAldo.parse(raw, regFor(FEV_ID))).rejects.toBeInstanceOf(UnknownCandidateError);
  });
});

describe('ParanaPesquisasAdapter.parse (PDF real de março/2026)', () => {
  it('extrai a rodada de março, com o 2º turno rebatizado de "Cenário 2"', async () => {
    const raw = await rawPdfFor(
      MAR,
      'https://paranapesquisas.com.br/wp-content/uploads/2026/03/Nacional_Mar26-3.pdf',
    );
    const parsed = await adapter.parse(raw, regFor(MAR_ID));
    expect(parsed.tseId).toBe(MAR_ID);
    expect(parsed.scenarios).toHaveLength(3);
    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    expect(t2?.t2Pair).toEqual(['Flávio Bolsonaro', 'Lula']);
  });
});

describe('ParanaPesquisasAdapter.documentToText — content-type', () => {
  it('LANÇA com razão explícita quando o documento não é PDF', async () => {
    // A página do post não tem percentual nenhum; falhar alto é melhor que
    // "não achei cenário" (R4).
    const html = await makeRawFromBytes(
      storage,
      '<html><body>Registro TSE n.º BR-07974/2026</body></html>',
      'text/html; charset=UTF-8',
      'https://paranapesquisas.com.br/pesquisas/alguma-rodada/',
    );
    await expect(adapter.parse(html, regFor(FEV_ID))).rejects.toThrow(/não PDF/);
  });
});
