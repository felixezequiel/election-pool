import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { readlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeTestDatabase, truncateData } from '../db/test-helpers.js';
import { seed } from '../db/seed.js';
import { RenderJob } from './render.job.js';
import { rollback } from '../publish/atomic-swap.js';
import { resolvePublishPaths } from '../publish/paths.js';
import type { RunBuildArgs, RunBuildResult } from '../publish/astro-build.js';

/**
 * Testes de integração REAIS do RenderJob contra o Postgres do docker-compose.
 * Cobrem o aceite de T-13:
 *  - dataset denso ⇒ publica (dist aponta para build novo, data.json servível);
 *  - data.json inválido / gates de modelo reprovando (M-1 com < 3 pesquisas) ⇒ NÃO publica, dist intacto;
 *  - astro build exit != 0 ⇒ NÃO publica, dist intacto;
 *  - rollback restaura a versão anterior e é idempotente.
 *
 * O `astro build` é INJETADO (runBuild) para os testes serem rápidos e
 * determinísticos — o build real é exercido no e2e manual (`pnpm render`). O
 * fake escreve um index.html > 10 KB no outDir, como o astro faria.
 */

const { db } = makeTestDatabase();

const RACE_ID = 'presidencia-2026';
const NOW_BASE = Date.parse('2026-08-14T15:00:00-03:00');

let base: string;
// webDir de descarte por teste: o build é INJETADO (não roda astro de verdade), e a
// escrita da costura (`src/data/sample-data.json`) deve cair aqui — NUNCA no
// `apps/web` real, para não poluir o artefato versionado de T-12.
let webDir: string;

/** astro fake: escreve um index.html grande no outDir e retorna exit 0 (limpo). */
const fakeCleanBuild = (args: RunBuildArgs): Promise<RunBuildResult> => {
  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(
    join(args.outDir, 'index.html'),
    `<!doctype html><body>${'x'.repeat(12 * 1024)}</body>`,
  );
  return Promise.resolve({ exitCode: 0, stdout: 'built', stderr: '' });
};

/** astro fake que FALHA (exit 1), simulando um build quebrado. */
const fakeFailingBuild = (args: RunBuildArgs): Promise<RunBuildResult> => {
  mkdirSync(args.outDir, { recursive: true });
  return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'astro: build error' });
};

/** Insere um cenário CANÔNICO com resultados (o render lê is_canonical=true). */
const insertCanonicalScenario = async (opts: {
  tseId: string;
  instituteId: string;
  fieldDate: string;
  kind: string;
  t2Pair: string[] | null;
  values: { candidateId: string; valuePct: number }[];
}): Promise<void> => {
  const rawId = randomUUID();
  const scenarioId = randomUUID();
  await db.query(
    `INSERT INTO raw_documents (id, url, fetched_at, http_status, content_type, content_hash, storage_path)
     VALUES ($1, $2, now(), 200, 'text/html', $3, $4)`,
    [
      rawId,
      `https://example.org/${opts.tseId}`,
      `hash-${opts.tseId}-${opts.kind}`,
      `/blob/${rawId}`,
    ],
  );
  await db.query(
    `INSERT INTO poll_scenarios (id, tse_id, raw_document_id, kind, label, is_canonical, canonical_reason, t2_pair, extracted_at)
     VALUES ($1,$2,$3,$4,$5,true,'regra',$6, now())`,
    [scenarioId, opts.tseId, rawId, opts.kind, `${opts.kind}-${opts.tseId}`, opts.t2Pair],
  );
  for (const v of opts.values) {
    await db.query(
      `INSERT INTO poll_results (scenario_id, candidate_id, value_pct) VALUES ($1,$2,$3)`,
      [scenarioId, v.candidateId, v.valuePct],
    );
  }
};

