import pg from 'pg';
import type { PoolConfig, QueryResultRow } from 'pg';

const { Pool } = pg;
type Pool = pg.Pool;

/**
 * Pool `pg` compartilhado. Acesso a dados é SQL explícito, sem ORM (docs/02 §2).
 * A connection string vem de `DATABASE_URL` (infra/.env em dev). Nunca embutimos
 * credenciais no código.
 *
 * Falha alta, nunca silenciosa (R4): se `DATABASE_URL` faltar, lançamos em vez de
 * conectar a um default surpresa.
 */

export interface Database {
  query<Row extends QueryResultRow>(text: string, params?: readonly unknown[]): Promise<Row[]>;
  end(): Promise<void>;
}

const requireDatabaseUrl = (): string => {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL não definida (veja infra/.env / infra/.env.example)');
  }
  return url;
};

export const createPool = (config?: PoolConfig): Pool => {
  const base: PoolConfig = config ?? { connectionString: requireDatabaseUrl() };
  return new Pool(base);
};

export const createDatabase = (pool: Pool): Database => ({
  async query<Row extends QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<Row[]> {
    const result = await pool.query<Row>(text, params === undefined ? undefined : [...params]);
    return result.rows;
  },
  async end(): Promise<void> {
    await pool.end();
  },
});
