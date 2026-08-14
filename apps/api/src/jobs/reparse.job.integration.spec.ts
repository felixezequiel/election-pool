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
import { makeTestDatabase, truncateData } from '../db/test-helpers.js';
import { seed } from '../db/seed.js';
import { HarvestJob } from './harvest.job.js';
import { ReparseJob } from './reparse.job.js';
import { loadCandidateResolver, buildRegistry } from './build-registry.js';

/**
 * Aceite T-06: `reparse` produz resultado IDÊNTICO ao parse original sobre o mesmo
 * raw (docs/04 §7). Estratégia: harvest de uma fixture persiste os cenários; o
 * reparse do MESMO raw, com o mesmo parser, não muda nada — tudo `unchanged`, zero
 * inserção, zero `needs_supersede`. Sem rede (o reparse lê o raw do disco).
 */

const { db } = makeTestDatabase();

const nexusFixture = (name: string): string =>
  readFileSync(
    fileURLToPath(
      new URL(`../../../../packages/adapters/nexus/__fixtures__/${name}`, import.meta.url),
    ),
    'utf8',
  );

const noWaitClock = (): HttpClientClock => ({
  now: () => 0,
  sleep: () => Promise.resolve(),
  random: () => 0,
});
const http = new HttpClient({
  fetchImpl: (() =>
    Promise.resolve({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      url: 'https://nexus.fsb.com.br/estudos-divulgados',
      text: () => Promise.resolve(nexusFixture('round.html')),
    })) as FetchLike,
  robots: new RobotsCache(() => Promise.resolve({ status: 404, body: '' })),
  rateLimiter: new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() }),
  clock: noWaitClock(),
});

const storage = new RawStorage(mkdtempSync(join(tmpdir(), 'ep-reparse-')));

const seedAdapterInstitutes = async (): Promise<void> => {
  await db.query(
    `INSERT INTO institutes (id, display_name, legal_name, cnpj, primary_method, site_url)
     VALUES ('nexus','Nexus/FSB',NULL,NULL,'telefone',NULL)
     ON CONFLICT (id) DO NOTHING`,
  );
};

describe('ReparseJob (integration)', () => {
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

  it('reparse over the same raw is identical: everything unchanged, nothing inserted or superseded', async () => {
    await db.query(
      `INSERT INTO poll_registrations
         (tse_id, race_id, institute_id, institute_raw_name, contractor_name, contractor_type,
          registered_at, field_start, field_end, sample_size, disclosure_status)
       VALUES ('BR-06591/2026','presidencia-2026','nexus','Nexus','C','veiculo',
               now(), (now()::date - 3), (now()::date - 1), 2000, 'pending')`,
    );

    const resolveCandidate = await loadCandidateResolver(db);
    const registry = buildRegistry(resolveCandidate, storage);
    const harvest = new HarvestJob({ db, http, registry, storage });
    const harvestResult = await harvest.run();
    expect(harvestResult.disclosed).toBe(1);

    const scenariosBefore = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM poll_scenarios WHERE tse_id = 'BR-06591/2026'`,
    );
    const resultsBefore = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM poll_results`,
    );

    // Reparse do MESMO raw com o adapter nexus.
    const adapter = registry.byId('nexus');
    expect(adapter).not.toBeNull();
    const reparse = new ReparseJob({ db, adapter: adapter! });
    const rr = await reparse.run({ adapterId: 'nexus', sinceIso: '2000-01-01' });

    expect(rr.rawsConsidered).toBe(1);
    expect(rr.scenariosInserted).toBe(0);
    expect(rr.scenariosNeedingSupersede).toBe(0);
    expect(rr.scenariosUnchanged).toBe(2); // t1 + t2, idênticos
    expect(rr.alerts).toEqual([]);

    // Nada foi inserido nem removido: idempotente e sem violar append-only.
    const scenariosAfter = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM poll_scenarios WHERE tse_id = 'BR-06591/2026'`,
    );
    const resultsAfter = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM poll_results`,
    );
    expect(scenariosAfter[0]!.n).toBe(scenariosBefore[0]!.n);
    expect(resultsAfter[0]!.n).toBe(resultsBefore[0]!.n);
  });
});
