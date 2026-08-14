import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';
import { diagnosticKindSchema } from '@election-pool/contracts/enums';

/**
 * Computed layer (docs/03 §2.5). Regenerável a partir do raw/normalized (R5):
 * apagar model_runs + model_estimates e rodar de novo produz o mesmo resultado
 * (docs/01 §9). Nada aqui é fonte de verdade. Todo `numeric`, nunca float.
 *
 * Nota sobre `model_estimates.t2_pair`: docs/03 §2.5 declara a coluna como
 * `text[]` e a inclui na PRIMARY KEY. Colunas de PK são implicitamente NOT NULL,
 * então usamos default `'{}'` (array vazio) para estimativas de 1º turno — assim
 * a PK fica exatamente como o doc especifica e o 2º turno guarda o par ordenado.
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

const inList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(',');

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('model_runs', {
    id: { type: 'uuid', primaryKey: true },
    race_id: { type: 'text', notNull: true, references: 'races(id)' },
    model_version: { type: 'text', notNull: true },
    run_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    reference_date: { type: 'date', notNull: true },
    input_hash: { type: 'text', notNull: true }, // docs/01 §9
    git_sha: { type: 'text', notNull: true },
    params_json: { type: 'jsonb', notNull: true }, // todos os priors, explícitos
    gates_passed: { type: 'boolean', notNull: true },
    gates_json: { type: 'jsonb', notNull: true },
  });

  // Série latente μ_t.
  pgm.createTable('model_estimates', {
    run_id: { type: 'uuid', notNull: true, references: 'model_runs(id)' },
    scenario_kind: { type: 'text', notNull: true },
    t2_pair: { type: 'text[]', notNull: true, default: '{}' },
    candidate_id: { type: 'text', notNull: true, references: 'candidates(id)' },
    date: { type: 'date', notNull: true },
    mean_pct: { type: 'numeric(5,2)', notNull: true },
    lo90_pct: { type: 'numeric(5,2)', notNull: true },
    hi90_pct: { type: 'numeric(5,2)', notNull: true },
  });
  pgm.addConstraint('model_estimates', 'model_estimates_pkey', {
    primaryKey: ['run_id', 'scenario_kind', 'candidate_id', 'date', 't2_pair'],
  });

  pgm.createTable('model_house_effects', {
    run_id: { type: 'uuid', notNull: true, references: 'model_runs(id)' },
    institute_id: { type: 'text', notNull: true, references: 'institutes(id)' },
    candidate_id: { type: 'text', notNull: true, references: 'candidates(id)' },
    effect_pp: { type: 'numeric(5,2)', notNull: true },
    lo90_pp: { type: 'numeric(5,2)', notNull: true },
    hi90_pp: { type: 'numeric(5,2)', notNull: true },
    n_polls: { type: 'integer', notNull: true },
    estimable: { type: 'boolean', notNull: true }, // false se n_polls < 3
  });
  pgm.addConstraint('model_house_effects', 'model_house_effects_pkey', {
    primaryKey: ['run_id', 'institute_id', 'candidate_id'],
  });

  pgm.createTable('model_diagnostics', {
    run_id: { type: 'uuid', notNull: true, references: 'model_runs(id)' },
    kind: {
      type: 'text',
      notNull: true,
      check: `kind IN (${inList(diagnosticKindSchema.options)})`,
    },
    subject_id: { type: 'text', notNull: true }, // institute_id ou contractor_name
    value: { type: 'numeric(8,4)', notNull: true },
    n: { type: 'integer', notNull: true },
    payload: { type: 'jsonb' },
  });
  pgm.addConstraint('model_diagnostics', 'model_diagnostics_pkey', {
    primaryKey: ['run_id', 'kind', 'subject_id'],
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('model_diagnostics');
  pgm.dropTable('model_house_effects');
  pgm.dropTable('model_estimates');
  pgm.dropTable('model_runs');
}
