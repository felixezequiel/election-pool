import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { RawRegistration } from '@election-pool/adapters/pesqele/registration';
import type {
  DiscoverOptions,
  PesqEleAlert,
  PesqEleClient,
  PesqEleSweepStats,
} from '@election-pool/adapters/pesqele/client';
import { makeTestDatabase, truncateData } from '../db/test-helpers.js';
import { seed } from '../db/seed.js';
import { DiscoveryJob, makePoolTransaction } from './discovery.job.js';

/**
 * Testes de integração REAIS do DiscoveryJob contra o Postgres do docker-compose.
 * Cobrem o aceite de T-05: idempotência, `source_expired_at` de registro ausente,
 * contratante sem match ⇒ `desconhecido`, instituto desconhecido ⇒ null+alerta,
 * e transação por página (falha de rede não corrompe estado).
 *
 * O `PesqEleClient` é substituído por um fake que emite páginas controladas —
 * o cliente JSF em si já é testado com HTTP mockado em
 * `packages/adapters/pesqele/client.spec.ts`. Aqui o foco é a persistência.
 */

const { db, pool } = makeTestDatabase();
const withTransaction = makePoolTransaction(pool);

/** Fake do PesqEleClient: emite as páginas dadas; opcionalmente falha numa página. */
const fakePesqEle = (pages: RawRegistration[][], failOnPageIndex?: number): PesqEleClient => {
  async function* discover(): AsyncGenerator<RawRegistration[], void, undefined> {
    for (let i = 0; i < pages.length; i++) {
      if (i === failOnPageIndex) {
        throw new Error('network failure mid-pagination');
      }
      yield await Promise.resolve(pages[i]!);
    }
  }
  return { discover } as unknown as PesqEleClient;
};

/**
 * Fake que exercita os CALLBACKS do adapter (alerta e contagem da varredura), sem
 * emitir registro. É por eles que a suspeita de truncagem do PesqEle chega ao
 * resultado do job (T-28) — se o job reescrevesse o `kind`, uma perda de dado
 * apareceria no log como "busca vazia".
 */
const fakePesqEleComAlerta = (
  alert: PesqEleAlert,
  stats: PesqEleSweepStats | null,
): PesqEleClient => {
  async function* discover(
    options: DiscoverOptions = {},
  ): AsyncGenerator<RawRegistration[], void, undefined> {
    options.onAlert?.(alert);
    if (stats !== null) options.onSweepStats?.(stats);
    // Uma varredura pode alertar e não emitir página nenhuma (é o caso de janela
    // vazia); o `yield` de lista vazia mantém isso explícito para o job.
    yield await Promise.resolve([]);
  }
  return { discover } as unknown as PesqEleClient;
};

const reg = (
  overrides: Partial<RawRegistration> & Pick<RawRegistration, 'tseId'>,
): RawRegistration => ({
  instituteName: 'Datafolha',
  contractorName: 'TV Fixture Comunicações',
  contractorCnpj: null,
  raceLabel: 'Presidente da República — Brasil',
  registeredAt: '2026-08-10T14:30:00-03:00',
  fieldStart: '2026-08-05',
  fieldEnd: '2026-08-08',
  sampleSize: 2000,
  marginOfError: 2.2,
  confidenceLevel: 95,
  costBrl: 150000,
  ...overrides,
});

const runJob = (
  pages: RawRegistration[][],
  failOnPageIndex?: number,
  now = () => new Date('2026-08-14T12:00:00Z'),
) =>
  new DiscoveryJob({
    db,
    withTransaction,
    pesqEle: fakePesqEle(pages, failOnPageIndex),
    now,
  }).run();

const rowByTse = async (tseId: string) => {
  const rows = await db.query<{
    tse_id: string;
    institute_id: string | null;
    institute_raw_name: string;
    contractor_type: string | null;
    first_seen_at: string;
    source_expired_at: string | null;
  }>(
    `SELECT tse_id, institute_id, institute_raw_name, contractor_type, first_seen_at, source_expired_at
       FROM poll_registrations WHERE tse_id = $1`,
    [tseId],
  );
  return rows[0] ?? null;
};

