import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpClient } from '@election-pool/adapters/http-client';
import type { FetchLike, HttpClientClock } from '@election-pool/adapters/http-client';
import { RobotsCache } from '@election-pool/adapters/robots';
import { PerHostRateLimiter } from '@election-pool/adapters/rate-limiter';
import { RawStorage } from '@election-pool/adapters/base/raw-storage';
import { AdapterFailureCounter } from '@election-pool/adapters/validation/failure-counter';
import { makeTestDatabase, truncateData } from '../db/test-helpers.js';
import { seed } from '../db/seed.js';
import { HarvestJob } from './harvest.job.js';
import { loadCandidateResolver, buildRegistry } from './build-registry.js';

/**
 * Integração REAL da validação bloqueante (T-07, docs/04 §5) dentro do HarvestJob,
 * contra o Postgres do docker-compose. Prova o aceite:
 * - falha de validação (V1 fora de banda) ⇒ NENHUMA linha órfã em poll_scenarios,
 *   registro segue `pending`, alerta `validation_failed`;
 * - 3 ciclos consecutivos com falha ⇒ alerta `adapter_suspect_streak`;
 * - um ciclo limpo zera o contador.
 */

const nexusFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../../packages/adapters/nexus/__fixtures__/${name}`, import.meta.url),
    ),
    'utf8',
  );

const { db } = makeTestDatabase();

const noWaitClock = (): HttpClientClock => ({
  now: () => 0,
  sleep: () => Promise.resolve(),
  random: () => 0,
});
const allowAllRobots = (): RobotsCache =>
  new RobotsCache(() => Promise.resolve({ status: 404, body: '' }));
const noWaitLimiter = (): PerHostRateLimiter =>
  new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() });

const makeHttp = (body: string): HttpClient =>
  new HttpClient({
    fetchImpl: () =>
      Promise.resolve({
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        url: 'https://nexus.fsb.com.br/estudos-divulgados',
        text: () => Promise.resolve(body),
      }) as ReturnType<FetchLike>,
    robots: allowAllRobots(),
    rateLimiter: noWaitLimiter(),
    clock: noWaitClock(),
  });

const tempStorage = (): RawStorage =>
  new RawStorage(mkdtempSync(join(tmpdir(), 'ep-harvest-val-')));

const seedNexus = async (): Promise<void> => {
  await db.query(
    `INSERT INTO institutes (id, display_name, legal_name, cnpj, primary_method, site_url)
     VALUES ('nexus','Nexus/FSB',NULL,NULL,'telefone',NULL)
     ON CONFLICT (id) DO NOTHING`,
  );
};

const insertRegistration = async (tseId: string): Promise<void> => {
  const fieldEnd = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO poll_registrations
       (tse_id, race_id, institute_id, institute_raw_name, contractor_name, contractor_type,
        registered_at, field_start, field_end, sample_size, disclosure_status)
     VALUES ($1,'presidencia-2026','nexus','Nexus','Contratante','veiculo',
             now(), $2::date - 3, $2::date, 2000, 'pending')`,
    [tseId, fieldEnd],
  );
};

const scenarioCount = async (tseId: string): Promise<number> => {
  const rows = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM poll_scenarios WHERE tse_id = $1`,
    [tseId],
  );
  return Number(rows[0]!.n);
};

const resultCount = async (tseId: string): Promise<number> => {
  const rows = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM poll_results pr JOIN poll_scenarios ps ON ps.id = pr.scenario_id
      WHERE ps.tse_id = $1`,
    [tseId],
  );
  return Number(rows[0]!.n);
};

const disclosureOf = async (tseId: string): Promise<string> => {
  const rows = await db.query<{ disclosure_status: string }>(
    `SELECT disclosure_status FROM poll_registrations WHERE tse_id = $1`,
    [tseId],
  );
  return rows[0]!.disclosure_status;
};

/** Reescreve o tse_id impresso no documento (para reusar a fixture noutra rodada). */
const rewriteTseId = (body: string, tseId: string): string => body.replace('BR-06591/2026', tseId);

/** Promove os cenários já persistidos de um tse_id a canônicos (para V4 os enxergar). */
const markCanonical = async (tseId: string): Promise<void> => {
  await db.query(
    `UPDATE poll_scenarios SET is_canonical = true, canonical_reason = 'teste'
      WHERE tse_id = $1 AND kind = 't1_estimulado'`,
    [tseId],
  );
};

const makeJob = async (
  http: HttpClient,
  storage: RawStorage,
  failureCounter?: AdapterFailureCounter,
): Promise<HarvestJob> => {
  const resolveCandidate = await loadCandidateResolver(db);
  const registry = buildRegistry(resolveCandidate, storage);
  return new HarvestJob({
    db,
    http,
    registry,
    storage,
    ...(failureCounter === undefined ? {} : { failureCounter }),
  });
};

