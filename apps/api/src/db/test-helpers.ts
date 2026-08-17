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

/**
 * Connection string do banco de TESTE — nunca o de desenvolvimento.
 *
 * Isto existe porque a alternativa custou dado real: `truncateData` roda
 * `TRUNCATE poll_results, poll_scenarios, poll_registrations, raw_documents` e os
 * testes apontavam para o MESMO banco do `docker compose`. Rodar a suíte no meio de
 * uma colheita apagava as pesquisas colhidas — e o sintoma era misterioso, porque
 * quem rodou o teste não era quem estava colhendo.
 *
 * A proteção é por DERIVAÇÃO, não por configuração: se `TEST_DATABASE_URL` não
 * estiver definida, derivamos acrescentando `_test` ao nome do banco de
 * `DATABASE_URL`. Assim é impossível a suíte cair no banco de desenvolvimento por
 * esquecimento — o caminho padrão já é isolado. O banco derivado precisa EXISTIR
 * (está em `POSTGRES_DATABASES` do `.env`, e o compose o garante); se não existir,
 * a conexão falha alto em vez de escolher outro (R4).
 */
export const testDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  const explicit = env['TEST_DATABASE_URL'];
  if (explicit !== undefined && explicit.length > 0) return explicit;

  const base = env['DATABASE_URL'];
  if (base === undefined || base.length === 0) {
    throw new Error(
      'Nem TEST_DATABASE_URL nem DATABASE_URL definidas para os testes (rode via pnpm test)',
    );
  }
  const url = new URL(base);
  // `pathname` é `/election_pool`; o banco de teste é `/election_pool_test`.
  const name = url.pathname.replace(/^\//, '');
  if (name.length === 0) {
    throw new Error(`DATABASE_URL sem nome de banco no path: ${base}`);
  }
  if (name.endsWith('_test')) return url.toString();
  url.pathname = `/${name}_test`;
  return url.toString();
};

export const makeTestDatabase = (): { db: Database; pool: Pool } => {
  const pool = new Pool({ connectionString: testDatabaseUrl() });
  return { db: createDatabase(pool), pool };
};

/** Trunca as tabelas de dados (não as de referência) para isolar cada teste. */
export const truncateData = async (db: Database): Promise<void> => {
  await db.query(
    `TRUNCATE poll_results, poll_scenarios, poll_registrations, raw_documents RESTART IDENTITY CASCADE`,
  );
};
