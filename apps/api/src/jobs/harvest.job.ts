/**
 * HarvestJob (docs/02 §3.2, docs/04 §3–§7). Para cada registro elegível (campo
 * encerrado, sem resultado, dentro da janela de tentativas) resolve o adapter,
 * busca as URLs candidatas com conditional GET, salva o raw no blob e extrai.
 *
 * Garantias não-negociáveis:
 * - **Conditional GET** obrigatório: guarda `etag`/`last_modified` por URL (o
 *   próprio `raw_documents`) e reenvia. **304 encerra o ciclo daquela URL sem
 *   parse** (docs/02 §3.2, docs/04 §6).
 * - **Backoff** de docs/02 §3.2 via `decideHarvest` (puro/testado). Após 15 dias
 *   sem resultado ⇒ `presumed_undisclosed` e para (é DADO, não falha).
 * - **V6 / alias desconhecido / nunca parcial** são do `parse` do adapter. Aqui
 *   tratamos os desfechos: sucesso ⇒ persiste; `UnknownCandidateError` ⇒
 *   quarentena (não persiste, não auto-cria); `ParseError` ⇒ log e segue.
 * - **Raw fora da árvore servida** (`RawStorage`, R3). `poll_results` é
 *   append-only (R5): persistência via `PollScenariosRepository`.
 *
 * Sem headless browser (CLAUDE.md). Requisições passam pelo `HttpClient`
 * compartilhado (robots + rate limit 1 req/10s por host, docs/04 §6).
 */

import { randomUUID } from 'node:crypto';
import {
  parsedPollSchema,
  pollScenarioSchema,
  pollResultSchema,
  pollRegistrationSchema,
  rawDocumentSchema,
} from '@election-pool/contracts/domain';
import type {
  ParsedPoll,
  PollRegistration,
  PollResult,
  PollScenario,
  RawDocument,
} from '@election-pool/contracts/domain';
import { DISCLOSURE_STATUS } from '@election-pool/contracts/enums';
import { UnknownCandidateError, ParseError } from '@election-pool/adapters/poll-source-adapter';
import type { PollSourceAdapter } from '@election-pool/adapters/poll-source-adapter';
import { AdapterRegistry } from '@election-pool/adapters/base/registry';
import { RawStorage } from '@election-pool/adapters/base/raw-storage';
import { resolverFromMap } from '@election-pool/adapters/base/candidate-resolver';
import type { CandidateAliasResolver } from '@election-pool/adapters/base/candidate-resolver';
import { validateParsedPoll } from '@election-pool/adapters/validation/validate-parsed-poll';
import { ValidationError } from '@election-pool/adapters/validation/validation-error';
import type { ValidationContext } from '@election-pool/adapters/validation/context';
import { AdapterFailureCounter } from '@election-pool/adapters/validation/failure-counter';
import type { HttpClient } from '@election-pool/adapters/http-client';
import type { Database } from '../db/pool.js';
import { RawDocumentsRepository } from '../db/raw-documents.repository.js';
import { PollScenariosRepository } from '../db/poll-scenarios.repository.js';
import { decideHarvest } from './harvest-eligibility.js';
import type { HarvestDecision } from './harvest-eligibility.js';
import type { WithTransaction } from './discovery.job.js';

export const CRON_SCHEDULE = '5 */2 * * *'; // docs/02 §3.2

const contentTypeOf = (headers: Headers): string | null => headers.get('content-type');

export interface HarvestAlert {
  kind:
    | 'quarantine_unknown_candidate'
    | 'parse_error'
    | 'no_adapter'
    | 'robots_or_http_error'
    | 'validation_failed'
    | 'adapter_suspect_streak';
  tseId: string;
  detail: string;
}

export interface HarvestResult {
  considered: number;
  attempted: number;
  disclosed: number;
  notModified: number;
  presumedUndisclosed: number;
  quarantined: number;
  /** Ciclos com falha de validação bloqueante (docs/04 §5). Nada persistido. */
  validationFailed: number;
  alerts: HarvestAlert[];
}