const insertRegistration = async (opts: {
  tseId: string;
  instituteId: string;
  fieldDate: string;
  disclosed: boolean;
}): Promise<void> => {
  // registered_at fixo em 2026-06-01 (janela de divulgação já passada em ago/26);
  // campo de 2 dias terminando em fieldDate (recente ⇒ dentro da janela ativa).
  await db.query(
    `INSERT INTO poll_registrations
       (tse_id, race_id, institute_id, institute_raw_name, contractor_name, contractor_type,
        registered_at, field_start, field_end, sample_size, margin_of_error, disclosure_status)
     VALUES ($1,$2,$3,$4,'Veículo Aurora','veiculo', '2026-06-01', $5::date - 2, $5::date, 2000, 2.0, $6)`,
    [
      opts.tseId,
      RACE_ID,
      opts.instituteId,
      opts.instituteId,
      opts.fieldDate,
      opts.disclosed ? 'disclosed' : 'presumed_undisclosed',
    ],
  );
};

/** Semeia um dataset DENSO: 3 pesquisas, 2 institutos, na janela ⇒ passa M-1. */
const seedDenseDataset = async (): Promise<void> => {
  const specs = [
    { tseId: 'BR-06591/2026', instituteId: 'quaest', fieldDate: '2026-08-01' },
    { tseId: 'BR-06592/2026', instituteId: 'datafolha', fieldDate: '2026-08-05' },
    { tseId: 'BR-06593/2026', instituteId: 'quaest', fieldDate: '2026-08-09' },
  ];
  let i = 0;
  for (const s of specs) {
    await insertRegistration({ ...s, disclosed: true });
    await insertCanonicalScenario({
      tseId: s.tseId,
      instituteId: s.instituteId,
      fieldDate: s.fieldDate,
      kind: 't1_estimulado',
      t2Pair: null,
      values: [
        { candidateId: 'lula', valuePct: 40 + i },
        { candidateId: 'tarcisio', valuePct: 32 - i },
      ],
    });
    await insertCanonicalScenario({
      tseId: s.tseId,
      instituteId: s.instituteId,
      fieldDate: s.fieldDate,
      kind: 't2',
      t2Pair: ['lula', 'tarcisio'],
      values: [
        { candidateId: 'lula', valuePct: 52 },
        { candidateId: 'tarcisio', valuePct: 48 },
      ],
    });
    i++;
  }
};

const makeJob = (overrides: Partial<ConstructorParameters<typeof RenderJob>[0]> = {}): RenderJob =>
  new RenderJob({
    db,
    raceId: RACE_ID,
    publishBaseDir: base,
    webDir,
    now: () => new Date(NOW_BASE),
    gitSha: 'testsha',
    runBuild: fakeCleanBuild,
    suspectAdapterOverThreshold: false,
    ...overrides,
  });

