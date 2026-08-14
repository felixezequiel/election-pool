import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildToStaging, type RunBuildArgs, type RunBuildResult } from './astro-build.js';
import { resolvePublishPaths, type PublishPaths } from './paths.js';
import type { PublicData } from '@election-pool/contracts/public-data';

/**
 * Wrapper do astro build: escreve o data.json na costura de T-12, roda o build
 * (injetado), detecta warning e copia o data.json servível quando limpo.
 */

let base: string;
let webDir: string;
let paths: PublishPaths;

const DATA = { schemaVersion: '1' } as unknown as PublicData;
const SERIALIZED = JSON.stringify({ schemaVersion: '1', marker: 'real' }, null, 2) + '\n';
const seamPath = (): string => join(webDir, 'src', 'data', 'sample-data.json');

const okBuild = (args: RunBuildArgs): Promise<RunBuildResult> => {
  mkdirSync(args.outDir, { recursive: true });
  writeFileSync(join(args.outDir, 'index.html'), '<html>built</html>');
  return Promise.resolve({ exitCode: 0, stdout: 'complete', stderr: '' });
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ep-astro-'));
  webDir = mkdtempSync(join(tmpdir(), 'ep-web-'));
  mkdirSync(join(webDir, 'src', 'data'), { recursive: true });
  writeFileSync(seamPath(), '{"stale":true}'); // amostra antiga
  paths = resolvePublishPaths(base);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  rmSync(webDir, { recursive: true, force: true });
});

describe('buildToStaging', () => {
  it('writes the real data.json to the T-12 seam and copies it into staging when clean', async () => {
    const outcome = await buildToStaging(DATA, SERIALIZED, { paths, webDir, runBuild: okBuild });

    expect(outcome.clean).toBe(true);
    expect(outcome.exitCode).toBe(0);
    // costura de T-12 sobrescrita com o data.json real
    expect(readFileSync(seamPath(), 'utf8')).toContain('"marker": "real"');
    // data.json servível em dist-staging/data.json (/data.json, docs/03 §5)
    expect(existsSync(join(paths.distStaging, 'data.json'))).toBe(true);
    expect(readFileSync(join(paths.distStaging, 'data.json'), 'utf8')).toContain(
      '"marker": "real"',
    );
    // index.html do build
    expect(existsSync(join(paths.distStaging, 'index.html'))).toBe(true);
  });

  it('reports not-clean when the build emits a warning (does not copy data.json)', async () => {
    const warnBuild = (args: RunBuildArgs): Promise<RunBuildResult> => {
      mkdirSync(args.outDir, { recursive: true });
      writeFileSync(join(args.outDir, 'index.html'), '<html>built</html>');
      return Promise.resolve({ exitCode: 0, stdout: '[WARN] something', stderr: '' });
    };
    const outcome = await buildToStaging(DATA, SERIALIZED, { paths, webDir, runBuild: warnBuild });

    expect(outcome.clean).toBe(false);
    expect(outcome.hadWarning).toBe(true);
    // não copia o data.json servível quando não está limpo
    expect(existsSync(join(paths.distStaging, 'data.json'))).toBe(false);
  });

  it('does NOT treat environment noise (Node cert warning) as an astro warning', async () => {
    // Ruído do sandbox: NODE_EXTRA_CA_CERTS ausente ⇒ "Warning: Ignoring extra certs".
    // Não é aviso de build; o build deve contar como limpo (regressão real do e2e).
    const noisyButClean = (args: RunBuildArgs): Promise<RunBuildResult> => {
      mkdirSync(args.outDir, { recursive: true });
      writeFileSync(join(args.outDir, 'index.html'), '<html>built</html>');
      return Promise.resolve({
        exitCode: 0,
        stdout: '[build] Complete!',
        stderr: 'Warning: Ignoring extra certs from `/path/rootCA.pem`, load failed',
      });
    };
    const outcome = await buildToStaging(DATA, SERIALIZED, {
      paths,
      webDir,
      runBuild: noisyButClean,
    });
    expect(outcome.hadWarning).toBe(false);
    expect(outcome.clean).toBe(true);
    expect(existsSync(join(paths.distStaging, 'data.json'))).toBe(true);
  });

  it('reports not-clean when the build exits != 0', async () => {
    const failBuild = (args: RunBuildArgs): Promise<RunBuildResult> => {
      mkdirSync(args.outDir, { recursive: true });
      return Promise.resolve({ exitCode: 1, stdout: '', stderr: 'error' });
    };
    const outcome = await buildToStaging(DATA, SERIALIZED, { paths, webDir, runBuild: failBuild });

    expect(outcome.clean).toBe(false);
    expect(outcome.exitCode).toBe(1);
    // a costura foi escrita (o dado real é a entrada), mas o data.json servível não.
    expect(readFileSync(seamPath(), 'utf8')).toContain('"marker": "real"');
    expect(existsSync(join(paths.distStaging, 'data.json'))).toBe(false);
  });
});
