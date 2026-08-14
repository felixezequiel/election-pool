import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpClient } from '@election-pool/adapters/http-client';
import type { FetchLike, HttpClientClock } from '@election-pool/adapters/http-client';
import { RobotsCache } from '@election-pool/adapters/robots';
import { PerHostRateLimiter } from '@election-pool/adapters/rate-limiter';
import { RawStorage } from '@election-pool/adapters/base/raw-storage';
import { makeTestDatabase, truncateData } from '../db/test-helpers.js';
import { seed } from '../db/seed.js';
import { HarvestJob } from './harvest.job.js';
import { loadCandidateResolver, buildRegistry } from './build-registry.js';

/**
 * Testes de integração REAIS do HarvestJob contra o Postgres do docker-compose.
 * Cobrem o aceite de T-06: colheita de fixture (persiste cenários/resultados +
 * disclosed), V6 (tse_id errado não persiste), 304 encerra sem parse, quarentena
 * de alias desconhecido, e transição para presumed_undisclosed após 15 dias.
 *
 * O HTTP é um `HttpClient` real com `fetchImpl` injetado (fixtures, sem rede),
 * robots allow-all e rate limiter sem espera.
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

const makeHttp = (
  handler: (url: string, etag: string | undefined) => ReturnType<FetchLike>,
): HttpClient =>
  new HttpClient({
    fetchImpl: (url, init) => handler(url, init.headers['If-None-Match']),
    robots: allowAllRobots(),
    rateLimiter: noWaitLimiter(),
    clock: noWaitClock(),
  });

const htmlResponse = (body: string, headers: Record<string, string> = {}): ReturnType<FetchLike> =>
  Promise.resolve({
    status: 200,
    headers: new Headers({ 'content-type': 'text/html', ...headers }),
    url: 'https://nexus.fsb.com.br/estudos-divulgados',
    text: () => Promise.resolve(body),
  });

const tempStorage = (): RawStorage => new RawStorage(mkdtempSync(join(tmpdir(), 'ep-harvest-')));

/** Insere os institutos/aliases que os adapters da v1 exigem (não estão no seed). */
const seedAdapterInstitutes = async (): Promise<void> => {
  await db.query(
    `INSERT INTO institutes (id, display_name, legal_name, cnpj, primary_method, site_url)
     VALUES ('nexus','Nexus/FSB',NULL,NULL,'telefone',NULL),
            ('mda','CNT/MDA',NULL,NULL,'presencial',NULL)
     ON CONFLICT (id) DO NOTHING`,
  );
};

/** Insere um registro de pesquisa elegível (campo encerrado há `daysAgo` dias). */
const insertRegistration = async (
  tseId: string,
  instituteId: string,
  fieldEndDaysAgo: number,
): Promise<void> => {
  const fieldEnd = new Date(Date.now() - fieldEndDaysAgo * 24 * 60 * 60 * 1000);
  const isoDate = fieldEnd.toISOString().slice(0, 10);
  await db.query(
    `INSERT INTO poll_registrations
       (tse_id, race_id, institute_id, institute_raw_name, contractor_name, contractor_type,
        registered_at, field_start, field_end, sample_size, disclosure_status)
     VALUES ($1,'presidencia-2026',$2,$3,'Contratante','veiculo',
             now(), $4::date - 3, $4::date, 2000, 'pending')`,
    [tseId, instituteId, instituteId, isoDate],
  );
};

const disclosureOf = async (tseId: string): Promise<string> => {
  const rows = await db.query<{ disclosure_status: string }>(
    `SELECT disclosure_status FROM poll_registrations WHERE tse_id = $1`,
    [tseId],
  );
  return rows[0]!.disclosure_status;
};

