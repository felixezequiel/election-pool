/**
 * Estimação de house effects `h_i` (docs/01 §1, §5).
 *
 * Modelo (docs/01 §1):  y_it = μ_t + h_i + ε_it,  ε_it ~ N(0, σ_it²)
 *
 *   - `h_i` é UM escalar por instituto, constante dentro do ciclo. A v1 NÃO
 *     modela `h_ij` (instituto × candidato): docs/01 §1.2 ponto 2 explica que a
 *     amostra de eleições é pequena demais para identificá-lo. O resíduo de
 *     TODOS os candidatos daquele instituto alimenta o mesmo `h_i`.
 *   - `μ_t` é a série latente por candidato, vinda do suavizador (T-03).
 *   - `σ_it²` é a variância da observação (docs/01 §4.2), com o peso de recência
 *     entrando na precisão (§4.4) — a MESMA definição usada pelo Kalman.
 *
 * Identificação (docs/01 §1.1). O sistema é subidentificado: somar `c` a todo
 * `μ_t` e subtrair `c` de todo `h_i` não muda nenhum `y_it`. Impomos
 *
 *     Σ_i (w_i · h_i) = 0,   w_i = nº de pesquisas do instituto i na janela,
 *
 * como restrição EXPLÍCITA e testável (`applyWeightedSumZero`), não efeito
 * colateral.
 *
 * Estimação conjunta por máxima verossimilhança sobre o CICLO INTEIRO (não só a
 * janela ativa de 45 dias — house effect precisa de histórico longo, docs/01
 * §5). Dado `μ_t`, cada `h_i` é a média dos resíduos `r_it = y_it − μ_t`
 * ponderada pela precisão, regularizada pelo prior `h_i ~ N(0, HOUSE_EFFECT_
 * PRIOR_SD²)` (ridge fraco em direção a zero). Como `μ_t` também depende de
 * `h_i`, iteramos: (μ dado h) ← Kalman sobre observações corrigidas por h;
 * (h dado μ) ← média regularizada dos resíduos + projeção da restrição. Isso é
 * coordinate-ascent na verossimilhança conjunta penalizada; converge em poucas
 * iterações porque cada bloco é um problema quadrático (docs/OPEN-QUESTIONS Q-01
 * registra que a incerteza de `h` fica subestimada nessa aproximação acoplada).
 *
 * Instituto com menos de MIN_POLLS_FOR_HOUSE_EFFECT pesquisas no ciclo recebe
 * `h_i = 0` fixo e `estimable = false` (docs/01 §5): não entra na restrição nem
 * corrige `μ`. A UI mostra "—", não um zero.
 *
 * Biblioteca PURA (CLAUDE.md): só importa de `@election-pool/contracts` e de
 * módulos irmãos puros. Sem rede, banco, `apps/`, RNG. Determinística: dado o
 * mesmo input, a saída é bit a bit idêntica (docs/01 §9) — toda iteração sobre
 * institutos/candidatos é feita em ordem ordenada, nunca em ordem de `Map`.
 *
 * R1/R2 do CLAUDE.md valem com força máxima: nenhuma correção por candidato ou
 * espectro; `h_i` sai dos dados, sempre. Se um `h_i` sair grande, é resultado.
 */

import type { Observation } from '@election-pool/contracts/model-io';
import {
  HOUSE_EFFECT_PRIOR_SD,
  MIN_POLLS_FOR_HOUSE_EFFECT,
  CI_Z_90,
  PCT_MIN,
  PCT_MAX,
} from '@election-pool/contracts/constants';
import { observationVariance, recencyWeight, type KalmanResult } from './kalman.js';
import { isoToDayNumber } from './calendar.js';

const ZERO = 0;
const ONE = 1;

/** House effect estimado de um instituto (escalar, compartilhado entre candidatos). */
export interface InstituteHouseEffect {
  instituteId: string;
  /** h_i em p.p. Zero se não estimável. */
  effectPp: number;
  /** Semilargura do IC 90% (p.p.). Zero se não estimável. */
  ciHalfWidthPp: number;
  lo90Pp: number;
  hi90Pp: number;
  /** w_i = nº de pesquisas do instituto na janela (peso da restrição). */
  nPolls: number;
  /** false se nPolls < MIN_POLLS_FOR_HOUSE_EFFECT ⇒ h_i = 0 fixo. */
  estimable: boolean;
  /** Candidatos medidos por este instituto, ordenados (para expandir a saída). */
  candidateIds: string[];
}

