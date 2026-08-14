/**
 * `GET /health` interno (docs/02 §5). NÃO é exposto ao público (o nginx não o
 * encaminha) — é o painel de staleness da VPS. O que importa aqui não é uptime; é
 * **staleness e falha silenciosa** (docs/02 §5, armadilha de T-14): um site no ar
 * com dado de duas semanas é pior que um site fora do ar.
 *
 * Reporta:
 *  - idade do último run bem-sucedido de cada job (e o mais antigo entre eles);
 *  - contagem de adapters em falha (do `AdapterFailureCounter` compartilhado);
 *  - idade do `dist/` publicado (mtime do symlink/alvo servido pelo nginx).
 *
 * Puro no cálculo: recebe as leituras (banco, contador, fs) e monta o snapshot.
 * O servidor HTTP (`health-server.ts`) o chama e serializa.
 */

import { stat } from 'node:fs/promises';
import type { JobName } from '@election-pool/contracts/enums';
import { DIST_STALE_MAX_HOURS } from './alerts.js';
import type { JobRunsRepository } from '../db/job-runs.repository.js';
import type { AdapterFailureCounter } from '@election-pool/adapters/validation/failure-counter';

const MS_PER_HOUR = 3_600_000;
const ZERO = 0;

export interface JobHealth {
  job: string;
  lastSuccessAt: string | null;
  ageSeconds: number | null;
}

export interface HealthSnapshot {
  /** `ok` sse nenhum sinal de staleness/falha; `degraded` caso contrário. */
  status: 'ok' | 'degraded';
  now: string;
  jobs: JobHealth[];
  failingAdapters: { adapterId: string; consecutive: number }[];
  dist: {
    path: string;
    publishedAt: string | null;
    ageSeconds: number | null;
    /** true se o dist tem mais que o limite de staleness (docs/02 §5). */
    stale: boolean;
    exists: boolean;
  };
}

export interface HealthDeps {
  jobRuns: JobRunsRepository;
  failureCounter: AdapterFailureCounter;
  /** Caminho do `dist/` servido pelo nginx (symlink em produção). */
  distPath: string;
  now?: () => Date;
}

const ageSecondsBetween = (now: Date, thenIso: string): number =>
  Math.max(ZERO, Math.round((now.getTime() - Date.parse(thenIso)) / 1000));

/**
 * Instante de publicação do `dist/` = mtime do DIRETÓRIO-alvo servido. `stat`
 * SEGUE o symlink (T-13: `dist` é um symlink para o build versionado), então
 * pega o mtime do build de fato no ar — que é quando o `astro build` o produziu,
 * o sinal correto de frescor. Ausência (symlink quebrado / nunca publicado) ⇒
 * `null` ⇒ o /health trata como degradado. Não usamos o mtime do PRÓPRIO link
 * (lstat): a troca de symlink não o atualiza de forma confiável entre plataformas.
 */
const distPublishedAt = async (distPath: string): Promise<Date | null> => {
  try {
    const s = await stat(distPath);
    return s.mtime;
  } catch {
    return null;
  }
};

export const buildHealthSnapshot = async (deps: HealthDeps): Promise<HealthSnapshot> => {
  const now = (deps.now ?? (() => new Date()))();
  const nowIso = now.toISOString();

  const lastSuccess = await deps.jobRuns.lastSuccessByJob();
  const lastByJob = new Map<string, string>();
  for (const row of lastSuccess) lastByJob.set(row.job, row.finishedAt);

  // Jobs que agendamos (docs/02 §3). Um job sem NENHUM sucesso aparece com null.
  const TRACKED_JOBS: JobName[] = ['discovery', 'harvest', 'model', 'render'];
  const jobs: JobHealth[] = TRACKED_JOBS.map((job) => {
    const at = lastByJob.get(job) ?? null;
    return {
      job,
      lastSuccessAt: at,
      ageSeconds: at === null ? null : ageSecondsBetween(now, at),
    };
  });

  const failingAdapters = deps.failureCounter.failing().map((f) => ({
    adapterId: f.adapterId,
    consecutive: f.consecutive,
  }));

  const publishedAt = await distPublishedAt(deps.distPath);
  const distAgeSeconds =
    publishedAt === null ? null : ageSecondsBetween(now, publishedAt.toISOString());
  const distStale =
    distAgeSeconds !== null && distAgeSeconds > DIST_STALE_MAX_HOURS * (MS_PER_HOUR / 1000);

  const degraded = failingAdapters.length > ZERO || distStale || publishedAt === null;

  return {
    status: degraded ? 'degraded' : 'ok',
    now: nowIso,
    jobs,
    failingAdapters,
    dist: {
      path: deps.distPath,
      publishedAt: publishedAt === null ? null : publishedAt.toISOString(),
      ageSeconds: distAgeSeconds,
      stale: distStale,
      exists: publishedAt !== null,
    },
  };
};