const scenarioCount = async (tseId: string): Promise<number> => {
  const rows = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM poll_scenarios WHERE tse_id = $1`,
    [tseId],
  );
  return Number(rows[0]!.n);
};

const makeJob = async (http: HttpClient, storage: RawStorage): Promise<HarvestJob> => {
  const resolveCandidate = await loadCandidateResolver(db);
  const registry = buildRegistry(resolveCandidate, storage);
  return new HarvestJob({ db, http, registry, storage });
};

describe('HarvestJob (integration)', () => {
  beforeAll(async () => {
    await seed(db);
    await seedAdapterInstitutes();
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateData(db);
    await seedAdapterInstitutes();
  });

  it('harvests a nexus fixture: persists scenarios/results and marks disclosed', async () => {
    await insertRegistration('BR-06591/2026', 'nexus', 1);
    const storage = tempStorage();
    const http = makeHttp(() => htmlResponse(nexusFixture('round.html')));

    const job = await makeJob(http, storage);
    const result = await job.run();

    expect(result.disclosed).toBe(1);
    expect(await disclosureOf('BR-06591/2026')).toBe('disclosed');
    // 2 cenários (t1 estimulado + t2)
    expect(await scenarioCount('BR-06591/2026')).toBe(2);

    // valores do 1º turno persistidos com os candidate_id resolvidos
    const results = await db.query<{ candidate_id: string; value_pct: number }>(
      `SELECT pr.candidate_id, pr.value_pct
         FROM poll_results pr
         JOIN poll_scenarios ps ON ps.id = pr.scenario_id
        WHERE ps.tse_id = $1 AND ps.kind = 't1_estimulado'
        ORDER BY pr.candidate_id`,
      ['BR-06591/2026'],
    );
    const byId = new Map(results.map((r) => [r.candidate_id, r.value_pct]));
    expect(byId.get('lula')).toBe(38.8);
    expect(byId.get('tarcisio')).toBe(29.1);
    // candidato ausente do cenário NÃO virou 0: nem sequer tem linha
    expect(byId.has('zema')).toBe(false);
  });

  it('V6: a document whose tse_id belongs to another round is NOT persisted', async () => {
    // registro 06591, mas o documento carrega BR-07777 (outra rodada)
    await insertRegistration('BR-06591/2026', 'nexus', 1);
    const storage = tempStorage();
    const http = makeHttp(() => htmlResponse(nexusFixture('wrong-tse-id.html')));

    const job = await makeJob(http, storage);
    const result = await job.run();

    expect(result.disclosed).toBe(0);
    expect(await scenarioCount('BR-06591/2026')).toBe(0);
    expect(await disclosureOf('BR-06591/2026')).toBe('pending');
    expect(result.alerts.some((a) => a.kind === 'parse_error')).toBe(true);
  });

  it('304 Not Modified ends the cycle without parse (nothing persisted)', async () => {
    await insertRegistration('BR-06591/2026', 'nexus', 1);
    // Primeiro salva um raw com etag, para o conditional GET reenviar If-None-Match.
    const storage = tempStorage();
    const store = await storage.store(nexusFixture('round.html'), 'text/html');
    await db.query(
      `INSERT INTO raw_documents (id, url, fetched_at, http_status, content_type, content_hash, storage_path, etag, last_modified)
       VALUES (gen_random_uuid(), 'https://nexus.fsb.com.br/estudos-divulgados', now(), 200, 'text/html', $1, $2, 'W/"v1"', NULL)`,
      [store.contentHash, store.storagePath],
    );

    const http = makeHttp((_url, etag) => {
      // O cliente reenviou o etag salvo ⇒ servidor responde 304.
      expect(etag).toBe('W/"v1"');
      return Promise.resolve({
        status: 304,
        headers: new Headers(),
        url: 'https://nexus.fsb.com.br/estudos-divulgados',
        text: () => Promise.resolve(''),
      });
    });

    const job = await makeJob(http, storage);
    const result = await job.run();

    expect(result.notModified).toBe(1);
    expect(result.disclosed).toBe(0);
    expect(await scenarioCount('BR-06591/2026')).toBe(0);
    expect(await disclosureOf('BR-06591/2026')).toBe('pending');
  });

  it('unknown candidate alias quarantines (no persistence, no auto-create)', async () => {
    await insertRegistration('BR-06591/2026', 'nexus', 1);
    const storage = tempStorage();
    const http = makeHttp(() => htmlResponse(nexusFixture('unknown-candidate.html')));

    const job = await makeJob(http, storage);
    const result = await job.run();

    expect(result.quarantined).toBe(1);
    expect(result.disclosed).toBe(0);
    expect(await scenarioCount('BR-06591/2026')).toBe(0);
    expect(await disclosureOf('BR-06591/2026')).toBe('pending');
    // nenhum candidato novo criado
    const cand = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM candidates WHERE id = 'candidato-fantasma'`,
    );
    expect(cand[0]!.n).toBe('0');
  });

  it('after 15 days without a result, transitions to presumed_undisclosed and stops', async () => {
    await insertRegistration('BR-09912/2026', 'mda', 16); // 16 dias atrás
    const storage = tempStorage();
    let fetched = false;
    const http = makeHttp(() => {
      fetched = true;
      return htmlResponse('should not be fetched');
    });

    const job = await makeJob(http, storage);
    const result = await job.run();

    expect(result.presumedUndisclosed).toBe(1);
    expect(result.attempted).toBe(0);
    expect(fetched).toBe(false); // parou, não buscou
    expect(await disclosureOf('BR-09912/2026')).toBe('presumed_undisclosed');
  });
});
