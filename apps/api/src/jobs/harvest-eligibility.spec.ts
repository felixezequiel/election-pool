import { describe, it, expect } from 'vitest';
import { decideHarvest } from './harvest-eligibility.js';

/**
 * Backoff de docs/02 §3.2 como lógica pura. Base de tempo: field_end.
 */

const now = '2026-08-20T12:00:00-03:00';
const t = (iso: string): string => iso;

describe('decideHarvest (backoff docs/02 §3.2)', () => {
  it('já tem resultado ⇒ skip', () => {
    expect(
      decideHarvest({
        fieldEndIso: '2026-08-19',
        hasResult: true,
        lastAttemptIso: null,
        nowIso: now,
      }).action,
    ).toBe('skip');
  });

  it('campo ainda aberto ⇒ skip (nada a buscar)', () => {
    const d = decideHarvest({
      fieldEndIso: '2026-08-25T00:00:00-03:00',
      hasResult: false,
      lastAttemptIso: null,
      nowIso: now,
    });
    expect(d).toEqual({ action: 'skip', reason: 'field_open' });
  });

  it('dentro das primeiras 72h ⇒ tenta a cada ciclo (sem cooldown)', () => {
    const d = decideHarvest({
      fieldEndIso: '2026-08-19T12:00:00-03:00', // 24h atrás
      hasResult: false,
      lastAttemptIso: '2026-08-20T10:00:00-03:00', // tentou há 2h
      nowIso: now,
    });
    expect(d).toEqual({ action: 'attempt', reason: 'fresh_window' });
  });

  it('72h–15d, sem tentativa recente ⇒ tenta', () => {
    const d = decideHarvest({
      fieldEndIso: '2026-08-15T12:00:00-03:00', // 5 dias atrás
      hasResult: false,
      lastAttemptIso: null,
      nowIso: now,
    });
    expect(d).toEqual({ action: 'attempt', reason: 'slow_window' });
  });

  it('72h–15d, tentou há menos de 12h ⇒ skip (cooldown de 2×/dia)', () => {
    const d = decideHarvest({
      fieldEndIso: '2026-08-15T12:00:00-03:00',
      hasResult: false,
      lastAttemptIso: '2026-08-20T06:00:00-03:00', // 6h atrás
      nowIso: now,
    });
    expect(d).toEqual({ action: 'skip', reason: 'slow_window_cooldown' });
  });

  it('72h–15d, tentou há mais de 12h ⇒ tenta', () => {
    const d = decideHarvest({
      fieldEndIso: '2026-08-15T12:00:00-03:00',
      hasResult: false,
      lastAttemptIso: '2026-08-19T20:00:00-03:00', // 16h atrás
      nowIso: now,
    });
    expect(d).toEqual({ action: 'attempt', reason: 'slow_window' });
  });

  it('após 15 dias sem resultado ⇒ presume_undisclosed (para)', () => {
    const d = decideHarvest({
      fieldEndIso: t('2026-08-04T12:00:00-03:00'), // 16 dias atrás
      hasResult: false,
      lastAttemptIso: null,
      nowIso: now,
    });
    expect(d).toEqual({ action: 'presume_undisclosed', reason: 'past_deadline' });
  });

  it('exatamente no limite de 15 dias ⇒ presume_undisclosed', () => {
    const d = decideHarvest({
      fieldEndIso: '2026-08-05T12:00:00-03:00', // 15 dias exatos
      hasResult: false,
      lastAttemptIso: null,
      nowIso: now,
    });
    expect(d.action).toBe('presume_undisclosed');
  });
});
