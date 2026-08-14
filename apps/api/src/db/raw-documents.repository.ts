import { rawDocumentSchema } from '@election-pool/contracts/domain';
import type { RawDocument } from '@election-pool/contracts/domain';
import type { Database } from './pool.js';

/**
 * Acesso a `raw_documents` (docs/03 §2.2). Proveniência/depuração; nunca servido
 * ao público (R3). Toda linha lida passa por `rawDocumentSchema` antes de virar
 * objeto de domínio (CLAUDE.md: Zod em toda fronteira, incluindo linha de banco).
 */

interface RawDocumentRow {
  id: string;
  url: string;
  fetched_at: string;
  http_status: number;
  content_type: string | null;
  content_hash: string;
  storage_path: string;
  etag: string | null;
  last_modified: string | null;
}

const mapRow = (row: RawDocumentRow): RawDocument =>
  rawDocumentSchema.parse({
    id: row.id,
    url: row.url,
    fetchedAt: row.fetched_at,
    httpStatus: row.http_status,
    contentType: row.content_type,
    contentHash: row.content_hash,
    storagePath: row.storage_path,
    etag: row.etag,
    lastModified: row.last_modified,
  });

export class RawDocumentsRepository {
  constructor(private readonly db: Database) {}

  async insert(doc: RawDocument): Promise<void> {
    await this.db.query(
      `INSERT INTO raw_documents
         (id, url, fetched_at, http_status, content_type, content_hash,
          storage_path, etag, last_modified)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        doc.id,
        doc.url,
        doc.fetchedAt,
        doc.httpStatus,
        doc.contentType,
        doc.contentHash,
        doc.storagePath,
        doc.etag,
        doc.lastModified,
      ],
    );
  }

  async findById(id: string): Promise<RawDocument | null> {
    const rows = await this.db.query<RawDocumentRow>(
      `SELECT id, url, fetched_at, http_status, content_type, content_hash,
              storage_path, etag, last_modified
         FROM raw_documents
        WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined ? null : mapRow(row);
  }
}