export interface HouseEffectResult {
  /** Um por instituto, ordenado por instituteId. */
  institutes: InstituteHouseEffect[];
  /** Iterações de coordinate-ascent efetivamente rodadas (diagnóstico/determinismo). */
  iterations: number;
}

export interface HouseEffectOptions {
  /**
   * Máximo de iterações do coordinate-ascent (μ↔h). Converge muito antes disso;
   * o teto existe só para garantir terminação. Prior de implementação, não de
   * modelo — não afeta o ponto fixo, só quantas iterações até alcançá-lo.
   */
  maxIterations?: number;
  /**
   * Tolerância de convergência: para quando o maior |Δh_i| entre iterações fica
   * abaixo disto (p.p.).
   */
  tolerancePp?: number;
  /** Função que roda o Kalman (injetada para o orquestrador reusar a mesma). */
  runLatent: (observations: readonly Observation[]) => KalmanResult;
}

// Tetos de iteração / tolerância: constantes de implementação do laço de ponto
// fixo, não parâmetros do modelo estatístico. Não entram em `μ_t` nem em `h_i`;
// só decidem quando o laço para. Ainda assim ficam nomeadas (o gate de viés
// proíbe literal solto em QUALQUER arquivo do modelo, docs/07 §5.1).
const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_TOLERANCE_PP = 1e-9;

/**
 * Projeta um vetor de efeitos na restrição `Σ_i w_i·h_i = 0` (docs/01 §1.1).
 *
 * A projeção ortogonal (na métrica ponderada por w) subtrai de cada `h_i` a
 * média ponderada `h̄_w = (Σ w_i h_i)/(Σ w_i)`, garantindo `Σ w_i (h_i − h̄_w)=0`
 * exatamente. Institutos não estimáveis (fora da restrição) mantêm `h_i = 0` e
 * NÃO participam de nenhuma soma. Determinística e testável isoladamente.
 *
 * Retorna um novo array (não muta a entrada). `effects` e `weights` devem ter o
 * mesmo comprimento; `mask[i] === false` exclui o instituto da restrição.
 */
export function applyWeightedSumZero(
  effects: readonly number[],
  weights: readonly number[],
  mask: readonly boolean[],
): number[] {
  let weightedSum = ZERO;
  let totalWeight = ZERO;
  for (let i = ZERO; i < effects.length; i++) {
    if (mask[i] === false) continue;
    const w = weights[i] ?? ZERO;
    const h = effects[i] ?? ZERO;
    weightedSum += w * h;
    totalWeight += w;
  }
  const mean = totalWeight > ZERO ? weightedSum / totalWeight : ZERO;
  const out: number[] = [];
  for (let i = ZERO; i < effects.length; i++) {
    if (mask[i] === false) {
      out.push(ZERO);
      continue;
    }
    out.push((effects[i] ?? ZERO) - mean);
  }
  return out;
}

/** Resíduo agrupado por instituto: precisão e resíduo ponderado acumulados. */
interface InstituteAccumulator {
  instituteId: string;
  candidateIds: Set<string>;
  nPolls: number;
  /** Σ (precisão · resíduo) — numerador da média ponderada. */
  weightedResidualSum: number;
  /** Σ precisão — denominador (verossimilhança) da média ponderada. */
  precisionSum: number;
}

/**
 * Estima `h_i` conjuntamente com `μ_t` (docs/01 §1, §5).
 *
 * @param observations  Todas as observações do ciclo (janela completa, não só 45d).
 * @param initialLatent Série latente inicial (Kalman sobre observações cruas).
 * @param options       Injeta a função de Kalman e os tetos do laço.
 */
