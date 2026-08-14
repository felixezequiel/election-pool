/**
 * Orquestrador (docs/02 §3, §5, §7). Bootstrap PLANO — sem NestJS (o codebase
 * inteiro segue funções/registry planos; LOG T-05/T-06). Sequência de boot:
 *
 *   1. Roda as MIGRATIONS (docs/02 §7). Falha ⇒ o processo sai != 0 e NENHUM job
 *      começa (aceite T-14). Nada de scheduler antes disto.
 *   2. `configurePgTypes()` (T-02 handoff) e abre o pool.
 *   3. Estado compartilhado do processo: UM `AdapterFailureCounter` (para "3 ciclos
 *      ⇒ alerta" ter memória entre runs, LOG T-07), o registry de adapters, o
 *      `JobLock` (impede sobreposição do mesmo job), o `AlertSink`.
 *   4. Agenda todos os jobs nos crons de docs/02 §3, cada tick sob o lock e com
 *      registro em `job_runs` + log JSON estruturado em stdout (journald).
 *   5. Sobe o `/health` interno e um loop periódico que dispara alertas de
 *      staleness (dist > 6h / adapter em falha).
 *
 * ModelJob dispara o RenderJob IN-PROCESS quando os gates passam (docs/02 §3.4) —
 * o gatilho é do orquestrador, não um cron. V5 μ_t é injetado no HarvestJob a
 * partir das model_estimates (LOG T-07).
 */

import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { HttpClient } from '@election-pool/adapters/http-client';
import { RawStorage } from '@election-pool/adapters/base/raw-storage';
import { AdapterFailureCounter } from '@election-pool/adapters/validation/failure-counter';
import { JOB_NAME } from '@election-pool/contracts/enums';
import type { JobName } from '@election-pool/contracts/enums';
import pg from 'pg';
import { configurePgTypes } from './db/types.js';
import { createDatabase } from './db/pool.js';
import type { Database } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { JobRunsRepository } from './db/job-runs.repository.js';
import { JobLock } from './jobs/job-lock.js';
import { DiscoveryJob, makePoolTransaction } from './jobs/discovery.job.js';
import { HarvestJob } from './jobs/harvest.job.js';
import { ModelJob } from './jobs/model.job.js';
import { RenderJob } from './jobs/render.job.js';
import { buildRegistry, loadCandidateResolver } from './jobs/build-registry.js';
import { makeCurrentLatentProvider } from './jobs/latent-provider.js';
import { PesqEleClient } from '@election-pool/adapters/pesqele/client';
import { requirePublishBaseDir, resolvePublishPaths } from './publish/paths.js';
import { startHealthServer, DEFAULT_HEALTH_PORT } from './health/health-server.js';
import type { RunningHealthServer } from './health/health-server.js';
import { AlertSink, alertsFromHealth } from './health/alerts.js';
import { buildHealthSnapshot } from './health/health.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Pool } = pg;

const RACE_ID = 'presidencia-2026'; // docs/00 §6
const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src → apps/web. `WEB_DIR` sobrescrevível por ambiente: em produção o app
// web fica no MESMO filesystem que PUBLISH_BASE_DIR (o `astro build` move assets com
// rename; cruzar filesystem lança EXDEV — armadilha de deploy, docs/02 §7 / T-13).
const WEB_DIR = process.env['WEB_DIR'] ?? join(__dirname, '..', '..', 'web');
const ALERT_CHECK_INTERVAL_MS = 15 * 60_000; // varredura de staleness a cada 15 min

/** Log estruturado JSON em stdout (docs/02 §5, journald-friendly). */
export const logJson = (obj: Record<string, unknown>): void => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...obj }));
};

const requireDatabaseUrl = (): string => {
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL não definida (docs/02 §7 / infra/.env)');
  }
  return url;
};

// --- Orquestrador (montável para teste) -------------------------------------

export interface Orchestrator {
  db: Database;
  jobLock: JobLock;
  failureCounter: AdapterFailureCounter;
  jobRuns: JobRunsRepository;
  distPath: string;
  /** Executa um job sob lock + registro em job_runs. Devolve se rodou de fato. */
  runJob: (job: JobName, fn: () => Promise<Record<string, unknown>>) => Promise<boolean>;
  /** As funções de cada job, já ligadas ao estado compartilhado. */
  jobs: {
    discovery: () => Promise<Record<string, unknown>>;
    harvest: () => Promise<Record<string, unknown>>;
    model: () => Promise<Record<string, unknown>>;
    render: () => Promise<Record<string, unknown>>;
  };
  /** Varredura de staleness ⇒ dispara alertas (docs/02 §5). Devolve nº disparado. */
  checkAndAlert: () => Promise<number>;
}

