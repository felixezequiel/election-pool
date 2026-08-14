import { pollRegistrationSchema } from '@election-pool/contracts/domain';
import type { PollRegistration } from '@election-pool/contracts/domain';
import type { Database } from './pool.js';

/**
 * Acesso a `poll_registrations` (docs/03 §2.3). O DiscoveryJob (docs/02 §3.1) faz
 * upsert por `tse_id` e NUNCA deleta: registro que some da origem recebe
 * `source_expired_at`. Toda linha lida passa por `pollRegistrationSchema`.
 */

interface PollRegistrationRow {
  tse_id: string;
  race_id: string;
  institute_id: string | null;
  institute_raw_name: string;
  contractor_name: string;
  contractor_type: string | null;
  registered_at: string;
  field_start: string;
  field_end: string;
  sample_size: number;
  margin_of_error: number | null;
  confidence_level: number | null;
  cost_brl: number | null;
  first_seen_at: string;
  source_expired_at: string | null;
  disclosure_status: string;
}

const mapRow = (row: PollRegistrationRow): PollRegistration =>
  pollRegistrationSchema.parse({
    tseId: row.tse_id,
    raceId: row.race_id,
    instituteId: row.institute_id,
    instituteRawName: row.institute_raw_name,
    contractorName: row.contractor_name,
    contractorType: row.contractor_type,
    registeredAt: row.registered_at,
    fieldStart: row.field_start,
    fieldEnd: row.field_end,
    sampleSize: row.sample_size,
    marginOfError: row.margin_of_error,
    confidenceLevel: row.confidence_level,
    costBrl: row.cost_brl,
    firstSeenAt: row.first_seen_at,
    sourceExpiredAt: row.source_expired_at,
    disclosureStatus: row.disclosure_status,
  });

const SELECT_COLUMNS = `
  tse_id, race_id, institute_id, institute_raw_name, contractor_name,
  contractor_type, registered_at, field_start, field_end, sample_size,
  margin_of_error, confidence_level, cost_brl, first_seen_at,
  source_expired_at, disclosure_status
`;

export class PollRegistrationsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Upsert por `tse_id` (chave canônica). `first_seen_at` só é gravado na
   * primeira vez — no conflito, o valor existente é preservado.
   */
  async upsert(reg: PollRegistration): Promise<void> {
    await this.db.query(
      `INSERT INTO poll_registrations
         (tse_id, race_id, institute_id, institute_raw_name, contractor_name,
          contractor_type, registered_at, field_start, field_end, sample_size,
          margin_of_error, confidence_level, cost_brl, first_seen_at,
          source_expired_at, disclosure_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (tse_id) DO UPDATE SET
         race_id = EXCLUDED.race_id,
         institute_id = EXCLUDED.institute_id,
         institute_raw_name = EXCLUDED.institute_raw_name,
         contractor_name = EXCLUDED.contractor_name,
         contractor_type = EXCLUDED.contractor_type,
         registered_at = EXCLUDED.registered_at,
         field_start = EXCLUDED.field_start,
         field_end = EXCLUDED.field_end,
         sample_size = EXCLUDED.sample_size,
         margin_of_error = EXCLUDED.margin_of_error,
         confidence_level = EXCLUDED.confidence_level,
         cost_brl = EXCLUDED.cost_brl,
         source_expired_at = EXCLUDED.source_expired_at,
         disclosure_status = EXCLUDED.disclosure_status`,
      [
        reg.tseId,
        reg.raceId,
        reg.instituteId,
        reg.instituteRawName,
        reg.contractorName,
        reg.contractorType,
        reg.registeredAt,
        reg.fieldStart,
        reg.fieldEnd,
        reg.sampleSize,
        reg.marginOfError,
        reg.confidenceLevel,
        reg.costBrl,
        reg.firstSeenAt,
        reg.sourceExpiredAt,
        reg.disclosureStatus,
      ],
    );
  }

  async findByTseId(tseId: string): Promise<PollRegistration | null> {
    const rows = await this.db.query<PollRegistrationRow>(
      `SELECT ${SELECT_COLUMNS} FROM poll_registrations WHERE tse_id = $1`,
      [tseId],
    );
    const row = rows[0];
    return row === undefined ? null : mapRow(row);
  }

  async listByRace(raceId: string): Promise<PollRegistration[]> {
    const rows = await this.db.query<PollRegistrationRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM poll_registrations
        WHERE race_id = $1
        ORDER BY field_end DESC`,
      [raceId],
    );
    return rows.map(mapRow);
  }
}
