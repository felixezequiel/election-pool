/**
 * Diagnósticos de anomalia (docs/01 §6). Três indicadores calculados e publicados:
 * engavetamento (§6.1), herding (§6.2) e divergência persistente (§6.3).
 *
 * REGRA CENTRAL (docs/01 §6, T-08): NENHUM destes indicadores altera o agregado.
 * São diagnóstico publicado, não correção aplicada. Estas funções são PURAS e
 * separadas da montagem de `latent`/`houseEffects` no orquestrador — não retornam,
 * nem consomem de volta, nada que realimente μ_t ou h_i. A separação é estrutural:
 * os tipos de saída daqui não aparecem em `ModelOutput.latent` nem em
 * `ModelOutput.houseEffects`.
 *
 * VOCABULÁRIO (docs/08 §5): nomes de campo e rótulos usam SÓ o léxico aprovado;
 * nenhum termo da lista proibida de docs/08 §5 aparece em campo, mensagem ou label.
 * `gaveta` = "registrada e não divulgada"; herding = "dispersão abaixo do
 * esperado"; divergência = "consistentemente acima/abaixo do consenso". Cada
 * indicador tem explicação inocente exibida junto na UI (docs/08 §4.5), fora daqui.
 *
 * Biblioteca PURA (CLAUDE.md): só importa de `@election-pool/contracts` e de módulos
 * irmãos puros. Sem rede, banco, `apps/`, RNG. Determinística: iteração sempre em
 * ordem ordenada, nunca em ordem de `Map` (docs/01 §9).
 *
 * R2 do CLAUDE.md vale com força máxima: nenhuma referência a candidato ou espectro;
 * nenhum limiar embutido — todos vêm de `@election-pool/contracts/constants`.
 */

import type { Observation } from '@election-pool/contracts/model-io';
import {
  HERDING_WINDOW_DAYS,
  HERDING_MIN_POLLS,
  HERDING_RATIO_THRESHOLD,
  DISCLOSURE_REGISTER_LEAD_DAYS,
  DISCLOSURE_GRACE_DAYS,
  DIVERGENCE_ABS_PP_THRESHOLD,
} from '@election-pool/contracts/constants';
import { observationVariance } from './kalman.js';
import { isoToDayNumber } from './calendar.js';

const ZERO = 0;
const ONE = 1;

// =============================================================================
// §6.1 — Taxa de engavetamento (gaveta)
// =============================================================================

/**
 * Uma linha de registro do PesqEle, na forma mínima que o diagnóstico de gaveta
 * precisa. NÃO é `PollRegistration` inteiro (docs/03 §2.3) — só os campos que a
 * taxa usa. Recebida do chamador (T-13), que a extrai do repositório; o modelo
 * continua puro (não lê banco).
 */
export interface RegistrationRecord {
  instituteId: string;
  contractorName: string;
  /** Data de registro no PesqEle (`YYYY-MM-DD` ou ISO com offset). */
  registeredAt: string;
  /** true se a pesquisa foi de fato divulgada (resultado ingerido). */
  disclosed: boolean;
}

/**
 * Corte da taxa de gaveta: por instituto OU por contratante (docs/01 §6.1). O corte
 * por contratante é o mais informativo (o mesmo instituto pode ter taxa diferente
 * conforme quem paga), mas ambos são publicados.
 */
export type GavetaSubjectKind = 'institute' | 'contractor';

/**
 * Resultado da taxa de gaveta para um sujeito (instituto ou contratante).
 *
 * `rate = 1 − disclosed/registered` (docs/01 §6.1). A saída SEMPRE carrega
 * numerador e denominador (`registered`/`disclosed`) separados: 1 registro e 0
 * divulgações dá `rate = 1.0` com `registered = 1` — a UI precisa distinguir isso
 * de `0.6` sobre 20 (T-08, aceite). Só entram registros cuja janela de divulgação
 * JÁ PASSOU (registro + DISCLOSURE_REGISTER_LEAD_DAYS + DISCLOSURE_GRACE_DAYS).
 */
export interface GavetaRate {
  subjectId: string;
  subjectKind: GavetaSubjectKind;
  /** 1 − disclosed/registered, em [0,1]. */
  rate: number;
  /** Denominador: registros elegíveis (janela de divulgação já passada). */
  registered: number;
  /** Numerador de divulgadas: registros elegíveis efetivamente divulgados. */
  disclosed: number;
}

