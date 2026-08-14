/**
 * ModelJob (`model:run`, docs/02 §3.3). O passo que transforma o dado normalized
 * em `computed` (docs/03 §1): calcula, NÃO publica.
 *
 * Sequência (docs/02 §3.3, docs/01, docs/07 §3):
 *  1. Seleção canônica (docs/01 §3) sobre os cenários pendentes — o harvest grava
 *     `is_canonical=false`; sem este passo o modelo não enxerga observação (M-1
 *     reprova). Roda AQUI, antes do modelo (LOG T-13).
 *  2. Lê as observações canônicas do banco (o mesmo read-model do render) e roda
 *     `runModel` (@election-pool/model) — a API pura.
 *  3. Avalia os gates de modelo M-1..M-7 (docs/07 §3). O modelo em si só afirma o
 *     que um run isolado pode (cobertura, soma, convergência); a continuidade
 *     (M-3, vs. run anterior), a sanidade de banda (M-4), o determinismo (M-6,
 *     dois runs) e o backtest (M-7) são avaliados AQUI, onde há estado entre runs
 *     e acesso ao harness de backtest.
 *  4. Persiste `model_runs` (com `input_hash`, `git_sha`, `gates_passed`,
 *     `gates_json`, `params_json`), `model_estimates`, `model_house_effects` e
 *     `model_diagnostics` (docs/03 §2.5), tudo numa transação — computed é
 *     regenerável e atômico.
 *  5. Se `gates_passed`, sinaliza o RenderJob (docs/02 §3.4). O disparo em si é do
 *     orquestrador (main.ts): o job devolve `shouldRender`.
 *
 * Idempotente e determinístico (docs/01 §9): mesmo `input_hash` + `model_version`
 * ⇒ mesma saída bit a bit (M-6 verifica). Rodável sozinho por CLI (`model:run`).
 */

import { randomUUID, createHash } from 'node:crypto';
import { runModel } from '@election-pool/model';
import type { ModelInput } from '@election-pool/model';
import {
  computeGavetaRates,
  computeHerding,
  computeDivergence,
} from '@election-pool/model/diagnostics';
import type { RegistrationRecord, HouseEffectInput } from '@election-pool/model/diagnostics';
import { runBacktest, loadFixture } from '@election-pool/model/backtest';
import type { ModelOutput, Observation } from '@election-pool/contracts/model-io';
import { observationsSchema } from '@election-pool/contracts/model-io';
import { DIAGNOSTIC_KIND, SCENARIO_KIND } from '@election-pool/contracts/enums';
import {
  MODEL_VERSION,
  BAND_WIDTH_MIN_PP,
  BAND_WIDTH_MAX_PP,
  CONTINUITY_MAX_MOVE_PP,
  SIGMA_PROCESS,
  DEFF,
  SIGMA_HOUSE_EXTRA,
  TAU_RECENCY_DAYS,
  ACTIVE_WINDOW_DAYS,
  HOUSE_EFFECT_PRIOR_SD,
} from '@election-pool/contracts/constants';
import type { Database } from '../db/pool.js';
import { RenderReadModel } from '../publish/read-model.js';
import type { ScenarioResultRow, RegistrationRow } from '../publish/read-model.js';
import { CanonicalSelector } from '../ingestion/canonical-selector.js';
import type { CanonicalSelectionResult } from '../ingestion/canonical-selector.js';

export const CRON_SCHEDULE = '15 */2 * * *'; // docs/02 §3.3

const ZERO = 0;
const TWO = 2;

/** Veredito de um gate individual, para `gates_json` e o log estruturado. */
export interface GateVerdict {
  name: string;
  ok: boolean;
  detail: string;
}

export interface ModelGatesJson {
  passed: boolean;
  results: GateVerdict[];
}

export interface ModelRunSummary {
  canonical: CanonicalSelectionResult;
  observations: number;
  referenceDate: string;
  inputHash: string;
  gatesPassed: boolean;
  gates: GateVerdict[];
  /** true ⇒ o orquestrador deve disparar o RenderJob (docs/02 §3.4). */
  shouldRender: boolean;
  /** id do model_run persistido, quando houve observação. */
  runId: string | null;
}

export interface ModelJobDeps {
  db: Database;
  raceId: string;
  now?: () => Date;
  gitSha?: string;
  /** Injeção do backtest (teste). Default: o harness real (fixture 2022). */
  runBacktestGate?: () => boolean;
}

