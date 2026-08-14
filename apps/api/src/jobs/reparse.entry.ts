/**
 * Entry point de `pnpm ingest:reparse --adapter=X --since=Y`. Roda o parser
 * corrente sobre os `raw_documents` já salvos, SEM REDE (docs/04 §7). Lê `--adapter`
 * e `--since` do argv; falha alto (R4) se faltarem. A lógica vive em
 * `reparse.job.ts`, importável sem efeito colateral pelos testes.
 */

import pg from 'pg';
import { RawStorage } from '@election-pool/adapters/base/raw-storage';
import { configurePgTypes } from '../db/types.js';
import { createDatabase } from '../db/pool.js';
import { ReparseJob } from './reparse.job.js';
import { buildRegistry, loadCandidateResolver } from './build-registry.js';

const { Pool } = pg;

/** Extrai `--chave=valor` (ou `--chave valor`) do argv. */
const argValue = (flag: string): string | null => {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
    if (arg === flag) return argv[i + 1] ?? null;
  }
  return null;
};

const run = async (): Promise<void> => {
  configurePgTypes();
  const adapterId = argValue('--adapter');
  const sinceIso = argValue('--since');
  if (adapterId === null || adapterId.length === 0) {
    throw new Error('uso: pnpm ingest:reparse --adapter=<id> --since=<AAAA-MM-DD>');
  }
  if (sinceIso === null || sinceIso.length === 0) {
    throw new Error('uso: pnpm ingest:reparse --adapter=<id> --since=<AAAA-MM-DD>');
  }

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
    const adapter = registry.byId(adapterId);
    if (adapter === null) {
      throw new Error(`adapter desconhecido: "${adapterId}"`);
    }
    const result = await new ReparseJob({ db, adapter }).run({ adapterId, sinceIso });
    console.log(
      `[reparse] adapter=${adapterId} since=${sinceIso} raws=${result.rawsConsidered} ` +
        `inserted=${result.scenariosInserted} unchanged=${result.scenariosUnchanged} ` +
        `needsSupersede=${result.scenariosNeedingSupersede} alerts=${result.alerts.length}`,
    );
    for (const alert of result.alerts) {
      console.warn(`[reparse][alert] ${alert.kind} tse_id=${alert.tseId} :: ${alert.detail}`);
    }
  } finally {
    await db.end();
  }
};

run().catch((err: unknown) => {
  console.error('[reparse] falhou:', err);
  process.exit(1);
});