/**
 * Dias após o registro em que a janela de divulgação se fecha (docs/01 §6.1):
 * registro + 5 dias (lead do PesqEle) + carência de 15 dias. Só depois disso um
 * registro conta para a taxa — antes, a não-divulgação é esperada, não anomalia.
 */
const DISCLOSURE_WINDOW_DAYS = DISCLOSURE_REGISTER_LEAD_DAYS + DISCLOSURE_GRACE_DAYS;

/**
 * Calcula a taxa de engavetamento por instituto e por contratante (docs/01 §6.1).
 *
 * @param registrations Registros do ciclo (do chamador — o modelo é puro).
 * @param referenceDate Data de referência do run; a janela de divulgação é medida
 *                      contra ela. Um registro só conta se
 *                      `referenceDate ≥ registeredAt + DISCLOSURE_WINDOW_DAYS`.
 * @returns Uma lista com todos os cortes (institutos primeiro, contratantes
 *          depois), ordenada de forma determinística.
 */
export function computeGavetaRates(
  registrations: readonly RegistrationRecord[],
  referenceDate: string,
): GavetaRate[] {
  const refDay = isoToDayNumber(referenceDate);

  // Acumula (registered, disclosed) por sujeito, para cada corte.
  const byInstitute = new Map<string, { registered: number; disclosed: number }>();
  const byContractor = new Map<string, { registered: number; disclosed: number }>();

  for (const reg of registrations) {
    // Janela de divulgação ainda não passou ⇒ não conta (docs/01 §6.1). A
    // não-divulgação aqui é legítima, não engavetamento.
    const eligibleFrom = isoToDayNumber(reg.registeredAt) + DISCLOSURE_WINDOW_DAYS;
    if (refDay < eligibleFrom) continue;

    accumulate(byInstitute, reg.instituteId, reg.disclosed);
    accumulate(byContractor, reg.contractorName, reg.disclosed);
  }

  const rates: GavetaRate[] = [];
  for (const [subjectId, tally] of sortedEntries(byInstitute)) {
    rates.push(toRate(subjectId, 'institute', tally));
  }
  for (const [subjectId, tally] of sortedEntries(byContractor)) {
    rates.push(toRate(subjectId, 'contractor', tally));
  }
  return rates;
}

function accumulate(
  map: Map<string, { registered: number; disclosed: number }>,
  key: string,
  disclosed: boolean,
): void {
  const tally = map.get(key) ?? { registered: ZERO, disclosed: ZERO };
  tally.registered += ONE;
  if (disclosed) tally.disclosed += ONE;
  map.set(key, tally);
}

function toRate(
  subjectId: string,
  subjectKind: GavetaSubjectKind,
  tally: { registered: number; disclosed: number },
): GavetaRate {
  // registered ≥ 1 aqui (só criamos a entrada ao acumular um registro elegível),
  // então a divisão nunca é 0/0.
  const rate = ONE - tally.disclosed / tally.registered;
  return {
    subjectId,
    subjectKind,
    rate,
    registered: tally.registered,
    disclosed: tally.disclosed,
  };
}

// =============================================================================
// §6.2 — Teste de herding
// =============================================================================

/**
 * Resultado do teste de herding para uma janela de 7 dias (docs/01 §6.2).
 *
 * `ratio = s²_observado / s²_esperado`, onde `s²_observado` é a variância amostral
 * dos valores entre institutos e `s²_esperado` é a média das variâncias amostrais
 * teóricas σ_i² (docs/01 §4.2). `ratio` abaixo de HERDING_RATIO_THRESHOLD é
 * sinalizado ("dispersão abaixo do esperado", docs/08 §5). A saída SEMPRE carrega
 * `nPolls` da janela: com 4 pesquisas o teste tem pouquíssima potência (docs/01
 * §6.2) e a UI precisa exibir o `n` junto.
 */
export interface HerdingResult {
  /** Fim da janela de 7 dias, `YYYY-MM-DD` (a data mais recente do grupo). */
  windowEnd: string;
  ratio: number;
  /** Número de pesquisas na janela (≥ HERDING_MIN_POLLS). */
  nPolls: number;
  /** true se ratio < HERDING_RATIO_THRESHOLD. */
  flagged: boolean;
}

/**
 * Chave de cenário para o herding: comparar dispersão só entre pesquisas do MESMO
 * cenário (docs/01 §6.2) — 1º turno estimulado ≠ espontâneo ≠ par de 2º turno.
 */
