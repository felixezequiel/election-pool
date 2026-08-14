/**
 * Elegibilidade e backoff do HarvestJob (docs/02 §3.2). Lógica PURA e determinística
 * — sem I/O, sem relógio próprio — para ser testada de forma exaustiva. A decisão
 * depende só de: quando o campo terminou, quando foi a última tentativa, se já há
 * resultado, e o instante corrente.
 *
 * Janela de tentativas (docs/02 §3.2):
 * - Campo ainda não terminou ⇒ não é elegível (não adianta buscar resultado).
 * - Primeiras 72h após o fim do campo: tenta a CADA ciclo.
 * - 72h–15 dias: tenta 2×/dia (respeitando um intervalo mínimo entre tentativas).
 * - Após 15 dias sem resultado: NÃO tenta mais — transiciona para
 *   `presumed_undisclosed` e para. Esse estado é DADO (taxa de engavetamento,
 *   docs/01 §6.1), não falha de pipeline.
 * - Já tem resultado (`disclosed`) ⇒ não é elegível (nada a fazer).
 */

import {
  HARVEST_FRESH_WINDOW_HOURS,
  HARVEST_PRESUMED_UNDISCLOSED_DAYS,
  HARVEST_SLOW_MIN_INTERVAL_HOURS,
} from './harvest-constants.js';

const MS_PER_HOUR = 60 * 60 * 1000;
const HOURS_PER_DAY = 24;

export type HarvestDecision =
  | { action: 'attempt'; reason: 'fresh_window' | 'slow_window' }
  | { action: 'skip'; reason: 'field_open' | 'already_disclosed' | 'slow_window_cooldown' }
  | { action: 'presume_undisclosed'; reason: 'past_deadline' };

export interface EligibilityInput {
  /** Fim do campo (ISO-8601). Base do relógio de backoff. */
  fieldEndIso: string;
  /** Já existe resultado divulgado para este registro? */
  hasResult: boolean;
  /** Última tentativa de colheita (ISO-8601), ou null se nunca tentou. */
  lastAttemptIso: string | null;
  /** Instante corrente (ISO-8601). */
  nowIso: string;
}

const hoursBetween = (fromIso: string, toIso: string): number =>
  (Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_HOUR;

/**
 * Decide o que fazer com um registro neste ciclo. Nunca lança por dado ausente —
 * datas mal-formadas viram `NaN` nas contas e caem no caminho conservador (skip),
 * mas o job valida as datas via Zod antes de chegar aqui.
 */
export const decideHarvest = (input: EligibilityInput): HarvestDecision => {
  if (input.hasResult) {
    return { action: 'skip', reason: 'already_disclosed' };
  }

  const hoursSinceField = hoursBetween(input.fieldEndIso, input.nowIso);

  if (hoursSinceField < 0) {
    // Campo ainda em andamento: não há resultado a buscar.
    return { action: 'skip', reason: 'field_open' };
  }

  const deadlineHours = HARVEST_PRESUMED_UNDISCLOSED_DAYS * HOURS_PER_DAY;
  if (hoursSinceField >= deadlineHours) {
    // 15 dias sem resultado: engavetado. Transiciona e para.
    return { action: 'presume_undisclosed', reason: 'past_deadline' };
  }

  if (hoursSinceField < HARVEST_FRESH_WINDOW_HOURS) {
    // Primeiras 72h: tenta a cada ciclo, sem cooldown.
    return { action: 'attempt', reason: 'fresh_window' };
  }

  // 72h–15d: 2×/dia. Sem última tentativa registrada ⇒ tenta agora. Com última
  // tentativa, respeita o intervalo mínimo (12h) para não exceder 2×/dia.
  if (input.lastAttemptIso === null) {
    return { action: 'attempt', reason: 'slow_window' };
  }
  const hoursSinceLast = hoursBetween(input.lastAttemptIso, input.nowIso);
  if (hoursSinceLast >= HARVEST_SLOW_MIN_INTERVAL_HOURS) {
    return { action: 'attempt', reason: 'slow_window' };
  }
  return { action: 'skip', reason: 'slow_window_cooldown' };
};
