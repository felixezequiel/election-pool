import { describe, it, expect, vi } from 'vitest';
import { AlertSink, alertsFromHealth, DIST_STALE_MAX_HOURS } from './alerts.js';

/**
 * Alertas (docs/02 §5, aceite T-14: o alerta DISPARA de fato no cenário simulado —
 * testar, não presumir). Cobrimos os dois gatilhos (adapter em falha, dist velho),
 * o destino padrão (log de erro) e o webhook configurável.
 */

describe('alertsFromHealth (gatilhos docs/02 §5)', () => {
  it('adapter em falha ⇒ alerta adapter_failing', () => {
    const alerts = alertsFromHealth({
      failingAdapters: [{ adapterId: 'nexus', consecutive: 3 }],
      dist: { stale: false, ageSeconds: 100, exists: true },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('adapter_failing');
    expect(alerts[0]?.message).toContain('nexus');
    expect(alerts[0]?.message).toContain('3');
  });

  it('dist velho ⇒ alerta dist_stale', () => {
    const overSixHours = (DIST_STALE_MAX_HOURS + 1) * 3600;
    const alerts = alertsFromHealth({
      failingAdapters: [],
      dist: { stale: true, ageSeconds: overSixHours, exists: true },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.kind).toBe('dist_stale');
  });

  it('saudável ⇒ nenhum alerta', () => {
    const alerts = alertsFromHealth({
      failingAdapters: [],
      dist: { stale: false, ageSeconds: 60, exists: true },
    });
    expect(alerts).toHaveLength(0);
  });
});

describe('AlertSink (aceite T-14: o alerta dispara de fato)', () => {
  it('sem webhook ⇒ SEMPRE loga em error (destino padrão docs/02 §5)', async () => {
    const lines: string[] = [];
    const sink = new AlertSink({ logError: (l) => lines.push(l) });
    const outcome = await sink.fire({
      kind: 'dist_stale',
      message: 'velho',
      detail: { ageSeconds: 99999 },
    });
    expect(outcome.logged).toBe(true);
    expect(outcome.webhookPosted).toBe(false);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}') as { level: string; kind: string };
    expect(parsed.level).toBe('error');
    expect(parsed.kind).toBe('dist_stale');
  });

  it('com webhook ⇒ POSTa JSON no destino configurado', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true } as Response);
    const sink = new AlertSink({
      webhookUrl: 'https://hooks.example.org/alert',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logError: () => {},
    });
    const outcome = await sink.fire({
      kind: 'adapter_failing',
      message: 'nexus falhou 3 ciclos',
      detail: { adapterId: 'nexus', consecutive: 3 },
    });
    expect(outcome.webhookPosted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, { method?: string; body?: string }];
    expect(url).toBe('https://hooks.example.org/alert');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body ?? '{}') as { kind: string };
    expect(body.kind).toBe('adapter_failing');
  });

  it('webhook indisponível NÃO derruba: ainda loga erro, não lança', async () => {
    const lines: string[] = [];
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const sink = new AlertSink({
      webhookUrl: 'https://down.example.org',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logError: (l) => lines.push(l),
    });
    const outcome = await sink.fire({ kind: 'dist_stale', message: 'velho', detail: {} });
    expect(outcome.logged).toBe(true);
    expect(outcome.webhookPosted).toBe(false);
    // Dois logs de erro: o alerta e a falha do webhook.
    expect(lines.length).toBe(2);
  });
});