describe('HarvestJob — validação bloqueante (integração)', () => {
  beforeAll(async () => {
    await seed(db);
    await seedNexus();
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateData(db);
    await seedNexus();
  });

  it('V1 fora de banda: NADA persiste, sem linha órfã, registro segue pending, alerta', async () => {
    await insertRegistration('BR-06591/2026');
    const job = await makeJob(makeHttp(nexusFixture('bad-sum.html')), tempStorage());

    const result = await job.run();

    expect(result.disclosed).toBe(0);
    expect(result.validationFailed).toBe(1);
    // integridade: nenhum cenário e nenhum resultado órfão
    expect(await scenarioCount('BR-06591/2026')).toBe(0);
    expect(await resultCount('BR-06591/2026')).toBe(0);
    expect(await disclosureOf('BR-06591/2026')).toBe('pending');
    const alert = result.alerts.find((a) => a.kind === 'validation_failed');
    expect(alert).toBeDefined();
    expect(alert!.tseId).toBe('BR-06591/2026');
    expect(alert!.detail).toContain('V1');
    expect(alert!.detail).toContain('BR-06591/2026');
  });

  it('V4: salto > 10 p.p. vs. rodada anterior do instituto bloqueia; aprovação manual libera', async () => {
    // Rodada ANTERIOR do mesmo instituto, canônica: Lula em 38.8 (round.html).
    await insertRegistration('BR-05000/2026');
    const priorJob = await makeJob(
      makeHttp(rewriteTseId(nexusFixture('round.html'), 'BR-05000/2026')),
      tempStorage(),
    );
    await priorJob.run();
    await markCanonical('BR-05000/2026');

    // Rodada CORRENTE: Lula salta para 58.8 (Δ=20 p.p. > 10). O documento carrega
    // esse tse_id e uma soma válida (fixture dedicada).
    await insertRegistration('BR-06591/2026');
    const currentBody = rewriteTseId(nexusFixture('big-jump.html'), 'BR-06591/2026');

    const blockedJob = await makeJob(makeHttp(currentBody), tempStorage());
    const blocked = await blockedJob.run();
    expect(blocked.validationFailed).toBe(1);
    expect(
      blocked.alerts.some((a) => a.kind === 'validation_failed' && a.detail.includes('V4')),
    ).toBe(true);
    expect(await scenarioCount('BR-06591/2026')).toBe(0);

    // Aprovação manual registrada ⇒ V4/V5 pulados; o mesmo poll agora persiste.
    await db.query(`INSERT INTO manual_approvals (tse_id, reason) VALUES ($1, $2)`, [
      'BR-06591/2026',
      'Movimento real: candidato adversário desistiu',
    ]);
    const approvedJob = await makeJob(makeHttp(currentBody), tempStorage());
    const approved = await approvedJob.run();
    expect(approved.validationFailed).toBe(0);
    expect(approved.disclosed).toBe(1);
    expect(await scenarioCount('BR-06591/2026')).toBeGreaterThan(0);
  });

  it('poll válido persiste normalmente (a validação não bloqueia o caminho feliz)', async () => {
    await insertRegistration('BR-06591/2026');
    const job = await makeJob(makeHttp(nexusFixture('round.html')), tempStorage());

    const result = await job.run();

    expect(result.disclosed).toBe(1);
    expect(result.validationFailed).toBe(0);
    expect(await scenarioCount('BR-06591/2026')).toBe(2);
    expect(await disclosureOf('BR-06591/2026')).toBe('disclosed');
  });

  it('3 ciclos consecutivos com falha ⇒ alerta adapter_suspect_streak; ciclo limpo zera', async () => {
    const counter = new AdapterFailureCounter();
    const badHttp = makeHttp(nexusFixture('bad-sum.html'));

    // Ciclo 1 e 2: falham, ainda sem streak-alert.
    for (const cycle of [1, 2]) {
      await truncateData(db);
      await seedNexus();
      await insertRegistration('BR-06591/2026');
      const job = await makeJob(badHttp, tempStorage(), counter);
      const result = await job.run();
      expect(result.alerts.some((a) => a.kind === 'adapter_suspect_streak')).toBe(false);
      void cycle;
    }

    // Ciclo 3: cruza o limiar.
    await truncateData(db);
    await seedNexus();
    await insertRegistration('BR-06591/2026');
    const streakJob = await makeJob(badHttp, tempStorage(), counter);
    const streakResult = await streakJob.run();
    const streakAlert = streakResult.alerts.find((a) => a.kind === 'adapter_suspect_streak');
    expect(streakAlert).toBeDefined();
    expect(streakAlert!.detail).toContain('nexus');

    // Ciclo limpo: o mesmo tse_id que a fixture carrega, agora com poll válido —
    // persiste e zera o contador consecutivo do adapter.
    await truncateData(db);
    await seedNexus();
    await insertRegistration('BR-06591/2026');
    const goodJob = await makeJob(makeHttp(nexusFixture('round.html')), tempStorage(), counter);
    const goodResult = await goodJob.run();
    expect(goodResult.disclosed).toBe(1);
    expect(counter.count('nexus')).toBe(0);
  });
});
