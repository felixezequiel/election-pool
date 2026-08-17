import { z } from 'zod';
import { PHOTO_FORMATS } from '@election-pool/adapters/tse-candidatos/image';
import type { Database } from './pool.js';

/**
 * Acesso às colunas de foto de `candidates` (migration 1700000000010).
 *
 * Zod na fronteira do banco (CLAUDE.md): a linha crua é validada na saída e o
 * tipo vem de `z.infer`, nunca declarado à mão em paralelo. `photo_*` é um bloco
 * tudo-ou-nada — o CHECK da migration garante isso no banco e o
 * `candidatePhotoSchema` garante aqui, para que meia foto não atravesse a
 * fronteira nem por bug de query (R4).
 *
 * As colunas de foto são DERIVADAS de uma fonte externa e regeneráveis (basta
 * rodar o job de novo), mas moram em `candidates` porque são atributo de
 * referência do candidato, não resultado de modelo — nada aqui entra em
 * `model_runs`/`model_estimates` (R5 continua valendo: `poll_results` segue
 * imutável e intocado).
 */

export const photoFormatSchema = z.enum(PHOTO_FORMATS);
export type PhotoFormatRow = z.infer<typeof photoFormatSchema>;

/** Bloco de foto de um candidato. `null` inteiro = candidato sem foto. */
export const candidatePhotoSchema = z.object({
  /** Caminho servido, ex.: '/candidatos/lula.jpg'. */
  photoPath: z.string().min(1),
  /** Link do registro de candidatura no TSE (proveniência, R6). */
  photoSourceUrl: z.string().url(),
  /** `sq_CANDIDATO` — identificador oficial da candidatura casada. */
  tseCandidaturaId: z.string().min(1),
  /** URL crua da imagem no TSE, efetivamente baixada. */
  originUrl: z.string().url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteLength: z.number().int().positive(),
  format: photoFormatSchema,
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  /** ISO-8601 com offset (America/Sao_Paulo) — CLAUDE.md. */
  capturedAt: z.string().min(1),
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
});
export type CandidatePhoto = z.infer<typeof candidatePhotoSchema>;

/** Candidato + foto (quando houver), como o job precisa ler. */
export const candidateWithPhotoSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  party: z.string().nullable(),
  photo: candidatePhotoSchema.nullable(),
});
export type CandidateWithPhoto = z.infer<typeof candidateWithPhotoSchema>;

interface CandidatePhotoRow {
  id: string;
  display_name: string;
  party: string | null;
  photo_path: string | null;
  photo_source_url: string | null;
  photo_tse_candidatura_id: string | null;
  photo_origin_url: string | null;
  photo_sha256: string | null;
  photo_bytes: number | null;
  photo_format: string | null;
  photo_width_px: number | null;
  photo_height_px: number | null;
  photo_captured_at: string | null;
  photo_etag: string | null;
  photo_last_modified: string | null;
}

const SELECT_COLUMNS = `
  id, display_name, party,
  photo_path, photo_source_url, photo_tse_candidatura_id, photo_origin_url,
  photo_sha256, photo_bytes, photo_format, photo_width_px, photo_height_px,
  photo_captured_at, photo_etag, photo_last_modified`;

/**
 * Monta o bloco de foto. Se `photo_path` é nulo, a foto é `null` INTEIRA — não
 * existe objeto meio preenchido. Se `photo_path` existe mas falta companhia, o
 * Zod lança: é sinal de corrupção, não de "quase pronto".
 */
const toPhoto = (row: CandidatePhotoRow): CandidatePhoto | null => {
  if (row.photo_path === null) return null;
  return candidatePhotoSchema.parse({
    photoPath: row.photo_path,
    photoSourceUrl: row.photo_source_url,
    tseCandidaturaId: row.photo_tse_candidatura_id,
    originUrl: row.photo_origin_url,
    sha256: row.photo_sha256,
    byteLength: row.photo_bytes,
    format: row.photo_format,
    widthPx: row.photo_width_px,
    heightPx: row.photo_height_px,
    capturedAt: row.photo_captured_at,
    etag: row.photo_etag,
    lastModified: row.photo_last_modified,
  });
};

