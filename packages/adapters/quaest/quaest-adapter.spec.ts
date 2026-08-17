/**
 * Testes do `QuaestAdapter` de ponta a ponta do adapter (blob → texto → V6 →
 * cenários → schema), contra as CAPTURAS REAIS de `__fixtures__/`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { HttpClient } from '../http-client.js';
import type { FetchLike, HttpClientClock } from '../http-client.js';
import { PerHostRateLimiter } from '../rate-limiter.js';
import { RobotsCache } from '../robots.js';
import { resolverFromMap } from '../base/candidate-resolver.js';
import { makeRawFromBytes, makeReg, makeTempStorage } from '../base/test-support.js';
import { makeCntMdaPdf } from '../cnt-mda/__fixtures__/make-pdf.js';
import { QuaestAdapter } from './quaest-adapter.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const POST_AGOSTO = fixture('2026-08-05-post-rodada-nacional.html');
const POST_JULHO = fixture('2026-07-15-post-rodada-nacional.html');
const PDF_TEXTLAYER = fixture('2026-08-14-rodada-1-pdf-textlayer.txt');

/**
 * Aliases que a rodada REAL de 2026-08-05 usa. O seed manual (`seed-data.ts`, de
 * T-02) precisa conter todos eles — está anotado em `tasks/LOG.md`. Aqui o mapa é
 * local, porque o adapter recebe o resolver injetado e não conhece o banco.
 */
const QUAEST_ALIASES = new Map<string, string>([
  ['Luiz Inácio Lula da Silva', 'lula'],
  ['Lula', 'lula'],
  ['Flávio Bolsonaro', 'flavio-bolsonaro'],
  ['Flávio', 'flavio-bolsonaro'],
  ['Ronaldo Caiado', 'ronaldo-caiado'],
  ['Renan Santos', 'renan-santos'],
  ['Romeu Zema', 'zema'],
]);

// --- Apoio para o `discover`, que faz UMA requisição ao WP REST ---------------
// Sem espera de rate limit e sem robots real: o que se testa aqui é a caminhada,
// não o cliente HTTP (que tem specs próprias).
const noWaitClock = (): HttpClientClock => ({
  now: () => 0,
  sleep: () => Promise.resolve(),
  random: () => 0,
});
const testHttp = (fetchImpl: FetchLike): HttpClient =>
  new HttpClient({
    fetchImpl,
    robots: new RobotsCache(() => Promise.resolve({ status: 404, body: '' })),
    rateLimiter: new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() }),
    clock: noWaitClock(),
  });

/**
 * Resposta REAL do WP REST para a janela do campo de agosto (verificada ao vivo em
 * 2026-08-17: `after=2026-08-02T00:00:00&before=2026-08-17T23:59:59` devolve estes
 * dois posts — o da rodada e um vizinho de análise).
 */
const WP_REST_JANELA_AGOSTO = JSON.stringify([
  {
    id: 4701,
    date: '2026-08-03T12:36:17',
    slug: 'lula-pesquisas-eleitorais-2026-vs-2022',
    link: 'https://quaest.com.br/lula-pesquisas-eleitorais-2026-vs-2022/',
  },
  {
    id: 4712,
    date: '2026-08-05T12:42:11',
    slug: 'pesquisa-genial-quaest-recuperacao-de-flavio-bolsonaro',
    link: 'https://quaest.com.br/pesquisa-genial-quaest-recuperacao-de-flavio-bolsonaro/',
  },
]);

const jsonOnce = (body: string, status = 200): { impl: FetchLike; urls: string[] } => {
  const urls: string[] = [];
  const impl: FetchLike = (url) => {
    urls.push(url);
    return Promise.resolve({
      status,
      headers: new Headers({ 'content-type': 'application/json; charset=UTF-8' }),
      url,
      text: () => Promise.resolve(body),
    });
  };
  return { impl, urls };
};

const { storage } = makeTempStorage();
const makeAdapter = (fetchImpl?: FetchLike): QuaestAdapter =>
  new QuaestAdapter({
    resolveCandidate: resolverFromMap(QUAEST_ALIASES),
    storage,
    ...(fetchImpl === undefined ? {} : { http: testHttp(fetchImpl) }),
  });