export interface OrchestratorDeps {
  db: Database;
  pool: pg.Pool;
  publishBaseDir: string;
  webDir?: string;
  alertSink?: AlertSink;
  now?: () => Date;
}

export const createOrchestrator = (deps: OrchestratorDeps): Orchestrator => {
  const { db, pool } = deps;
  const now = deps.now ?? (() => new Date());
  const jobLock = new JobLock();
  const failureCounter = new AdapterFailureCounter();
  const jobRuns = new JobRunsRepository(db);
  const storage = new RawStorage();
  const http = new HttpClient();
  const paths = resolvePublishPaths(deps.publishBaseDir);
  const webDir = deps.webDir ?? WEB_DIR;
  const alertSink =
    deps.alertSink ?? new AlertSink({ webhookUrl: process.env['ALERT_WEBHOOK_URL'] });

  /**
   * Executa um job sob o lock (segunda execução simultânea é descartada) e o
   * registra em `job_runs` (start → ok/error) com log JSON. `fn` devolve as
   * métricas do run (viram `metrics_json` + o log). Um erro do job é capturado,
   * gravado como `error` e re-logado — nunca derruba o scheduler.
   */
  const runJob = async (
    job: JobName,
    fn: () => Promise<Record<string, unknown>>,
  ): Promise<boolean> => {
    const outcome = await jobLock.run(job, async () => {
      const startedAt = now().toISOString();
      const runId = await jobRuns.start(job, startedAt);
      try {
        const metrics = await fn();
        await jobRuns.finishOk(runId, now().toISOString(), metrics);
        logJson({ level: 'info', event: 'job_ok', job, metrics });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await jobRuns.finishError(runId, now().toISOString(), message, {});
        logJson({ level: 'error', event: 'job_error', job, error: message });
        return true;
      }
    });
    if (!outcome.ran) {
      logJson({ level: 'warn', event: 'job_skipped_locked', job });
      return false;
    }
    return outcome.result;
  };

  // --- funções de job ligadas ao estado -------------------------------------

  const discovery = async (): Promise<Record<string, unknown>> => {
    const job = new DiscoveryJob({
      db,
      withTransaction: makePoolTransaction(pool),
      pesqEle: new PesqEleClient({ http }),
      now,
    });
    const r = await job.run();
    return { seen: r.seen, upserted: r.upserted, expired: r.expired, alerts: r.alerts.length };
  };

  const harvest = async (): Promise<Record<string, unknown>> => {
    const resolveCandidate = await loadCandidateResolver(db);
    const registry = buildRegistry(resolveCandidate, storage);
    const job = new HarvestJob({
      db,
      http,
      registry,
      storage,
      now,
      failureCounter, // UMA instância compartilhada (LOG T-07)
      currentLatentByCandidateId: makeCurrentLatentProvider(db, RACE_ID), // V5 μ_t (LOG T-07)
    });
    const r = await job.run();
    return {
      considered: r.considered,
      attempted: r.attempted,
      disclosed: r.disclosed,
      validationFailed: r.validationFailed,
      alerts: r.alerts.length,
    };
  };

  const render = async (): Promise<Record<string, unknown>> => {
    const job = new RenderJob({
      db,
      raceId: RACE_ID,
      publishBaseDir: deps.publishBaseDir,
      webDir,
      now,
      // §6.6: um adapter suspeito há mais de 3 ciclos bloqueia a publicação. A
      // métrica real vem do contador compartilhado (LOG do render, T-13).
      suspectAdapterOverThreshold: failureCounter.failing().length > 0,
    });
    const r = await job.run();
    return {
      published: r.published,
      abortReason: r.abortReason,
      distPath: r.distPath,
      alerts: r.alerts.length,
    };
  };

  const model = async (): Promise<Record<string, unknown>> => {
    const job = new ModelJob({ db, raceId: RACE_ID, now });
    const summary = await job.run();
    // docs/02 §3.4: RenderJob é disparado por ModelJob quando os gates passam.
    // In-process (não subprocesso) para compartilhar pool/estado. exit-codes viram
    // published=false + alerta (o render nunca lança por gate reprovado).
    let renderMetrics: Record<string, unknown> | null = null;
    if (summary.shouldRender) {
      renderMetrics = await render();
    }
    return {
      observations: summary.observations,
      canonicalMarked: summary.canonical.canonicalMarked,
      gatesPassed: summary.gatesPassed,
      gates: summary.gates,
      renderTriggered: summary.shouldRender,
      render: renderMetrics,
    };
  };

  // --- alertas de staleness (docs/02 §5) ------------------------------------

  const checkAndAlert = async (): Promise<number> => {
    const snapshot = await buildHealthSnapshot({
      jobRuns,
      failureCounter,
      distPath: paths.dist,
      now,
    });
    const alerts = alertsFromHealth(snapshot);
    for (const alert of alerts) await alertSink.fire(alert);
    if (alerts.length > 0) {
      logJson({ level: 'warn', event: 'alerts_fired', count: alerts.length });
    }
    return alerts.length;
  };

  return {
    db,
    jobLock,
    failureCounter,
    jobRuns,
    distPath: paths.dist,
    runJob,
    jobs: { discovery, harvest, model, render },
    checkAndAlert,
  };
};

