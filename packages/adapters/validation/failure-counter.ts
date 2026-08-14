/**
 * Contador de falhas de validação por adapter (docs/04 §5). Cada
 * ciclo de colheita que termina com ao menos uma falha de validação num adapter
 * incrementa o contador daquele adapter; um ciclo LIMPO o zera. Três ciclos
 * consecutivos com falha ⇒ o adapter é sinalizado (`shouldAlert`), sugerindo que
 * a fonte mudou de estrutura e o parser precisa de revisão — não é um evento
 * pontual, é uma tendência.
 *
 * Estado em memória, escopo de processo. O HarvestJob mantém UMA instância viva
 * entre execuções (é o orquestrador/cron que a segura). Não persiste no banco: a
 * decisão de alertar é operacional, não é dado de pesquisa. Um limite (3) vindo
 * da spec — sem literal solto, exposto como constante nomeada aqui.
 */

// docs/04 §5: 3 ciclos consecutivos com falha de validação ⇒ alerta.
export const CONSECUTIVE_FAILURES_ALERT_THRESHOLD = 3;

export class AdapterFailureCounter {
  private readonly consecutive = new Map<string, number>();

  /** Registra um ciclo COM falha de validação; devolve o total consecutivo. */
  recordFailure(adapterId: string): number {
    const next = (this.consecutive.get(adapterId) ?? 0) + 1;
    this.consecutive.set(adapterId, next);
    return next;
  }

  /** Registra um ciclo SEM falha: zera a contagem consecutiva do adapter. */
  recordSuccess(adapterId: string): void {
    this.consecutive.set(adapterId, 0);
  }

  /** Falhas consecutivas correntes do adapter. */
  count(adapterId: string): number {
    return this.consecutive.get(adapterId) ?? 0;
  }

  /** `true` quando o adapter cruzou o limiar de ciclos consecutivos com falha. */
  shouldAlert(adapterId: string): boolean {
    return this.count(adapterId) >= CONSECUTIVE_FAILURES_ALERT_THRESHOLD;
  }

  /**
   * Adapters atualmente no estado de alerta (≥ limiar de ciclos consecutivos com
   * falha), com sua contagem. Consumido pelo `/health` (docs/02 §5: contagem de
   * adapters em falha) e pelo gate de publicação §6.6. Só leitura — não muta estado.
   */
  failing(): ReadonlyArray<{ adapterId: string; consecutive: number }> {
    const out: { adapterId: string; consecutive: number }[] = [];
    for (const [adapterId, consecutive] of this.consecutive) {
      if (consecutive >= CONSECUTIVE_FAILURES_ALERT_THRESHOLD) {
        out.push({ adapterId, consecutive });
      }
    }
    out.sort((a, b) => (a.adapterId < b.adapterId ? -1 : a.adapterId > b.adapterId ? 1 : 0));
    return out;
  }
}
