import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';
import { JOB_RUN_STATUS } from '@election-pool/contracts/enums';

/**
 * Observabilidade (docs/02 §5). Uma linha por execução de job, com início, fim,
 * status, erro e métricas. Alimenta o `GET /health` (idade do último run
 * bem-sucedido por job) e os alertas de staleness (docs/02 §5).
 *
 * Migration ADITIVA — não altera nenhuma tabela existente (nunca mexemos nas
 * migrations de T-02). `metrics_json` guarda o resumo estruturado do run (o mesmo
 * objeto do log JSON em stdout), para inspeção sem varrer o journald.
 *
 * `job` é texto livre com CHECK contra o enum de contracts (fonte única, como as
 * demais migrations): discovery | harvest | model | render | reparse.
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

const inList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(',');

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('job_runs', {
    id: { type: 'uuid', primaryKey: true },
    job: { type: 'text', notNull: true },
    started_at: { type: 'timestamptz', notNull: true },
    finished_at: { type: 'timestamptz' }, // null enquanto em andamento
    status: {
      type: 'text',
      notNull: true,
      check: `status IN (${inList(JOB_RUN_STATUS.map((s) => s))})`,
    },
    error: { type: 'text' }, // preenchido quando status = 'error'
    metrics_json: { type: 'jsonb', notNull: true, default: '{}' },
  });

  // Consulta quente do /health: último run (por job) com um dado status.
  pgm.createIndex('job_runs', ['job', 'status', 'finished_at']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('job_runs');
}
