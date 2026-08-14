/**
 * Alertas de staleness/falha (docs/02 §5, T-14 aceite). Dois gatilhos:
 *  1. um adapter falhando validação por 3 ciclos consecutivos
 *     (`AdapterFailureCounter`, docs/04 §5);
 *  2. o `dist/` publicado com mais de 6h (dado velho no ar).
 *
 * Destino CONFIGURÁVEL: `ALERT_WEBHOOK_URL` recebe um POST JSON; sem ele, o padrão
 * é um log de nível `error` em stdout (journald), como docs/02 §5 especifica. O
 * disparo é "melhor esforço": uma falha ao POSTar o webhook NUNCA derruba o
 * orquestrador — o alerta ainda vira log de erro.
 *
 * Filosofia (docs/02 §5): monitoramos staleness e falha SILENCIOSA, não uptime.
 * Um alerta que não dispara é pior que um falso positivo.
 */

// docs/02 §5: dist com mais de 6 horas ⇒ alerta.
export const DIST_STALE_MAX_HOURS = 6;

export type AlertKind = 'adapter_failing' | 'dist_stale';

export interface Alert {
  kind: AlertKind;
  message: string;
  detail: Record<string, unknown>;
}

export interface AlertSinkDeps {
  /** URL do webhook; ausente ⇒ só log de erro (padrão docs/02 §5). */
  webhookUrl?: string | undefined;
  /** Injeção de fetch (teste); default global. */
  fetchImpl?: typeof fetch;
  /** Injeção de logger (teste); default console. */
  logError?: (line: string) => void;
}

/**
 * Despacha um alerta: sempre loga em `error` (journald) e, se houver webhook
 * configurado, faz um POST JSON. Retorna o desfecho para os testes afirmarem que
 * o alerta DE FATO disparou (aceite T-14: testar, não presumir).
 */
export class AlertSink {
  private readonly webhookUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly logError: (line: string) => void;

  constructor(deps: AlertSinkDeps = {}) {
    this.webhookUrl = deps.webhookUrl;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.logError = deps.logError ?? ((line: string): void => console.error(line));
  }

  async fire(alert: Alert): Promise<{ logged: boolean; webhookPosted: boolean }> {
    // Log estruturado de erro — sempre (o destino padrão de docs/02 §5).
    this.logError(
      JSON.stringify({
        level: 'error',
        event: 'alert',
        kind: alert.kind,
        message: alert.message,
        detail: alert.detail,
      }),
    );

    if (this.webhookUrl === undefined || this.webhookUrl.length === 0) {
      return { logged: true, webhookPosted: false };
    }
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(alert),
      });
      return { logged: true, webhookPosted: res.ok };
    } catch (err) {
      // Webhook indisponível NÃO pode derrubar o orquestrador — o log de erro já saiu.
      this.logError(
        JSON.stringify({
          level: 'error',
          event: 'alert_webhook_failed',
          kind: alert.kind,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      return { logged: true, webhookPosted: false };
    }
  }
}

/**
 * Deriva os alertas a disparar a partir de um snapshot de saúde (health.ts). Puro:
 * dado o estado, decide o que alertar. O chamador (main.ts) despacha via AlertSink.
 */
export const alertsFromHealth = (snapshot: {
  failingAdapters: { adapterId: string; consecutive: number }[];
  dist: { stale: boolean; ageSeconds: number | null; exists: boolean };
}): Alert[] => {
  const alerts: Alert[] = [];
  for (const a of snapshot.failingAdapters) {
    alerts.push({
      kind: 'adapter_failing',
      message: `adapter ${a.adapterId} falhou validação em ${String(a.consecutive)} ciclos consecutivos`,
      detail: { adapterId: a.adapterId, consecutive: a.consecutive },
    });
  }
  if (snapshot.dist.stale) {
    alerts.push({
      kind: 'dist_stale',
      message: `dist/ publicado há mais de ${String(DIST_STALE_MAX_HOURS)}h`,
      detail: { ageSeconds: snapshot.dist.ageSeconds },
    });
  }
  return alerts;
};
