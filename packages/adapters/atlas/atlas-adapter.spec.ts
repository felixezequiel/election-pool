/**
 * Testes do `AtlasAdapter`. O HTTP é mockado, mas todo CORPO é captura real de
 * 2026-08-17 (`__fixtures__/`). Os dois achados que esta task existe para
 * registrar em código verificável são:
 *
 * 1. `discover` FUNCIONA contra a API pública real e acha o relatório da rodada.
 * 2. `parse` NÃO PODE funcionar: a única superfície buscável (`/poll/<slug>`) não
 *    tem percentual nem `tse_id`, e o relatório em PDF está num CDN cujo
 *    `robots.txt` real proíbe todo agente (docs/04 §6).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError } from '../poll-source-adapter.js';
import { HttpClient, RobotsDisallowedError } from '../http-client.js';
import type { FetchLike, HttpClientClock } from '../http-client.js';
import { RobotsCache } from '../robots.js';
import { PerHostRateLimiter } from '../rate-limiter.js';
import { makeRawFromBytes, makeReg, makeTempStorage, seedResolver } from '../base/test-support.js';
import { AtlasAdapter } from './atlas-adapter.js';
import { ATLAS_NO_PARSABLE_SOURCE } from './parse.js';
import { publicPollsUrl } from './public-polls-api.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const EXCLUSIVE = fixture('01-public-polls-exclusive-polls.json');
const POLL_PAGE = fixture('03-poll-brazil-national-2026-07-29.html');
const ROBOTS_CDN = fixture('04-robots-cdn.atlasintel.org.txt');

const FEED_URL = publicPollsUrl('exclusive-polls');
const REPORT_URL = 'https://cdn.atlasintel.org/498dd172-4381-4192-977c-c4af9787434f.pdf';

const noWaitClock: HttpClientClock = {
  now: () => 0,
  sleep: () => Promise.resolve(),
  random: () => 0,
};
const noWaitLimiter = (): PerHostRateLimiter =>
  new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() });

/** `robots.txt` REAL dos dois hosts: 404 no site, `Disallow: /` no CDN. */
const realRobots = (): RobotsCache =>
  new RobotsCache((robotsUrl) => {
    if (robotsUrl === 'https://cdn.atlasintel.org/robots.txt') {
      return Promise.resolve({ status: 200, body: ROBOTS_CDN });
    }
    if (robotsUrl === 'https://atlasintel.org/robots.txt') {
      return Promise.resolve({ status: 404, body: '' });
    }
    throw new Error(`robots.txt não previsto no teste: ${robotsUrl}`);
  });

interface Chamadas {
  urls: string[];
}

const fakeAtlas = (
  chamadas: Chamadas,
  body: string | { status: number; body: string },
): FetchLike => {
  return (url) => {
    chamadas.urls.push(url);
    const res = typeof body === 'string' ? { status: 200, body } : body;
    return Promise.resolve({
      status: res.status,
      headers: new Headers({ 'Content-Type': 'application/json; charset=utf-8' }),
      url,
      text: () => Promise.resolve(res.body),
    });
  };
};

const makeAdapter = (
  fetchImpl: FetchLike,
): { adapter: AtlasAdapter; storage: ReturnType<typeof makeTempStorage>['storage'] } => {
  const { storage } = makeTempStorage();
  const http = new HttpClient({
    fetchImpl,
    robots: realRobots(),
    rateLimiter: noWaitLimiter(),
    clock: noWaitClock,
  });
  return { adapter: new AtlasAdapter({ resolveCandidate: seedResolver, http, storage }), storage };
};

