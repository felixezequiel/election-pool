import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  rawDocumentSchema,
  pollRegistrationSchema,
  pollScenarioSchema,
  pollResultSchema,
} from '@election-pool/contracts/domain';
import type { RawDocument, PollRegistration } from '@election-pool/contracts/domain';
import { makeTestDatabase, truncateData } from './test-helpers.js';
import type { Database } from './pool.js';
import { RawDocumentsRepository } from './raw-documents.repository.js';
import { PollRegistrationsRepository } from './poll-registrations.repository.js';
import { PollScenariosRepository } from './poll-scenarios.repository.js';
import { seed } from './seed.js';

/**
 * Testes de integração REAIS contra o Postgres do docker-compose. Cobrem os
 * itens de aceite de T-02: trigger append-only, índice único parcial de
 * canônico, CHECK de value_pct, e o round-trip repositório → Zod → domínio.
 */

const { db } = makeTestDatabase();

const RACE_ID = 'presidencia-2026';
const INSTITUTE_ID = 'quaest';
const TSE_ID = 'BR-06591/2026';

const makeRawDocument = (): RawDocument =>
  rawDocumentSchema.parse({
    id: randomUUID(),
    url: 'https://example.org/pesquisa.pdf',
    fetchedAt: '2026-08-14T10:00:00-03:00',
    httpStatus: 200,
    contentType: 'application/pdf',
    contentHash: 'a'.repeat(64),
    storagePath: '/var/lib/election-pool/raw/a.pdf',
    etag: null,
    lastModified: null,
  });

const makeRegistration = (): PollRegistration =>
  pollRegistrationSchema.parse({
    tseId: TSE_ID,
    raceId: RACE_ID,
    instituteId: INSTITUTE_ID,
    instituteRawName: 'Genial/Quaest',
    contractorName: 'Genial Investimentos',
    contractorType: 'instituicao_financeira',
    registeredAt: '2026-08-01T09:00:00-03:00',
    fieldStart: '2026-08-05',
    fieldEnd: '2026-08-08',
    sampleSize: 2000,
    marginOfError: 2.0,
    confidenceLevel: 95.0,
    costBrl: 120000.0,
    firstSeenAt: '2026-08-02T00:00:00-03:00',
    sourceExpiredAt: null,
    disclosureStatus: 'disclosed',
  });

const seedScenarioPrereqs = async (database: Database): Promise<{ rawDocId: string }> => {
  const raw = new RawDocumentsRepository(database);
  const regs = new PollRegistrationsRepository(database);
  const rawDoc = makeRawDocument();
  await raw.insert(rawDoc);
  await regs.upsert(makeRegistration());
  return { rawDocId: rawDoc.id };
};

beforeAll(async () => {
  // Garante que as migrations rodaram e semeia a referência (races/candidatos).
  await seed(db);
});

afterAll(async () => {
  await db.end();
});

beforeEach(async () => {
  await truncateData(db);
});

describe('round-trip repositório → Zod → domínio', () => {
  it('lê de volta o registro e o documento validados pelos schemas de contrato', async () => {
    const { rawDocId } = await seedScenarioPrereqs(db);

    const raw = new RawDocumentsRepository(db);
    const regs = new PollRegistrationsRepository(db);

    const rawDoc = await raw.findById(rawDocId);
    expect(rawDoc?.contentHash).toBe('a'.repeat(64));

    const reg = await regs.findByTseId(TSE_ID);
    expect(reg?.tseId).toBe(TSE_ID);
    // numeric → number (type parser); datas → string ISO/date.
    expect(reg?.marginOfError).toBe(2);
    expect(reg?.fieldEnd).toBe('2026-08-08');
    expect(reg?.disclosureStatus).toBe('disclosed');
  });
});

describe('poll_results append-only (trigger, docs/03 §2.4)', () => {
  const setupScenarioWithResult = async (): Promise<{ scenarioId: string }> => {
    const { rawDocId } = await seedScenarioPrereqs(db);
    const scenarios = new PollScenariosRepository(db);

    const scenarioId = randomUUID();
    await scenarios.insertScenario(
      pollScenarioSchema.parse({
        id: scenarioId,
        tseId: TSE_ID,
        rawDocumentId: rawDocId,
        kind: 't1_estimulado',
        label: 'Cenário 1',
        isCanonical: true,
        canonicalReason: 'único estimulado',
        t2Pair: null,
        blankNullPct: null,
        undecidedPct: null,
        extractedAt: '2026-08-09T12:00:00-03:00',
      }),
    );
    await scenarios.insertResults([
      pollResultSchema.parse({ scenarioId, candidateId: 'lula', valuePct: 44.5 }),
    ]);
    return { scenarioId };
  };

  it('rejeita UPDATE em poll_results', async () => {
    const { scenarioId } = await setupScenarioWithResult();
    await expect(
      db.query(`UPDATE poll_results SET value_pct = 50 WHERE scenario_id = $1`, [scenarioId]),
    ).rejects.toThrow(/append-only/);
  });

  it('rejeita DELETE em poll_results', async () => {
    const { scenarioId } = await setupScenarioWithResult();
    await expect(
      db.query(`DELETE FROM poll_results WHERE scenario_id = $1`, [scenarioId]),
    ).rejects.toThrow(/append-only/);
  });
});