const adapter = makeAdapter(jsonOnce(WP_REST_JANELA_AGOSTO).impl);

const POST_URL = 'https://quaest.com.br/pesquisa-genial-quaest-recuperacao-de-flavio-bolsonaro/';

const rawHtml = (html: string, url = POST_URL): Promise<RawDocument> =>
  makeRawFromBytes(storage, html, 'text/html; charset=UTF-8', url);

describe('QuaestAdapter — identidade e roteamento', () => {
  it('id e instituteId são "quaest"', () => {
    expect(adapter.id).toBe('quaest');
    expect(adapter.instituteId).toBe('quaest');
  });

  it('canHandle casa pelo instituteId do registro', () => {
    expect(adapter.canHandle(makeReg({ instituteId: 'quaest' }))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
    expect(adapter.canHandle(makeReg({ instituteId: null }))).toBe(false);
  });
});

describe('QuaestAdapter.discover — devolve POST FINAL, nunca URL intermediária', () => {
  it('devolve só URLs de post da rodada; nenhum sitemap, nenhum wp-json', async () => {
    const { impl } = jsonOnce(WP_REST_JANELA_AGOSTO);
    const candidates = await makeAdapter(impl).discover(
      makeReg({ instituteId: 'quaest', fieldStart: '2026-07-31', fieldEnd: '2026-08-03' }),
    );
    const urls = candidates.map((c) => c.url);
    expect(urls).toEqual([
      'https://quaest.com.br/lula-pesquisas-eleitorais-2026-vs-2022/',
      'https://quaest.com.br/pesquisa-genial-quaest-recuperacao-de-flavio-bolsonaro/',
    ]);
    // A regressão que o HarvestJob pegou: sitemap e wp-json chegavam ao parse como
    // se fossem documento de rodada. Nunca mais.
    expect(urls.some((u) => u.includes('sitemap'))).toBe(false);
    expect(urls.some((u) => u.includes('wp-json'))).toBe(false);
    expect(urls.every((u) => u.startsWith('https://quaest.com.br/'))).toBe(true);
    expect(candidates.every((c) => c.reason.length > 0)).toBe(true);
  });

  it('a janela do WP REST é derivada do fim do campo do registro', async () => {
    const { impl, urls } = jsonOnce(WP_REST_JANELA_AGOSTO);
    await makeAdapter(impl).discover(
      makeReg({ instituteId: 'quaest', fieldStart: '2026-07-31', fieldEnd: '2026-08-03' }),
    );
    // Uma requisição só, e é a do WP REST com a janela [fieldEnd-1, fieldEnd+14].
    expect(urls).toHaveLength(1);
    const [url] = urls;
    expect(url).toContain('after=2026-08-02T00:00:00');
    expect(url).toContain('before=2026-08-17T23:59:59');
    // `title` não é pedido: prosa de terceiro não interessa nem para filtrar (R3).
    expect(url).toContain('_fields=id,date,slug,link');
    expect(url).not.toContain('title');
  });

  it('janela sem post devolve [] — "ainda não divulgou" é fato, não falha', async () => {
    const { impl } = jsonOnce('[]');
    const candidates = await makeAdapter(impl).discover(makeReg({ instituteId: 'quaest' }));
    expect(candidates).toEqual([]);
  });

  it('WP REST fora do ar LANÇA em vez de devolver [] (R4: zero silencioso é a Q-09)', async () => {
    const { impl } = jsonOnce('gateway down', 503);
    await expect(makeAdapter(impl).discover(makeReg({ instituteId: 'quaest' }))).rejects.toThrow();
  });

  it('WP REST com forma diferente LANÇA (Zod na fronteira)', async () => {
    const { impl } = jsonOnce(JSON.stringify([{ id: 1, slug: 'x' }])); // sem link/date
    await expect(makeAdapter(impl).discover(makeReg({ instituteId: 'quaest' }))).rejects.toThrow(
      /mudou de forma/,
    );
  });
});

describe('QuaestAdapter.parse — post real de 2026-08-05 (BR-06591/2026)', () => {
  let raw: RawDocument;
  beforeAll(async () => {
    raw = await rawHtml(POST_AGOSTO);
  });

  it('devolve ParsedPoll válido com 1º turno e 2º turno, tse_id confirmado', async () => {
    const parsed = await adapter.parse(
      raw,
      makeReg({ instituteId: 'quaest', tseId: 'BR-06591/2026' }),
    );
    expect(parsed.tseId).toBe('BR-06591/2026');
    expect(parsed.scenarios.map((s) => s.kind)).toEqual(['t1_estimulado', 't2']);

    const t1 = parsed.scenarios.find((s) => s.kind === 't1_estimulado');
    expect(t1?.values).toHaveLength(5);
    expect(t1?.blankNullPct).toBe(8);
    expect(t1?.undecidedPct).toBe(10);

    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    expect(t2?.t2Pair).toEqual(['Flávio', 'Lula']);
    expect(t2?.values).toHaveLength(2);
  });

  it('LANÇA (V6) quando o registro é de OUTRA rodada', async () => {
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'quaest', tseId: 'BR-07777/2026' })),
    ).rejects.toBeInstanceOf(ParseError);
  });

  it('LANÇA UnknownCandidateError (quarentena) quando um alias não está cadastrado', async () => {
    const sem = new Map(QUAEST_ALIASES);
    sem.delete('Renan Santos');
    const outro = new QuaestAdapter({ resolveCandidate: resolverFromMap(sem), storage });
    await expect(
      outro.parse(raw, makeReg({ instituteId: 'quaest', tseId: 'BR-06591/2026' })),
    ).rejects.toBeInstanceOf(UnknownCandidateError);
  });
});