export function estimateHouseEffects(
  observationsInput: readonly Observation[],
  initialLatent: KalmanResult,
  options: HouseEffectOptions,
): HouseEffectResult {
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const tolerancePp = options.tolerancePp ?? DEFAULT_TOLERANCE_PP;

  // Ordenação canônica ANTES de qualquer soma: a acumulação de resíduos em ponto
  // flutuante depende da ordem, então fixamos a ordem (date, instituteId,
  // candidateId) para que a saída seja bit a bit idêntica qualquer que seja a
  // ordem de entrada (docs/01 §9). NUNCA confiar em ordem de Map/array de entrada.
  const observations = [...observationsInput].sort(compareObservations);

  // Institutos ordenados: determinismo e ordem estável na restrição.
  const instituteIds = [...new Set(observations.map((o) => o.instituteId))].sort();
  const indexOf = new Map<string, number>();
  instituteIds.forEach((id, i) => indexOf.set(id, i));

  // Contagem de pesquisas por instituto = w_i (docs/01 §1.1). Uma "pesquisa" é um
  // (instituto, candidato, data) distinto; contamos observações por instituto.
  const nPolls = new Array<number>(instituteIds.length).fill(ZERO);
  for (const o of observations) {
    const idx = indexOf.get(o.instituteId);
    if (idx !== undefined) nPolls[idx] = (nPolls[idx] ?? ZERO) + ONE;
  }

  // Máscara de estimabilidade (docs/01 §5): < MIN_POLLS ⇒ h fixo em 0.
  const estimable = instituteIds.map((_, i) => (nPolls[i] ?? ZERO) >= MIN_POLLS_FOR_HOUSE_EFFECT);

  // Estado corrente dos house effects (começa em zero) e latente corrente.
  let effects = new Array<number>(instituteIds.length).fill(ZERO);
  let latent = initialLatent;

  // Prior: h_i ~ N(0, τ²), τ = HOUSE_EFFECT_PRIOR_SD. Entra como pseudo-precisão
  // 1/τ² somada ao denominador (ridge que puxa a zero, docs/01 §5).
  const priorPrecision = ONE / (HOUSE_EFFECT_PRIOR_SD * HOUSE_EFFECT_PRIOR_SD);

  let iterations = ZERO;
  let precisionSums = new Array<number>(instituteIds.length).fill(ZERO);

  for (let iter = ZERO; iter < maxIterations; iter++) {
    iterations = iter + ONE;

    // --- Passo H: h dado μ ---------------------------------------------------
    // Para cada observação, resíduo r = y − μ_{candidato, data}. Acumula por
    // instituto ponderando pela precisão da observação (recência incluída).
    const accumulators = instituteIds.map<InstituteAccumulator>((id) => ({
      instituteId: id,
      candidateIds: new Set<string>(),
      nPolls: ZERO,
      weightedResidualSum: ZERO,
      precisionSum: ZERO,
    }));

    const latentLookup = buildLatentLookup(latent);
    for (const o of observations) {
      const idx = indexOf.get(o.instituteId);
      if (idx === undefined) continue;
      const acc = accumulators[idx];
      if (!acc) continue;
      acc.candidateIds.add(o.candidateId);
      acc.nPolls += ONE;

      const mu = latentLookup(o.candidateId, o.fieldMedianDate);
      if (mu === undefined) continue; // sem μ nesse dia/candidato ⇒ não informa h
      const residual = o.valuePct - mu;
      // Variância da observação usa o μ CORRENTE como p (docs/01 §4.2), não o
      // valor observado — mesma convenção do Kalman.
      const variance = observationVariance(mu, o.sampleSize);
      const w = recencyWeight(daysBetween(o.fieldMedianDate, latent.referenceDate));
      const precision = w / variance; // recência entra na precisão (§4.4)
      acc.weightedResidualSum += precision * residual;
      acc.precisionSum += precision;
    }

    // h_i não regularizado = média ponderada dos resíduos; com prior:
    //   h_i = (Σ precisão·resíduo) / (Σ precisão + 1/τ²)
    const rawEffects = accumulators.map((acc, i) => {
      if (estimable[i] !== true) return ZERO;
      const denom = acc.precisionSum + priorPrecision;
      return denom > ZERO ? acc.weightedResidualSum / denom : ZERO;
    });
    precisionSums = accumulators.map((acc) => acc.precisionSum);

    // Projeção da restrição Σ w_i·h_i = 0 (docs/01 §1.1), só sobre estimáveis.
    const projected = applyWeightedSumZero(rawEffects, nPolls, estimable);

    // Convergência: maior |Δh_i|.
    let maxDelta = ZERO;
    for (let i = ZERO; i < projected.length; i++) {
      const delta = Math.abs((projected[i] ?? ZERO) - (effects[i] ?? ZERO));
      if (delta > maxDelta) maxDelta = delta;
    }
    effects = projected;

    // --- Passo μ: μ dado h ---------------------------------------------------
    // Corrige cada observação subtraindo h_i e re-roda o suavizador. Assim o μ
    // da próxima iteração já está "limpo" do house effect corrente.
    if (maxDelta <= tolerancePp) break;
    const corrected = correctObservations(observations, effects, indexOf);
    latent = options.runLatent(corrected);
  }

  // --- Monta a saída por instituto -----------------------------------------
  const institutes = instituteIds.map<InstituteHouseEffect>((id, i) => {
    const acc = precisionSums[i] ?? ZERO;
    const isEstimable = estimable[i] === true;
    // Variância posterior de h_i ≈ 1/(Σ precisão + 1/τ²) (aprox. gaussiana,
    // docs/OPEN-QUESTIONS Q-01: subestima porque ignora incerteza de μ).
    const posteriorVar = isEstimable ? ONE / (acc + priorPrecision) : ZERO;
    const half = isEstimable ? CI_Z_90 * Math.sqrt(posteriorVar) : ZERO;
    const effect = isEstimable ? (effects[i] ?? ZERO) : ZERO;
    const cands = collectCandidates(id, observations);
    return {
      instituteId: id,
      effectPp: effect,
      ciHalfWidthPp: half,
      lo90Pp: effect - half,
      hi90Pp: effect + half,
      nPolls: nPolls[i] ?? ZERO,
      estimable: isEstimable,
      candidateIds: cands,
    };
  });

  return { institutes, iterations };
}

