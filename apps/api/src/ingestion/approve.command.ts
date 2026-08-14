/**
 * Comando de aprovação manual de ingestão (docs/04 §5).
 *
 * `pnpm ingest:approve <tse_id> --reason="..."` é o ÚNICO caminho para inserir um
 * registro que V4 ou V5 apontaram como movimento suspeito. A regra é dura: SEM
 * `--reason`, RECUSA (não há aprovação sem motivo registrado — auditabilidade,
 * R6-adjacente). Aprovar NÃO relaxa limite nem desliga V1–V3/V6/V7: só permite
 * pular as duas comparativas (V4/V5) para AQUELE `tse_id`.
 *
 * O comando (1) exige que o registro exista, (2) grava a aprovação + razão em
 * `manual_approvals`, e (3) reprocessa o registro pelo caminho normal de ingestão
 * com `manuallyApproved=true` no contexto — assim os cenários entram exatamente
 * como entrariam na colheita, mas passando por V4/V5. A lógica de I/O de rede/parse
 * é do HarvestJob; aqui só orquestramos a permissão e disparamos o reprocesso.
 *
 * Esta unidade é PURA de argv: recebe `{ tseId, reason }` já parseados e um
 * `runReingest` injetável, para ser testável sem CLI nem rede. O parsing de argv
 * e a montagem real vivem em `approve.entry.ts`.
 */

import { tseIdSchema } from '@election-pool/contracts/branded';
import type { Database } from '../db/pool.js';
import { ManualApprovalsRepository } from './manual-approvals.repository.js';
import type { ManualApproval } from './manual-approvals.repository.js';

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export interface ApproveArgs {
  readonly tseId: string;
  /** Razão da aprovação. Vazia/ausente ⇒ RECUSA (docs/04 §5). */
  readonly reason: string | null;
}

export interface ApproveDeps {
  readonly db: Database;
  /**
   * Reprocessa o registro aprovado inserindo seus cenários com `manuallyApproved`
   * no contexto de validação. Injetável para teste; em produção é o HarvestJob
   * mirando um único `tse_id`. Devolve quantos cenários inseriu.
   */
  readonly runReingest?: (tseId: string) => Promise<number>;
}

export interface ApproveOutcome {
  readonly approval: ManualApproval;
  readonly scenariosInserted: number;
}

const registrationExists = async (db: Database, tseId: string): Promise<boolean> => {
  const rows = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM poll_registrations WHERE tse_id = $1`,
    [tseId],
  );
  const first = rows[0];
  return first !== undefined && first.n !== '0';
};

export const approve = async (args: ApproveArgs, deps: ApproveDeps): Promise<ApproveOutcome> => {
  // 1. Razão obrigatória — a recusa é do produto, não uma consequência do banco.
  if (args.reason === null || args.reason.trim().length === 0) {
    throw new ApprovalError(
      'Recusado: aprovação manual exige --reason="...". ' +
        'V4/V5 disparando é comportamento correto; a exceção precisa de motivo (docs/04 §5).',
    );
  }

  // 2. tse_id bem-formado e existente. Não inventamos registro.
  const parsedTseId = tseIdSchema.safeParse(args.tseId);
  if (!parsedTseId.success) {
    throw new ApprovalError(`tse_id inválido: "${args.tseId}" (esperado BR-NNNNN/AAAA).`);
  }
  const tseId = parsedTseId.data;
  if (!(await registrationExists(deps.db, tseId))) {
    throw new ApprovalError(`Nenhum registro com tse_id=${tseId} — nada a aprovar.`);
  }

  // 3. Grava a permissão + razão (durável, auditável).
  const approval = await new ManualApprovalsRepository(deps.db).approve(tseId, args.reason);

  // 4. Reprocessa (se um reingestor foi injetado), agora com V4/V5 pulados.
  const scenariosInserted = deps.runReingest === undefined ? 0 : await deps.runReingest(tseId);

  return { approval, scenariosInserted };
};
