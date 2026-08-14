import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';
import { contractorTypeSchema, disclosureStatusSchema } from '@election-pool/contracts/enums';

/**
 * PesqEle registrations (docs/03 §2.3). `tse_id` é a chave canônica. Percentuais
 * e valores monetários são `numeric` — nunca float — porque este projeto é sobre
 * precisão. `disclosure_status = 'presumed_undisclosed'` é DADO (taxa de
 * engavetamento), não erro de pipeline.
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

const inList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(',');

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('poll_registrations', {
    tse_id: { type: 'text', primaryKey: true }, // 'BR-06591/2026'
    race_id: { type: 'text', notNull: true, references: 'races(id)' },
    institute_id: { type: 'text', references: 'institutes(id)' }, // null se alias desconhecido
    institute_raw_name: { type: 'text', notNull: true },
    contractor_name: { type: 'text', notNull: true }, // quem pagou
    contractor_type: {
      type: 'text',
      check: `contractor_type IN (${inList(contractorTypeSchema.options)})`,
    },
    registered_at: { type: 'timestamptz', notNull: true },
    field_start: { type: 'date', notNull: true },
    field_end: { type: 'date', notNull: true },
    sample_size: { type: 'integer', notNull: true, check: 'sample_size > 0' },
    margin_of_error: { type: 'numeric(4,2)' }, // p.p.
    confidence_level: { type: 'numeric(4,2)' }, // normalmente 95.00
    cost_brl: { type: 'numeric(12,2)' },
    first_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    source_expired_at: { type: 'timestamptz' }, // quando sumiu do PesqEle
    disclosure_status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check: `disclosure_status IN (${inList(disclosureStatusSchema.options)})`,
    },
  });

  // docs/03 §4: field_end >= field_start (CHECK).
  pgm.addConstraint('poll_registrations', 'poll_registrations_field_range_check', {
    check: 'field_end >= field_start',
  });

  pgm.createIndex('poll_registrations', [{ name: 'race_id' }, { name: 'field_end', sort: 'DESC' }]);
  pgm.createIndex('poll_registrations', ['institute_id', 'disclosure_status']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('poll_registrations');
}
