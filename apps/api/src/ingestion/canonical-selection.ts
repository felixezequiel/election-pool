/**
 * Seleção do cenário canônico (docs/01 §3). Passo determinístico ENTRE o harvest
 * (que grava todo cenário com `is_canonical=false`) e o modelo (que só consome
 * `is_canonical=true`). Sem este passo o gate de cobertura M-1 reprova e nada
 * publica — por isso ele roda no início do ModelJob (docs/02 §3.3).
 *
 * Este módulo é PURO: recebe os cenários de uma pesquisa já lidos do banco e
 * devolve, por grupo, qual `id` é canônico e por quê. Não faz I/O — o
 * `CanonicalSelector` (canonical-selector.ts) o alimenta a partir do banco e
 * persiste a marcação. Manter a regra pura a torna testável isoladamente e
 * garante que ela é EXATAMENTE a de docs/01 §3, sem improviso.
 *
 * A regra (docs/01 §3), aplicada por (tse_id, kind, t2_pair):
 *
 *  1º turno (kind t1_*):
 *   1. o cenário com o MAIOR número de candidatos com registro de candidatura
 *      confirmado no TSE (após convenções) ou pré-candidatura pública (antes).
 *      Na v1 todo candidato de `poll_results` já foi resolvido a um `candidate_id`
 *      do cadastro (o harvest recusa alias desconhecido, CLAUDE.md), então o
 *      número de candidatos RESOLVIDOS do cenário é a contagem de confirmados.
 *   2. empate na regra 1 ⇒ o de MAIOR número total de nomes (idem: mesma
 *      contagem, pois todo nome exibido é um candidato resolvido — as duas regras
 *      colapsam no dado que temos; mantidas separadas na estrutura para fidelidade
 *      ao doc e para evoluir se um dia registrarmos "nome não-candidato").
 *   3. empate na regra 2 ⇒ o PRIMEIRO na ordem de publicação do instituto
 *      (aproximada por `extractedAt` e, em empate, `label` — determinístico).
 *
 *  2º turno (kind t2): cenários são pareados por (candidato_a, candidato_b)
 *   normalizado alfabeticamente (o `t2Pair` já vem ordenado do harvest). Cada par
 *   é uma SÉRIE independente (docs/01 §3), então há um canônico POR PAR — a mesma
 *   regra 1→2→3 decide dentro do par (na prática um par costuma ter só um cenário).
 *
 * O motivo aplicado fica em `poll_scenarios.canonical_reason` (docs/01 §3).
 */

const ZERO = 0;

/** Um cenário candidato à seleção, na forma mínima que a regra precisa. */
export interface ScenarioForSelection {
  id: string;
  kind: string;
  /** Par ordenado do 2º turno; `null` no 1º turno. */
  t2Pair: readonly [string, string] | null;
  label: string;
  /** Instante de extração — proxy da ordem de publicação (docs/01 §3, regra 3). */
  extractedAt: string;
  /** `candidate_id`s resolvidos deste cenário (todos confirmados na v1). */
  candidateIds: readonly string[];
}

/** Resultado da seleção: qual cenário é canônico e o motivo registrado. */
export interface CanonicalDecision {
  scenarioId: string;
  canonicalReason: string;
}

/** Chave do grupo (tse_id implícito no conjunto) = kind + par normalizado. */
const groupKey = (s: ScenarioForSelection): string =>
  s.t2Pair === null ? s.kind : `${s.kind}:${s.t2Pair[0]}|${s.t2Pair[1]}`;

/**
 * Contagem de candidatos com registro/pré-candidatura confirmados (regra 1).
 * Na v1 = candidatos distintos resolvidos do cenário.
 */
const confirmedCount = (s: ScenarioForSelection): number => new Set(s.candidateIds).size;

/** Número total de nomes (regra 2). Na v1 coincide com a regra 1 (ver cabeçalho). */
const totalNames = (s: ScenarioForSelection): number => s.candidateIds.length;

/**
 * Ordena os cenários de um grupo pela regra 1→2→3 e devolve o vencedor + o
 * motivo textual do desempate. Comparação total e estável (determinismo).
 */
const pickWithin = (group: readonly ScenarioForSelection[]): CanonicalDecision => {
  const sorted = [...group].sort((a, b) => {
    const byConfirmed = confirmedCount(b) - confirmedCount(a); // desc
    if (byConfirmed !== ZERO) return byConfirmed;
    const byTotal = totalNames(b) - totalNames(a); // desc
    if (byTotal !== ZERO) return byTotal;
    // Regra 3: ordem de publicação do instituto (extração asc, depois label asc).
    if (a.extractedAt < b.extractedAt) return -1;
    if (a.extractedAt > b.extractedAt) return 1;
    if (a.label < b.label) return -1;
    if (a.label > b.label) return 1;
    return ZERO;
  });
  const winner = sorted[0];
  if (winner === undefined) {
    // Grupo nunca é vazio aqui (só chamamos com ≥1); defensivo para o type-checker.
    throw new Error('grupo de cenários vazio na seleção canônica');
  }
  const runnerUp = sorted[1];
  const reason = reasonFor(winner, runnerUp);
  return { scenarioId: winner.id, canonicalReason: reason };
};

/** Texto do motivo (docs/01 §3): explicita qual regra decidiu. */
const reasonFor = (
  winner: ScenarioForSelection,
  runnerUp: ScenarioForSelection | undefined,
): string => {
  const c = confirmedCount(winner);
  if (runnerUp === undefined) {
    return `único cenário do grupo (${String(c)} candidatos)`;
  }
  if (confirmedCount(winner) > confirmedCount(runnerUp)) {
    return `regra 1 (docs/01 §3): mais candidatos confirmados (${String(c)})`;
  }
  if (totalNames(winner) > totalNames(runnerUp)) {
    return `regra 2 (docs/01 §3): mais nomes no total (${String(totalNames(winner))})`;
  }
  return 'regra 3 (docs/01 §3): primeiro na ordem de publicação do instituto';
};

/**
 * Seleciona o cenário canônico de CADA grupo (kind × par) de uma pesquisa
 * (docs/01 §3). Recebe todos os cenários de um `tse_id` e devolve uma decisão por
 * grupo. Cenários não-canônicos ficam de fora (o chamador desmarca os demais).
 */
export const selectCanonicalScenarios = (
  scenarios: readonly ScenarioForSelection[],
): CanonicalDecision[] => {
  const groups = new Map<string, ScenarioForSelection[]>();
  for (const s of scenarios) {
    const key = groupKey(s);
    const bucket = groups.get(key) ?? [];
    bucket.push(s);
    groups.set(key, bucket);
  }
  const decisions: CanonicalDecision[] = [];
  // Ordena as chaves para saída determinística (não afeta correção, ajuda o teste).
  for (const key of [...groups.keys()].sort()) {
    const group = groups.get(key) ?? [];
    decisions.push(pickWithin(group));
  }
  return decisions;
};
