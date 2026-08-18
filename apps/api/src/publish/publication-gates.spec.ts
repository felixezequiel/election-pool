import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePublicationGates, type GateInputs } from './publication-gates.js';
import { resolvePublishPaths, type PublishPaths } from './paths.js';

/**
 * Testes dos gates de publicação (docs/07 §6), todos bloqueantes. Montamos um
 * `dist-staging` mínimo no disco e variamos cada condição para provar que qualquer
 * falha reprova o veredito.
 */

let base: string;
let paths: PublishPaths;

const VALID_DATA = {
  schemaVersion: '2',
  generatedAt: '2026-08-14T15:00:00-03:00',
  nextUpdateAt: '2026-08-14T17:00:00-03:00',
  updateIntervalMinutes: 120,
  modelVersion: '0.0.4',
  gitSha: 'abc',
  race: { id: 'presidencia-2026', displayName: 'Presidência da República 2026' },
  candidates: [],
  institutes: [],
  latent: { firstRound: [], runoffs: [], electorate: [] },
  polls: [],
  // Nenhum instituto publicou cenário espontâneo: `null` (Q-14). É o estado normal
  // no começo, e o contrato o aceita.
  spontaneous: null,
  // Sem passos suficientes para estimar fluxo: `null` é o estado normal e o
  // contrato o aceita (Q-10).
  transitions: null,
  houseEffects: [],
  diagnostics: { gaveta: [], herding: [] },
  historicalError: [],
  otherRaces: [],
  methodologyNotes: [],
};

const bigIndexHtml = `<!doctype html><html><body>${'x'.repeat(11 * 1024)}</body></html>`;

const writeStaging = (opts: { indexBytes?: string; dataJson?: string } = {}): void => {
  mkdirSync(paths.distStaging, { recursive: true });
  writeFileSync(join(paths.distStaging, 'index.html'), opts.indexBytes ?? bigIndexHtml);
  writeFileSync(join(paths.distStaging, 'data.json'), opts.dataJson ?? JSON.stringify(VALID_DATA));
};

const writeCurrentDist = (generatedAt: string): void => {
  // dist é symlink em produção; para o gate de frescor basta um dir com data.json.
  const dir = join(base, 'dist-current');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'data.json'), JSON.stringify({ ...VALID_DATA, generatedAt }));
  // aponta o "dist" (dir simples no teste) para o conteúdo atual
  mkdirSync(paths.dist, { recursive: true });
  writeFileSync(join(paths.dist, 'data.json'), JSON.stringify({ ...VALID_DATA, generatedAt }));
};

const baseInputs = (): GateInputs => ({
  paths,
  modelGatesPassed: true,
  astroBuildClean: true,
  dataJsonValidated: true,
  suspectAdapterOverThreshold: false,
  newGeneratedAt: '2026-08-14T15:00:00-03:00',
});

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ep-gates-'));
  paths = resolvePublishPaths(base);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('evaluatePublicationGates', () => {
  it('passes when every gate is satisfied (first publish, no current dist)', async () => {
    writeStaging();
    const verdict = await evaluatePublicationGates(baseInputs());
    expect(verdict.passed).toBe(true);
    expect(verdict.results.every((r) => r.ok)).toBe(true);
  });

  it('fails when model gates did not pass (§6.1)', async () => {
    writeStaging();
    const verdict = await evaluatePublicationGates({ ...baseInputs(), modelGatesPassed: false });
    expect(verdict.passed).toBe(false);
    expect(verdict.results.find((r) => r.name === 'model_gates_passed')!.ok).toBe(false);
  });

  it('fails when astro build was not clean (§6.3)', async () => {
    writeStaging();
    const verdict = await evaluatePublicationGates({ ...baseInputs(), astroBuildClean: false });
    expect(verdict.passed).toBe(false);
    expect(verdict.results.find((r) => r.name === 'astro_build_clean')!.ok).toBe(false);
  });

  it('fails when index.html is <= 10 KB (§6.4)', async () => {
    writeStaging({ indexBytes: '<html>tiny</html>' });
    const verdict = await evaluatePublicationGates(baseInputs());
    expect(verdict.passed).toBe(false);
    expect(verdict.results.find((r) => r.name === 'index_html_size')!.ok).toBe(false);
  });

  it('fails when staging data.json is unparseable (§6.5)', async () => {
    writeStaging({ dataJson: '{ this is not json' });
    const verdict = await evaluatePublicationGates(baseInputs());
    expect(verdict.passed).toBe(false);
    expect(verdict.results.find((r) => r.name === 'staging_data_json_parseable')!.ok).toBe(false);
  });

  it('fails when staging data.json does not match the schema (§6.2)', async () => {
    writeStaging({ dataJson: JSON.stringify({ schemaVersion: '2' }) }); // faltam campos
    const verdict = await evaluatePublicationGates(baseInputs());
    expect(verdict.passed).toBe(false);
    expect(verdict.results.find((r) => r.name === 'data_json_validates')!.ok).toBe(false);
  });

  it('fails when an adapter is suspect beyond the threshold (§6.6)', async () => {
    writeStaging();
    const verdict = await evaluatePublicationGates({
      ...baseInputs(),
      suspectAdapterOverThreshold: true,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.results.find((r) => r.name === 'no_stale_suspect_adapter')!.ok).toBe(false);
  });

  it('fails when the new generatedAt is NOT newer than the current dist (§6.7)', async () => {
    writeStaging();
    writeCurrentDist('2026-08-14T15:00:00-03:00'); // igual ao novo ⇒ não é mais recente
    const verdict = await evaluatePublicationGates(baseInputs());
    expect(verdict.passed).toBe(false);
    expect(verdict.results.find((r) => r.name === 'newer_than_current')!.ok).toBe(false);
  });

  it('passes freshness when the new generatedAt is strictly newer (§6.7)', async () => {
    writeStaging();
    writeCurrentDist('2026-08-14T13:00:00-03:00'); // mais velho
    const verdict = await evaluatePublicationGates(baseInputs());
    expect(verdict.results.find((r) => r.name === 'newer_than_current')!.ok).toBe(true);
    expect(verdict.passed).toBe(true);
  });
});
