/**
 * Specs do `PoderDataAdapter` — o caminho COMPLETO do adapter: bytes de PDF no
 * blob → extração de texto (`unpdf`) → V6 → extração → resolução de alias →
 * validação Zod do `ParsedPoll`.
 *
 * O PDF do teste é montado a partir do TEXTO REAL das capturas
 * (`__fixtures__/*.txt`): as mesmas linhas, na mesma ordem, embaladas num PDF
 * mínimo. Assim o caminho de extração de PDF é exercitado de verdade sem
 * commitar o relatório do instituto no repositório (R3, docs/08 §2.1).
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { makeTempStorage, makeRawFromBytes, makeReg } from '../base/test-support.js';
import { resolverFromMap } from '../base/candidate-resolver.js';
import { HttpClient, RobotsDisallowedError } from '../http-client.js';
import type { FetchLike, HttpClientClock } from '../http-client.js';
import { RobotsCache } from '../robots.js';
import { PerHostRateLimiter } from '../rate-limiter.js';
import { makePoderDataPdf } from './__fixtures__/make-pdf.js';
import { PoderDataAdapter, extractReportUrls } from './poderdata-adapter.js';
import { PODERDATA_DISCLOSURE_INDEX_URLS } from './constants.js';

const FIXTURES = join(import.meta.dirname, '__fixtures__');
const readFixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/**
 * Aliases dos candidatos que aparecem de fato nos relatórios de 2026.
 * `Joaquim Barbosa` fica DE FORA de propósito: ele concorre nas rodadas de maio e
 * junho e é o caso real de alias não cadastrado (quarentena, docs/04 §4.1).
 */
const aliases = new Map<string, string>([
  ['Lula', 'lula'],
  ['Flávio Bolsonaro', 'flavio-bolsonaro'],
  ['Renan Santos', 'renan-santos'],
  ['Ronaldo Caiado', 'ronaldo-caiado'],
  ['Romeu Zema', 'zema'],
  ['Augusto Cury', 'augusto-cury'],
]);

const { storage } = makeTempStorage();
const adapter = new PoderDataAdapter({ resolveCandidate: resolverFromMap(aliases), storage });

const REPORT_URL = 'https://static.poder360.com.br/uploads/2026/07/Relatorio-PoderData.pdf';

const rawFromFixture = (name: string): Promise<RawDocument> => {
  const lines = readFixture(name).split(/\r?\n/);
  return makeRawFromBytes(storage, makePoderDataPdf(lines), 'application/pdf', REPORT_URL);
};

const JUL29 = { tseId: 'BR-07845/2026', fieldStart: '2026-07-26', fieldEnd: '2026-07-29' };
const MAI28 = { tseId: 'BR-04882/2026', fieldStart: '2026-05-25', fieldEnd: '2026-05-28' };

