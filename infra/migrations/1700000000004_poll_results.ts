import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';
import { scenarioKindSchema } from '@election-pool/contracts/enums';

/**
 * Normalized results (docs/03 §2.4).
 *
 * - `poll_scenarios`: one row per instituto scenario (1º turno estimulado /
 *   espontâneo, 2º turno). `t2_pair` is the ordered pair of candidate ids for a
 *   runoff; NULL for 1º turno.
 * - `poll_results`: one row per candidate value inside a scenario. **Append-only**
 *   (R5): a trigger raises on UPDATE and DELETE. Correction is a new scenario,
 *   never a mutation.
 * - Partial unique index: at most one `is_canonical = true` per
 *   `(tse_id, kind, t2_pair)` (docs/03 §4). `NULLS NOT DISTINCT` (pg 15+) makes
 *   two canonical 1º-turno scenarios (both t2_pair NULL) collide as intended.
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

const inList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(',');

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('poll_scenarios', {
    id: { type: 'uuid', primaryKey: true },
    tse_id: { type: 'text', notNull: true, references: 'poll_registrations(tse_id)' },
    raw_document_id: { type: 'uuid', notNull: true, references: 'raw_documents(id)' },
    kind: {
      type: 'text',
      notNull: true,
      check: `kind IN (${inList(scenarioKindSchema.options)})`,
    },
    label: { type: 'text', notNull: true }, // rótulo do instituto: 'Cenário 1'
    is_canonical: { type: 'boolean', notNull: true, default: false },
    canonical_reason: { type: 'text' }, // regra aplicada, docs/01 §3
    t2_pair: { type: 'text[]' }, // [candidate_id, candidate_id], ordenado
    blank_null_pct: { type: 'numeric(5,2)' },
    undecided_pct: { type: 'numeric(5,2)' },
    extracted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addConstraint('poll_scenarios', 'poll_scenarios_tse_kind_label_key', {
    unique: ['tse_id', 'kind', 'label'],
  });

  // docs/03 §4: um único is_canonical = true por (tse_id, kind, t2_pair).
  // node-pg-migrate não expõe NULLS NOT DISTINCT; raw SQL para cobrir t2_pair NULL.
  pgm.sql(`
    CREATE UNIQUE INDEX poll_scenarios_one_canonical_idx
      ON poll_scenarios (tse_id, kind, t2_pair)
      NULLS NOT DISTINCT
      WHERE is_canonical
  `);

  pgm.createTable('poll_results', {
    scenario_id: { type: 'uuid', notNull: true, references: 'poll_scenarios(id)' },
    candidate_id: { type: 'text', notNull: true, references: 'candidates(id)' },
    // docs/03 §4: value_pct entre 0 e 100 (CHECK). numeric, nunca float.
    value_pct: {
      type: 'numeric(5,2)',
      notNull: true,
      check: 'value_pct >= 0 AND value_pct <= 100',
    },
  });

  pgm.addConstraint('poll_results', 'poll_results_pkey', {
    primaryKey: ['scenario_id', 'candidate_id'],
  });

  // docs/03 §2.4 / R5: poll_results é append-only. Trigger BEFORE UPDATE OR DELETE
  // que lança — correção se faz com novo cenário, nunca com UPDATE/DELETE.
  pgm.sql(`
    CREATE FUNCTION poll_results_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'poll_results is append-only: % blocked (R5, docs/03 §2.4)', TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE TRIGGER poll_results_no_update_delete
      BEFORE UPDATE OR DELETE ON poll_results
      FOR EACH ROW EXECUTE FUNCTION poll_results_append_only();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql('DROP TRIGGER IF EXISTS poll_results_no_update_delete ON poll_results');
  pgm.sql('DROP FUNCTION IF EXISTS poll_results_append_only()');
  pgm.dropTable('poll_results');
  pgm.sql('DROP INDEX IF EXISTS poll_scenarios_one_canonical_idx');
  pgm.dropTable('poll_scenarios');
}