describe('DiscoveryJob (integration)', () => {
  beforeAll(async () => {
    await seed(db);
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateData(db);
  });

  it('resolves a known institute alias and persists the registration', async () => {
    const result = await runJob([[reg({ tseId: 'BR-06591/2026' })]]);
    expect(result.seen).toBe(1);
    const row = await rowByTse('BR-06591/2026');
    expect(row?.institute_id).toBe('datafolha');
    expect(row?.institute_raw_name).toBe('Datafolha');
  });

  it('running twice does not duplicate nor change first_seen_at', async () => {
    await runJob(
      [[reg({ tseId: 'BR-06591/2026' })]],
      undefined,
      () => new Date('2026-08-14T12:00:00Z'),
    );
    const first = await rowByTse('BR-06591/2026');

    // Second run, later clock: upsert must preserve the original first_seen_at.
    await runJob(
      [[reg({ tseId: 'BR-06591/2026' })]],
      undefined,
      () => new Date('2026-08-20T09:00:00Z'),
    );
    const second = await rowByTse('BR-06591/2026');

    const count = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM poll_registrations WHERE tse_id = $1`,
      ['BR-06591/2026'],
    );
    expect(count[0]!.n).toBe('1'); // no duplicate
    expect(second!.first_seen_at).toBe(first!.first_seen_at); // preserved
  });

  it('marks a registration absent in run 2 as source_expired_at and keeps it', async () => {
    await runJob([[reg({ tseId: 'BR-06591/2026' }), reg({ tseId: 'BR-06592/2026' })]]);

    // Run 2: only 06591 present. 06592 must be expired but remain in the table.
    const result = await runJob([[reg({ tseId: 'BR-06591/2026' })]]);
    expect(result.expired).toBe(1);

    const stillAlive = await rowByTse('BR-06591/2026');
    expect(stillAlive!.source_expired_at).toBeNull();

    const expired = await rowByTse('BR-06592/2026');
    expect(expired).not.toBeNull(); // never deleted
    expect(expired!.source_expired_at).not.toBeNull();
  });

  it('revives (clears source_expired_at) when an expired registration reappears', async () => {
    await runJob([[reg({ tseId: 'BR-06592/2026' })]]);
    await runJob([[]]); // 06592 absent -> expired
    expect((await rowByTse('BR-06592/2026'))!.source_expired_at).not.toBeNull();

    await runJob([[reg({ tseId: 'BR-06592/2026' })]]); // reappears
    expect((await rowByTse('BR-06592/2026'))!.source_expired_at).toBeNull();
  });

  it('preserves disclosure_status set by another job across a re-run (T-06 owns it)', async () => {
    await runJob([[reg({ tseId: 'BR-06591/2026' })]]);
    // Simulate HarvestJob (T-06) transitioning the row to disclosed.
    await db.query(
      `UPDATE poll_registrations SET disclosure_status = 'disclosed' WHERE tse_id = $1`,
      ['BR-06591/2026'],
    );

    await runJob([[reg({ tseId: 'BR-06591/2026' })]]); // discovery must not clobber it
    const rows = await db.query<{ disclosure_status: string }>(
      `SELECT disclosure_status FROM poll_registrations WHERE tse_id = $1`,
      ['BR-06591/2026'],
    );
    expect(rows[0]!.disclosure_status).toBe('disclosed');
  });

  it('classifies an unmatched contractor as desconhecido (not null, no guess)', async () => {
    await runJob([[reg({ tseId: 'BR-06591/2026', contractorName: 'Sociedade Anônima Genérica' })]]);
    const row = await rowByTse('BR-06591/2026');
    expect(row!.contractor_type).toBe('desconhecido');
    expect(row!.contractor_type).not.toBeNull();
  });

  it('stores institute_raw_name with null institute_id and emits an alert for an unknown alias', async () => {
    const result = await runJob([
      [reg({ tseId: 'BR-06591/2026', instituteName: 'Instituto Jamais Cadastrado' })],
    ]);
    const row = await rowByTse('BR-06591/2026');
    expect(row!.institute_id).toBeNull();
    expect(row!.institute_raw_name).toBe('Instituto Jamais Cadastrado');
    expect(result.alerts).toContainEqual({
      kind: 'unknown_institute',
      tseId: 'BR-06591/2026',
      detail: 'Instituto Jamais Cadastrado',
    });
  });

  it('relays the truncation alert from the adapter WITHOUT rewriting its kind (T-28)', async () => {
    const stats: PesqEleSweepStats = {
      janela: { inicio: '2026-07-19', fim: '2026-08-17' },
      fatias: 12,
      fatiasNoTeto: 2,
      truncagensSuspeitas: 1,
      linhasVistas: 131,
      tseIdsDistintos: 131,
      limiteDeclarado: 50,
    };
    const alert: PesqEleAlert = {
      kind: 'truncation_suspected',
      detail: 'Fatia 10/08/2026–10/08/2026 voltou com 50 registros, no teto de 50',
    };

    const result = await new DiscoveryJob({
      db,
      withTransaction,
      pesqEle: fakePesqEleComAlerta(alert, stats),
      now: () => new Date('2026-08-17T12:00:00Z'),
    }).run();

    expect(result.alerts).toEqual([
      { kind: 'truncation_suspected', tseId: null, detail: alert.detail },
    ]);
    // A contagem da varredura chega ao resultado: é o que permite ver no log que
    // o número colhido é um PISO.
    expect(result.sweep).toEqual(stats);
    expect(result.sweep?.truncagensSuspeitas).toBe(1);
  });

  it('reports sweep as null when the adapter does not count (never a fabricated zero)', async () => {
    const result = await runJob([[reg({ tseId: 'BR-06591/2026' })]]);

    expect(result.sweep).toBeNull();
  });

  it('transaction per page: a network failure on page 2 keeps page 1 persisted', async () => {
    // Page 0 persists; page 1 throws before persisting. State must not be corrupted.
    await expect(
      runJob([[reg({ tseId: 'BR-06591/2026' })], [reg({ tseId: 'BR-06592/2026' })]], 1),
    ).rejects.toThrow(/network failure/);

    expect(await rowByTse('BR-06591/2026')).not.toBeNull(); // committed page 1
    expect(await rowByTse('BR-06592/2026')).toBeNull(); // never reached
  });
});
