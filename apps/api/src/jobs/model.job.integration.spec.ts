import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTestDatabase, truncateData } from '../db/test-helpers.js';
import { seed } from '../db/seed.js';
import { ModelJob } from './model.job.js';

/**
 * Testes de integração REAIS do ModelJob contra o Postgres do docker-compose.
 * Cobrem a glue de T-14:
 *  - seleção canônica (docs/01 §3) marca `is_canonical` sobre cenários que o
 *    harvest gravou com `is_canonical=false`;
 *  - `runModel` roda sobre as observações canônicas e persiste model_runs +
 *    estimates + house_effects + diagnostics;
 *  - os gates M-1..M-7 são avaliados; M-7 (backtest) é INJETADO para os testes
 *    controlarem o veredito sem depender do estado honesto da fixture (LOG T-09);
 *  - gates_passed=false quando M-7 reprova ⇒ shouldRender=false (não publica).
 */

const { db } = makeTestDatabase();
const RACE_ID = 'presidencia-2026';
const NOW = (): Date => new Date(Date.parse('2026-08-14T15:00:00-03:00'));

/** Insere um registro + um cenário NÃO-canônico com resultados (como o harvest faz). */
const insertNonCanonicalScenario = async (opts: {
  tseId: string;
  instituteId: string;
  fieldDate: string;
  kind: string;
  t2Pair: string[] | null;
  label: string;
  values: { candidateId: string; valuePct: number }[];
}): Promise<string> => {
  const rawId = randomUUID();
  const scenarioId = randomUUID();
  await db.query(
    `INSERT INTO raw_documents (id, url, fetched_at, http_status, content_type, content_hash, storage_path)
     VALUES ($1,$2, now(), 200, 'text/html', $3, $4)`,
    [
      rawId,
      `https://example.org/${opts.tseId}/${opts.label}`,
      `hash-${scenarioId}`,
      `/blob/${rawId}`,
    ],
  );
  await db.query(
    `INSERT INTO poll_scenarios (id, tse_id, raw_document_id, kind, label, is_canonical, canonical_reason, t2_pair, extracted_at)
     VALUES ($1,$2,$3,$4,$5,false,NULL,$6, now())`,
    [scenarioId, opts.tseId, rawId, opts.kind, opts.label, opts.t2Pair],
  );
  for (const v of opts.values) {
    await db.query(
      `INSERT INTO poll_results (scenario_id, candidate_id, value_pct) VALUES ($1,$2,$3)`,
      [scenarioId, v.candidateId, v.valuePct],
    );
  }
  return scenarioId;
};

const insertRegistration = async (
  tseId: string,
  instituteId: string,
  fieldDate: string,
): Promise<void> => {
  await db.query(
    `INSERT INTO poll_registrations
       (tse_id, race_id, institute_id, institute_raw_name, contractor_name, contractor_type,
        registered_at, field_start, field_end, sample_size, margin_of_error, disclosure_status)
     VALUES ($1,$2,$3,$4,'Veículo Aurora','veiculo','2026-06-01',$5::date - 2,$5::date,2000,2.0,'disclosed')`,
    [tseId, RACE_ID, instituteId, instituteId, fieldDate],
  );
};

/** Dataset denso: 3 pesquisas, 2 institutos, na janela ⇒ passa M-1. */
const seedDense = async (): Promise<void> => {
  const specs = [
    { tseId: 'BR-06591/2026', instituteId: 'quaest', fieldDate: '2026-08-01' },
    { tseId: 'BR-06592/2026', instituteId: 'datafolha', fieldDate: '2026-08-05' },
    { tseId: 'BR-06593/2026', instituteId: 'quaest', fieldDate: '2026-08-09' },
  ];
  let i = 0;
  for (const s of specs) {
    await insertRegistration(s.tseId, s.instituteId, s.fieldDate);
    // Dois cenários de 1º turno por pesquisa: um POBRE (2 nomes) e um RICO (3
    // nomes). A regra 1 (docs/01 §3) deve escolher o rico.
    await insertNonCanonicalScenario({
      tseId: s.tseId,
      instituteId: s.instituteId,
      fieldDate: s.fieldDate,
      kind: 't1_estimulado',
      t2Pair: null,
      label: 'Cenário pobre',
      values: [
        { candidateId: 'lula', valuePct: 40 + i },
        { candidateId: 'tarcisio', valuePct: 32 - i },
      ],
    });
    await insertNonCanonicalScenario({
      tseId: s.tseId,
      instituteId: s.instituteId,
      fieldDate: s.fieldDate,
      kind: 't1_estimulado',
      t2Pair: null,
      label: 'Cenário rico',
      values: [
        { candidateId: 'lula', valuePct: 39 + i },
        { candidateId: 'tarcisio', valuePct: 31 - i },
        { candidateId: 'ciro-gomes', valuePct: 8 },
      ],
    });
    i++;
  }
};