describe('PoderDataAdapter — identidade', () => {
  it('id e instituteId são "poderdata"', () => {
    expect(adapter.id).toBe('poderdata');
    expect(adapter.instituteId).toBe('poderdata');
  });

  it('canHandle só aceita registro do PoderData', () => {
    expect(adapter.canHandle(makeReg({ instituteId: 'poderdata' }))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
    expect(adapter.canHandle(makeReg({ instituteId: null }))).toBe(false);
  });
});

describe('PoderDataAdapter.parse — PDF real da rodada BR-07845/2026', () => {
  let raw: RawDocument;
  beforeAll(async () => {
    raw = await rawFromFixture('BR-07845-2026-29jul2026.txt');
  });

  it('devolve um ParsedPoll válido com o tse_id do REGISTRO', async () => {
    const parsed = await adapter.parse(raw, makeReg({ instituteId: 'poderdata', ...JUL29 }));
    expect(parsed.tseId).toBe('BR-07845/2026');
    expect(parsed.scenarios.map((s) => s.kind)).toEqual(['t1_estimulado', 't2', 't2', 't2', 't2']);
  });

  it('1º turno por candidato, com brancos/nulos e não sabe publicados', async () => {
    const parsed = await adapter.parse(raw, makeReg({ instituteId: 'poderdata', ...JUL29 }));
    const t1 = parsed.scenarios.find((s) => s.kind === 't1_estimulado');
    expect(t1?.values).toEqual(
      expect.arrayContaining([
        { candidateAlias: 'Lula', valuePct: 41 },
        { candidateAlias: 'Flávio Bolsonaro', valuePct: 35 },
      ]),
    );
    expect(t1?.blankNullPct).toBe(5);
    expect(t1?.undecidedPct).toBe(4);
  });

  it('2º turno com par de exatamente 2 e a onda corrente', async () => {
    const parsed = await adapter.parse(raw, makeReg({ instituteId: 'poderdata', ...JUL29 }));
    const runoff = parsed.scenarios.find((s) => s.t2Pair?.includes('Flávio Bolsonaro') === true);
    expect(runoff?.t2Pair).toEqual(['Flávio Bolsonaro', 'Lula']);
    expect(runoff?.values).toEqual([
      { candidateAlias: 'Flávio Bolsonaro', valuePct: 43 },
      { candidateAlias: 'Lula', valuePct: 46 },
    ]);
  });

  it('candidato ausente do 2º turno NÃO vira zero', async () => {
    const parsed = await adapter.parse(raw, makeReg({ instituteId: 'poderdata', ...JUL29 }));
    const runoff = parsed.scenarios.find((s) => s.t2Pair?.includes('Flávio Bolsonaro') === true);
    expect(runoff?.values.some((v) => v.candidateAlias === 'Augusto Cury')).toBe(false);
    expect(runoff?.values).toHaveLength(2);
  });

  it('LANÇA (V6) quando o registro é de OUTRA rodada', async () => {
    // O documento é da rodada BR-07845/2026; o registro diz BR-06591/2026.
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'poderdata', tseId: 'BR-06591/2026' })),
    ).rejects.toBeInstanceOf(ParseError);
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'poderdata', tseId: 'BR-06591/2026' })),
    ).rejects.toThrow(/não contém o tse_id do registro/);
  });
});

describe('PoderDataAdapter.parse — rodada BR-04882/2026 (gráfico de barras)', () => {
  it('LANÇA UnknownCandidateError no alias real não cadastrado (Joaquim Barbosa)', async () => {
    const raw = await rawFromFixture('BR-04882-2026-28mai2026.txt');
    const promise = adapter.parse(raw, makeReg({ instituteId: 'poderdata', ...MAI28 }));
    await expect(promise).rejects.toBeInstanceOf(UnknownCandidateError);
  });

  it('com o alias cadastrado, extrai a rodada inteira', async () => {
    const raw = await rawFromFixture('BR-04882-2026-28mai2026.txt');
    const withJoaquim = new Map(aliases).set('Joaquim Barbosa', 'joaquim-barbosa');
    const tolerant = new PoderDataAdapter({
      resolveCandidate: resolverFromMap(withJoaquim),
      storage,
    });
    const parsed = await tolerant.parse(raw, makeReg({ instituteId: 'poderdata', ...MAI28 }));
    expect(parsed.tseId).toBe('BR-04882/2026');
    // 1 cenário de 1º turno + 5 pares de 2º turno.
    expect(parsed.scenarios).toHaveLength(6);
    const t1 = parsed.scenarios.find((s) => s.kind === 't1_estimulado');
    expect(t1?.values.find((v) => v.candidateAlias === 'Joaquim Barbosa')?.valuePct).toBe(3);
  });
});

describe('PoderDataAdapter.documentToText — R4 no que não é relatório', () => {
  it('LANÇA quando o blob não é um PDF (ex.: o HTML do índice foi salvo por engano)', async () => {
    const raw = await makeRawFromBytes(
      storage,
      '<html><body>não é PDF</body></html>',
      'text/html',
      'https://www.poder360.com.br/poderdata/',
    );
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'poderdata', ...JUL29 })),
    ).rejects.toBeInstanceOf(ParseError);
  });
});

// --- discover ---------------------------------------------------------------

const noWaitClock = (): HttpClientClock => ({
  now: () => 0,
  sleep: () => Promise.resolve(),
  random: () => 0.5,
});

const makeHttp = (fetchImpl: FetchLike, robotsBody = ''): HttpClient =>
  new HttpClient({
    fetchImpl,
    robots: new RobotsCache(() => Promise.resolve({ status: 200, body: robotsBody })),
    rateLimiter: new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() }),
    clock: noWaitClock(),
  });

