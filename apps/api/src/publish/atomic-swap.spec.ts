import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { canCreateSymlink, SYMLINK_SKIP_REASON } from './can-symlink.js';

if (!canCreateSymlink()) {
  console.warn(`[skip] ${SYMLINK_SKIP_REASON}`);
}
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicSwap, rollback, listSnapshots, currentDistTarget } from './atomic-swap.js';
import { resolvePublishPaths, type PublishPaths } from './paths.js';

/**
 * Testes do swap atômico (docs/02 §3.4). Puros de banco: só sistema de arquivos,
 * num tmpdir dedicado (mesmo filesystem ⇒ rename atômico, armadilha de T-13).
 * Cobrem o aceite de T-13: leitor concorrente nunca vê parcial nem ENOENT;
 * rollback restaura e é idempotente; retenção de 5.
 *
 * `dist` é um SYMLINK para o build versionado corrente; a leitura de
 * `dist/index.html` resolve pelo symlink e sempre encontra uma árvore completa.
 */

let base: string;
let paths: PublishPaths;

/** Escreve uma árvore de staging com um index.html marcado por conteúdo. */
const makeStaging = (marker: string): void => {
  mkdirSync(paths.distStaging, { recursive: true });
  writeFileSync(join(paths.distStaging, 'index.html'), `<!doctype html><body>${marker}</body>`);
  writeFileSync(join(paths.distStaging, 'data.json'), JSON.stringify({ marker }));
};

const distMarker = (): string => {
  const html = readFileSync(join(paths.dist, 'index.html'), 'utf8');
  return /body>([^<]*)</.exec(html)?.[1] ?? '';
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'ep-swap-'));
  paths = resolvePublishPaths(base);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe.skipIf(!canCreateSymlink())('atomicSwap', () => {
  it('publishes staging as a versioned dir and points dist at it (first publish)', async () => {
    makeStaging('v1');
    await atomicSwap(paths, 'dist-2026-01-01', { keep: 5 });

    expect(existsSync(paths.dist)).toBe(true);
    expect(distMarker()).toBe('v1');
    expect(await currentDistTarget(paths)).toBe('dist-2026-01-01');
    // o build vira snapshot versionado
    expect((await listSnapshots(paths)).map((s) => s.name)).toEqual(['dist-2026-01-01']);
  });

  it('swaps a new build in, keeping the previous one as a snapshot', async () => {
    makeStaging('old');
    await atomicSwap(paths, 'dist-2026-02-01', { keep: 5 });
    makeStaging('new');
    await atomicSwap(paths, 'dist-2026-02-02', { keep: 5 });

    expect(distMarker()).toBe('new');
    expect(await currentDistTarget(paths)).toBe('dist-2026-02-02');
    const names = (await listSnapshots(paths)).map((s) => s.name).sort();
    expect(names).toEqual(['dist-2026-02-01', 'dist-2026-02-02']);
    // o build anterior continua legível para rollback
    expect(readFileSync(join(base, 'dist-2026-02-01', 'index.html'), 'utf8')).toContain('old');
  });

  it('a concurrent reader of dist/index.html never reads a partial file nor gets ENOENT', async () => {
    makeStaging('gen-0');
    await atomicSwap(paths, 'dist-gen-0', { keep: 10 });

    let stop = false;
    const seen = new Set<string>();
    let corrupt = 0;
    let enoent = 0;
    const reader = (async () => {
      while (!stop) {
        try {
          const html = await readFile(join(paths.dist, 'index.html'), 'utf8');
          const marker = /body>([^<]*)</.exec(html)?.[1] ?? '';
          if (!/^gen-\d+$/.test(marker)) corrupt++;
          else seen.add(marker);
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') enoent++;
          else throw err;
        }
      }
    })();

    // Muitos swaps seguidos para maximizar a chance de pegar qualquer vão.
    for (let i = 1; i <= 40; i++) {
      makeStaging(`gen-${String(i)}`);
      await atomicSwap(paths, `dist-gen-${String(i)}`, { keep: 10 });
    }
    stop = true;
    await reader;

    expect(corrupt).toBe(0); // NUNCA leu conteúdo parcial/corrompido
    expect(enoent).toBe(0); // NUNCA recebeu ENOENT — dist sempre presente
    expect(seen.size).toBeGreaterThan(1); // o leitor de fato pegou várias versões
    expect(distMarker()).toBe('gen-40');
  });

  it('retains only the last 5 snapshots (never removing the current target)', async () => {
    for (let i = 1; i <= 8; i++) {
      makeStaging(`gen-${String(i)}`);
      await atomicSwap(paths, `dist-2026-01-${String(i).padStart(2, '0')}`, { keep: 5 });
      await new Promise((r) => setTimeout(r, 5)); // mtimes distintos p/ ordenação estável
    }
    const snaps = await listSnapshots(paths);
    expect(snaps).toHaveLength(5);
    const names = snaps.map((s) => s.name).sort();
    // mantém os 5 mais recentes (04..08); dist aponta para 08.
    expect(names).toEqual([
      'dist-2026-01-04',
      'dist-2026-01-05',
      'dist-2026-01-06',
      'dist-2026-01-07',
      'dist-2026-01-08',
    ]);
    expect(await currentDistTarget(paths)).toBe('dist-2026-01-08');
  });

  it('aborts the swap when dist-staging is missing (dist intact)', async () => {
    makeStaging('live');
    await atomicSwap(paths, 'dist-live', { keep: 5 });
    // staging já foi consumido; um novo swap sem staging deve abortar.
    await expect(atomicSwap(paths, 'dist-x', { keep: 5 })).rejects.toThrow(/dist-staging/);
    expect(distMarker()).toBe('live');
  });

  it('migrates a legacy real dist directory into a snapshot before swapping', async () => {
    // Instalação legada: dist é um diretório REAL, não symlink.
    mkdirSync(paths.dist, { recursive: true });
    writeFileSync(join(paths.dist, 'index.html'), '<!doctype html><body>legacy</body>');

    makeStaging('fresh');
    await atomicSwap(paths, 'dist-fresh', { keep: 5 });

    expect(distMarker()).toBe('fresh');
    expect(await currentDistTarget(paths)).toBe('dist-fresh');
    // o dist legado foi preservado como snapshot dist-legacy-*
    const legacy = (await listSnapshots(paths)).find((s) => s.name.startsWith('dist-legacy-'));
    expect(legacy).toBeDefined();
    expect(readFileSync(join(base, legacy!.name, 'index.html'), 'utf8')).toContain('legacy');
  });
});

