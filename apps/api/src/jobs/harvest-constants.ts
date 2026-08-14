/**
 * Constantes operacionais do HarvestJob (docs/02 §3.2). Cada número cita a seção
 * de origem (CLAUDE.md: nada de valor mágico sem justificativa).
 *
 * DESVIO REGISTRADO de CLAUDE.md ("constantes vão para `packages/contracts/constants.ts`"):
 * estas são parâmetros OPERACIONAIS de agendamento do harvest, não constantes de
 * modelo/contrato de dados, e `contracts` é dono de outro agente (mudar lá
 * invalidaria o trabalho dele). Ficam aqui, junto do job. O orquestrador (T-14)
 * pode consolidá-las em `contracts/constants.ts` se preferir centralizar.
 */

// docs/02 §3.2 — "Primeiras 72h após o fim do campo: tenta a cada ciclo".
export const HARVEST_FRESH_WINDOW_HOURS = 72;

// docs/02 §3.2 — "Após 15 dias sem resultado: marca presumed_undisclosed e para".
export const HARVEST_PRESUMED_UNDISCLOSED_DAYS = 15;

// docs/02 §3.2 — "72h–15 dias: tenta 2×/dia". 2×/dia ⇒ intervalo mínimo de 12h
// entre tentativas (24h / 2). Combinado ao cron de 2h (docs/02 §3.2), isto limita
// as tentativas a no máximo duas por dia nesta janela.
export const HARVEST_SLOW_MIN_INTERVAL_HOURS = 12;
