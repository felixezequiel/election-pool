import { z } from 'zod';
import { primaryMethodSchema, raceStatusSchema } from '@election-pool/contracts/enums';
import { colorSlotSchema } from '@election-pool/contracts/palette';
import type { Database } from './pool.js';

/**
 * Acesso às tabelas de referência (docs/03 §2.1): institutes, candidates, races
 * e seus aliases. Contracts não define schema de domínio para instituto/candidato
 * (só enums/palette/races), então declaramos aqui schemas Zod estreitos que
 * espelham as colunas — Zod continua sendo a fronteira de validação (CLAUDE.md),
 * reaproveitando os enums e o `colorSlotSchema` dos contratos.
 *
 * Seed de candidato/alias é MANUAL e revisado — nunca fuzzy match (CLAUDE.md).
 */

export const instituteSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  legalName: z.string().nullable(),
  cnpj: z.string().nullable(),
  primaryMethod: primaryMethodSchema,
  siteUrl: z.string().nullable(),
});
export type Institute = z.infer<typeof instituteSchema>;

export const candidateSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  party: z.string().nullable(),
  colorSlot: colorSlotSchema,
});
export type Candidate = z.infer<typeof candidateSchema>;

export const raceRowSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: raceStatusSchema,
  sortOrder: z.number().int(),
});
export type RaceRow = z.infer<typeof raceRowSchema>;

export const aliasSchema = z.object({
  alias: z.string(),
  targetId: z.string(),
});
export type Alias = z.infer<typeof aliasSchema>;

interface InstituteRow {
  id: string;
  display_name: string;
  legal_name: string | null;
  cnpj: string | null;
  primary_method: string;
  site_url: string | null;
}

interface CandidateRow {
  id: string;
  display_name: string;
  party: string | null;
  color_slot: number;
}

interface RaceDbRow {
  id: string;
  display_name: string;
  status: string;
  sort_order: number;
}

export class ReferenceRepository {
  constructor(private readonly db: Database) {}

  // --- institutes ----------------------------------------------------------
  async insertInstitute(inst: Institute): Promise<void> {
    await this.db.query(
      `INSERT INTO institutes (id, display_name, legal_name, cnpj, primary_method, site_url)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inst.id, inst.displayName, inst.legalName, inst.cnpj, inst.primaryMethod, inst.siteUrl],
    );
  }

  async findInstituteById(id: string): Promise<Institute | null> {
    const rows = await this.db.query<InstituteRow>(
      `SELECT id, display_name, legal_name, cnpj, primary_method, site_url
         FROM institutes WHERE id = $1`,
      [id],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : instituteSchema.parse({
          id: row.id,
          displayName: row.display_name,
          legalName: row.legal_name,
          cnpj: row.cnpj,
          primaryMethod: row.primary_method,
          siteUrl: row.site_url,
        });
  }

  // --- candidates ----------------------------------------------------------
  async insertCandidate(cand: Candidate): Promise<void> {
    await this.db.query(
      `INSERT INTO candidates (id, display_name, party, color_slot)
       VALUES ($1, $2, $3, $4)`,
      [cand.id, cand.displayName, cand.party, cand.colorSlot],
    );
  }

  async listCandidates(): Promise<Candidate[]> {
    const rows = await this.db.query<CandidateRow>(
      `SELECT id, display_name, party, color_slot FROM candidates ORDER BY id`,
    );
    return rows.map((row) =>
      candidateSchema.parse({
        id: row.id,
        displayName: row.display_name,
        party: row.party,
        colorSlot: row.color_slot,
      }),
    );
  }

  // --- races ---------------------------------------------------------------
  async insertRace(race: RaceRow): Promise<void> {
    await this.db.query(
      `INSERT INTO races (id, display_name, status, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [race.id, race.displayName, race.status, race.sortOrder],
    );
  }

  async listRaces(): Promise<RaceRow[]> {
    const rows = await this.db.query<RaceDbRow>(
      `SELECT id, display_name, status, sort_order FROM races ORDER BY sort_order`,
    );
    return rows.map((row) =>
      raceRowSchema.parse({
        id: row.id,
        displayName: row.display_name,
        status: row.status,
        sortOrder: row.sort_order,
      }),
    );
  }

  // --- aliases -------------------------------------------------------------
  async insertInstituteAlias(alias: Alias): Promise<void> {
    await this.db.query(`INSERT INTO institute_aliases (alias, institute_id) VALUES ($1, $2)`, [
      alias.alias,
      alias.targetId,
    ]);
  }

  async insertCandidateAlias(alias: Alias): Promise<void> {
    await this.db.query(`INSERT INTO candidate_aliases (alias, candidate_id) VALUES ($1, $2)`, [
      alias.alias,
      alias.targetId,
    ]);
  }

  async resolveInstituteAlias(alias: string): Promise<string | null> {
    const rows = await this.db.query<{ institute_id: string }>(
      `SELECT institute_id FROM institute_aliases WHERE alias = $1`,
      [alias],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : aliasSchema.parse({ alias, targetId: row.institute_id }).targetId;
  }

  async resolveCandidateAlias(alias: string): Promise<string | null> {
    const rows = await this.db.query<{ candidate_id: string }>(
      `SELECT candidate_id FROM candidate_aliases WHERE alias = $1`,
      [alias],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : aliasSchema.parse({ alias, targetId: row.candidate_id }).targetId;
  }
}
