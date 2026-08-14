import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

/**
 * Raw provenance layer (docs/03 §2.2). Exists for provenance and debugging only.
 * NUNCA é exposto na web nem republicado (R3, docs/08). We store metadata + a
 * blob path; the body itself lives on disk, never in this table.
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('raw_documents', {
    id: { type: 'uuid', primaryKey: true },
    url: { type: 'text', notNull: true },
    fetched_at: { type: 'timestamptz', notNull: true },
    http_status: { type: 'smallint', notNull: true },
    content_type: { type: 'text' },
    content_hash: { type: 'text', notNull: true }, // sha256 do corpo
    storage_path: { type: 'text', notNull: true }, // caminho no blob local, NUNCA servido
    etag: { type: 'text' },
    last_modified: { type: 'text' },
  });

  pgm.createIndex('raw_documents', [{ name: 'url' }, { name: 'fetched_at', sort: 'DESC' }]);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('raw_documents');
}
