import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';
import { primaryMethodSchema, raceStatusSchema } from '@election-pool/contracts/enums';

/**
 * Reference / normalized-identity tables (docs/03 §2.1).
 *
 * CHECK constraints on enum columns are generated from the Zod enum options so
 * the database and `@election-pool/contracts/enums` cannot drift. A contract
 * test (enum-check-parity.spec.ts) reads these CHECKs back from pg_catalog and
 * asserts equality with the TS enums (docs/03 §3).
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

const inList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(',');

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('institutes', {
    id: { type: 'text', primaryKey: true }, // 'quaest', 'cnt-mda', 'nexus'
    display_name: { type: 'text', notNull: true }, // 'Genial/Quaest'
    legal_name: { type: 'text' }, // razão social no PesqEle
    cnpj: { type: 'text' },
    primary_method: {
      type: 'text',
      notNull: true,
      check: `primary_method IN (${inList(primaryMethodSchema.options)})`,
    },
    site_url: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('institute_aliases', {
    alias: { type: 'text', primaryKey: true }, // como aparece no PesqEle/imprensa
    institute_id: {
      type: 'text',
      notNull: true,
      references: 'institutes(id)',
    },
  });

  pgm.createTable('candidates', {
    id: { type: 'text', primaryKey: true }, // 'lula', 'flavio-bolsonaro'
    display_name: { type: 'text', notNull: true },
    party: { type: 'text' },
    // color_slot 1..8 (docs/05 §4). Bounds come from contracts constants; the
    // CHECK keeps the DB honest even if a bad seed is attempted.
    color_slot: { type: 'smallint', notNull: true, check: 'color_slot BETWEEN 1 AND 8' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // Normalização de nomes é MANUAL. Nunca fuzzy match (CLAUDE.md).
  pgm.createTable('candidate_aliases', {
    alias: { type: 'text', primaryKey: true },
    candidate_id: {
      type: 'text',
      notNull: true,
      references: 'candidates(id)',
    },
  });

  pgm.createTable('races', {
    id: { type: 'text', primaryKey: true }, // 'presidencia-2026'
    display_name: { type: 'text', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      check: `status IN (${inList(raceStatusSchema.options)})`,
    },
    sort_order: { type: 'smallint', notNull: true },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('races');
  pgm.dropTable('candidate_aliases');
  pgm.dropTable('candidates');
  pgm.dropTable('institute_aliases');
  pgm.dropTable('institutes');
}