function scenarioKey(o: Observation): string {
  const pair = o.t2Pair ? `${o.t2Pair[0]}|${o.t2Pair[1]}` : '';
  return `${o.scenarioKind}|${pair}`;
}

/**
 * Testa herding em janelas móveis de 7 dias por (cenário, candidato) (docs/01 §6.2).
 *
 * Uma janela é ancorada no dia de campo de cada pesquisa e olha os
 * HERDING_WINDOW_DAYS anteriores. Só janelas com ≥ HERDING_MIN_POLLS pesquisas do
 * mesmo cenário produzem resultado — com menos, não há teste (docs/01 §6.2, aceite
 * T-08: janela com 3 pesquisas não produz resultado).
 *
 * @returns Um resultado por (cenário, candidato, janela) elegível, ordenado.
 */
export function computeHerding(observations: readonly Observation[]): HerdingResult[] {
  // Agrupa por (cenário, candidato): a dispersão entre institutos só faz sentido
  // dentro do mesmo cenário e do mesmo candidato (o mesmo "número" medido).
  const groups = new Map<string, Observation[]>();
  for (const o of observations) {
    const key = `${scenarioKey(o)}|${o.candidateId}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(o);
    groups.set(key, bucket);
  }

  const results: HerdingResult[] = [];
  for (const [, bucketRaw] of sortedEntries(groups)) {
    // Ordena por dia para as janelas serem determinísticas.
    const bucket = [...bucketRaw].sort((a, b) => compareStr(a.fieldMedianDate, b.fieldMedianDate));
    // Cada pesquisa é âncora de uma janela [dia − 6, dia]. Deduplica janelas com o
    // mesmo conjunto de pesquisas (âncoras consecutivas idênticas).
    const seen = new Set<string>();
    for (const anchor of bucket) {
      const endDay = isoToDayNumber(anchor.fieldMedianDate);
      const startDay = endDay - (HERDING_WINDOW_DAYS - ONE);
      const inWindow = bucket.filter((o) => {
        const d = isoToDayNumber(o.fieldMedianDate);
        return d >= startDay && d <= endDay;
      });
      if (inWindow.length < HERDING_MIN_POLLS) continue;

      // Identidade da janela = conjunto ordenado de (instituto, data, valor).
      const identity = inWindow
        .map((o) => `${o.instituteId}@${o.fieldMedianDate}=${o.valuePct}`)
        .sort()
        .join(';');
      if (seen.has(identity)) continue;
      seen.add(identity);

      results.push(herdingForWindow(anchor.fieldMedianDate, inWindow));
    }
  }

  // Ordem determinística de saída: por (windowEnd, nPolls, ratio).
  results.sort(
    (a, b) =>
      compareStr(a.windowEnd, b.windowEnd) || a.nPolls - b.nPolls || compareNum(a.ratio, b.ratio),
  );
  return results;
}

/**
 * Calcula o ratio de herding de uma janela (docs/01 §6.2):
 *   s²_observado = variância amostral dos valores entre institutos
 *   s²_esperado  = média dos σ_i² (docs/01 §4.2)
 *   ratio        = s²_observado / s²_esperado
 *
 * σ_i² usa a média dos valores da janela como `p` (a estimativa corrente do apoio
 * naquela janela): é o proxy transparente de μ_t quando o diagnóstico é calculado
 * sem re-rodar o modelo, e mantém a variância teórica na mesma convenção do Kalman
 * (docs/01 §4.2, `observationVariance`).
 */
function herdingForWindow(windowEnd: string, inWindow: readonly Observation[]): HerdingResult {
  const n = inWindow.length;
  const values = inWindow.map((o) => o.valuePct);
  const mean = values.reduce((s, v) => s + v, ZERO) / n;

  // Variância amostral (denominador n−1) da dispersão observada entre institutos.
  const sampleVar = values.reduce((s, v) => s + (v - mean) * (v - mean), ZERO) / (n - ONE);

  // s²_esperado = média das variâncias teóricas σ_i², com p = média da janela.
  const expectedVar =
    inWindow.reduce((s, o) => s + observationVariance(mean, o.sampleSize), ZERO) / n;

  const ratio = expectedVar > ZERO ? sampleVar / expectedVar : ZERO;
  return {
    windowEnd,
    ratio,
    nPolls: n,
    flagged: ratio < HERDING_RATIO_THRESHOLD,
  };
}

// =============================================================================
// §6.3 — Divergência persistente
// =============================================================================

/**
 * House effect de um instituto, na forma mínima que a divergência precisa. Espelha
 * `InstituteHouseEffect`/`HouseEffect` (docs/01 §5) sem acoplar a este módulo o
 * cálculo de h_i — recebido do chamador (o orquestrador em `index.ts`).
 */
export interface HouseEffectInput {
  instituteId: string;
  /** h_i em p.p. */
  effectPp: number;
  /** Limites do IC 90% de h_i (p.p.). */
  lo90Pp: number;
  hi90Pp: number;
  /** false ⇒ h_i = 0 fixo (n < MIN_POLLS_FOR_HOUSE_EFFECT). NUNCA divergente. */
  estimable: boolean;
}

/**
 * Resultado da divergência persistente para um instituto (docs/01 §6.3). Rótulo
 * neutro na UI: "consistentemente acima/abaixo do consenso" (docs/08 §5). O sinal
 * de `effectPp` diz a direção; este módulo não a nomeia como boa ou ruim.
 */
export interface DivergenceResult {
  instituteId: string;
  effectPp: number;
  lo90Pp: number;
  hi90Pp: number;
  /**
   * true sse |h_i| > DIVERGENCE_ABS_PP_THRESHOLD E o IC 90% não cruza zero E o
   * instituto é estimável (docs/01 §6.3). Estimável=false NUNCA é marcado.
   */
  divergent: boolean;
}

/**
 * Marca institutos com divergência persistente (docs/01 §6.3): `|h_i| > 3` p.p.
 * E IC 90% que não cruza zero. Um instituto `estimable: false` NUNCA é divergente
 * (h_i é fixo em 0 e não há evidência; docs/01 §5, §6.3, aceite T-08).
 *
 * @returns Um resultado por instituto (todos, com o flag), ordenado por instituteId.
 */
export function computeDivergence(houseEffects: readonly HouseEffectInput[]): DivergenceResult[] {
  const results: DivergenceResult[] = [];
  for (const he of houseEffects) {
    const magnitudeExceeds = Math.abs(he.effectPp) > DIVERGENCE_ABS_PP_THRESHOLD;
    // IC 90% "não cruza zero": ambos os limites do mesmo lado de zero.
    const ciExcludesZero = he.lo90Pp > ZERO || he.hi90Pp < ZERO;
    const divergent = he.estimable && magnitudeExceeds && ciExcludesZero;
    results.push({
      instituteId: he.instituteId,
      effectPp: he.effectPp,
      lo90Pp: he.lo90Pp,
      hi90Pp: he.hi90Pp,
      divergent,
    });
  }
  results.sort((a, b) => compareStr(a.instituteId, b.instituteId));
  return results;
}

// =============================================================================
// Agregado dos diagnósticos
// =============================================================================

/**
 * Todos os diagnósticos de um run (docs/01 §6), na forma rica que a UI consome
 * (docs/03 §5 `PublicData.diagnostics` para gaveta/herding; divergência derivada
 * dos house effects). NENHUM campo aqui realimenta o agregado — separação
 * estrutural (T-08).
 */
export interface DiagnosticsBundle {
  gaveta: GavetaRate[];
  herding: HerdingResult[];
  divergence: DivergenceResult[];
}

/**
 * Monta o pacote completo de diagnósticos (docs/01 §6). Puro: dado observações,
 * registros e house effects, devolve os três indicadores. Não toca latent/houseEffects
 * de saída — é publicado como diagnóstico, não aplicado como correção.
 */
export function computeDiagnostics(input: {
  observations: readonly Observation[];
  registrations: readonly RegistrationRecord[];
  houseEffects: readonly HouseEffectInput[];
  referenceDate: string;
}): DiagnosticsBundle {
  return {
    gaveta: computeGavetaRates(input.registrations, input.referenceDate),
    herding: computeHerding(input.observations),
    divergence: computeDivergence(input.houseEffects),
  };
}

// =============================================================================
// utilidades de ordenação determinística
// =============================================================================

function sortedEntries<V>(map: ReadonlyMap<string, V>): [string, V][] {
  return [...map.entries()].sort((a, b) => compareStr(a[0], b[0]));
}

function compareStr(a: string, b: string): number {
  if (a < b) return -ONE;
  if (a > b) return ONE;
  return ZERO;
}

function compareNum(a: number, b: number): number {
  if (a < b) return -ONE;
  if (a > b) return ONE;
  return ZERO;
}