describe('QuaestAdapter.parse — bordas da fonte real', () => {
  const URL_JULHO = 'https://quaest.com.br/pesquisa-genial-quaest-saldo-de-aprovacao-de-lula/';

  it('ARMADILHA REAL: o post de julho grafa "BR-7181/2026" sem o zero à esquerda e o V6 recusa', async () => {
    const raw = await rawHtml(POST_JULHO, URL_JULHO);
    // `tseIdSchema` (contracts) exige 'BR-<5 dígitos>/<ano>', logo o registro
    // canônico é 'BR-07181/2026'. `base/tse-id` casa a sequência EXATA, então a
    // grafia do instituto não confirma o registro e o documento é recusado antes
    // de qualquer extração. Não é bug deste adapter: `base/` é congelado nesta
    // task e a decisão está relatada em tasks/LOG.md. O teste existe para que a
    // armadilha não volte a ser descoberta em produção.
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'quaest', tseId: 'BR-07181/2026' })),
    ).rejects.toThrow(/não contém o tse_id/);
  });

  it('com o registro confirmado, o post de julho ainda é RECUSADO na extração (redação diferente)', async () => {
    // Mutação mínima da captura real: só o zero à esquerda do protocolo, para
    // isolar a extração do problema de grafia acima.
    const raw = await rawHtml(POST_JULHO.replace('BR-7181/2026', 'BR-07181/2026'), URL_JULHO);
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'quaest', tseId: 'BR-07181/2026' })),
    ).rejects.toThrow(/não é extraível/);
  });

  it('PDF de rodada: o ramo de PDF funciona e o V6 recusa, porque a camada de texto não tem o registro', async () => {
    // PDF mínimo com as linhas REAIS da camada de texto do relatório de 14/08/2026
    // (ver __fixtures__/README.md). Prova a fiação bytes→unpdf→texto e o veredito.
    const linhas = PDF_TEXTLAYER.split(/\r?\n/)
      .filter((l) => l.trim().length > 0 && !l.startsWith('====='))
      .slice(0, 20);
    const raw = await makeRawFromBytes(
      storage,
      makeCntMdaPdf(linhas),
      'application/pdf',
      'https://quaest.com.br/wp-content/uploads/2026/08/QUAEST1PRESIDENCIAL1408.pdf',
    );
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'quaest', tseId: 'BR-06591/2026' })),
    ).rejects.toThrow(/não contém o tse_id/);
  });

  it('content-type inesperado LANÇA em vez de tentar adivinhar o formato', async () => {
    const raw = await makeRawFromBytes(storage, 'qualquer coisa', 'application/json', POST_URL);
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'quaest', tseId: 'BR-06591/2026' })),
    ).rejects.toThrow(/content-type inesperado/);
  });
});