/** Estado de conditional GET de uma URL previamente buscada. */
interface ConditionalState {
  etag: string | null;
  lastModified: string | null;
}

/** Conjuntos vivos durante um `run()` para rolar o contador de falhas por adapter. */
interface CycleTracking {
  readonly exercised: Set<string>;
  readonly failed: Set<string>;
}

export interface HarvestDeps {
  db: Database;
  http: HttpClient;
  registry: AdapterRegistry;
  storage?: RawStorage;
  now?: () => Date;
  /**
   * Abre uma transação com conexão dedicada (mesmo helper do DiscoveryJob). A
   * persistência de UMA divulgação (todos os cenários + resultados + a transição
   * para `disclosed`) roda dentro dela: ou entra inteira, ou nada entra. Sem
   * transação injetada (testes/uso direto) cai num modo NÃO-atômico que emula o
   * comportamento antigo statement-a-statement — os testes de integração passam
   * uma real. O motivo do contêiner é R4/R5: uma falha no meio da gravação (ex.:
   * colisão de cenário já existente) não pode deixar a pesquisa meio-escrita nem,
   * pior ainda, uma divulgação parcial sobrepondo a anterior.
   */
  withTransaction?: WithTransaction;
  /**
   * Contador de falhas de validação por adapter (docs/04 §5). Compartilhe UMA
   * instância entre execuções para que "3 ciclos consecutivos ⇒ alerta" seja
   * medido no tempo real do cron; sem instância injetada o contador é local à
   * execução (nunca alerta num run isolado, o que é o comportamento correto de
   * um único ciclo).
   */
  failureCounter?: AdapterFailureCounter;
  /**
   * V5 (docs/04 §5): série latente μ_t corrente por `candidate_id`, para o
   * contexto de validação. A série é do MODELO (fora do caminho de colheita), então
   * o orquestrador (T-14) a carrega das `model_estimates` mais recentes e a injeta
   * aqui. Ausente ⇒ modelo frio (primeiros dados) e V5 não dispara. Chamado uma vez
   * no início do `run()`; o job reprojeta para o alias de cada poll.
   */
  currentLatentByCandidateId?: () => Promise<ReadonlyMap<string, number>>;
}

export class HarvestJob {
  private readonly db: Database;
  private readonly http: HttpClient;
  private readonly registry: AdapterRegistry;
  private readonly storage: RawStorage;
  private readonly now: () => Date;
  private readonly withTransaction: WithTransaction;
  private readonly failureCounter: AdapterFailureCounter;
  private readonly currentLatentByCandidateId:
    | (() => Promise<ReadonlyMap<string, number>>)
    | undefined;
  /** μ_t corrente por candidate_id, carregado uma vez por `run()` (V5). */
  private currentLatent: ReadonlyMap<string, number> = new Map();

  constructor(deps: HarvestDeps) {
    this.db = deps.db;
    this.http = deps.http;
    this.registry = deps.registry;
    this.storage = deps.storage ?? new RawStorage();
    this.now = deps.now ?? (() => new Date());
    // Sem transação injetada: modo NÃO-atômico (roda no mesmo `db`). Só o entry de
    // produção e os testes de integração passam uma transação real de pool.
    this.withTransaction = deps.withTransaction ?? ((fn) => fn(this.db));
    this.failureCounter = deps.failureCounter ?? new AdapterFailureCounter();
    this.currentLatentByCandidateId = deps.currentLatentByCandidateId;
  }