/** Candidatos medidos por um instituto, ordenados (para expandir a saída). */
function collectCandidates(instituteId: string, observations: readonly Observation[]): string[] {
  const set = new Set<string>();
  for (const o of observations) {
    if (o.instituteId === instituteId) set.add(o.candidateId);
  }
  return [...set].sort();
}

/** Subtrai h_i de cada valor observado do instituto i (correção para o passo μ). */
function correctObservations(
  observations: readonly Observation[],
  effects: readonly number[],
  indexOf: ReadonlyMap<string, number>,
): Observation[] {
  return observations.map((o) => {
    const idx = indexOf.get(o.instituteId);
    const h = idx === undefined ? ZERO : (effects[idx] ?? ZERO);
    if (h === ZERO) return o;
    // Reconstrói a observação com valor corrigido; mantém o branded Pct grampeando
    // a [0,100] via aritmética (o schema já validou a entrada, não re-parseamos
    // para não reintroduzir dependência de Zod aqui — valor corrigido é interno).
    const corrected = o.valuePct - h;
    return { ...o, valuePct: clampPct(corrected) as Observation['valuePct'] };
  });
}

function clampPct(x: number): number {
  if (!Number.isFinite(x)) return PCT_MIN;
  if (x < PCT_MIN) return PCT_MIN;
  if (x > PCT_MAX) return PCT_MAX;
  return x;
}

/** Constrói um lookup μ_{candidato, data} a partir do resultado do Kalman. */
function buildLatentLookup(
  latent: KalmanResult,
): (candidateId: string, date: string) => number | undefined {
  const map = new Map<string, number>();
  for (const p of latent.points) {
    map.set(keyOf(p.candidateId, p.date), p.mean);
  }
  return (candidateId, date) => map.get(keyOf(candidateId, date));
}

function keyOf(candidateId: string, date: string): string {
  return `${candidateId} ${date}`;
}

/**
 * Ordem canônica de observação (docs/01 §9). Precisa ser um total order ESTRITO:
 * uma mesma (data, instituto, candidato) pode ocorrer em cenários distintos
 * (t1 e t2 no mesmo dia), então desempatamos também por scenarioKind e t2Pair —
 * senão a ordem entre "iguais" dependeria da ordem de entrada e quebraria o
 * determinismo bit a bit da acumulação de resíduos.
 */
function compareObservations(a: Observation, b: Observation): number {
  if (a.fieldMedianDate < b.fieldMedianDate) return -ONE;
  if (a.fieldMedianDate > b.fieldMedianDate) return ONE;
  if (a.instituteId < b.instituteId) return -ONE;
  if (a.instituteId > b.instituteId) return ONE;
  if (a.candidateId < b.candidateId) return -ONE;
  if (a.candidateId > b.candidateId) return ONE;
  if (a.scenarioKind < b.scenarioKind) return -ONE;
  if (a.scenarioKind > b.scenarioKind) return ONE;
  const pa = a.t2Pair ? `${a.t2Pair[0]} ${a.t2Pair[1]}` : '';
  const pb = b.t2Pair ? `${b.t2Pair[0]} ${b.t2Pair[1]}` : '';
  if (pa < pb) return -ONE;
  if (pa > pb) return ONE;
  return ZERO;
}

/** Δdias entre uma data de campo e a data de referência (≥ 0). */
function daysBetween(fieldDate: string, referenceDate: string): number {
  if (referenceDate === '') return ZERO;
  const d = isoToDayNumber(referenceDate) - isoToDayNumber(fieldDate);
  return d > ZERO ? d : ZERO;
}
