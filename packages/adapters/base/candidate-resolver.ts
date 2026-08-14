/**
 * Resolução de alias de candidato (docs/04 §4.1). O adapter NÃO conhece o banco:
 * recebe um `CandidateAliasResolver` (uma função) e o usa para mapear a grafia
 * que aparece no documento para o `candidate_id` canônico.
 *
 * Regra dura: alias desconhecido ⇒ `UnknownCandidateError`. O registro entra em
 * quarentena para revisão manual; o adapter NUNCA cria candidato automaticamente.
 * Aqui só reconhecemos, nunca inventamos (CLAUDE.md: seed manual, nunca fuzzy).
 *
 * A resolução é síncrona por contrato do adapter — o HarvestJob pré-carrega o mapa
 * de aliases uma vez por ciclo (uma query) e injeta um resolver em memória, para
 * não bater no banco por candidato.
 */

import { UnknownCandidateError } from '../poll-source-adapter.js';

/** Mapeia um alias (grafia do documento) para o `candidate_id`, ou `null`. */
export type CandidateAliasResolver = (alias: string) => string | null;

/**
 * Constrói um resolver a partir de um mapa alias→id já carregado. O casamento é
 * EXATO por padrão (a grafia canônica dos aliases é definida no seed). Não há
 * normalização fuzzy: só um `trim` das pontas, porque espaço nas bordas é ruído
 * de layout, não ambiguidade de identidade.
 */
export const resolverFromMap = (aliases: ReadonlyMap<string, string>): CandidateAliasResolver => {
  return (alias: string): string | null => aliases.get(alias.trim()) ?? null;
};

/**
 * Resolve ou LANÇA `UnknownCandidateError`. É o ponto único onde um alias vira
 * id — todos os adapters passam por aqui, então a garantia de "nunca auto-cria"
 * vale para todos.
 */
export const resolveCandidateOrThrow = (
  resolver: CandidateAliasResolver,
  alias: string,
): string => {
  const id = resolver(alias);
  if (id === null) {
    throw new UnknownCandidateError(alias);
  }
  return id;
};
