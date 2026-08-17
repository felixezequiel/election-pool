/**
 * Monta o `AdapterRegistry` com um resolver de candidato amarrado ao banco. O
 * resolver é carregado UMA vez (uma query aos aliases) e injetado em todos os
 * adapters — assim o `parse` de cada adapter confirma alias sem bater no banco por
 * candidato. Adicionar instituto = adicionar adapter aqui (docs/02 §4).
 *
 * ── Quem está LIGADO, e por quê ────────────────────────────────────────────────
 * Só entra aqui adapter que EXTRAI número de uma fonte alcançável. Adapter cujo
 * `parse` recusa por construção fica de fora: ligado, ele viraria um `ParseError`
 * previsível a cada ciclo, poluindo o log e — pior — alimentando o contador de
 * falhas por adapter, que acima do limiar BLOQUEIA a publicação (docs/07 §6.6).
 * Um adapter que não pode funcionar derrubaria o site inteiro.
 *
 * FORA, com o motivo (detalhe em `tasks/T-2*.md` de cada um):
 *  - `atlas`   — números só em PDF de CDN cujo robots.txt proíbe tudo, e nenhuma
 *                superfície acessível traz o registro TSE.
 *  - `palver`  — 74 páginas de resultado RASTERIZADAS (sem camada de texto).
 *  - `ipec`    — host atrás de desafio Cloudflare; e o 1º turno estimulado, que é
 *                o número principal, é publicado como gráfico.
 *  - `datafolha` — nas rodadas presidenciais o valor é atrelado a uma DESCRIÇÃO
 *                ("o presidenciável do PL"), não a um nome; atribuir seria chute
 *                que o V6 não pega. A gramática funciona nas estaduais e liga
 *                sozinha no dia em que a redação nomear os líderes.
 *  - `cnt-mda` — DESLIGADO por dívida: extrai PDF por ordem de fluxo (sem
 *                coordenada) e só tem fixture SINTÉTICA. Ver Q-13: o risco é
 *                trocar os finalistas do 2º turno com soma 100 e gates verdes.
 */

import { AdapterRegistry } from '@election-pool/adapters/base/registry';
import { NexusAdapter } from '@election-pool/adapters/nexus/nexus-adapter';
import { QuaestAdapter } from '@election-pool/adapters/quaest/quaest-adapter';
import { ParanaPesquisasAdapter } from '@election-pool/adapters/paranapesquisas/paranapesquisas-adapter';
import { RealTimeAdapter } from '@election-pool/adapters/realtime/realtime-adapter';
import { PoderDataAdapter } from '@election-pool/adapters/poderdata/poderdata-adapter';
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
    new QuaestAdapter({ resolveCandidate, storage }),
    new ParanaPesquisasAdapter({ resolveCandidate, storage }),
    new RealTimeAdapter({ resolveCandidate, storage }),
    new PoderDataAdapter({ resolveCandidate, storage }),
  ]);
