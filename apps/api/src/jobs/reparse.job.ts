/**
 * Reprocessamento (docs/04 §7). `pnpm ingest:reparse --adapter=nexus --since=Y`
 * roda o parser CORRENTE sobre os `raw_documents` já armazenados — SEM REDE. É o
 * que torna barata a correção de bug de parser (a razão de guardar o raw).
 *
 * Determinismo: re-parsear o mesmo raw com o mesmo parser produz saída idêntica.
 * Este job é IDEMPOTENTE: se a extração corrente bate com a já persistida, é no-op;
 * se DIVERGE, reporta `needs_supersede` (não força `UPDATE` — `poll_results` é
 * append-only, R5) e o supersede real depende de decisão de schema (Q-06 em
 * docs/OPEN-QUESTIONS). Se a extração corrente traz um cenário NOVO (label/kind que
 * não existia), ele é inserido normalmente.
 *
 * A ligação raw → registro se dá pelos `poll_scenarios` já existentes: reparseamos
 * os raws que já geraram cenários do adapter alvo, desde `--since`. Assim não
 * dependemos de rede nem de re-descoberta.
 */

import { randomUUID } from 'node:crypto';
import {
  parsedPollSchema,
  pollScenarioSchema,
  pollResultSchema,
  pollRegistrationSchema,
} from '@election-pool/contracts/domain';
import type {
  ParsedPoll,
  ParsedScenario,
  PollRegistration,
  PollResult,
  PollScenario,
  RawDocument,
} from '@election-pool/contracts/domain';
import { UnknownCandidateError } from '@election-pool/adapters/poll-source-adapter';
import type { PollSourceAdapter } from '@election-pool/adapters/poll-source-adapter';
import { resolverFromMap } from '@election-pool/adapters/base/candidate-resolver';
import type { CandidateAliasResolver } from '@election-pool/adapters/base/candidate-resolver';
import type { Database } from '../db/pool.js';
import { RawDocumentsRepository } from '../db/raw-documents.repository.js';
import { PollScenariosRepository } from '../db/poll-scenarios.repository.js';

export interface ReparseParams {
  adapterId: string;
  /** Data ISO ('AAAA-MM-DD' ou datetime): reparseia raws com fetched_at >= since. */
  sinceIso: string;
}

export interface ReparseAlert {
  kind: 'needs_supersede' | 'quarantine_unknown_candidate' | 'parse_error' | 'raw_missing';
  tseId: string;
  detail: string;
}

export interface ReparseResult {
  rawsConsidered: number;
  scenariosInserted: number;
  scenariosUnchanged: number;
  scenariosNeedingSupersede: number;
  alerts: ReparseAlert[];
}

export interface ReparseDeps {
  db: Database;
  adapter: PollSourceAdapter;
}

interface RawTseRow {
  raw_id: string;
  tse_id: string;
}

export class ReparseJob {
  private readonly db: Database;
  private readonly adapter: PollSourceAdapter;

  constructor(deps: ReparseDeps) {
    this.db = deps.db;
    this.adapter = deps.adapter;
  }