describe('índice único parcial de canônico (docs/03 §4)', () => {
  const insertCanonicalScenario = async (
    rawId: string,
    label: string,
    t2Pair: string[] | null,
  ): Promise<void> => {
    await db.query(
      `INSERT INTO poll_scenarios
         (id, tse_id, raw_document_id, kind, label, is_canonical, t2_pair, extracted_at)
       VALUES ($1, $2, $3, $4, $5, true, $6, now())`,
      [randomUUID(), TSE_ID, rawId, t2Pair === null ? 't1_estimulado' : 't2', label, t2Pair],
    );
  };

  it('viola ao inserir dois canônicos para a mesma (tse_id, kind, t2_pair) — t1 (t2_pair NULL)', async () => {
    const { rawDocId } = await seedScenarioPrereqs(db);
    await insertCanonicalScenario(rawDocId, 'Cenário 1', null);
    await expect(insertCanonicalScenario(rawDocId, 'Cenário 2', null)).rejects.toThrow(
      /poll_scenarios_one_canonical_idx|duplicate key/,
    );
  });

  it('viola para o mesmo par de 2º turno', async () => {
    const { rawDocId } = await seedScenarioPrereqs(db);
    await insertCanonicalScenario(rawDocId, 'T2 A', ['lula', 'tarcisio']);
    await expect(insertCanonicalScenario(rawDocId, 'T2 B', ['lula', 'tarcisio'])).rejects.toThrow(
      /poll_scenarios_one_canonical_idx|duplicate key/,
    );
  });

  it('permite dois canônicos de pares de 2º turno DIFERENTES', async () => {
    const { rawDocId } = await seedScenarioPrereqs(db);
    await insertCanonicalScenario(rawDocId, 'T2 A', ['lula', 'tarcisio']);
    await expect(
      insertCanonicalScenario(rawDocId, 'T2 B', ['lula', 'flavio-bolsonaro']),
    ).resolves.toBeUndefined();
  });
});

describe('CHECK de value_pct (docs/03 §4)', () => {
  it('rejeita value_pct = 100.5', async () => {
    const { rawDocId } = await seedScenarioPrereqs(db);
    const scenarioId = randomUUID();
    await db.query(
      `INSERT INTO poll_scenarios (id, tse_id, raw_document_id, kind, label, extracted_at)
       VALUES ($1, $2, $3, 't1_estimulado', 'Cenário 1', now())`,
      [scenarioId, TSE_ID, rawDocId],
    );
    await expect(
      db.query(
        `INSERT INTO poll_results (scenario_id, candidate_id, value_pct) VALUES ($1, 'lula', 100.5)`,
        [scenarioId],
      ),
    ).rejects.toThrow(/value_pct/);
  });

  it('aceita value_pct = 100.00 e 0.00', async () => {
    const { rawDocId } = await seedScenarioPrereqs(db);
    const scenarioId = randomUUID();
    await db.query(
      `INSERT INTO poll_scenarios (id, tse_id, raw_document_id, kind, label, extracted_at)
       VALUES ($1, $2, $3, 't1_estimulado', 'Cenário 1', now())`,
      [scenarioId, TSE_ID, rawDocId],
    );
    await db.query(
      `INSERT INTO poll_results (scenario_id, candidate_id, value_pct) VALUES ($1, 'lula', 100.00), ($1, 'tarcisio', 0.00)`,
      [scenarioId],
    );
    const scenarios = new PollScenariosRepository(db);
    const results = await scenarios.listResultsByScenario(scenarioId);
    expect(results.map((r) => r.valuePct).sort((a, b) => a - b)).toEqual([0, 100]);
  });
});

describe('field_end >= field_start (CHECK)', () => {
  it('rejeita janela de campo invertida', async () => {
    const regs = new PollRegistrationsRepository(db);
    const bad = pollRegistrationSchema.parse({
      ...makeRegistration(),
      fieldStart: '2026-08-08',
      fieldEnd: '2026-08-05',
    });
    await expect(regs.upsert(bad)).rejects.toThrow(/field_range|field_end/);
  });
});