// --- bootstrap (main real) --------------------------------------------------

const main = async (): Promise<void> => {
  const databaseUrl = requireDatabaseUrl();

  // 1. MIGRATIONS ANTES DE QUALQUER JOB (docs/02 §7). Falha ⇒ sai != 0, sem boot.
  await runMigrations(databaseUrl);
  logJson({ level: 'info', event: 'migrations_applied' });

  // 2. type parsers + pool (T-02 handoff).
  configurePgTypes();
  const publishBaseDir = requirePublishBaseDir();
  const pool = new Pool({ connectionString: databaseUrl });
  const db = createDatabase(pool);

  const orch = createOrchestrator({ db, pool, publishBaseDir });

  // 4. Agenda os jobs nos crons de docs/02 §3 (cada tick sob lock + job_runs).
  const tasks: ScheduledTask[] = [];
  const schedule = (
    expr: string,
    job: JobName,
    fn: () => Promise<Record<string, unknown>>,
  ): void => {
    tasks.push(
      cron.schedule(expr, () => {
        void orch.runJob(job, fn);
      }),
    );
  };
  schedule('0 */2 * * *', JOB_NAME.discovery, orch.jobs.discovery); // docs/02 §3.1
  schedule('5 */2 * * *', JOB_NAME.harvest, orch.jobs.harvest); // docs/02 §3.2
  schedule('15 */2 * * *', JOB_NAME.model, orch.jobs.model); // docs/02 §3.3 (dispara render)

  // 5. /health interno + loop de alertas de staleness (docs/02 §5).
  let health: RunningHealthServer | null = null;
  try {
    const port = Number.parseInt(process.env['HEALTH_PORT'] ?? String(DEFAULT_HEALTH_PORT), 10);
    // Bind host: dentro do container precisa ser 0.0.0.0 para o mapeamento de porta
    // do compose (que já é 127.0.0.1:PORT no HOST — segue interno). Fora, 127.0.0.1.
    const host = process.env['HEALTH_HOST'];
    health = await startHealthServer({
      deps: { jobRuns: orch.jobRuns, failureCounter: orch.failureCounter, distPath: orch.distPath },
      port,
      ...(host === undefined ? {} : { host }),
    });
    logJson({ level: 'info', event: 'health_listening', port: health.port });
  } catch (err) {
    logJson({
      level: 'error',
      event: 'health_start_failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const alertTimer = setInterval(() => {
    void orch.checkAndAlert();
  }, ALERT_CHECK_INTERVAL_MS);

  logJson({
    level: 'info',
    event: 'orchestrator_ready',
    jobs: ['discovery', 'harvest', 'model', 'render'],
  });

  // Encerramento gracioso: para os crons, o timer, o health e o pool.
  const shutdown = (signal: string): void => {
    logJson({ level: 'info', event: 'shutdown', signal });
    for (const t of tasks) t.stop();
    clearInterval(alertTimer);
    void (async (): Promise<void> => {
      if (health !== null) await health.close();
      await db.end();
      process.exit(0);
    })();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

// Só executa o bootstrap quando rodado como entrypoint (não ao ser importado por
// teste). `import.meta.url` === argv[1] resolvido a file URL.
const isEntrypoint = (): boolean => {
  const argv1 = process.argv[1];
  if (argv1 === undefined) return false;
  return import.meta.url === `file://${argv1}` || import.meta.url.endsWith(argv1);
};

if (isEntrypoint()) {
  main().catch((err: unknown) => {
    // Falha de migration/boot cai aqui: log e sai != 0. Os jobs NUNCA começaram.
    logJson({
      level: 'error',
      event: 'boot_failed',
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