const distTarget = async (): Promise<string | null> => {
  const paths = resolvePublishPaths(base);
  if (!existsSync(paths.dist)) return null;
  const info = await lstat(paths.dist);
  if (!info.isSymbolicLink()) return null;
  return (await readlink(paths.dist)).replace(/^\.\//, '');
};

describe('RenderJob (integration)', () => {
  beforeAll(async () => {
    await seed(db);
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateData(db);
    base = mkdtempSync(join(tmpdir(), 'ep-render-'));
    // webDir de descarte com a costura de T-12; a escrita do data.json cai aqui,
    // não no apps/web real (o build é injetado, não roda astro).
    webDir = mkdtempSync(join(tmpdir(), 'ep-render-web-'));
    mkdirSync(join(webDir, 'src', 'data'), { recursive: true });
    writeFileSync(join(webDir, 'src', 'data', 'sample-data.json'), '{}');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
    rmSync(webDir, { recursive: true, force: true });
  });

  it('publishes a dense dataset: dist points at a new build with a servable data.json', async () => {
    await seedDenseDataset();
    const result = await makeJob().run();

    expect(result.published).toBe(true);
    expect(result.abortReason).toBeNull();
    const paths = resolvePublishPaths(base);
    // dist é symlink para um build versionado
    expect(await distTarget()).not.toBeNull();
    // data.json servível em /data.json (docs/03 §5)
    const dataJsonPath = join(paths.dist, 'data.json');
    expect(existsSync(dataJsonPath)).toBe(true);
    const served = JSON.parse(readFileSync(dataJsonPath, 'utf8')) as {
      schemaVersion: string;
      polls: unknown[];
    };
    expect(served.schemaVersion).toBe('1');
    expect(served.polls).toHaveLength(3);
    // index.html > 10 KB presente
    expect(existsSync(join(paths.dist, 'index.html'))).toBe(true);
  });

  it('does NOT publish when coverage fails (M-1: < 3 polls); no dist created', async () => {
    // Apenas 1 pesquisa ⇒ M-1 reprova ⇒ gates de modelo false ⇒ não publica.
    await insertRegistration({
      tseId: 'BR-06591/2026',
      instituteId: 'quaest',
      fieldDate: '2026-08-01',
      disclosed: true,
    });
    await insertCanonicalScenario({
      tseId: 'BR-06591/2026',
      instituteId: 'quaest',
      fieldDate: '2026-08-01',
      kind: 't1_estimulado',
      t2Pair: null,
      values: [
        { candidateId: 'lula', valuePct: 40 },
        { candidateId: 'tarcisio', valuePct: 32 },
      ],
    });

    const result = await makeJob().run();

    expect(result.published).toBe(false);
    expect(result.abortReason).toMatch(/gate/i);
    expect(result.gateResults.find((r) => r.name === 'model_gates_passed')!.ok).toBe(false);
    // nenhum dist publicado (não havia antes; segue não havendo)
    expect(await distTarget()).toBeNull();
  });

  it('does NOT publish when astro build exits != 0; a prior dist stays intact', async () => {
    await seedDenseDataset();
    // Primeira publicação boa.
    const first = await makeJob().run();
    expect(first.published).toBe(true);
    const publishedTarget = await distTarget();

    // Segundo run com build QUEBRADO e generatedAt mais novo — deve abortar e
    // manter o dist anterior no ar (docs/07 §1).
    const second = await makeJob({
      now: () => new Date(NOW_BASE + 2 * 60 * 60 * 1000), // +2h
      runBuild: fakeFailingBuild,
    }).run();

    expect(second.published).toBe(false);
    expect(second.abortReason).toMatch(/gate|astro/i);
    // dist continua apontando para o build bom anterior.
    expect(await distTarget()).toBe(publishedTarget);
    const paths = resolvePublishPaths(base);
    expect(existsSync(join(paths.dist, 'index.html'))).toBe(true);
  });

  it('does NOT publish a stale build (generatedAt not newer than current)', async () => {
    await seedDenseDataset();
    const first = await makeJob().run();
    expect(first.published).toBe(true);
    const target = await distTarget();

    // Mesmo now ⇒ mesmo generatedAt ⇒ gate de frescor (§6.7) reprova.
    const second = await makeJob().run();
    expect(second.published).toBe(false);
    expect(second.gateResults.find((r) => r.name === 'newer_than_current')!.ok).toBe(false);
    expect(await distTarget()).toBe(target); // inalterado
  });

  it('rollback restores the previous published version and is idempotent', async () => {
    await seedDenseDataset();
    const first = await makeJob().run();
    expect(first.published).toBe(true);
    const firstTarget = await distTarget();

    // Segunda publicação: mesmo dado, generatedAt +2h ⇒ passa no gate de frescor
    // (§6.7) e gera um novo build versionado. (Não podemos UPDATE poll_results —
    // é append-only, R5; a diferença entre publicações é o generatedAt.)
    const second = await makeJob({ now: () => new Date(NOW_BASE + 2 * 60 * 60 * 1000) }).run();
    expect(second.published).toBe(true);
    const secondTarget = await distTarget();
    expect(secondTarget).not.toBe(firstTarget);

    const paths = resolvePublishPaths(base);
    const r1 = await rollback(paths);
    expect(r1).toBe(firstTarget);
    expect(await distTarget()).toBe(firstTarget);

    // Idempotente: repetir mantém o mesmo alvo.
    const r2 = await rollback(paths);
    expect(r2).toBe(firstTarget);
    expect(await distTarget()).toBe(firstTarget);
  });

  it('aborts (dist intact) when the race does not exist', async () => {
    const result = await makeJob({ raceId: 'inexistente-9999' }).run();
    expect(result.published).toBe(false);
    expect(result.alerts.some((a) => a.kind === 'no_race')).toBe(true);
  });
});
