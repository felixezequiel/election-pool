import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { configurePgTypes } from '../db/types.js';
import { createPool, createDatabase } from '../db/pool.js';
import { requirePublishBaseDir } from '../publish/paths.js';
import { RenderJob } from './render.job.js';

/**
 * Entrada CLI do RenderJob (`pnpm render`). Monta o data.json, constrói o site e
 * publica atomicamente se os gates passarem (docs/02 §3.4, docs/07 §6). Falha
 * alta (R4): se abortar por gate, sai com código != 0 e loga o motivo — o
 * orquestrador (T-14) trata o exit code como alerta.
 *
 * `PUBLISH_BASE_DIR` é obrigatória (ex.: /var/lib/election-pool). `GIT_SHA` deve
 * ser injetada pelo CI. A corrida-alvo é a Presidência 2026 (v1, docs/00 §6).
 */

const RACE_ID = 'presidencia-2026'; // docs/00 §6: corrida da v1
const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/jobs → apps/web. `WEB_DIR` pode ser sobrescrito por ambiente: em
// produção (container) o app web fica no MESMO filesystem que PUBLISH_BASE_DIR para
// o `astro build` não cruzar filesystem (EXDEV) ao mover seus assets (docs/02 §7).
const WEB_DIR = process.env['WEB_DIR'] ?? join(__dirname, '..', '..', '..', 'web');

const main = async (): Promise<void> => {
  configurePgTypes();
  const pool = createPool();
  const db = createDatabase(pool);
  try {
    const job = new RenderJob({
      db,
      raceId: RACE_ID,
      publishBaseDir: requirePublishBaseDir(),
      webDir: WEB_DIR,
    });
    const result = await job.run();

    // Log estruturado (docs/02 §5: JSON em stdout).
    console.log(
      JSON.stringify({
        job: 'render',
        published: result.published,
        abortReason: result.abortReason,
        distPath: result.distPath,
        gates: result.gateResults,
        alerts: result.alerts,
      }),
    );

    if (!result.published) {
      // Aborto é esperado quando não há dado novo/válido; mantém dist atual no ar.
      // Sai != 0 para o orquestrador tratar como alerta (docs/07 §1).
      process.exitCode = 2;
    }
  } finally {
    await db.end();
  }
};

main().catch((error: unknown) => {
  console.error('render failed:', error);
  process.exit(1);
});
