import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PesqEleClient } from './client.js';
import { HttpClient } from '../http-client.js';
import type { FetchLike, HttpClientClock } from '../http-client.js';
import { RobotsCache } from '../robots.js';
import { PerHostRateLimiter } from '../rate-limiter.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const noWaitClock = (): HttpClientClock => ({
  now: () => 0,
  sleep: () => Promise.resolve(),
  random: () => 0,
});
const noWaitLimiter = (): PerHostRateLimiter =>
  new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() });
const allowAllRobots = (): RobotsCache =>
  new RobotsCache(() => Promise.resolve({ status: 404, body: '' }));

const response = (body: string, headers: Record<string, string> = {}): ReturnType<FetchLike> =>
  Promise.resolve({
    status: 200,
    headers: new Headers(headers),
    url: 'https://pesqele-divulgacao.tse.jus.br/index.xhtml',
    text: () => Promise.resolve(body),
  });

const makeClient = (
  fetchImpl: FetchLike,
  now: () => Date = () => new Date('2026-08-14T12:00:00Z'),
): PesqEleClient => {
  const http = new HttpClient({
    fetchImpl,
    robots: allowAllRobots(),
    rateLimiter: noWaitLimiter(),
    clock: noWaitClock(),
  });
  return new PesqEleClient({ http, now });
};

const collect = async (client: PesqEleClient): Promise<string[]> => {
  const ids: string[] = [];
  for await (const page of client.discover()) {
    for (const reg of page) ids.push(reg.tseId);
  }
  return ids;
};

describe('PesqEleClient JSF/ViewState flow', () => {
  it('establishes session, applies filters, and paginates through all pages', async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn<FetchLike>((_url, init) => {
      if (init.method === 'GET')
        return response(fixture('index.html'), { 'set-cookie': 'JSESSIONID=abc; path=/' });
      const body = init.body ?? '';
      bodies.push(body);
      // formAviso submit -> return a page that still has a ViewState (index re-render)
      if (body.includes('formAviso')) return response(fixture('index.html'));
      // filter POST -> page 1; page POST for page 2 -> page 2
      if (body.includes(encodeURIComponent('formPesquisa:tabela:pagina') + '=2')) {
        return response(fixture('results-page-2.html'));
      }
      return response(fixture('results-page-1.html'));
    });

    const client = makeClient(fetchImpl);
    const ids = await collect(client);

    expect(ids).toEqual(['BR-06591/2026', 'BR-06592/2026', 'BR-06593/2026']);

    // The filter POST must carry the ViewState extracted from the landing page.
    const filterBody = bodies.find((b) => b.includes('btnPesquisar'))!;
    expect(filterBody).toContain(`${encodeURIComponent('javax.faces.ViewState')}=VS-INDEX-0001`);
    // The election/scope/window filters are present.
    expect(filterBody).toContain(`${encodeURIComponent('formPesquisa:eleicao')}=2026`);
    expect(filterBody).toContain(`${encodeURIComponent('formPesquisa:abrangencia')}=BR`);

    // Page-2 POST must carry the ViewState from page 1 (resubmitted, not stale).
    const page2Body = bodies.find((b) =>
      b.includes(encodeURIComponent('formPesquisa:tabela:pagina') + '=2'),
    )!;
    expect(page2Body).toContain(`${encodeURIComponent('javax.faces.ViewState')}=VS-RESULTS-P1`);
  });

  it('re-establishes the session ONCE on ViewState expiry without looping', async () => {
    let filterAttempts = 0;
    const fetchImpl = vi.fn<FetchLike>((_url, init) => {
      if (init.method === 'GET') return response(fixture('index.html'));
      const body = init.body ?? '';
      if (body.includes('formAviso')) return response(fixture('index.html'));
      if (body.includes('btnPesquisar')) {
        filterAttempts += 1;
        // First filter attempt: session expired. After re-establish: succeed.
        return filterAttempts === 1
          ? response(fixture('session-expired.html'))
          : response(fixture('results-page-2.html')); // single-page result
      }
      return response(fixture('results-page-2.html'));
    });

    const client = makeClient(fetchImpl);
    const ids = await collect(client);

    expect(ids).toEqual(['BR-06593/2026']);
    expect(filterAttempts).toBe(2); // retried exactly once after expiry
  });

  it('aborts (throws) if the session expires repeatedly — no infinite loop', async () => {
    const fetchImpl = vi.fn<FetchLike>((_url, init) => {
      if (init.method === 'GET') return response(fixture('index.html'));
      const body = init.body ?? '';
      if (body.includes('formAviso')) return response(fixture('index.html'));
      // Every filter POST reports expiry.
      return response(fixture('session-expired.html'));
    });

    const client = makeClient(fetchImpl);
    await expect(collect(client)).rejects.toThrow(/expirou repetidamente/);
  });
});
