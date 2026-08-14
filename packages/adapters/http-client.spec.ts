import { describe, it, expect, vi } from 'vitest';
import { HttpClient, HttpError, RobotsDisallowedError, DEFAULT_USER_AGENT } from './http-client.js';
import type { FetchLike, HttpClientClock } from './http-client.js';
import { RobotsCache } from './robots.js';
import { PerHostRateLimiter } from './rate-limiter.js';

const noWaitClock = (): HttpClientClock => ({
  now: () => 0,
  sleep: () => Promise.resolve(),
  random: () => 0.5,
});

/** Rate limiter que nunca espera (relógio zerado, sleep no-op). */
const noWaitLimiter = (): PerHostRateLimiter =>
  new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() });

/** Robots que permite tudo (404). */
const allowAllRobots = (): RobotsCache =>
  new RobotsCache(() => Promise.resolve({ status: 404, body: '' }));

const makeResponse = (
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Awaited<ReturnType<FetchLike>> => ({
  status,
  headers: new Headers(headers),
  url: 'https://host.example/doc',
  text: () => Promise.resolve(body),
});

const baseDeps = (fetchImpl: FetchLike) => ({
  fetchImpl,
  robots: allowAllRobots(),
  rateLimiter: noWaitLimiter(),
  clock: noWaitClock(),
});

describe('HttpClient', () => {
  it('sends the identifiable User-Agent', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(makeResponse(200, 'ok')));
    const client = new HttpClient(baseDeps(fetchImpl));
    await client.request({ url: 'https://host.example/doc' });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.headers['User-Agent']).toBe(DEFAULT_USER_AGENT);
  });

  it('sends conditional GET headers when etag/lastModified are provided', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(makeResponse(200, 'ok')));
    const client = new HttpClient(baseDeps(fetchImpl));
    await client.request({
      url: 'https://host.example/doc',
      etag: 'W/"abc"',
      lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT',
    });
    const [, init] = fetchImpl.mock.calls[0]!;
    expect(init.headers['If-None-Match']).toBe('W/"abc"');
    expect(init.headers['If-Modified-Since']).toBe('Wed, 21 Oct 2026 07:28:00 GMT');
  });

  it('returns notModified=true with empty body on 304', async () => {
    const fetchImpl = vi.fn<FetchLike>(() =>
      Promise.resolve(makeResponse(304, 'SHOULD NOT BE READ')),
    );
    const client = new HttpClient(baseDeps(fetchImpl));
    const res = await client.request({ url: 'https://host.example/doc', etag: '"x"' });
    expect(res.notModified).toBe(true);
    expect(res.status).toBe(304);
    expect(res.body).toBe('');
  });

  it('retries on 5xx up to 2 times then succeeds', async () => {
    let n = 0;
    const fetchImpl = vi.fn<FetchLike>(() => {
      n += 1;
      return Promise.resolve(n < 3 ? makeResponse(503, 'busy') : makeResponse(200, 'ok'));
    });
    const client = new HttpClient(baseDeps(fetchImpl));
    const res = await client.request({ url: 'https://host.example/doc' });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries on network error then throws HttpError after 3 attempts', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.reject(new Error('ECONNRESET')));
    const client = new HttpClient(baseDeps(fetchImpl));
    await expect(client.request({ url: 'https://host.example/doc' })).rejects.toBeInstanceOf(
      HttpError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 4xx', async () => {
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(makeResponse(404, 'nope')));
    const client = new HttpClient(baseDeps(fetchImpl));
    const res = await client.request({ url: 'https://host.example/doc' });
    expect(res.status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('backoff uses exponential ceilings with full jitter', async () => {
    const sleeps: number[] = [];
    const clock: HttpClientClock = {
      now: () => 0,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      random: () => 1, // jitter at the full ceiling for a deterministic assertion
    };
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(makeResponse(500, 'err')));
    const client = new HttpClient({
      fetchImpl,
      robots: allowAllRobots(),
      rateLimiter: noWaitLimiter(),
      clock,
    });
    await expect(client.request({ url: 'https://host.example/doc' })).rejects.toBeInstanceOf(
      HttpError,
    );
    // retry 1 -> ceiling 500*2^0=500, retry 2 -> 500*2^1=1000; full jitter with
    // random()=1 hits the ceiling exactly.
    expect(sleeps).toEqual([500, 1000]);
  });

  it('refuses when robots.txt disallows the path', async () => {
    const robots = new RobotsCache(() =>
      Promise.resolve({ status: 200, body: 'User-agent: *\nDisallow: /doc' }),
    );
    const fetchImpl = vi.fn<FetchLike>(() => Promise.resolve(makeResponse(200, 'ok')));
    const client = new HttpClient({
      fetchImpl,
      robots,
      rateLimiter: noWaitLimiter(),
      clock: noWaitClock(),
    });
    await expect(client.request({ url: 'https://host.example/doc' })).rejects.toBeInstanceOf(
      RobotsDisallowedError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