export class CandidatePhotosRepository {
  constructor(private readonly db: Database) {}

  /** Todos os candidatos com o bloco de foto atual (ou `null`). */
  async listCandidatesWithPhotos(): Promise<CandidateWithPhoto[]> {
    const rows = await this.db.query<CandidatePhotoRow>(
      `SELECT ${SELECT_COLUMNS} FROM candidates ORDER BY id`,
    );
    return rows.map((row) =>
      candidateWithPhotoSchema.parse({
        id: row.id,
        displayName: row.display_name,
        party: row.party,
        photo: toPhoto(row),
      }),
    );
  }

  async findByCandidateId(candidateId: string): Promise<CandidateWithPhoto | null> {
    const rows = await this.db.query<CandidatePhotoRow>(
      `SELECT ${SELECT_COLUMNS} FROM candidates WHERE id = $1`,
      [candidateId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return candidateWithPhotoSchema.parse({
      id: row.id,
      displayName: row.display_name,
      party: row.party,
      photo: toPhoto(row),
    });
  }

  /**
   * Grava o bloco de foto de um candidato. Valida com Zod ANTES do UPDATE — o
   * banco nunca vê um bloco parcial vindo daqui.
   *
   * `UPDATE`, não `INSERT`: o candidato já existe (seed manual). Se o id não
   * existir, LANÇA — criar candidato automaticamente é proibido (docs/04 §4.1).
   */
  async setPhoto(candidateId: string, photo: CandidatePhoto): Promise<void> {
    const valid = candidatePhotoSchema.parse(photo);
    const rows = await this.db.query<{ id: string }>(
      `UPDATE candidates
          SET photo_path = $2,
              photo_source_url = $3,
              photo_tse_candidatura_id = $4,
              photo_origin_url = $5,
              photo_sha256 = $6,
              photo_bytes = $7,
              photo_format = $8,
              photo_width_px = $9,
              photo_height_px = $10,
              photo_captured_at = $11,
              photo_etag = $12,
              photo_last_modified = $13
        WHERE id = $1
      RETURNING id`,
      [
        candidateId,
        valid.photoPath,
        valid.photoSourceUrl,
        valid.tseCandidaturaId,
        valid.originUrl,
        valid.sha256,
        valid.byteLength,
        valid.format,
        valid.widthPx,
        valid.heightPx,
        valid.capturedAt,
        valid.etag,
        valid.lastModified,
      ],
    );
    if (rows.length === 0) {
      throw new Error(
        `Candidato '${candidateId}' não existe em candidates: o job de fotos ` +
          'NÃO cria candidato (cadastro é manual, docs/04 §4.1)',
      );
    }
  }

  /**
   * Apaga o bloco de foto. Usado só em revisão manual/limpeza — o job NUNCA
   * chama isto: rebaixar dado bom porque uma execução falhou seria o oposto de
   * idempotência.
   */
  async clearPhoto(candidateId: string): Promise<void> {
    await this.db.query(
      `UPDATE candidates
          SET photo_path = NULL, photo_source_url = NULL, photo_tse_candidatura_id = NULL,
              photo_origin_url = NULL, photo_sha256 = NULL, photo_bytes = NULL,
              photo_format = NULL, photo_width_px = NULL, photo_height_px = NULL,
              photo_captured_at = NULL, photo_etag = NULL, photo_last_modified = NULL
        WHERE id = $1`,
      [candidateId],
    );
  }

  /** Mapa alias → candidate_id, para o casamento determinístico. */
  async loadCandidateAliases(): Promise<Map<string, string>> {
    const rows = await this.db.query<{ alias: string; candidate_id: string }>(
      `SELECT alias, candidate_id FROM candidate_aliases`,
    );
    return new Map(rows.map((row) => [row.alias, row.candidate_id]));
  }
}
