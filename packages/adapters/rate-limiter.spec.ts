import { describe, it, expect } from 'vitest';
import { PerHostRateLimiter } from './rate-limiter.js';
import type { RateLimiterClock } from './rate-limiter.js';

/**
 * Relógio controlável: `now()` avança só quando o teste manda, e `sleep(ms)`
 * avança o relógio por `ms` na hora (simula o tempo passando sem esperar de
 * verdade). Registra os `sleep` para checar o espaçamento.
 */
const makeClock = (): {
  clock: RateLimiterClock;
  sleeps: number[];
  advance: (ms: number) => void;
} => {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    advance: (ms) => {
      t += ms;
    },
    clock: {
      now: () => t,
      sleep: (ms) => {
        sleeps.push(ms);
        t += ms;
        return Promise.resolve();
      },
    },
  };
};

describe('PerHostRateLimiter', () => {
  it('does not delay the first request to a host', async () => {
    const { clock, sleeps } = makeClock();
    const limiter = new PerHostRateLimiter(clock);
    await limiter.acquire('https://a.example/x');
    expect(sleeps).toEqual([]);
  });

  it('enforces 10s spacing between consecutive requests to the same host', async () => {
    const { clock, sleeps } = makeClock();
    const limiter = new PerHostRateLimiter(clock);

    await limiter.acquire('https://a.example/1'); // t=0
    await limiter.acquire('https://a.example/2'); // must wait 10s
    expect(sleeps).toEqual([10_000]);
  });

  it('does not wait if enough real time already elapsed', async () => {
    const { clock, sleeps, advance } = makeClock();
    const limiter = new PerHostRateLimiter(clock);

    await limiter.acquire('https://a.example/1'); // t=0
    advance(12_000); // 12s passed doing work
    await limiter.acquire('https://a.example/2');
    expect(sleeps).toEqual([]); // no extra wait needed
  });

  it('does not couple different hosts', async () => {
    const { clock, sleeps } = makeClock();
    const limiter = new PerHostRateLimiter(clock);

    await limiter.acquire('https://a.example/1');
    await limiter.acquire('https://b.example/1'); // different host, no wait
    expect(sleeps).toEqual([]);
  });

  it('serializes concurrent acquires to the same host, each spaced 10s', async () => {
    const { clock, sleeps } = makeClock();
    const limiter = new PerHostRateLimiter(clock);

    // Fire three concurrently.
    await Promise.all([
      limiter.acquire('https://a.example/1'),
      limiter.acquire('https://a.example/2'),
      limiter.acquire('https://a.example/3'),
    ]);
    // First is free; second and third each wait 10s.
    expect(sleeps).toEqual([10_000, 10_000]);
  });
});
