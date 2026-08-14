import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

/**
 * Aprovações manuais de ingestão (docs/04 §5).
 *
 * V4/V5 podem disparar legitimamente em movimento real (desistência, escândalo).
 * A resolução é HUMANA, nunca relaxamento de limite: `pnpm ingest:approve <tse_id>
 * --reason="..."` grava aqui a permissão para inserir aquele registro pulando V4/V5
 * (V1–V3, V6, V7 continuam bloqueando). A razão é obrigatória e fica registrada —
 * auditabilidade (R6-adjacente): toda exceção manual tem autor humano e motivo.
 *
 * Tabela ADITIVA — não altera nenhuma tabela existente. Uma linha por `tse_id`
 * aprovado; reaprovar atualiza a razão e o instante (a intenção humana corrente
 * é a que vale).
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('manual_approvals', {
    tse_id: {
      type: 'text',
      primaryKey: true,
      references: 'poll_registrations(tse_id)',
    },
    reason: { type: 'text', notNull: true, check: 'length(btrim(reason)) > 0' },
    approved_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('manual_approvals');
}
