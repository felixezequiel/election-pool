/**
 * Monta o `AdapterRegistry` da v1 (nexus, cnt-mda) com um resolver de candidato
 * amarrado ao banco. O resolver é carregado UMA vez (uma query aos aliases) e
 * injetado em todos os adapters — assim o `parse` de cada adapter confirma alias
 * sem bater no banco por candidato. Adicionar instituto = adicionar adapter aqui
 * (docs/02 §4). Registro tipado simples (não módulo NestJS — Nest não está montado;
 * ver DESVIO em `base/registry.ts`).
 */

import { AdapterRegistry } from '@election-pool/adapters/base/registry';
import { NexusAdapter } from '@election-pool/adapters/nexus/nexus-adapter';
import { CntMdaAdapter } from '@election-pool/adapters/cnt-mda/cnt-mda-adapter';
import { resolverFromMap } from '@election-pool/adapters/base/candidate-resolver';
import { RawStorage } from '@election-pool/adapters/base/raw-storage';
import type { CandidateAliasResolver } from '@election-pool/adapters/base/candidate-resolver';
import type { Database } from '../db/pool.js';

export const loadCandidateResolver = async (db: Database): Promise<CandidateAliasResolver> => {
  const rows = await db.query<{ alias: string; candidate_id: string }>(
    `SELECT alias, candidate_id FROM candidate_aliases`,
  );
  return resolverFromMap(new Map(rows.map((r) => [r.alias, r.candidate_id])));
};

export const buildRegistry = (
  resolveCandidate: CandidateAliasResolver,
  storage: RawStorage,
): AdapterRegistry =>
  new AdapterRegistry([
    new NexusAdapter({ resolveCandidate, storage }),
    new CntMdaAdapter({ resolveCandidate, storage }),
  ]);
