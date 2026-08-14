import { z } from 'zod';
import { tseIdSchema, isoDateSchema } from '@election-pool/contracts/branded';
import type { Database } from '../db/pool.js';

/**
 * Acesso à tabela `manual_approvals` (docs/04 §5). Home durável e auditável das
 * aprovações humanas de V4/V5: quem chega aqui já decidiu conscientemente inserir
 * um registro que uma regra de movimento apontou como suspeito. A razão é
 * obrigatória (o CHECK do banco recusa vazio; validamos aqui também, antes de ir
 * ao banco — fronteira Zod, CLAUDE.md).
 *
 * `poll_results`/`poll_scenarios` continuam append-only (R5): esta tabela NÃO os
 * toca; só registra a permissão. A inserção dos cenários aprovados é feita pelo
 * caminho normal de ingestão com o contexto `manuallyApproved`.
 */

export const manualApprovalSchema = z.object({
  tseId: tseIdSchema,
  reason: z.string().trim().min(1),
  approvedAt: isoDateSchema,
});
export type ManualApproval = z.infer<typeof manualApprovalSchema>;

interface ManualApprovalRow {
  tse_id: string;
  reason: string;
  approved_at: string;
}

export class ManualApprovalsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registra (ou re-registra) a aprovação de um `tse_id` com a razão. Reaprovar
   * atualiza razão e instante — a intenção humana corrente é a que vale.
   */
  async approve(tseId: string, reason: string): Promise<ManualApproval> {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
      throw new Error('Aprovação manual exige uma razão não vazia (docs/04 §5).');
    }
    const rows = await this.db.query<ManualApprovalRow>(
      `INSERT INTO manual_approvals (tse_id, reason)
       VALUES ($1, $2)
       ON CONFLICT (tse_id) DO UPDATE SET reason = EXCLUDED.reason, approved_at = now()
       RETURNING tse_id, reason, approved_at`,
      [tseId, trimmed],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new Error(`Falha ao gravar aprovação manual de ${tseId} (nenhuma linha retornada).`);
    }
    return manualApprovalSchema.parse({
      tseId: row.tse_id,
      reason: row.reason,
      approvedAt: row.approved_at,
    });
  }

  async find(tseId: string): Promise<ManualApproval | null> {
    const rows = await this.db.query<ManualApprovalRow>(
      `SELECT tse_id, reason, approved_at FROM manual_approvals WHERE tse_id = $1`,
      [tseId],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : manualApprovalSchema.parse({
          tseId: row.tse_id,
          reason: row.reason,
          approvedAt: row.approved_at,
        });
  }

  /** `true` se o `tse_id` tem aprovação manual registrada (pula V4/V5). */
  async isApproved(tseId: string): Promise<boolean> {
    return (await this.find(tseId)) !== null;
  }
}