export class ModelJob {
  private readonly db: Database;
  private readonly raceId: string;
  private readonly now: () => Date;
  private readonly gitSha: string;
  private readonly runBacktestGate: () => boolean;

  constructor(deps: ModelJobDeps) {
    this.db = deps.db;
    this.raceId = deps.raceId;
    this.now = deps.now ?? (() => new Date());
    this.gitSha = deps.gitSha ?? process.env['GIT_SHA'] ?? 'unknown';
    this.runBacktestGate = deps.runBacktestGate ?? defaultBacktestGate;
  }

  async run(): Promise<ModelRunSummary> {
    // 1. Seleção canônica (docs/01 §3) — sempre, antes de ler observações.
    const canonical = await new CanonicalSelector(this.db).selectForRace(this.raceId);

    const read = new RenderReadModel(this.db);
    const [scenarioResults, registrations] = await Promise.all([
      read.listCanonicalScenarioResults(this.raceId),
      read.listRegistrations(this.raceId),
    ]);

    const observations = buildObservations(scenarioResults);
    const referenceDate = referenceDateFor(scenarioResults, this.now());
    const inputHash = computeInputHash(observations);

    // 2. Roda o modelo. Se a restrição de soma estourar (R4), runModel LANÇA — o
    //    orquestrador trata como falha de run (job_runs=error), não publica.
    const modelInput: ModelInput = { observations, referenceDate };
    const output = runModel(modelInput);

    // 3. Gates M-1..M-7 (docs/07 §3).
    const previous = await this.loadPreviousEstimates();
    const gates = this.evaluateGates(output, observations, modelInput, previous);
    const gatesPassed = gates.every((g) => g.ok);

    // 4. Persiste o run inteiro numa transação.
    const runId = randomUUID();
    const diagnostics = this.buildDiagnostics(output, observations, registrations, referenceDate);
    await this.persistRun({
      runId,
      referenceDate,
      inputHash,
      gatesPassed,
      gates,
      output,
      diagnostics,
    });

    return {
      canonical,
      observations: observations.length,
      referenceDate,
      inputHash,
      gatesPassed,
      gates,
      shouldRender: gatesPassed,
      runId,
    };
  }

  // --- Gates ----------------------------------------------------------------

  /**
   * Avalia os sete gates de modelo (docs/07 §3). O `runModel` afirma M-1/M-2/M-5;
   * M-3 (continuidade vs. run anterior), M-4 (largura de banda), M-6 (determinismo)
   * e M-7 (backtest) são avaliados aqui, com estado entre runs e o harness. NUNCA
   * relaxa um limite (docs/07 §3): um estouro legítimo (M-3) resolve-se por
   * aprovação humana, não afrouxando o gate.
   */
  private evaluateGates(
    output: ModelOutput,
    observations: readonly Observation[],
    input: ModelInput,
    previous: PreviousEstimate[],
  ): GateVerdict[] {
    const results: GateVerdict[] = [];

    // M-1 Cobertura — do modelo (≥3 pesquisas de ≥2 institutos na janela).
    results.push({
      name: 'M-1 coverage',
      ok: output.gates.coverageOk,
      detail: output.gates.coverageOk
        ? 'cobertura suficiente na janela'
        : 'cobertura insuficiente (docs/07 M-1): < 3 pesquisas ou < 2 institutos na janela de 45d',
    });

    // M-2 Soma — do modelo (buildDatedSeries lança se a soma estoura; chegou aqui ⇒ ok).
    results.push({
      name: 'M-2 sum',
      ok: output.gates.sumOk,
      detail: 'soma dos rastreados dentro do desvio máximo antes da normalização',
    });

    // M-3 Continuidade — nenhum μ_t move > 5 p.p. entre dois runs consecutivos.
    const m3 = checkContinuity(output, previous);
    results.push(m3);

    // M-4 Sanidade de banda — largura do IC 90% em [1.5, 15] p.p.
    const m4 = checkBandSanity(output);
    results.push(m4);

    // M-5 Convergência — sem NaN/Inf/variância negativa (o Kalman garante; o
    //     schema Zod da saída já barra não-finito, mas checamos explicitamente).
    const m5 = checkConvergence(output);
    results.push(m5);

    // M-6 Determinismo — segundo run com o mesmo input produz saída idêntica.
    const m6 = checkDeterminism(output, input);
    results.push(m6);

    // M-7 Backtest — o gate que importa (docs/07 §4). Consome o harness 2022.
    //     Se REPROVA, gates_passed=false e a publicação é bloqueada (LOG T-09).
    let m7Ok: boolean;
    try {
      m7Ok = this.runBacktestGate();
    } catch (err) {
      m7Ok = false;
      results.push({
        name: 'M-7 backtest',
        ok: false,
        detail: `backtest lançou: ${err instanceof Error ? err.message : String(err)}`,
      });
      // Evita empurrar duas linhas M-7; retorna cedo o conjunto atual + M-7 falho.
      void observations;
      return results;
    }
    results.push({
      name: 'M-7 backtest',
      ok: m7Ok,
      detail: m7Ok
        ? 'backtest 2022 aprovado (4/4)'
        : 'backtest 2022 REPROVOU (docs/07 §4) — publicação bloqueada até decisão de metodologia',
    });

    void observations;
    return results;
  }

