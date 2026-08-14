import { describe, it, expect } from 'vitest';
import { runMigrations } from './migrate.js';

/**
 * Aceite T-14 (docs/02 §7): falha de migration impede o boot da API. O boot real
 * (`main.ts`) chama `runMigrations` ANTES de agendar qualquer job; se ela lançar, o
 * processo sai != 0 e os jobs nunca começam.
 *
 * `runMigrations` delega à CLI `node-pg-migrate --tsx` (o caminho já provado em
 * dev, que resolve os subpaths de `@election-pool/contracts` nas migrations `.ts`).
 * Testamos os dois lados:
 *  - contra o banco de teste (já migrado) resolve — idempotente, "nada a aplicar";
 *  - contra um DATABASE_URL inalcançável REJEITA — o sinal que aborta o boot.
 */

const databaseUrl = (): string => {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0)
    throw new Error('DATABASE_URL ausente (rode via pnpm test)');
  return url;
};

describe('runMigrations (docs/02 §7: falha de migration impede o boot)', () => {
  it('a cadeia real de migrations resolve (idempotente contra o banco migrado)', async () => {
    const result = await runMigrations(databaseUrl());
    expect(result).toHaveProperty('output');
  });

  it('DATABASE_URL inalcançável ⇒ REJEITA (o main.ts aborta o boot com esse sinal)', async () => {
    await expect(runMigrations('postgres://nobody:nobody@127.0.0.1:1/none')).rejects.toBeInstanceOf(
      Error,
    );
  });
});