  async run(): Promise<HarvestResult> {
    const nowIso = this.now().toISOString();
    const result: HarvestResult = {
      considered: 0,
      attempted: 0,
      disclosed: 0,
      notModified: 0,
      presumedUndisclosed: 0,
      quarantined: 0,
      validationFailed: 0,
      alerts: [],
    };

    const resolveCandidate = await this.loadCandidateResolver();
    // V5 (docs/04 §5): carrega μ_t corrente por candidate_id uma vez (a série é do
    // modelo, injetada pelo orquestrador). Modelo frio ⇒ mapa vazio, V5 não dispara.
    this.currentLatent =
      this.currentLatentByCandidateId === undefined
        ? new Map()
        : await this.currentLatentByCandidateId();
    const registrations = await this.loadEligibleRegistrations();

    // Adapters que foram exercitados neste ciclo e se algum teve falha de
    // validação — para rolar o contador consecutivo por adapter ao final (§5).
    const adapterExercised = new Set<string>();
    const adapterHadValidationFailure = new Set<string>();

    /**
     * Colheita PARALELA ENTRE INSTITUTOS, serial DENTRO de cada um.
     *
     * O motivo é tempo de parede. O rate limit de docs/04 §6 (1 req/10s) é POR
     * HOST, mas o laço era global e sequencial: buscar o instituto A e depois o B
     * esperava 10s entre requisições de servidores que nada têm a ver um com o
     * outro. Com N institutos, o ciclo custava a SOMA de todos em vez do mais
     * lento — e com um ciclo de 2h isso é a diferença entre colher a rodada do dia
     * e perdê-la.
     *
     * O que NÃO muda: a etiqueta. O `PerHostRateLimiter` continua garantindo 1
     * req/10s por host, e cada grupo aqui é um instituto (um host), processado em
     * série. Ninguém recebe duas requisições nossas em menos de 10s.
     *
     * Registro sem instituto resolvido fica num grupo à parte: ele não vai gerar
     * requisição nenhuma (não há adapter), só alerta `no_adapter`.
     *
     * `result` é mutado por vários grupos, o que é seguro: JS é single-threaded e
     * cada `await` cede o turno inteiro; não há escrita parcial de contador.
     */
    const byInstitute = new Map<string, typeof registrations>();
    for (const reg of registrations) {
      const key = reg.instituteId ?? '(sem instituto)';
      const group = byInstitute.get(key) ?? [];
      group.push(reg);
      byInstitute.set(key, group);
    }

    const harvestGroup = async (group: typeof registrations): Promise<void> => {
      for (const reg of group) {
        result.considered++;
        const hasResult = await this.hasCanonicalResult(reg.tseId);
        const lastAttemptIso = await this.lastAttemptAt(reg.tseId);
        const decision = decideHarvest({
          fieldEndIso: reg.fieldEnd,
          hasResult,
          lastAttemptIso,
          nowIso,
        });
        await this.applyDecision(reg, decision, resolveCandidate, nowIso, result, {
          exercised: adapterExercised,
          failed: adapterHadValidationFailure,
        });
      }
    };

    await Promise.all([...byInstitute.values()].map(harvestGroup));

    this.rollFailureCounters(adapterExercised, adapterHadValidationFailure, result);
    return result;
  }

  /**
   * Fecha o ciclo do contador de falhas por adapter (docs/04 §5): adapter com ao
   * menos uma falha de validação ⇒ incrementa a série consecutiva; adapter limpo
   * ⇒ zera. Cruzar o limiar (3 ciclos) emite `adapter_suspect_streak`.
   */
  private rollFailureCounters(
    exercised: ReadonlySet<string>,
    failed: ReadonlySet<string>,
    result: HarvestResult,
  ): void {
    for (const adapterId of exercised) {
      if (failed.has(adapterId)) {
        const streak = this.failureCounter.recordFailure(adapterId);
        if (this.failureCounter.shouldAlert(adapterId)) {
          result.alerts.push({
            kind: 'adapter_suspect_streak',
            tseId: '-',
            detail: `adapter ${adapterId} falhou validação em ${String(streak)} ciclos consecutivos`,
          });
        }
      } else {
        this.failureCounter.recordSuccess(adapterId);
      }
    }
  }