const respond = (status: number, body: string, url: string): Awaited<ReturnType<FetchLike>> => ({
  status,
  headers: new Headers(),
  url,
  text: () => Promise.resolve(body),
});

const adapterWithHttp = (http: HttpClient): PoderDataAdapter =>
  new PoderDataAdapter({ resolveCandidate: resolverFromMap(aliases), storage, http });

describe('extractReportUrls — só href, nunca conteúdo (R3)', () => {
  it('pega os 4 relatórios eleitorais reais da página da série', () => {
    const urls = extractReportUrls(
      readFixture('indice-serie-2026-links.html'),
      PODERDATA_DISCLOSURE_INDEX_URLS[0],
    );
    expect(urls).toHaveLength(4);
    expect(urls[0]).toContain('29jul26');
  });

  it('filtra o relatório NÃO eleitoral e o de 2020 na página institucional', () => {
    const urls = extractReportUrls(
      readFixture('indice-institucional-links.html'),
      PODERDATA_DISCLOSURE_INDEX_URLS[1],
    );
    expect(urls).toHaveLength(4);
    expect(urls.some((u) => u.includes('relatorio-poderdata-93'))).toBe(false);
    expect(urls.some((u) => u.includes('Covid19'))).toBe(false);
  });

  it('ordena do mais recente para o mais antigo, mesmo com índice em ordem inversa', () => {
    // A página institucional lista do mais ANTIGO para o mais novo; a ordenação
    // por ano/mês da URL evita baixar 4 PDFs antes do certo.
    const urls = extractReportUrls(
      readFixture('indice-institucional-links.html'),
      PODERDATA_DISCLOSURE_INDEX_URLS[1],
    );
    expect(urls[0]).toContain('/2026/07/');
    expect(urls[urls.length - 1]).toContain('/2026/05/');
  });
});

describe('PoderDataAdapter.discover', () => {
  it('devolve os PDFs do primeiro índice que responder', async () => {
    const body = readFixture('indice-serie-2026-links.html');
    const fetchImpl = vi.fn<FetchLike>((url) => Promise.resolve(respond(200, body, url)));
    const candidates = await adapterWithHttp(makeHttp(fetchImpl)).discover(
      makeReg({ instituteId: 'poderdata', ...JUL29 }),
    );
    expect(candidates).toHaveLength(4);
    expect(candidates[0]?.url).toContain('Relatorio-PoderData-Eleitoral-29jul26');
    expect(candidates[0]?.reason).toMatch(/próprio PoderData/);
    // Um índice basta: não batemos no segundo host à toa.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('cai para o índice seguinte quando o primeiro não tem PDF de relatório', async () => {
    const institucional = readFixture('indice-institucional-links.html');
    const fetchImpl = vi.fn<FetchLike>((url) =>
      Promise.resolve(
        url === PODERDATA_DISCLOSURE_INDEX_URLS[0]
          ? respond(200, '<html><body>post sem PDF</body></html>', url)
          : respond(200, institucional, url),
      ),
    );
    const candidates = await adapterWithHttp(makeHttp(fetchImpl)).discover(
      makeReg({ instituteId: 'poderdata', ...JUL29 }),
    );
    expect(candidates).toHaveLength(4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('LANÇA quando nenhum índice tem relatório — zero dado não é sucesso (Q-09)', async () => {
    const fetchImpl = vi.fn<FetchLike>((url) =>
      Promise.resolve(respond(200, '<html></html>', url)),
    );
    await expect(
      adapterWithHttp(makeHttp(fetchImpl)).discover(
        makeReg({ instituteId: 'poderdata', ...JUL29 }),
      ),
    ).rejects.toBeInstanceOf(ParseError);
  });

  it('respeita o robots.txt do host antes de buscar o índice', async () => {
    const fetchImpl = vi.fn<FetchLike>((url) => Promise.resolve(respond(200, '', url)));
    const http = makeHttp(fetchImpl, 'User-agent: *\nDisallow: /poderdata/\nDisallow: /poderdata-');
    await expect(
      adapterWithHttp(http).discover(makeReg({ instituteId: 'poderdata', ...JUL29 })),
    ).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