  // --- Persistência ---------------------------------------------------------

  private async persistRun(args: {
    runId: string;
    referenceDate: string;
    inputHash: string;
    gatesPassed: boolean;
    gates: GateVerdict[];
    output: ModelOutput;
    diagnostics: DiagnosticRowToPersist[];
  }): Promise<void> {
    const runAt = this.now().toISOString();
    const gatesJson: ModelGatesJson = { passed: args.gatesPassed, results: args.gates };

    await this.db.query(
      `INSERT INTO model_runs
         (id, race_id, model_version, run_at, reference_date, input_hash, git_sha,
          params_json, gates_passed, gates_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)`,
      [
        args.runId,
        this.raceId,
        MODEL_VERSION,
        runAt,
        args.referenceDate,
        args.inputHash,
        this.gitSha,
        JSON.stringify(MODEL_PARAMS),
        args.gatesPassed,
        JSON.stringify(gatesJson),
      ],
    );

    await this.persistEstimates(args.runId, args.output);
    await this.persistHouseEffects(args.runId, args.output);
    await this.persistDiagnostics(args.runId, args.diagnostics);
  }

  /** Grava a série latente μ_t (model_estimates). t2_pair '{}' no 1º turno (docs/03 §2.5). */
  private async persistEstimates(runId: string, output: ModelOutput): Promise<void> {
    for (const point of output.latent.firstRound) {
      for (const [candidateId, band] of Object.entries(point.byCandidate)) {
        await this.db.query(
          `INSERT INTO model_estimates
             (run_id, scenario_kind, t2_pair, candidate_id, date, mean_pct, lo90_pct, hi90_pct)
           VALUES ($1,$2,'{}',$3,$4,$5,$6,$7)`,
          [
            runId,
            SCENARIO_KIND.t1Estimulado,
            candidateId,
            point.date,
            band.meanPct,
            band.lo90Pct,
            band.hi90Pct,
          ],
        );
      }
    }
    for (const runoff of output.latent.runoffs) {
      const pair = [runoff.pair[0], runoff.pair[1]];
      for (const point of runoff.series) {
        for (const [candidateId, band] of Object.entries(point.byCandidate)) {
          await this.db.query(
            `INSERT INTO model_estimates
               (run_id, scenario_kind, t2_pair, candidate_id, date, mean_pct, lo90_pct, hi90_pct)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              runId,
              SCENARIO_KIND.t2,
              pair,
              candidateId,
              point.date,
              band.meanPct,
              band.lo90Pct,
              band.hi90Pct,
            ],
          );
        }
      }
    }
  }

  private async persistHouseEffects(runId: string, output: ModelOutput): Promise<void> {
    for (const he of output.houseEffects) {
      await this.db.query(
        `INSERT INTO model_house_effects
           (run_id, institute_id, candidate_id, effect_pp, lo90_pp, hi90_pp, n_polls, estimable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (run_id, institute_id, candidate_id) DO NOTHING`,
        [
          runId,
          he.instituteId,
          he.candidateId,
          he.effectPp,
          he.lo90Pp,
          he.hi90Pp,
          he.nPolls,
          he.estimable,
        ],
      );
    }
  }

  private async persistDiagnostics(
    runId: string,
    diagnostics: readonly DiagnosticRowToPersist[],
  ): Promise<void> {
    for (const d of diagnostics) {
      await this.db.query(
        `INSERT INTO model_diagnostics (run_id, kind, subject_id, value, n, payload)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (run_id, kind, subject_id) DO NOTHING`,
        [runId, d.kind, d.subjectId, d.value, d.n, JSON.stringify(d.payload)],
      );
    }
  }

  /**
   * Monta as linhas de `model_diagnostics` (docs/03 §2.5) das três famílias
   * (gaveta, herding, divergência), na forma rica de T-08 no `payload`. Diagnóstico
   * é publicado, nunca aplicado (separação estrutural).
   */
  private buildDiagnostics(
    output: ModelOutput,
    observations: readonly Observation[],
    registrations: readonly RegistrationRow[],
    referenceDate: string,
  ): DiagnosticRowToPersist[] {
    const rows: DiagnosticRowToPersist[] = [];

    const gaveta = computeGavetaRates(toRegistrationRecords(registrations), referenceDate);
    for (const g of gaveta) {
      rows.push({
        kind: DIAGNOSTIC_KIND.gaveta,
        subjectId: `${g.subjectKind}:${g.subjectId}`,
        value: g.rate,
        n: g.registered,
        payload: {
          subjectKind: g.subjectKind,
          subjectId: g.subjectId,
          registered: g.registered,
          disclosed: g.disclosed,
        },
      });
    }

    const herding = computeHerding(observations);
    for (const h of herding) {
      rows.push({
        kind: DIAGNOSTIC_KIND.herding,
        subjectId: h.windowEnd,
        value: h.ratio,
        n: h.nPolls,
        payload: { windowEnd: h.windowEnd, ratio: h.ratio, nPolls: h.nPolls, flagged: h.flagged },
      });
    }

    const heInput: HouseEffectInput[] = output.houseEffects.map((h) => ({
      instituteId: h.instituteId,
      effectPp: h.effectPp,
      lo90Pp: h.lo90Pp,
      hi90Pp: h.hi90Pp,
      estimable: h.estimable,
    }));
    // Dedup por instituto: houseEffects repete h_i por candidato (v1 não modela h_ij).
    const seenInstitutes = new Set<string>();
    const dedupHe = heInput.filter((h) => {
      if (seenInstitutes.has(h.instituteId)) return false;
      seenInstitutes.add(h.instituteId);
      return true;
    });
    for (const d of computeDivergence(dedupHe)) {
      if (!d.divergent) continue;
      rows.push({
        kind: DIAGNOSTIC_KIND.divergencia,
        subjectId: d.instituteId,
        value: d.effectPp,
        n: ZERO,
        payload: { lo90Pp: d.lo90Pp, hi90Pp: d.hi90Pp, divergent: d.divergent },
      });
    }

    return rows;
  }

  /**
   * Estimativas do run anterior (mais recente) desta corrida, para o gate de
   * continuidade M-3. Só o 1º turno (a série que carrega o grosso do sinal); um
   * salto grande num par de 2º turno costuma refletir composição de par, não
   * descontinuidade. Vazio no primeiro run ⇒ M-3 passa vacuamente.
   */
  private async loadPreviousEstimates(): Promise<PreviousEstimate[]> {
    const rows = await this.db.query<{ candidate_id: string; date: string; mean_pct: number }>(
      `SELECT me.candidate_id, me.date, me.mean_pct
         FROM model_estimates me
        WHERE me.run_id = (
          SELECT id FROM model_runs
           WHERE race_id = $1
           ORDER BY run_at DESC
           LIMIT 1
        )
        AND me.scenario_kind = $2`,
      [this.raceId, SCENARIO_KIND.t1Estimulado],
    );
    return rows.map((r) => ({ candidateId: r.candidate_id, date: r.date, meanPct: r.mean_pct }));
  }
}

// --- Gate helpers (puros) ---------------------------------------------------

interface PreviousEstimate {
  candidateId: string;
  date: string;
  meanPct: number;
}

/**
 * M-3 (docs/07): nenhum μ_t (1º turno) move mais que CONTINUITY_MAX_MOVE_PP entre
 * o run corrente e o anterior, comparando o mesmo (candidato, data). Sem run
 * anterior, passa vacuamente. Um estouro é resolvido por aprovação humana
 * (`model:approve`), nunca relaxando o limite (docs/07 §3).
 */
const checkContinuity = (output: ModelOutput, previous: PreviousEstimate[]): GateVerdict => {
  if (previous.length === ZERO) {
    return {
      name: 'M-3 continuity',
      ok: true,
      detail: 'primeiro run — sem baseline (vacuamente ok)',
    };
  }
  const prevByKey = new Map<string, number>();
  for (const p of previous) prevByKey.set(`${p.candidateId}|${p.date}`, p.meanPct);

  let maxMove = ZERO;
  let worst = '';
  for (const point of output.latent.firstRound) {
    for (const [candidateId, band] of Object.entries(point.byCandidate)) {
      const prev = prevByKey.get(`${candidateId}|${point.date}`);
      if (prev === undefined) continue;
      const move = Math.abs(band.meanPct - prev);
      if (move > maxMove) {
        maxMove = move;
        worst = `${candidateId}@${point.date}`;
      }
    }
  }
  const ok = maxMove <= CONTINUITY_MAX_MOVE_PP;
  return {
    name: 'M-3 continuity',
    ok,
    detail: ok
      ? `maior movimento ${maxMove.toFixed(TWO)} p.p. ≤ ${String(CONTINUITY_MAX_MOVE_PP)}`
      : `movimento ${maxMove.toFixed(TWO)} p.p. em ${worst} > ${String(CONTINUITY_MAX_MOVE_PP)} (M-3) — requer aprovação humana`,
  };
};

/**
 * M-4 (docs/07): a largura do IC 90% de cada ponto/candidato está em
 * [BAND_WIDTH_MIN_PP, BAND_WIDTH_MAX_PP]. Banda estreita demais é bug; larga
 * demais é inútil. Verifica 1º turno e pares de 2º turno.
 */
const checkBandSanity = (output: ModelOutput): GateVerdict => {
  let minW = Number.POSITIVE_INFINITY;
  let maxW = ZERO;
  let count = ZERO;

  const scan = (byCandidate: Record<string, { lo90Pct: number; hi90Pct: number }>): void => {
    for (const band of Object.values(byCandidate)) {
      const w = band.hi90Pct - band.lo90Pct;
      if (w < minW) minW = w;
      if (w > maxW) maxW = w;
      count++;
    }
  };
  for (const p of output.latent.firstRound) scan(p.byCandidate);
  for (const r of output.latent.runoffs) for (const p of r.series) scan(p.byCandidate);

  if (count === ZERO) {
    return { name: 'M-4 band', ok: false, detail: 'sem pontos latentes para avaliar banda' };
  }
  const ok = minW >= BAND_WIDTH_MIN_PP && maxW <= BAND_WIDTH_MAX_PP;
  return {
    name: 'M-4 band',
    ok,
    detail: `largura IC90 ∈ [${minW.toFixed(TWO)}, ${maxW.toFixed(TWO)}] p.p. (limite [${String(BAND_WIDTH_MIN_PP)}, ${String(BAND_WIDTH_MAX_PP)}])`,
  };
};

/** M-5 (docs/07): nenhum valor não-finito na saída (o Kalman/Zod garantem; explícito). */
const checkConvergence = (output: ModelOutput): GateVerdict => {
  const finite = (x: number): boolean => Number.isFinite(x);
  let ok = true;
  const scan = (
    byCandidate: Record<string, { meanPct: number; lo90Pct: number; hi90Pct: number }>,
  ): void => {
    for (const b of Object.values(byCandidate)) {
      if (!finite(b.meanPct) || !finite(b.lo90Pct) || !finite(b.hi90Pct)) ok = false;
    }
  };
  for (const p of output.latent.firstRound) scan(p.byCandidate);
  for (const r of output.latent.runoffs) for (const p of r.series) scan(p.byCandidate);
  for (const he of output.houseEffects) {
    if (!finite(he.effectPp) || !finite(he.lo90Pp) || !finite(he.hi90Pp)) ok = false;
  }
  return {
    name: 'M-5 convergence',
    ok,
    detail: ok ? 'sem NaN/Infinity na saída' : 'valor não-finito na saída (M-5) — divergência',
  };
};

/**
 * M-6 (docs/07 / docs/01 §9): um segundo run com o MESMO input produz saída
 * idêntica bit a bit. Rodamos `runModel` de novo e comparamos o JSON serializado.
 */
const checkDeterminism = (output: ModelOutput, input: ModelInput): GateVerdict => {
  const second = runModel(input);
  const ok = JSON.stringify(output) === JSON.stringify(second);
  return {
    name: 'M-6 determinism',
    ok,
    detail: ok
      ? 'segundo run idêntico (bit a bit)'
      : 'saída divergiu entre dois runs (M-6) — não-determinismo',
  };
};

/**
 * Gate M-7 padrão (docs/07 §4): roda o backtest 2022 real (fixture versionada) e
 * devolve se as quatro comparações passaram. É a caixa-preta do modelo — NUNCA
 * ajustada para passar (R1). No estado atual REPROVA honestamente (LOG T-09), o
 * que bloqueia a publicação até decisão de metodologia do Felix.
 */
const defaultBacktestGate = (): boolean => {
  const fixture = loadFixture();
  return runBacktest(fixture).allPassed;
};

// --- input_hash (docs/01 §9) ------------------------------------------------

/**
 * `input_hash` = SHA-256 do conjunto ORDENADO de (tse_id, candidato, valor) usado
 * (docs/01 §9). Ordenamos antes de hashear ⇒ o hash é independente da ordem de
 * leitura do banco. Mesmo hash + mesma model_version ⇒ mesma saída (M-6).
 */
const computeInputHash = (observations: readonly Observation[]): string => {
  const rows = observations
    .map(
      (o) =>
        `${o.tseId}\t${o.candidateId}\t${o.scenarioKind}\t${o.t2Pair?.join('|') ?? ''}\t${o.valuePct.toFixed(TWO)}`,
    )
    .sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
};

// --- params_json (docs/03 §2.5: todos os priors, explícitos) ----------------

const MODEL_PARAMS = {
  modelVersion: MODEL_VERSION,
  sigmaProcess: SIGMA_PROCESS,
  deff: DEFF,
  sigmaHouseExtra: SIGMA_HOUSE_EXTRA,
  tauRecencyDays: TAU_RECENCY_DAYS,
  activeWindowDays: ACTIVE_WINDOW_DAYS,
  houseEffectPriorSd: HOUSE_EFFECT_PRIOR_SD,
} as const;

// --- observações a partir das linhas de cenário -----------------------------
// (mesma lógica do data-assembler do render; duplicada de propósito para o
// ModelJob não depender do módulo de publicação — computed antes de render.)

const buildObservations = (rows: readonly ScenarioResultRow[]): Observation[] => {
  const raw = rows.map((r) => ({
    tseId: r.tseId,
    instituteId: r.instituteId,
    candidateId: r.candidateId,
    scenarioKind: r.scenarioKind,
    t2Pair: r.t2Pair,
    fieldMedianDate: medianFieldDate(r.fieldStart, r.fieldEnd),
    sampleSize: r.sampleSize,
    valuePct: r.valuePct,
  }));
  return observationsSchema.parse(raw);
};

const medianFieldDate = (fieldStart: string, fieldEnd: string): string => {
  const startMs = Date.parse(`${fieldStart}T00:00:00Z`);
  const endMs = Date.parse(`${fieldEnd}T00:00:00Z`);
  const midMs = startMs + (endMs - startMs) / TWO;
  return new Date(midMs).toISOString().slice(ZERO, 10);
};

const referenceDateFor = (rows: readonly ScenarioResultRow[], now: Date): string => {
  let max = '';
  for (const r of rows) {
    const d = medianFieldDate(r.fieldStart, r.fieldEnd);
    if (d > max) max = d;
  }
  return max === '' ? now.toISOString().slice(ZERO, 10) : max;
};

const toRegistrationRecords = (rows: readonly RegistrationRow[]): RegistrationRecord[] =>
  rows.map((r) => ({
    instituteId: r.instituteId,
    contractorName: r.contractorName,
    registeredAt: r.registeredAt,
    disclosed: r.disclosed,
  }));

// --- diagnóstico a persistir ------------------------------------------------

interface DiagnosticRowToPersist {
  kind: (typeof DIAGNOSTIC_KIND)[keyof typeof DIAGNOSTIC_KIND];
  subjectId: string;
  value: number;
  n: number;
  payload: Record<string, unknown>;
}
