/**
 * Rate limiter por host: no máximo 1 requisição a cada 10s por host (docs/04 §6).
 * Compartilhado por todos os adapters — uma instância por processo garante o
 * espaçamento mesmo entre adapters diferentes que batem no mesmo host.
 *
 * Serializa por host: chamadas concorrentes ao mesmo host formam fila e são
 * liberadas uma a uma, cada uma esperando até 10s depois da anterior começar.
 * Hosts diferentes não se bloqueiam.
 *
 * O relógio (`now`) e o `sleep` são injetáveis para teste com fake timers.
 */

const MIN_INTERVAL_MS = 10_000; // 1 req / 10s por host (docs/04 §6)

export interface RateLimiterClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realClock: RateLimiterClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class PerHostRateLimiter {
  /** Cauda da fila por host: cada `acquire` encadeia depois da anterior. */
  private readonly tail = new Map<string, Promise<void>>();
  private readonly lastStartAt = new Map<string, number>();

  constructor(
    private readonly clock: RateLimiterClock = realClock,
    private readonly minIntervalMs: number = MIN_INTERVAL_MS,
  ) {}

  /**
   * Resolve quando é permitido bater no host de `targetUrl`. Espera o tempo
   * necessário desde a última liberação do MESMO host. Sequencial por host.
   */
  async acquire(targetUrl: string): Promise<void> {
    const host = new URL(targetUrl).host;
    const previous = this.tail.get(host) ?? Promise.resolve();
    const mine = previous.then(() => this.waitTurn(host));
    // Guarda uma versão que nunca rejeita, para não quebrar a cadeia do host.
    this.tail.set(
      host,
      mine.catch(() => undefined),
    );
    await mine;
  }

  private async waitTurn(host: string): Promise<void> {
    const last = this.lastStartAt.get(host);
    if (last !== undefined) {
      const wait = last + this.minIntervalMs - this.clock.now();
      if (wait > 0) {
        await this.clock.sleep(wait);
      }
    }
    this.lastStartAt.set(host, this.clock.now());
  }
}
