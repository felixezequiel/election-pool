/**
 * Entry point de `pnpm ingest:approve <tse_id> --reason="..."` (docs/04 §5).
 * Fino de propósito: parseia argv, RECUSA sem `--reason`, grava a aprovação e
 * dispara o reprocesso. A lógica testável vive em `approve.command.ts`.
 *
 * Uso:
 *   pnpm ingest:approve BR-06591/2026 --reason="Candidato X desistiu (fato real)"
 *
 * Sem `--reason`, sai com código não-zero e não grava nada.
 */

import pg from 'pg';
import { HttpClient } from '@election-pool/adapters/http-client';
import { RawStorage } from '@election-pool/adapters/base/raw-storage';
import { AdapterFailureCounter } from '@election-pool/adapters/validation/failure-counter';
import { configurePgTypes } from '../db/types.js';
import { createDatabase } from '../db/pool.js';
import { HarvestJob } from '../jobs/harvest.job.js';
import { makePoolTransaction } from '../jobs/discovery.job.js';
import { buildRegistry, loadCandidateResolver } from '../jobs/build-registry.js';
import { approve, ApprovalError } from './approve.command.js';

const { Pool } = pg;

/** Primeiro argumento posicional (não-flag) do argv. */
const positional = (): string | null => {
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith('--')) return arg;
  }
  return null;
};

/** Valor de `--reason=...` ou `--reason valor`. `null` se ausente. */
const reasonArg = (): string | null => {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--reason=')) return arg.slice('--reason='.length);
    if (arg === '--reason') return argv[i + 1] ?? null;
  }
  return null;
};

const run = async (): Promise<void> => {
  configurePgTypes();
  const tseId = positional();
  const reason = reasonArg();
  if (tseId === null || tseId.length === 0) {
    throw new ApprovalError('uso: pnpm ingest:approve <tse_id> --reason="..."');
  }

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL não definida (veja infra/.env)');
  }
  const pool = new Pool({ connectionString });
  const db = createDatabase(pool);
  const storage = new RawStorage();
  try {
    const outcome = await approve(
      { tseId, reason },
      {
        db,
        runReingest: async (approvedTseId: string): Promise<number> => {
          // Reprocessa pelo caminho normal de colheita: o registro segue `pending`
          // (a falha de validação não mudou o disclosure), então o HarvestJob o
          // recolhe — agora com `manuallyApproved` no contexto, pulando V4/V5.
          const resolveCandidate = await loadCandidateResolver(db);
          const registry = buildRegistry(resolveCandidate, storage);
          const job = new HarvestJob({
            db,
            http: new HttpClient(),
            registry,
            storage,
            withTransaction: makePoolTransaction(pool), // persistência atômica (R5/R4)
            failureCounter: new AdapterFailureCounter(),
          });
          const result = await job.run();
          // Só reportamos os cenários do tse_id aprovado.
          const rows = await db.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM poll_scenarios WHERE tse_id = $1`,
            [approvedTseId],
          );
          void result;
          return Number(rows[0]?.n ?? '0');
        },
      },
    );
    console.log(
      `[approve] tse_id=${outcome.approval.tseId} aprovado em ${outcome.approval.approvedAt} ` +
        `razão="${outcome.approval.reason}" cenários=${String(outcome.scenariosInserted)}`,
    );
  } finally {
    await db.end();
  }
};

run().catch((err: unknown) => {
  if (err instanceof ApprovalError) {
    console.error(`[approve] ${err.message}`);
  } else {
    console.error('[approve] falhou:', err);
  }
  process.exit(1);
});
