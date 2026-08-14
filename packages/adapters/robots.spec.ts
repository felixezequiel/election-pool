import { describe, it, expect, vi } from 'vitest';
import { RobotsCache, __test } from './robots.js';
import type { RobotsFetchResult } from './robots.js';

const { parseRobotsTxt, isAllowedByRules } = __test;

describe('parseRobotsTxt + isAllowedByRules', () => {
  it('allows everything when Disallow is empty', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow:');
    expect(isAllowedByRules(rules, '/anything')).toBe(true);
  });

  it('honors the most specific (longest) matching rule; Allow wins ties', () => {
    const rules = parseRobotsTxt('User-agent: *\nDisallow: /a\nAllow: /a/b');
    expect(isAllowedByRules(rules, '/a/x')).toBe(false);
    expect(isAllowedByRules(rules, '/a/b/c')).toBe(true);
  });

  it('prefers the group matching our UA token over the wildcard', () => {
    const body = [
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: election-pool',
      'Disallow: /private',
    ].join('\n');
    const rules = parseRobotsTxt(body);
    expect(isAllowedByRules(rules, '/public')).toBe(true);
    expect(isAllowedByRules(rules, '/private/x')).toBe(false);
  });
});

describe('RobotsCache', () => {
  it('treats 404 robots.txt as allow-all (RFC 9309)', async () => {
    const fetcher = vi.fn(
      (): Promise<RobotsFetchResult> => Promise.resolve({ status: 404, body: 'Not Found' }),
    );
    const cache = new RobotsCache(fetcher);
    expect(await cache.isAllowed('https://host.example/x')).toBe(true);
  });

  it('respects Disallow from a 200 robots.txt', async () => {
    const fetcher = vi.fn(
      (): Promise<RobotsFetchResult> =>
        Promise.resolve({ status: 200, body: 'User-agent: *\nDisallow: /secret' }),
    );
    const cache = new RobotsCache(fetcher);
    expect(await cache.isAllowed('https://host.example/secret/page')).toBe(false);
    expect(await cache.isAllowed('https://host.example/open')).toBe(true);
  });

  it('caches for 24h then refetches after expiry', async () => {
    let clock = 0;
    const fetcher = vi.fn(
      (): Promise<RobotsFetchResult> =>
        Promise.resolve({ status: 200, body: 'User-agent: *\nDisallow:' }),
    );
    const cache = new RobotsCache(fetcher, () => clock);

    await cache.isAllowed('https://host.example/a');
    await cache.isAllowed('https://host.example/b');
    expect(fetcher).toHaveBeenCalledTimes(1); // second read served from cache

    clock += 24 * 60 * 60 * 1000 + 1; // just past 24h
    await cache.isAllowed('https://host.example/c');
    expect(fetcher).toHaveBeenCalledTimes(2); // refetched after TTL
  });

  it('falls back to allow-all when the fetcher throws (network down)', async () => {
    const fetcher = vi.fn(
      (): Promise<RobotsFetchResult> => Promise.reject(new Error('ENETUNREACH')),
    );
    const cache = new RobotsCache(fetcher);
    expect(await cache.isAllowed('https://host.example/x')).toBe(true);
  });
});
