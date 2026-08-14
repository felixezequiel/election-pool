/**
 * Entry point de `pnpm model:run` (docs/02 §3.3). Fino: configura os type parsers
 * do pg, abre o pool, roda o ModelJob e loga o resultado em JSON estruturado
 * (docs/02 §5). Sai != 0 se o run falhar (o cron/orquestrador detecta). Quando os
 * gates passam, dispara o RenderJob por CLI (`pnpm render`) — em produção o
 * orquestrador (main.ts) prefere o disparo in-process; este CLI é o modo manual.
 *
 * A lógica vive em `model.job.ts`, importável sem efeito colateral pelos testes.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { configurePgTypes } from '../db/types.js';
import { createPool, createDatabase } from '../db/pool.js';
import { ModelJob } from './model.job.js';

const RACE_ID = 'presidencia-2026'; // docs/00 §6: corrida da v1
const __dirname = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(__dirname, '..', '..');

const run = async (): Promise<void> => {
  configurePgTypes();
  const pool = createPool();
  const db = createDatabase(pool);
  try {
    const job = new ModelJob({ db, raceId: RACE_ID });
    const summary = await job.run();

    console.log(
      JSON.stringify({
        job: 'model',
        observations: summary.observations,
        referenceDate: summary.referenceDate,
        inputHash: summary.inputHash,
        canonicalMarked: summary.canonical.canonicalMarked,
        gatesPassed: summary.gatesPassed,
        gates: summary.gates,
        shouldRender: summary.shouldRender,
        runId: summary.runId,
      }),
    );

    if (summary.shouldRender) {
      // Gates passaram ⇒ dispara o render (docs/02 §3.4). Modo CLI: subprocesso
      // `pnpm render`; exit 2 = abortado por gate de publicação (mantém dist), 1 = crash.
      const render = spawnSync('pnpm', ['--filter', '@election-pool/api', 'render'], {
        cwd: join(API_DIR, '..', '..'),
        stdio: 'inherit',
      });
      if (render.status !== 0) {
        console.error(`[model] render terminou com código ${String(render.status)}`);
      }
    } else {
      console.warn(
        '[model] gates reprovaram — render NÃO disparado (docs/07 §1: não publica dado errado)',
      );
    }
  } finally {
    await db.end();
  }
};

run().catch((err: unknown) => {
  console.error('[model] falhou:', err);
  process.exit(1);
});
