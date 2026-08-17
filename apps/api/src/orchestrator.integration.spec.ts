import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { canCreateSymlink, SYMLINK_SKIP_REASON } from './publish/can-symlink.js';

if (!canCreateSymlink()) {
  console.warn(`[skip] ${SYMLINK_SKIP_REASON}`);
}
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { makeTestDatabase } from './db/test-helpers.js';
import { createOrchestrator } from './main.js';
import { AlertSink } from './health/alerts.js';
import { DIST_STALE_MAX_HOURS } from './health/alerts.js';

/**
 * Orquestrador (docs/02 §5) contra o Postgres real. Cobre a glue de T-14 que só se
 * prova em conjunto:
 *  - `runJob` grava start→ok/error em `job_runs` (observabilidade);
 *  - o lock impede sobreposição do MESMO job mesmo passando por `runJob`;
 *  - um job que lança é registrado como `error` e NÃO derruba o scheduler
 *    (recuperação: o próximo tick roda normalmente);
 *  - `checkAndAlert` DISPARA alertas de fato com um dist envelhecido (aceite T-14).
 */

const { Pool } = pg;
const { db } = makeTestDatabase();
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });

const NOW = new Date(Date.parse('2026-08-14T15:00:00-03:00'));

let base: string;
let webDir: string;

const makeOrch = (alertLines: string[]): ReturnType<typeof createOrchestrator> =>
  createOrchestrator({
    db,
    pool,
    publishBaseDir: base,
    webDir,
    now: () => NOW,
    alertSink: new AlertSink({ logError: (l) => alertLines.push(l) }),
  });

describe('createOrchestrator (integration)', () => {
  beforeAll(async () => {
    await db.query(`TRUNCATE job_runs`);
  });
  afterAll(async () => {
    await db.end();
    await pool.end();
  });
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'ep-orch-'));
    webDir = mkdtempSync(join(tmpdir(), 'ep-orch-web-'));
  });
  afterEach(async () => {
    await db.query(`TRUNCATE job_runs`);
    rmSync(base, { recursive: true, force: true });
    rmSync(webDir, { recursive: true, force: true });
  });

  it('runJob grava um run ok em job_runs com métricas', async () => {
    const orch = makeOrch([]);
    const ran = await orch.runJob('discovery', () => Promise.resolve({ seen: 5 }));
    expect(ran).toBe(true);
    const ok = await orch.jobRuns.countByJobStatus('discovery', 'ok');
    expect(ok).toBe(1);
    const rows = await db.query<{ metrics_json: { seen: number }; status: string }>(
      `SELECT metrics_json, status FROM job_runs WHERE job = 'discovery' ORDER BY started_at DESC LIMIT 1`,
    );
    expect(rows[0]?.status).toBe('ok');
    expect(rows[0]?.metrics_json.seen).toBe(5);
  });

  it('duas execuções simultâneas do MESMO job via runJob ⇒ a segunda não roda', async () => {
    const orch = makeOrch([]);
    let release!: () => void;
    const blocker = new Promise<void>((r) => (release = r));

    const first = orch.runJob('harvest', async () => {
      await blocker;
      return { disclosed: 1 };
    });
    await Promise.resolve();

    const secondRan = await orch.runJob('harvest', () => Promise.resolve({ disclosed: 99 }));
    expect(secondRan).toBe(false); // descartada pelo lock

    release();
    expect(await first).toBe(true);

    // Só UM run de harvest foi registrado (o segundo nem abriu linha em job_runs).
    const total = await orch.jobRuns.countByJobStatus('harvest', 'ok');
    expect(total).toBe(1);
  });

  it('job que lança ⇒ registrado como error, scheduler segue (recuperação no próximo tick)', async () => {
    const orch = makeOrch([]);
    const ran = await orch.runJob('model', () => Promise.reject(new Error('kaboom')));
    expect(ran).toBe(true); // runJob captura o erro (não propaga)
    expect(await orch.jobRuns.countByJobStatus('model', 'error')).toBe(1);

    // Próximo tick do mesmo job roda normalmente (lock foi liberado, sem estado preso).
    const okRan = await orch.runJob('model', () => Promise.resolve({ observations: 3 }));
    expect(okRan).toBe(true);
    expect(await orch.jobRuns.countByJobStatus('model', 'ok')).toBe(1);
  });

  // Cria o `dist` (symlink) para envelhecê-lo: Windows sem privilégio não roda.
  it.skipIf(!canCreateSymlink())(
    'checkAndAlert dispara alerta de dist velho (aceite T-14: dispara de fato)',
    async () => {
      // dist/ symlink cujo build-alvo está envelhecido além do limite de 6h.
      const build = join(base, 'dist-build');
      mkdirSync(build, { recursive: true });
      symlinkSync(build, join(base, 'dist'));
      const old = (NOW.getTime() - (DIST_STALE_MAX_HOURS + 2) * 3_600_000) / 1000;
      utimesSync(build, old, old);

      const lines: string[] = [];
      const orch = makeOrch(lines);
      const fired = await orch.checkAndAlert();
      expect(fired).toBeGreaterThanOrEqual(1);
      // O alerta virou log de erro (destino padrão docs/02 §5).
      const distAlert = lines
        .map((l) => JSON.parse(l) as { kind?: string })
        .find((o) => o.kind === 'dist_stale');
      expect(distAlert).toBeDefined();
    },
  );

  it.skipIf(!canCreateSymlink())(
    'checkAndAlert dispara alerta de adapter em falha (3 ciclos)',
    async () => {
      const build = join(base, 'dist-build');
      mkdirSync(build, { recursive: true });
      symlinkSync(build, join(base, 'dist')); // dist fresco (só o adapter deve alertar)

      const lines: string[] = [];
      const orch = makeOrch(lines);
      orch.failureCounter.recordFailure('nexus');
      orch.failureCounter.recordFailure('nexus');
      orch.failureCounter.recordFailure('nexus');

      const fired = await orch.checkAndAlert();
      expect(fired).toBeGreaterThanOrEqual(1);
      const adapterAlert = lines
        .map((l) => JSON.parse(l) as { kind?: string })
        .find((o) => o.kind === 'adapter_failing');
      expect(adapterAlert).toBeDefined();
    },
  );
});