describe.skipIf(!canCreateSymlink())('rollback', () => {
  it('restores the previous build (repoints dist at the prior snapshot)', async () => {
    makeStaging('v1');
    await atomicSwap(paths, 'dist-2026-03-01', { keep: 5 });
    makeStaging('v2');
    await atomicSwap(paths, 'dist-2026-03-02', { keep: 5 });
    expect(distMarker()).toBe('v2');

    const restored = await rollback(paths);
    expect(restored).toBe('dist-2026-03-01');
    expect(distMarker()).toBe('v1');
  });

  it('is idempotent: rolling back twice restores the same state without error', async () => {
    makeStaging('v1');
    await atomicSwap(paths, 'dist-2026-03-10', { keep: 5 });
    makeStaging('v2');
    await atomicSwap(paths, 'dist-2026-03-11', { keep: 5 });

    const first = await rollback(paths);
    const firstMarker = distMarker();
    const second = await rollback(paths);
    const secondMarker = distMarker();

    // Idempotente: ambos restauram a MESMA versão anterior (não alterna).
    expect(first).toBe('dist-2026-03-10');
    expect(second).toBe('dist-2026-03-10');
    expect(firstMarker).toBe('v1');
    expect(secondMarker).toBe('v1'); // mesmo estado
  });

  it('returns null when there is no snapshot to restore (no-op)', async () => {
    const restored = await rollback(paths);
    expect(restored).toBeNull();
  });

  it('returns null when only one build exists (nothing prior to restore)', async () => {
    makeStaging('only');
    await atomicSwap(paths, 'dist-only', { keep: 5 });
    const restored = await rollback(paths);
    expect(restored).toBeNull();
    expect(distMarker()).toBe('only');
  });
});