describe('AtlasAdapter.discover (API pública real)', () => {
  it('acha o relatório da rodada nacional com UMA requisição', async () => {
    const chamadas: Chamadas = { urls: [] };
    const { adapter } = makeAdapter(fakeAtlas(chamadas, EXCLUSIVE));

    const candidates = await adapter.discover(
      makeReg({ instituteId: 'atlas', fieldStart: '2026-07-22', fieldEnd: '2026-07-27' }),
    );

    expect(chamadas.urls).toEqual([FEED_URL]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.url).toBe(REPORT_URL);
    // O motivo diz onde o número está E que o robots do CDN barra o caminho.
    expect(candidates[0]?.reason).toContain('cdn.atlasintel.org');
  });

  it('devolve vazio (legítimo) quando a Atlas ainda não publicou a rodada', async () => {
    const chamadas: Chamadas = { urls: [] };
    const { adapter } = makeAdapter(fakeAtlas(chamadas, EXCLUSIVE));
    const candidates = await adapter.discover(
      makeReg({ instituteId: 'atlas', fieldStart: '2026-08-10', fieldEnd: '2026-08-15' }),
    );
    expect(candidates).toEqual([]);
  });

  it('LANÇA quando o feed vem VAZIO — zero silencioso foi o bug do Q-09 (R4)', async () => {
    const chamadas: Chamadas = { urls: [] };
    const { adapter } = makeAdapter(fakeAtlas(chamadas, '{"data":[]}'));
    await expect(adapter.discover(makeReg({ instituteId: 'atlas' }))).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('LANÇA quando o feed responde 4xx', async () => {
    const chamadas: Chamadas = { urls: [] };
    const { adapter } = makeAdapter(fakeAtlas(chamadas, { status: 404, body: 'not found' }));
    await expect(adapter.discover(makeReg({ instituteId: 'atlas' }))).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('canHandle casa pelo instituteId do registro', () => {
    const { adapter } = makeAdapter(fakeAtlas({ urls: [] }, EXCLUSIVE));
    expect(adapter.canHandle(makeReg({ instituteId: 'atlas' }))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
  });
});

describe('o bloqueio: robots.txt REAL do CDN que hospeda o relatório', () => {
  it('o HttpClient RECUSA o relatório e ACEITA o feed', async () => {
    // Este é o teste que sustenta a conclusão da task. As regras vêm do arquivo
    // capturado byte-a-byte (`User-agent: *` + `Disallow: /`), passando pelo
    // RobotsCache de produção — nenhuma regra foi reescrita aqui.
    const chamadas: Chamadas = { urls: [] };
    const http = new HttpClient({
      fetchImpl: fakeAtlas(chamadas, EXCLUSIVE),
      robots: realRobots(),
      rateLimiter: noWaitLimiter(),
      clock: noWaitClock,
    });

    await expect(http.request({ url: REPORT_URL })).rejects.toBeInstanceOf(RobotsDisallowedError);
    const feed = await http.request({ url: FEED_URL });
    expect(feed.status).toBe(200);
    // A requisição proibida nunca chegou à rede.
    expect(chamadas.urls).toEqual([FEED_URL]);
  });

  it('o robots capturado é exatamente o que o CDN respondeu', () => {
    expect(ROBOTS_CDN.trim()).toBe('User-agent: *\nDisallow: /');
  });
});

describe('AtlasAdapter.parse — recusa documentada, nunca parcial', () => {
  const rawFrom = async (
    body: string | Uint8Array,
    contentType: string,
    url = 'https://atlasintel.org/poll/brazil-national-2026-07-29',
  ): Promise<{ raw: RawDocument; adapter: AtlasAdapter }> => {
    const chamadas: Chamadas = { urls: [] };
    const { adapter, storage } = makeAdapter(fakeAtlas(chamadas, EXCLUSIVE));
    const raw = await makeRawFromBytes(storage, body, contentType, url);
    return { raw, adapter };
  };

  it('ACHADO CENTRAL: a página real da rodada não tem tse_id ⇒ V6 recusa', async () => {
    // A publicação buscável não traz o número de registro exigido pela Lei
    // 9.504/1997 na divulgação. Sem ele, o V6 do BaseAdapter recusa antes de
    // qualquer extração — que é o comportamento correto (docs/04 §4.1).
    const { raw, adapter } = await rawFrom(POLL_PAGE, 'text/html; charset=utf-8');
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'atlas', tseId: 'BR-06591/2026' })),
    ).rejects.toThrow(/V6/);
    expect(/BR-?\d{4,6}\s*\/\s*\d{4}/.test(POLL_PAGE)).toBe(false);
  });

  it('documento de OUTRA rodada ⇒ V6 recusa (teste explícito)', async () => {
    // Sonda de V6, não fixture: um texto mínimo com o registro de OUTRA rodada.
    // Não afirma nada sobre a estrutura da Atlas — exercita só a nossa guarda
    // contra atribuir números da rodada errada.
    const { raw, adapter } = await rawFrom('Registro TSE BR-07185/2026', 'text/plain');
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'atlas', tseId: 'BR-06591/2026' })),
    ).rejects.toThrow(/V6/);
  });

  it('mesmo com o tse_id CERTO, a extração recusa — e diz por quê', async () => {
    // Prova que a recusa não é efeito colateral do V6: aqui o V6 PASSA e a
    // extração ainda se recusa a inventar estrutura de PDF não capturado (Q-09).
    const { raw, adapter } = await rawFrom('Registro TSE BR-06591/2026', 'text/plain');
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'atlas', tseId: 'BR-06591/2026' })),
    ).rejects.toThrow(ATLAS_NO_PARSABLE_SOURCE);
  });

  it('Content-Type desconhecido LANÇA — não adivinhamos formato (R4)', async () => {
    const { raw, adapter } = await rawFrom('bytes', 'image/png');
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'atlas', tseId: 'BR-06591/2026' })),
    ).rejects.toBeInstanceOf(ParseError);
  });

  it('o caminho de PDF está ligado ao extrator do cnt-mda e falha alto', async () => {
    // Não existe PDF real da Atlas para congelar (o CDN proíbe), então o que se
    // pode afirmar hoje é que o despacho por Content-Type vai para
    // `extractPdfText` e que bytes ilegíveis LANÇAM em vez de virar texto vazio.
    const { raw, adapter } = await rawFrom(
      new Uint8Array([0x00, 0x01, 0x02, 0x03]),
      'application/pdf',
      REPORT_URL,
    );
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'atlas', tseId: 'BR-06591/2026' })),
    ).rejects.toBeInstanceOf(ParseError);
  });
});