const countCanonical = async (): Promise<number> => {
  const rows = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM poll_scenarios ps
       JOIN poll_registrations reg ON reg.tse_id = ps.tse_id
      WHERE reg.race_id = $1 AND ps.is_canonical`,
    [RACE_ID],
  );
  return Number.parseInt(rows[0]?.n ?? '0', 10);
};

describe('ModelJob (integration)', () => {
  beforeAll(async () => {
    await seed(db);
  });
  afterAll(async () => {
    await db.end();
  });
  beforeEach(async () => {
    await truncateData(db);
    await db.query(`DELETE FROM model_diagnostics`);
    await db.query(`DELETE FROM model_house_effects`);
    await db.query(`DELETE FROM model_estimates`);
    await db.query(`DELETE FROM model_runs`);
  });

  it('marca o cenário canônico (regra 1: mais nomes) e ignora o pobre', async () => {
    await seedDense();
    const job = new ModelJob({
      db,
      raceId: RACE_ID,
      now: NOW,
      gitSha: 'testsha',
      runBacktestGate: () => true,
    });
    const summary = await job.run();

    // Uma pesquisa tem 2 cenários t1 no MESMO grupo ⇒ 1 canônico por pesquisa = 3.
    expect(summary.canonical.canonicalMarked).toBe(3);
    expect(await countCanonical()).toBe(3);

    // O canônico é o "rico" (regra 1). Verifica o motivo gravado.
    const rows = await db.query<{ label: string; canonical_reason: string }>(
      `SELECT label, canonical_reason FROM poll_scenarios
        WHERE is_canonical AND tse_id = 'BR-06591/2026'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.label).toBe('Cenário rico');
    expect(rows[0]?.canonical_reason).toContain('regra 1');
  });

  it('persiste model_runs/estimates/house_effects e avalia gates (M-7 injetado PASS)', async () => {
    await seedDense();
    const job = new ModelJob({
      db,
      raceId: RACE_ID,
      now: NOW,
      gitSha: 'testsha',
      runBacktestGate: () => true,
    });
    const summary = await job.run();

    expect(summary.observations).toBeGreaterThan(0);
    expect(summary.runId).not.toBeNull();

    // model_runs gravado com input_hash e gates_json.
    const runRows = await db.query<{ input_hash: string; gates_passed: boolean; git_sha: string }>(
      `SELECT input_hash, gates_passed, git_sha FROM model_runs WHERE id = $1`,
      [summary.runId],
    );
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(runRows[0]?.git_sha).toBe('testsha');

    // Série latente persistida.
    const est = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM model_estimates WHERE run_id = $1`,
      [summary.runId],
    );
    expect(Number.parseInt(est[0]?.n ?? '0', 10)).toBeGreaterThan(0);

    // M-1 (cobertura) deve passar com o dataset denso.
    const m1 = summary.gates.find((g) => g.name.startsWith('M-1'));
    expect(m1?.ok).toBe(true);
    // M-6 determinismo (segundo run idêntico) deve passar.
    const m6 = summary.gates.find((g) => g.name.startsWith('M-6'));
    expect(m6?.ok).toBe(true);
  });

  it('M-7 backtest REPROVA ⇒ gates_passed=false e shouldRender=false (não publica)', async () => {
    await seedDense();
    const job = new ModelJob({
      db,
      raceId: RACE_ID,
      now: NOW,
      gitSha: 'testsha',
      runBacktestGate: () => false,
    });
    const summary = await job.run();

    const m7 = summary.gates.find((g) => g.name.startsWith('M-7'));
    expect(m7?.ok).toBe(false);
    expect(summary.gatesPassed).toBe(false);
    expect(summary.shouldRender).toBe(false);

    // Ainda assim o run é PERSISTIDO (histórico de reprovação é dado, docs/07 §4.4).
    const runRows = await db.query<{ gates_passed: boolean }>(
      `SELECT gates_passed FROM model_runs WHERE id = $1`,
      [summary.runId],
    );
    expect(runRows[0]?.gates_passed).toBe(false);
  });

  it('sem cenário (dataset vazio): M-1 reprova, não trava (input_hash de conjunto vazio)', async () => {
    const job = new ModelJob({
      db,
      raceId: RACE_ID,
      now: NOW,
      gitSha: 'testsha',
      runBacktestGate: () => true,
    });
    const summary = await job.run();
    expect(summary.observations).toBe(0);
    const m1 = summary.gates.find((g) => g.name.startsWith('M-1'));
    expect(m1?.ok).toBe(false);
    expect(summary.gatesPassed).toBe(false);
  });
});
