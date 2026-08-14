/**
 * Contexto que as regras V4/V5 exigem (docs/04 §5). Elas comparam o cenário
 * corrente contra dados EXTERNOS ao documento — a rodada anterior do mesmo
 * instituto (V4) e a série latente `μ_t` corrente (V5) — então esses dados
 * entram como INPUT do chamador (o HarvestJob os carrega do banco/modelo).
 * A validação não faz I/O: recebe tudo pronto e só decide.
 *
 * As chaves são `candidateAlias` (a mesma unidade do `ParsedPoll`, antes de
 * resolver para `candidate_id`), na escala 0–100 (CLAUDE.md). Alias ausente do
 * mapa ⇒ a regra correspondente não tem baseline para aquele candidato e o
 * pula (não há comparação a fazer; não é falha).
 */

/** Percentual do candidato na rodada anterior do MESMO instituto, por alias. */
export type PreviousRoundByAlias = ReadonlyMap<string, number>;

/** `μ_t` corrente (média da série latente) por alias de candidato. */
export type CurrentLatentByAlias = ReadonlyMap<string, number>;

export interface ValidationContext {
  /** V4: rodada anterior do mesmo instituto. `undefined` ⇒ não há anterior (pula V4). */
  readonly previousRound?: PreviousRoundByAlias;
  /** V5: `μ_t` corrente. `undefined` ⇒ modelo ainda sem estimativa (pula V5). */
  readonly currentLatent?: CurrentLatentByAlias;
  /**
   * V4/V5 já aprovados manualmente para este `tse_id` (docs/04 §5): a resolução de
   * um movimento real legítimo é humana, via `ingest:approve`. Quando `true`, V4 e
   * V5 são pulados (mas V1–V3, V6, V7 continuam bloqueando — aprovar não é relaxar
   * o resto).
   */
  readonly manuallyApproved?: boolean;
}
