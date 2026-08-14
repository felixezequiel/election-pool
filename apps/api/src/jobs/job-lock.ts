/**
 * Lock in-process que impede a SOBREPOSIÇÃO de execuções do mesmo job (docs/02 §5,
 * aceite T-14: duas execuções simultâneas do mesmo job ⇒ a segunda não roda).
 *
 * Um único processo orquestrador (a VPS roda um `api`, docs/02 §7) segura este
 * lock; o cron dispara o mesmo job a cada 2h, mas um run lento (harvest com muitas
 * URLs) pode passar do próximo tick. Sem lock, dois harvests concorrentes
 * competiriam pelas mesmas URLs e conexões. O lock é por NOME de job: discovery e
 * harvest podem rodar em paralelo entre si; dois discovery, não.
 *
 * É deliberadamente in-memory (não advisory lock no Postgres): a exclusão que
 * importa é entre ticks do MESMO processo. Se um dia houver mais de uma instância,
 * migra-se para `pg_advisory_lock` — registrado como evolução, não necessário na v1
 * de VPS única (docs/02 §7).
 */

export class JobLock {
  private readonly held = new Set<string>();

  /** true se o job está executando agora. */
  isLocked(job: string): boolean {
    return this.held.has(job);
  }

  /**
   * Roda `fn` sob o lock do job. Se já estiver travado, NÃO executa e devolve
   * `{ ran: false }` — a segunda execução simultânea é descartada (o cron tentará
   * de novo no próximo tick). Libera o lock mesmo se `fn` lançar.
   */
  async run<T>(
    job: string,
    fn: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    if (this.held.has(job)) {
      return { ran: false };
    }
    this.held.add(job);
    try {
      const result = await fn();
      return { ran: true, result };
    } finally {
      this.held.delete(job);
    }
  }
}
