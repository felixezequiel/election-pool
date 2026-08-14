import { describe, it, expect } from 'vitest';
import { AdapterFailureCounter, CONSECUTIVE_FAILURES_ALERT_THRESHOLD } from './failure-counter.js';

/**
 * Contador de falhas por adapter: 3 ciclos consecutivos com falha ⇒ alerta; um
 * ciclo limpo zera. Isola adapters entre si.
 */
describe('AdapterFailureCounter', () => {
  it('alerta somente no 3º ciclo consecutivo com falha', () => {
    const counter = new AdapterFailureCounter();
    counter.recordFailure('nexus');
    expect(counter.shouldAlert('nexus')).toBe(false);
    counter.recordFailure('nexus');
    expect(counter.shouldAlert('nexus')).toBe(false);
    counter.recordFailure('nexus');
    expect(counter.count('nexus')).toBe(CONSECUTIVE_FAILURES_ALERT_THRESHOLD);
    expect(counter.shouldAlert('nexus')).toBe(true);
  });

  it('um ciclo limpo zera a contagem consecutiva', () => {
    const counter = new AdapterFailureCounter();
    counter.recordFailure('nexus');
    counter.recordFailure('nexus');
    counter.recordSuccess('nexus');
    expect(counter.count('nexus')).toBe(0);
    counter.recordFailure('nexus');
    expect(counter.shouldAlert('nexus')).toBe(false);
  });

  it('adapters são independentes', () => {
    const counter = new AdapterFailureCounter();
    counter.recordFailure('nexus');
    counter.recordFailure('nexus');
    counter.recordFailure('nexus');
    expect(counter.shouldAlert('nexus')).toBe(true);
    expect(counter.shouldAlert('mda')).toBe(false);
    expect(counter.count('mda')).toBe(0);
  });
});
