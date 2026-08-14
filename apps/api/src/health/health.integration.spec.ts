import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeTestDatabase } from '../db/test-helpers.js';
import { JobRunsRepository } from '../db/job-runs.repository.js';
import { AdapterFailureCounter } from '@election-pool/adapters/validation/failure-counter';
import { buildHealthSnapshot } from './health.js';
import { DIST_STALE_MAX_HOURS } from './alerts.js';

/**
 * Health snapshot (aceite T-14: `/health` reporta staleness corretamente com um
 * `dist/` envelhecido artificialmente). Testa contra o Postgres real (job_runs) e
 * um dist de tmpdir cujo mtime envelhecemos com `utimesSync`.
 */

const { db } = makeTestDatabase();

let workdir: string;
let distPath: string;
let buildDir: string;

const NOW = new Date(Date.parse('2026-08-14T15:00:00-03:00'));

describe('buildHealthSnapshot (staleness, docs/02 §5)', () => {
  beforeAll(async () => {
    // job_runs pode ter lixo de outros testes; isolamos por truncate aqui.
    await db.query(`TRUNCATE job_runs`);
  });
  afterAll(async () => {
    await db.end();
  });

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'ep-health-'));
    // dist/ é um SYMLINK (como em produção, T-13) apontando para o build real; o
    // /health mede o mtime do build-alvo (segue o link).
    buildDir = join(workdir, 'dist-build');
    mkdirSync(buildDir, { recursive: true });
    distPath = join(workdir, 'dist');
    symlinkSync(buildDir, distPath);
  });
  afterEach(async () => {
    await db.query(`TRUNCATE job_runs`);
    rmSync(workdir, { recursive: true, force: true });
  });

  const ageDistHours = (hours: number): void => {
    const when = new Date(NOW.getTime() - hours * 3_600_000);
    const secs = when.getTime() / 1000;
    // Envelhece o DIRETÓRIO-alvo (o que o /health mede via stat, seguindo o link).
    utimesSync(buildDir, secs, secs);
  };

  it('dist recém-publicado ⇒ status ok, não stale', async () => {
    ageDistHours(0.1);
    const snap = await buildHealthSnapshot({
      jobRuns: new JobRunsRepository(db),
      failureCounter: new AdapterFailureCounter(),
      distPath,
      now: () => NOW,
    });
    expect(snap.dist.exists).toBe(true);
    expect(snap.dist.stale).toBe(false);
    expect(snap.status).toBe('ok');
  });

  it('dist com mais de 6h ⇒ stale e status degraded', async () => {
    ageDistHours(DIST_STALE_MAX_HOURS + 1);
    const snap = await buildHealthSnapshot({
      jobRuns: new JobRunsRepository(db),
      failureCounter: new AdapterFailureCounter(),
      distPath,
      now: () => NOW,
    });
    expect(snap.dist.stale).toBe(true);
    expect(snap.status).toBe('degraded');
    expect(snap.dist.ageSeconds).toBeGreaterThan(DIST_STALE_MAX_HOURS * 3600);
  });

  it('reporta a idade do último run bem-sucedido por job (job_runs)', async () => {
    const repo = new JobRunsRepository(db);
    // Um run de harvest concluído 30 min atrás.
    const startedAt = new Date(NOW.getTime() - 40 * 60_000).toISOString();
    const finishedAt = new Date(NOW.getTime() - 30 * 60_000).toISOString();
    const id = await repo.start('harvest', startedAt);
    await repo.finishOk(id, finishedAt, { disclosed: 2 });

    ageDistHours(0.1);
    const snap = await buildHealthSnapshot({
      jobRuns: repo,
      failureCounter: new AdapterFailureCounter(),
      distPath,
      now: () => NOW,
    });
    const harvest = snap.jobs.find((j) => j.job === 'harvest');
    // Mesmo instante (o pg reserializa timestamptz no offset -03:00; comparamos por
    // tempo, não por string).
    expect(Date.parse(harvest?.lastSuccessAt ?? '')).toBe(Date.parse(finishedAt));
    // ~30 min = 1800s.
    expect(harvest?.ageSeconds).toBeGreaterThanOrEqual(1795);
    expect(harvest?.ageSeconds).toBeLessThanOrEqual(1805);
    // Um job sem sucesso aparece com null.
    const model = snap.jobs.find((j) => j.job === 'model');
    expect(model?.lastSuccessAt).toBeNull();
  });

  it('adapter em falha (≥3 ciclos) aparece na contagem e degrada o status', async () => {
    const counter = new AdapterFailureCounter();
    counter.recordFailure('nexus');
    counter.recordFailure('nexus');
    counter.recordFailure('nexus'); // 3 ciclos ⇒ failing()
    ageDistHours(0.1);
    const snap = await buildHealthSnapshot({
      jobRuns: new JobRunsRepository(db),
      failureCounter: counter,
      distPath,
      now: () => NOW,
    });
    expect(snap.failingAdapters).toEqual([{ adapterId: 'nexus', consecutive: 3 }]);
    expect(snap.status).toBe('degraded');
  });
});
