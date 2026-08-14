import pg from 'pg';
import { configurePgTypes } from './types.js';

const { Pool } = pg;
type Pool = pg.Pool;
import { createDatabase } from './pool.js';
import type { Database } from './pool.js';

/**
 * Utilitários de teste de integração. Conectam ao Postgres do docker-compose
 * (infra/.env → DATABASE_URL). Os testes de integração são reais: sobem contra
 * um banco de verdade, não um mock. Rodam em série (vitest fileParallelism:false)
 * e limpam as tabelas relevantes entre casos.
 */

configurePgTypes();

export const makeTestDatabase = (): { db: Database; pool: Pool } => {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL não definida para os testes (rode via pnpm test)');
  }
  const pool = new Pool({ connectionString });
  return { db: createDatabase(pool), pool };
};

/** Trunca as tabelas de dados (não as de referência) para isolar cada teste. */
export const truncateData = async (db: Database): Promise<void> => {
  await db.query(
    `TRUNCATE poll_results, poll_scenarios, poll_registrations, raw_documents RESTART IDENTITY CASCADE`,
  );
};