  private async applyDecision(
    reg: PollRegistration,
    decision: HarvestDecision,
    resolveCandidate: CandidateAliasResolver,
    nowIso: string,
    result: HarvestResult,
    cycle: CycleTracking,
  ): Promise<void> {
    if (decision.action === 'presume_undisclosed') {
      await this.markPresumedUndisclosed(reg.tseId);
      result.presumedUndisclosed++;
      return;
    }
    if (decision.action === 'skip') {
      return;
    }
    // action === 'attempt'
    const adapter = this.registry.resolve(reg);
    if (adapter === null) {
      result.alerts.push({
        kind: 'no_adapter',
        tseId: reg.tseId,
        detail: `sem adapter para instituto ${reg.instituteId ?? 'null'}`,
      });
      return;
    }
    result.attempted++;
    cycle.exercised.add(adapter.id);
    await this.attempt(reg, adapter, resolveCandidate, nowIso, result, cycle);
  }

  /**
   * Uma tentativa: percorre as URLs candidatas com conditional GET. 304 encerra o
   * ciclo daquela URL SEM parse. Corpo novo ⇒ salva raw + parse. Sucesso persiste
   * e transiciona para `disclosed` (para nesta URL). Erros são registrados e a
   * próxima URL é tentada.
   */
  private async attempt(
    reg: PollRegistration,
    adapter: PollSourceAdapter,
    resolveCandidate: CandidateAliasResolver,
    nowIso: string,
    result: HarvestResult,
    cycle: CycleTracking,
  ): Promise<void> {
    /**
     * `discover` PODE fazer rede. A maioria dos adapters só devolve URLs
     * derivadas, mas há fonte cujo slug é um título editorial e não dá para
     * derivar — nesse caso o adapter consulta a API da fonte aqui dentro. Sem este
     * try/catch, uma falha de transporte de UM instituto lançaria para fora do
     * loop de registros e abortaria o ciclo de TODOS: um site fora do ar levaria a
     * colheita inteira embora. O contêiner é aqui, no job, e não em relaxar o R4
     * dentro do adapter — que faz o certo ao lançar quando não sabe as candidatas
     * (devolver lista vazia ali seria afirmar "nada publicado", o zero silencioso).
     */
    let candidates;
    try {
      candidates = await adapter.discover(reg);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      result.alerts.push({
        kind: 'robots_or_http_error',
        tseId: reg.tseId,
        detail: `discover de ${adapter.id} falhou: ${detail}`,
      });
      return;
    }
    for (const candidate of candidates) {
      const prior = await this.conditionalStateFor(candidate.url);
      let res;
      try {
        res = await this.http.request({
          url: candidate.url,
          method: 'GET',
          etag: prior.etag,
          lastModified: prior.lastModified,
        });
      } catch (err) {
        result.alerts.push({
          kind: 'robots_or_http_error',
          tseId: reg.tseId,
          detail: `${candidate.url}: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }

      if (res.notModified) {
        // 304: nada mudou nesta URL. Encerra o ciclo desta URL sem parse.
        result.notModified++;
        continue;
      }

      // BYTES, não `res.body`: passar o texto decodificado aqui destruía todo PDF
      // (o RawStorage refazia Buffer.from(..., 'utf8') e as sequências inválidas
      // viravam U+FFFD). O sintoma era "PDF sem texto extraível" — arquivo
      // corrompido na entrada, não fonte rasterizada. Ver `FetchResponse.bytes`.
      const raw = await this.persistRaw(res.url, res.status, res.bytes, res.headers, nowIso);

      let parsed: ParsedPoll;
      try {
        parsed = await adapter.parse(raw, reg);
      } catch (err) {
        if (err instanceof UnknownCandidateError) {
          // Quarentena: NÃO persiste, NÃO cria candidato. Sinaliza revisão manual.
          result.quarantined++;
          result.alerts.push({
            kind: 'quarantine_unknown_candidate',
            tseId: reg.tseId,
            detail: err.alias,
          });
          return;
        }
        if (err instanceof ParseError) {
          result.alerts.push({ kind: 'parse_error', tseId: reg.tseId, detail: err.message });
          continue;
        }
        throw err;
      }

      // Validação bloqueante (docs/04 §5) ENTRE parse e persistência: se qualquer
      // regra V1–V7 falhar, NADA é persistido (roda antes de todo INSERT), o
      // evento é logado em `error` e o adapter é marcado suspeito (R4). Não é
      // warning: bloqueia esta URL e segue para a próxima candidata.
      try {
        const context = await this.buildValidationContext(reg, parsed, resolveCandidate);
        validateParsedPoll({ parsed, expectedTseId: reg.tseId, context });
      } catch (err) {
        if (err instanceof ValidationError) {
          result.validationFailed++;
          cycle.failed.add(adapter.id);
          console.error(`[harvest][validation] adapter=${adapter.id} ${err.message}`);
          result.alerts.push({
            kind: 'validation_failed',
            tseId: reg.tseId,
            detail: `${err.rule}: ${err.message}`,
          });
          continue; // não persiste; tenta a próxima URL candidata
        }
        throw err;
      }

      // FAIL-SAFE (R5/R4): só chegamos aqui com dado NOVO, parseado e validado EM
      // MÃOS. Antes de gravar, reafirmamos que não há divulgação anterior para este
      // registro. `run()` já garante isso pelo gate de elegibilidade
      // (`hasCanonicalResult` ⇒ `decideHarvest` devolve `skip`), mas repetimos a
      // checagem à beira do INSERT: se por qualquer caminho (estado inconsistente,
      // corrida, evolução futura do código) um registro com resultados fosse
      // reprocessado, NUNCA sobrepomos nem apagamos o que já existe — a colheita é
      // append-only e a correção de uma divulgação é um passo deliberado à parte,
      // não um efeito colateral de um novo ciclo de harvest.
      if (await this.hasCanonicalResult(reg.tseId)) {
        result.alerts.push({
          kind: 'validation_failed',
          tseId: reg.tseId,
          detail:
            'registro já possui cenários persistidos; harvest não sobrepõe divulgação existente (R5)',
        });
        return;
      }

      // Persistência ATÔMICA: os cenários, os resultados e a transição para
      // `disclosed` entram na MESMA transação. Uma falha no meio (ex.: colisão de
      // cenário) faz rollback — o registro segue `pending`, SEM pesquisa
      // meio-escrita e SEM tocar em dado anterior. Só há efeito visível após o
      // COMMIT, quando a divulgação nova está inteira e validada.
      await this.withTransaction(async (tx) => {
        await this.persistParsed(parsed, raw, resolveCandidate, nowIso, tx);
        await this.markDisclosed(reg.tseId, tx);
      });
      result.disclosed++;
      return; // resultado obtido; não busca as outras URLs candidatas
    }
  }

  // --- contexto de validação (V4/V5) ----------------------------------------

  /**
   * Monta o contexto que V4/V5 exigem (docs/04 §5). V4 compara com a rodada
   * ANTERIOR do mesmo instituto: carrega os resultados canônicos do registro mais
   * recente do instituto (exceto o corrente) e devolve um mapa keyed pelo MESMO
   * alias do documento corrente — resolvendo cada alias do poll a `candidate_id` e
   * cruzando com o valor anterior daquele id. `manuallyApproved` vem de
   * `manual_approvals` (pula V4/V5). V5 (μ_t) não é carregado aqui: a série latente
   * é do modelo, fora do caminho de colheita — o orquestrador que a injeta.
   */
  private async buildValidationContext(
    reg: PollRegistration,
    parsed: ParsedPoll,
    resolveCandidate: CandidateAliasResolver,
  ): Promise<ValidationContext> {
    const manuallyApproved = await this.isManuallyApproved(reg.tseId);
    const previousRound = await this.loadPreviousRound(reg, parsed, resolveCandidate);
    const currentLatent = this.projectLatentToAliases(parsed, resolveCandidate);
    return {
      manuallyApproved,
      ...(previousRound === undefined ? {} : { previousRound }),
      ...(currentLatent === undefined ? {} : { currentLatent }),
    };
  }

  /**
   * Reprojeta a série latente μ_t (por candidate_id) para os aliases do documento
   * corrente — a unidade que V5 compara (docs/04 §5, context.ts). Só entram os
   * candidatos que aparecem no poll corrente e têm μ_t. Modelo frio (mapa vazio) ⇒
   * `undefined`, e V5 não dispara.
   */
  private projectLatentToAliases(
    parsed: ParsedPoll,
    resolveCandidate: CandidateAliasResolver,
  ): ReadonlyMap<string, number> | undefined {
    if (this.currentLatent.size === 0) return undefined;
    const byAlias = new Map<string, number>();
    for (const scenario of parsed.scenarios) {
      for (const value of scenario.values) {
        const candidateId = resolveCandidate(value.candidateAlias);
        if (candidateId === null) continue;
        const mu = this.currentLatent.get(candidateId);
        if (mu !== undefined) byAlias.set(value.candidateAlias, mu);
      }
    }
    return byAlias.size === 0 ? undefined : byAlias;
  }

  private async isManuallyApproved(tseId: string): Promise<boolean> {
    const rows = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM manual_approvals WHERE tse_id = $1`,
      [tseId],
    );
    const first = rows[0];
    return first !== undefined && first.n !== '0';
  }

  /**
   * Valores por alias na rodada anterior do MESMO instituto. Anterior = o registro
   * do instituto com `field_end` mais recente ANTES do corrente que já tenha
   * cenário canônico persistido. Sem instituto resolvido, ou sem rodada anterior,
   * devolve `undefined` (V4 não dispara — não há baseline).
   */
  private async loadPreviousRound(
    reg: PollRegistration,
    parsed: ParsedPoll,
    resolveCandidate: CandidateAliasResolver,
  ): Promise<ReadonlyMap<string, number> | undefined> {
    if (reg.instituteId === null) return undefined;

    const rows = await this.db.query<{ candidate_id: string; value_pct: number }>(
      `SELECT pr.candidate_id, pr.value_pct
         FROM poll_results pr
         JOIN poll_scenarios ps ON ps.id = pr.scenario_id
         JOIN poll_registrations reg ON reg.tse_id = ps.tse_id
        WHERE reg.institute_id = $1
          AND ps.tse_id <> $2
          AND ps.is_canonical
          AND reg.field_end = (
            SELECT max(reg2.field_end)
              FROM poll_registrations reg2
              JOIN poll_scenarios ps2 ON ps2.tse_id = reg2.tse_id AND ps2.is_canonical
             WHERE reg2.institute_id = $1
               AND reg2.tse_id <> $2
               AND reg2.field_end <= $3::date
          )`,
      [reg.instituteId, reg.tseId, reg.fieldEnd],
    );
    if (rows.length === 0) return undefined;

    const byCandidateId = new Map<string, number>(rows.map((r) => [r.candidate_id, r.value_pct]));
    // Reprojeta para alias do documento corrente: só entram os candidatos que
    // aparecem no poll corrente (são os que V4 compara).
    const byAlias = new Map<string, number>();
    for (const scenario of parsed.scenarios) {
      for (const value of scenario.values) {
        const candidateId = resolveCandidate(value.candidateAlias);
        if (candidateId === null) continue; // parse já garante resolução; defensivo
        const previous = byCandidateId.get(candidateId);
        if (previous !== undefined) byAlias.set(value.candidateAlias, previous);
      }
    }
    return byAlias.size === 0 ? undefined : byAlias;
  }

  // --- persistência ---------------------------------------------------------

  private async persistRaw(
    url: string,
    status: number,
    /** BYTES do corpo. `Uint8Array` de propósito: texto aqui corrompe binário. */
    body: Uint8Array,
    headers: Headers,
    nowIso: string,
  ): Promise<RawDocument> {
    const contentType = contentTypeOf(headers);
    const { contentHash, storagePath } = await this.storage.store(body, contentType);
    const raw: RawDocument = rawDocumentSchema.parse({
      id: randomUUID(),
      url,
      fetchedAt: nowIso,
      httpStatus: status,
      contentType,
      contentHash,
      storagePath,
      etag: headers.get('etag'),
      lastModified: headers.get('last-modified'),
    });
    await new RawDocumentsRepository(this.db).insert(raw);
    return raw;
  }

  /**
   * Persiste o `ParsedPoll` como `poll_scenarios` + `poll_results` (append-only,
   * R5). Resolve aliases → `candidate_id` (o parse já garantiu que todos resolvem).
   * Os cenários entram como NÃO canônicos: a seleção do canônico (docs/01 §3) é de
   * um passo posterior (T-07/modelo) — o harvest só materializa o extraído.
   */
  private async persistParsed(
    parsed: ParsedPoll,
    raw: RawDocument,
    resolveCandidate: CandidateAliasResolver,
    nowIso: string,
    tx: Database,
  ): Promise<void> {
    // Revalida a fronteira (defesa em profundidade; o adapter já validou).
    const poll = parsedPollSchema.parse(parsed);
    const repo = new PollScenariosRepository(tx);

    for (const scenario of poll.scenarios) {
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
        tseId: poll.tseId,
        rawDocumentId: raw.id,
        kind: scenario.kind,
        label: scenario.label,
        isCanonical: false,
        canonicalReason: null,
        t2Pair,
        blankNullPct: scenario.blankNullPct ?? null,
        undecidedPct: scenario.undecidedPct ?? null,
        extractedAt: nowIso,
      });

      const results: PollResult[] = scenario.values.map((value) =>
        pollResultSchema.parse({
          scenarioId,
          candidateId: resolveOrThrow(resolveCandidate, value.candidateAlias),
          valuePct: value.valuePct,
        }),
      );

      await repo.insertScenario(scenarioRow);
      await repo.insertResults(results);
    }
  }

  // --- estado (queries próprias; só LEIO a camada db, não a modifico) --------

  /** Carrega os aliases de candidato uma vez e devolve um resolver em memória. */
  private async loadCandidateResolver(): Promise<CandidateAliasResolver> {
    const rows = await this.db.query<{ alias: string; candidate_id: string }>(
      `SELECT alias, candidate_id FROM candidate_aliases`,
    );
    const map = new Map<string, string>(rows.map((r) => [r.alias, r.candidate_id]));
    return resolverFromMap(map);
  }

  /**
   * Registros candidatos à colheita: campo encerrado (`field_end <= now`) e ainda
   * não `disclosed` nem `presumed_undisclosed`. A decisão fina (janela/backoff) é
   * do `decideHarvest`; aqui só reduzimos o conjunto para não varrer o banco todo.
   */
  private async loadEligibleRegistrations(): Promise<PollRegistration[]> {
    const rows = await this.db.query<PollRegistrationRow>(
      `SELECT tse_id, race_id, institute_id, institute_raw_name, contractor_name,
              contractor_type, registered_at, field_start, field_end, sample_size,
              margin_of_error, confidence_level, cost_brl, first_seen_at,
              source_expired_at, disclosure_status
         FROM poll_registrations
        WHERE disclosure_status = $1
          AND field_end <= (now() AT TIME ZONE 'America/Sao_Paulo')::date
        ORDER BY field_end ASC`,
      [DISCLOSURE_STATUS.pending],
    );
    return rows.map(mapRegistration);
  }

  private async hasCanonicalResult(tseId: string): Promise<boolean> {
    const rows = await this.db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM poll_scenarios WHERE tse_id = $1`,
      [tseId],
    );
    const first = rows[0];
    return first !== undefined && first.n !== '0';
  }

  /**
   * Última tentativa para o registro, aproximada pelo `fetched_at` mais recente
   * dos `raw_documents` das URLs candidatas do registro. Sem tabela dedicada de
   * tentativas (T-02 não a criou), este é o melhor proxy: só gravamos raw quando
   * de fato buscamos. Null se nunca houve raw.
   */
  private async lastAttemptAt(tseId: string): Promise<string | null> {
    const rows = await this.db.query<{ fetched_at: string }>(
      `SELECT rd.fetched_at
         FROM raw_documents rd
         JOIN poll_scenarios ps ON ps.raw_document_id = rd.id
        WHERE ps.tse_id = $1
        ORDER BY rd.fetched_at DESC
        LIMIT 1`,
      [tseId],
    );
    return rows[0]?.fetched_at ?? null;
  }

  /** Estado de conditional GET: etag/last_modified do raw mais recente da URL. */
  private async conditionalStateFor(url: string): Promise<ConditionalState> {
    const rows = await this.db.query<{ etag: string | null; last_modified: string | null }>(
      `SELECT etag, last_modified
         FROM raw_documents
        WHERE url = $1
        ORDER BY fetched_at DESC
        LIMIT 1`,
      [url],
    );
    const row = rows[0];
    return { etag: row?.etag ?? null, lastModified: row?.last_modified ?? null };
  }

  private async markDisclosed(tseId: string, db: Database = this.db): Promise<void> {
    await db.query(`UPDATE poll_registrations SET disclosure_status = $1 WHERE tse_id = $2`, [
      DISCLOSURE_STATUS.disclosed,
      tseId,
    ]);
  }

  private async markPresumedUndisclosed(tseId: string): Promise<void> {
    await this.db.query(`UPDATE poll_registrations SET disclosure_status = $1 WHERE tse_id = $2`, [
      DISCLOSURE_STATUS.presumedUndisclosed,
      tseId,
    ]);
  }
}

const resolveOrThrow = (resolver: CandidateAliasResolver, alias: string): string => {
  const id = resolver(alias);
  if (id === null) {
    // O parse do adapter já garante que todo alias resolve; se chegou aqui sem
    // resolver, é inconsistência entre o resolver do adapter e o do job — falha
    // alta (R4), nunca persiste candidato inventado.
    throw new UnknownCandidateError(alias);
  }
  return id;
};

interface PollRegistrationRow {
  tse_id: string;
  race_id: string;
  institute_id: string | null;
  institute_raw_name: string;
  contractor_name: string;
  contractor_type: string | null;
  registered_at: string;
  field_start: string;
  field_end: string;
  sample_size: number;
  margin_of_error: number | null;
  confidence_level: number | null;
  cost_brl: number | null;
  first_seen_at: string;
  source_expired_at: string | null;
  disclosure_status: string;
}

const mapRegistration = (row: PollRegistrationRow): PollRegistration =>
  pollRegistrationSchema.parse({
    tseId: row.tse_id,
    raceId: row.race_id,
    instituteId: row.institute_id,
    instituteRawName: row.institute_raw_name,
    contractorName: row.contractor_name,
    contractorType: row.contractor_type,
    registeredAt: row.registered_at,
    fieldStart: row.field_start,
    fieldEnd: row.field_end,
    sampleSize: row.sample_size,
    marginOfError: row.margin_of_error,
    confidenceLevel: row.confidence_level,
    costBrl: row.cost_brl,
    firstSeenAt: row.first_seen_at,
    sourceExpiredAt: row.source_expired_at,
    disclosureStatus: row.disclosure_status,
  });
