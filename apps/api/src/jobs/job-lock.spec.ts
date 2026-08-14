import { describe, it, expect } from 'vitest';
import { JobLock } from './job-lock.js';

/**
 * Lock que impede sobreposição do MESMO job (aceite T-14). O caso central: duas
 * execuções simultâneas do mesmo job ⇒ a segunda NÃO roda.
 */
describe('JobLock (aceite T-14: sem sobreposição do mesmo job)', () => {
  it('a segunda execução simultânea do mesmo job não roda', async () => {
    const lock = new JobLock();
    let firstStarted = false;
    let releaseFirst!: () => void;
    const firstBlocker = new Promise<void>((resolve) => (releaseFirst = resolve));

    let firstBodyRan = 0;
    let secondBodyRan = 0;

    // Primeiro run: entra no lock e fica "trabalhando" até liberarmos.
    const first = lock.run('harvest', async () => {
      firstStarted = true;
      firstBodyRan++;
      await firstBlocker;
      return 'first';
    });

    // Enquanto o primeiro trabalha, dispara o segundo run do MESMO job.
    await Promise.resolve();
    expect(firstStarted).toBe(true);
    expect(lock.isLocked('harvest')).toBe(true);

    const second = await lock.run('harvest', () => {
      secondBodyRan++;
      return Promise.resolve('second');
    });

    // A segunda NÃO rodou (descartada).
    expect(second.ran).toBe(false);
    expect(secondBodyRan).toBe(0);

    // Libera o primeiro e confirma que ele completou.
    releaseFirst();
    const firstOutcome = await first;
    expect(firstOutcome).toEqual({ ran: true, result: 'first' });
    expect(firstBodyRan).toBe(1);

    // Após liberar, o job pode rodar de novo (lock disponível).
    expect(lock.isLocked('harvest')).toBe(false);
    const third = await lock.run('harvest', () => Promise.resolve('third'));
    expect(third).toEqual({ ran: true, result: 'third' });
  });

  it('jobs distintos rodam em paralelo (lock é por nome)', async () => {
    const lock = new JobLock();
    let releaseA!: () => void;
    const blockA = new Promise<void>((r) => (releaseA = r));

    const a = lock.run('discovery', async () => {
      await blockA;
      return 'a';
    });
    await Promise.resolve();

    // Outro job (harvest) roda mesmo com discovery travado.
    const b = await lock.run('harvest', () => Promise.resolve('b'));
    expect(b).toEqual({ ran: true, result: 'b' });

    releaseA();
    expect(await a).toEqual({ ran: true, result: 'a' });
  });

  it('libera o lock mesmo se o job lançar', async () => {
    const lock = new JobLock();
    await expect(lock.run('model', () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    // Lock liberado ⇒ pode rodar de novo.
    expect(lock.isLocked('model')).toBe(false);
    const ok = await lock.run('model', () => Promise.resolve('ok'));
    expect(ok).toEqual({ ran: true, result: 'ok' });
  });
});
