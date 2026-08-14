/**
 * Entry point de `pnpm ingest:harvest`. Fino de propósito: configura os type
 * parsers do pg (docs/02, T-02 handoff), abre o pool, monta o registry e dispara
 * o HarvestJob. Sai com código não-zero se falhar (para o cron/orquestrador
 * detectar). A lógica vive em `harvest.job.ts`, importável sem efeito colateral
 * pelos testes.
 */

import pg from 'pg';
import { HttpClient } from '@election-pool/adapters/http-client';
import { RawStorage } from '@election-pool/adapters/base/raw-storage';
import { configurePgTypes } from '../db/types.js';
import { createDatabase } from '../db/pool.js';
import { HarvestJob } from './harvest.job.js';
import { buildRegistry, loadCandidateResolver } from './build-registry.js';

const { Pool } = pg;

const run = async (): Promise<void> => {
  configurePgTypes();
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL não definida (veja infra/.env)');
  }
  const pool = new Pool({ connectionString });
  const db = createDatabase(pool);
  const storage = new RawStorage();
  try {
    const resolveCandidate = await loadCandidateResolver(db);
    const registry = buildRegistry(resolveCandidate, storage);
    const job = new HarvestJob({ db, http: new HttpClient(), registry, storage });
    const result = await job.run();
    console.log(
      `[harvest] considered=${result.considered} attempted=${result.attempted} ` +
        `disclosed=${result.disclosed} notModified=${result.notModified} ` +
        `presumedUndisclosed=${result.presumedUndisclosed} quarantined=${result.quarantined} ` +
        `alerts=${result.alerts.length}`,
    );
    for (const alert of result.alerts) {
      console.warn(`[harvest][alert] ${alert.kind} tse_id=${alert.tseId} :: ${alert.detail}`);
    }
  } finally {
    await db.end();
  }
};

run().catch((err: unknown) => {
  console.error('[harvest] falhou:', err);
  process.exit(1);
});