  async run(params: ReparseParams): Promise<ReparseResult> {
    const result: ReparseResult = {
      rawsConsidered: 0,
      scenariosInserted: 0,
      scenariosUnchanged: 0,
      scenariosNeedingSupersede: 0,
      alerts: [],
    };

    const resolveCandidate = await this.loadCandidateResolver();
    const rawRepo = new RawDocumentsRepository(this.db);
    const scenarioRepo = new PollScenariosRepository(this.db);
    const pairs = await this.rawsToReparse(params.sinceIso);

    for (const pair of pairs) {
      result.rawsConsidered++;
      const raw = await rawRepo.findById(pair.raw_id);
      const reg = await this.registration(pair.tse_id);
      if (raw === null || reg === null) {
        result.alerts.push({
          kind: 'raw_missing',
          tseId: pair.tse_id,
          detail: `raw ${pair.raw_id} ou registro ausente`,
        });
        continue;
      }

      let parsed: ParsedPoll;
      try {
        parsed = parsedPollSchema.parse(await this.adapter.parse(raw, reg));
      } catch (err) {
        if (err instanceof UnknownCandidateError) {
          result.alerts.push({
            kind: 'quarantine_unknown_candidate',
            tseId: reg.tseId,
            detail: err.alias,
          });
          continue;
        }
        result.alerts.push({
          kind: 'parse_error',
          tseId: reg.tseId,
          detail: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      await this.reconcile(parsed, raw, reg, resolveCandidate, scenarioRepo, result);
    }

    return result;
  }

  /**
   * Concilia a extração corrente com o que já está no banco, cenário a cenário:
   * - cenário novo (label/kind inédito) ⇒ insere;
   * - cenário existente idêntico ⇒ no-op (idempotente);
   * - cenário existente divergente ⇒ reporta `needs_supersede` (não força UPDATE;
   *   R5 e Q-06).
   */
  private async reconcile(
    parsed: ParsedPoll,
    raw: RawDocument,
    reg: PollRegistration,
    resolveCandidate: CandidateAliasResolver,
    scenarioRepo: PollScenariosRepository,
    result: ReparseResult,
  ): Promise<void> {
    for (const scenario of parsed.scenarios) {
      const existing = await this.existingScenario(reg.tseId, scenario.kind, scenario.label);
      const newResults = scenario.values.map((v) => ({
        candidateId: resolveOrThrow(resolveCandidate, v.candidateAlias),
        valuePct: v.valuePct as number,
      }));

      if (existing === null) {
        await this.insertScenario(scenario, raw, reg, resolveCandidate, scenarioRepo);
        result.scenariosInserted++;
        continue;
      }

      const storedResults = await this.storedResults(existing.id);
      if (sameResults(storedResults, newResults)) {
        result.scenariosUnchanged++;
      } else {
        result.scenariosNeedingSupersede++;
        result.alerts.push({
          kind: 'needs_supersede',
          tseId: reg.tseId,
          detail: `cenário "${scenario.label}" (${scenario.kind}) diverge da extração armazenada`,
        });
      }
    }
  }

  private async insertScenario(
    scenario: ParsedScenario,
    raw: RawDocument,
    reg: PollRegistration,
    resolveCandidate: CandidateAliasResolver,
    scenarioRepo: PollScenariosRepository,
  ): Promise<void> {
    const scenarioId = randomUUID();
    const t2Pair =
      scenario.t2Pair === undefined
        ? null
        : ([
            resolveOrThrow(resolveCandidate, scenario.t2Pair[0]),
            resolveOrThrow(resolveCandidate, scenario.t2Pair[1]),
          ] as [string, string]);

    const scenarioRow: PollScenario = pollScenarioSchema.parse({
      id: scenarioId,
      tseId: reg.tseId,
      rawDocumentId: raw.id,
      kind: scenario.kind,
      label: scenario.label,
      isCanonical: false,
      canonicalReason: null,
      t2Pair,
      blankNullPct: scenario.blankNullPct ?? null,
      undecidedPct: scenario.undecidedPct ?? null,
      extractedAt: new Date().toISOString(),
    });
    const results: PollResult[] = scenario.values.map((v) =>
      pollResultSchema.parse({
        scenarioId,
        candidateId: resolveOrThrow(resolveCandidate, v.candidateAlias),
        valuePct: v.valuePct,
      }),
    );
    await scenarioRepo.insertScenario(scenarioRow);
    await scenarioRepo.insertResults(results);
  }

  // --- queries (só LEIO a camada db) ---------------------------------------

  private async loadCandidateResolver(): Promise<CandidateAliasResolver> {
    const rows = await this.db.query<{ alias: string; candidate_id: string }>(
      `SELECT alias, candidate_id FROM candidate_aliases`,
    );
    return resolverFromMap(new Map(rows.map((r) => [r.alias, r.candidate_id])));
  }

  /** Raws que já geraram cenários deste adapter (via tse_id → instituto), desde since. */
  private async rawsToReparse(sinceIso: string): Promise<RawTseRow[]> {
    return this.db.query<RawTseRow>(
      `SELECT DISTINCT rd.id AS raw_id, ps.tse_id AS tse_id
         FROM raw_documents rd
         JOIN poll_scenarios ps ON ps.raw_document_id = rd.id
        WHERE rd.fetched_at >= $1
        ORDER BY ps.tse_id`,
      [sinceIso],
    );
  }

  private async registration(tseId: string): Promise<PollRegistration | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT tse_id, race_id, institute_id, institute_raw_name, contractor_name,
              contractor_type, registered_at, field_start, field_end, sample_size,
              margin_of_error, confidence_level, cost_brl, first_seen_at,
              source_expired_at, disclosure_status
         FROM poll_registrations WHERE tse_id = $1`,
      [tseId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return pollRegistrationSchema.parse({
      tseId: row['tse_id'],
      raceId: row['race_id'],
      instituteId: row['institute_id'],
      instituteRawName: row['institute_raw_name'],
      contractorName: row['contractor_name'],
      contractorType: row['contractor_type'],
      registeredAt: row['registered_at'],
      fieldStart: row['field_start'],
      fieldEnd: row['field_end'],
      sampleSize: row['sample_size'],
      marginOfError: row['margin_of_error'],
      confidenceLevel: row['confidence_level'],
      costBrl: row['cost_brl'],
      firstSeenAt: row['first_seen_at'],
      sourceExpiredAt: row['source_expired_at'],
      disclosureStatus: row['disclosure_status'],
    });
  }

  private async existingScenario(
    tseId: string,
    kind: string,
    label: string,
  ): Promise<{ id: string } | null> {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM poll_scenarios WHERE tse_id = $1 AND kind = $2 AND label = $3`,
      [tseId, kind, label],
    );
    return rows[0] ?? null;
  }

  private async storedResults(
    scenarioId: string,
  ): Promise<{ candidateId: string; valuePct: number }[]> {
    const rows = await this.db.query<{ candidate_id: string; value_pct: number }>(
      `SELECT candidate_id, value_pct FROM poll_results WHERE scenario_id = $1`,
      [scenarioId],
    );
    return rows.map((r) => ({ candidateId: r.candidate_id, valuePct: r.value_pct }));
  }
}

const resolveOrThrow = (resolver: CandidateAliasResolver, alias: string): string => {
  const id = resolver(alias);
  if (id === null) throw new UnknownCandidateError(alias);
  return id;
};

/** Compara dois conjuntos de resultados (candidato→valor) ignorando a ordem. */
const sameResults = (
  a: { candidateId: string; valuePct: number }[],
  b: { candidateId: string; valuePct: number }[],
): boolean => {
  if (a.length !== b.length) return false;
  const key = (r: { candidateId: string; valuePct: number }): string =>
    `${r.candidateId}=${r.valuePct.toFixed(2)}`;
  const setA = new Set(a.map(key));
  return b.every((r) => setA.has(key(r)));
};
