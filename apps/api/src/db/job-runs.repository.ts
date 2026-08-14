import { randomUUID } from 'node:crypto';
import { jobRunStatusSchema, jobNameSchema } from '@election-pool/contracts/enums';
import type { JobName } from '@election-pool/contracts/enums';
import { z } from 'zod';
import type { Database } from './pool.js';

/**
 * `job_runs` (docs/02 §5): registro de cada execução de job — início, fim,
 * status, erro e métricas. Alimenta o `GET /health` (idade do último run
 * bem-sucedido por job) e os alertas de staleness.
 *
 * Fluxo: `start()` grava a linha `running` no início do run e devolve o id;
 * `finish()` fecha com `ok`/`error`, fim e métricas. Toda leitura passa por Zod
 * (fronteira de banco, CLAUDE.md).
 */

const ZERO = 0;

const lastSuccessRowSchema = z.object({
  job: jobNameSchema,
  finishedAt: z.string(),
});
export type LastSuccessRow = z.infer<typeof lastSuccessRowSchema>;

export interface JobRunMetrics {
  [key: string]: unknown;
}

export class JobRunsRepository {
  constructor(private readonly db: Database) {}

  /** Abre um run (`running`) e devolve seu id para o `finish()` posterior. */
  async start(job: JobName, startedAt: string): Promise<string> {
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO job_runs (id, job, started_at, status, metrics_json)
       VALUES ($1, $2, $3, $4, '{}'::jsonb)`,
      [id, job, startedAt, jobRunStatusSchema.enum.running],
    );
    return id;
  }

  /** Fecha um run com sucesso: status `ok`, fim e métricas. */
  async finishOk(id: string, finishedAt: string, metrics: JobRunMetrics): Promise<void> {
    await this.db.query(
      `UPDATE job_runs
          SET status = $2, finished_at = $3, metrics_json = $4::jsonb, error = NULL
        WHERE id = $1`,
      [id, jobRunStatusSchema.enum.ok, finishedAt, JSON.stringify(metrics)],
    );
  }

  /** Fecha um run com falha: status `error`, fim, mensagem e métricas parciais. */
  async finishError(
    id: string,
    finishedAt: string,
    error: string,
    metrics: JobRunMetrics,
  ): Promise<void> {
    await this.db.query(
      `UPDATE job_runs
          SET status = $2, finished_at = $3, error = $4, metrics_json = $5::jsonb
        WHERE id = $1`,
      [id, jobRunStatusSchema.enum.error, finishedAt, error, JSON.stringify(metrics)],
    );
  }

  /**
   * Instante do último run bem-sucedido de cada job (docs/02 §5: idade do último
   * run bem-sucedido). Só jobs que já tiveram ao menos um `ok` aparecem.
   */
  async lastSuccessByJob(): Promise<LastSuccessRow[]> {
    const rows = await this.db.query<{ job: string; finished_at: string }>(
      `SELECT job, max(finished_at) AS finished_at
         FROM job_runs
        WHERE status = $1 AND finished_at IS NOT NULL
        GROUP BY job
        ORDER BY job`,
      [jobRunStatusSchema.enum.ok],
    );
    return rows.map((r) => lastSuccessRowSchema.parse({ job: r.job, finishedAt: r.finished_at }));
  }

  /** Nº de runs de um job com um dado status (para testes/diagnóstico). */
  async countByJobStatus(job: JobName, status: 'running' | 'ok' | 'error'): Promise<number> {
    const rows = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM job_runs WHERE job = $1 AND status = $2`,
      [job, status],
    );
    const first = rows[0];
    return first === undefined ? ZERO : Number.parseInt(first.n, 10);
  }
}
