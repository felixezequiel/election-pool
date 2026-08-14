import { rename, rm, readdir, stat, symlink, readlink, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RESERVED_DIST_NAMES, SNAPSHOT_PREFIX, type PublishPaths } from './paths.js';

/**
 * Publicação atômica (docs/02 §3.4). O nginx serve `<base>/dist` e NUNCA pode ver
 * um estado intermediário — nem arquivo pela metade, nem ENOENT (aceite de T-13).
 *
 * A dança de renames descrita em docs/02 §3.4 —
 *   rename(dist-staging→dist-new) → rename(dist→dist-old) → rename(dist-new→dist)
 * — tem um vão inerente: entre os passos 2 e 3, `dist` não existe por um instante,
 * e um GET que caia nesse vão recebe ENOENT. O aceite proíbe isso. Realizamos o
 * MESMO efeito de forma comprovadamente sem-vão publicando `dist` como um SYMLINK
 * para o build versionado corrente:
 *
 *   1. rename(dist-staging → dist-<snapshot>)   # build vira diretório versionado
 *   2. symlink(dist-<snapshot>, dist.tmp)       # link novo, ainda não visível
 *   3. rename(dist.tmp → dist)                  # troca ATÔMICA do symlink
 *
 * `rename` de um symlink sobre um symlink existente é atômico no Linux e NÃO tem
 * vão: em qualquer instante `dist` resolve para um diretório completo, o antigo ou
 * o novo. É o mesmo princípio de docs/02 §3.4 (um único rename de árvore completa
 * publica o novo estado), com a garantia extra de que `dist` nunca deixa de
 * existir. O nginx precisa resolver symlink (`disable_symlinks off`, o padrão) —
 * anotado para T-14.
 *
 * Retém os 5 últimos `dist-<snapshot>` (docs/02 §3.4). Falha alta (R4): qualquer
 * passo que lance aborta e não deixa `dist` apontando para árvore incompleta.
 */

export interface SnapshotRetention {
  /** Quantos snapshots `dist-<ts>` manter (docs/02 §3.4: os 5 últimos). */
  keep: number;
}

const DIST_TMP_SUFFIX = '.tmp-publish';

/**
 * Executa o swap atômico. Pressupõe que `distStaging` existe e passou nos gates.
 * Ao final: `dist` (symlink) aponta para o novo build versionado; os builds
 * anteriores permanecem como snapshots `dist-<ts>`; só os `keep` mais recentes
 * ficam.
 *
 * @param snapshotName Nome do diretório versionado do build NOVO (`dist-<ts>`).
 */
export const atomicSwap = async (
  paths: PublishPaths,
  snapshotName: string,
  retention: SnapshotRetention,
): Promise<void> => {
  if (!existsSync(paths.distStaging)) {
    throw new Error(`swap abortado: dist-staging inexistente em ${paths.distStaging}`);
  }
  const versionedPath = join(paths.base, snapshotName);
  const tmpLink = join(paths.base, `${snapshotName}${DIST_TMP_SUFFIX}`);

  // Higiene: restos de um swap anterior interrompido.
  await removeIfExists(versionedPath);
  await removeIfExists(tmpLink);

  // 1. staging → diretório versionado (árvore completa, pronta para servir).
  await rename(paths.distStaging, versionedPath);

  // 2+3. Publica por troca atômica do symlink `dist`.
  await pointDistAt(paths, snapshotName, tmpLink);

  await pruneSnapshots(paths, retention.keep);
};

/**
 * Aponta `dist` (symlink) para `<base>/<target>` de forma atômica: cria um symlink
 * temporário e o renomeia sobre `dist`. Sem vão de ENOENT — `dist` só deixa de
 * apontar para o alvo antigo no instante atômico do rename.
 *
 * Se `dist` hoje é um diretório de verdade (instalação legada, primeira migração),
 * ele é movido para um snapshot antes da troca, para não perder o build no ar.
 */
const pointDistAt = async (paths: PublishPaths, target: string, tmpLink: string): Promise<void> => {
  await migrateLegacyDistDir(paths);
  await removeIfExists(tmpLink);
  // symlink relativo (ao próprio base): o diretório de publicação fica portátil.
  await symlink(target, tmpLink);
  await rename(tmpLink, paths.dist); // troca atômica do symlink
};

/**
 * Se `dist` for um diretório REAL (não symlink) — estado de uma instalação que
 * ainda não usava symlink —, converte-o num snapshot versionado para preservá-lo
 * e liberar o nome `dist` para virar symlink. No-op quando `dist` já é symlink ou
 * não existe.
 */
const migrateLegacyDistDir = async (paths: PublishPaths): Promise<void> => {
  if (!existsSync(paths.dist)) return;
  const info = await lstat(paths.dist);
  if (info.isSymbolicLink()) return;
  const legacyName = `${SNAPSHOT_PREFIX}legacy-${String(Date.now())}`;
  await rename(paths.dist, join(paths.base, legacyName));
};

/**
 * Restaura a versão ANTERIOR para `dist` (`pnpm publish:rollback`, docs/02 §3.4).
 * IDEMPOTENTE: rodar duas vezes restaura o mesmo estado, sem toggle nem erro.
 *
 * "Anterior" é definido em relação ao build MAIS RECENTE (o snapshot de maior
 * mtime), não em relação a onde `dist` aponta agora: é o SEGUNDO snapshot mais
 * recente. Ancorar no mais recente (e não no alvo atual) é o que garante
 * idempotência — rodar de novo continua apontando para o mesmo penúltimo build, em
 * vez de alternar entre os dois. Com `dist` sendo symlink, repontá-lo não copia
 * nem destrói nada, então repetir é trivialmente seguro.
 *
 * @returns o nome do snapshot restaurado, ou null se não há versão anterior
 *          distinta (0 ou 1 snapshot).
 */
export const rollback = async (paths: PublishPaths): Promise<string | null> => {
  const snapshots = await listSnapshots(paths);
  // snapshots[0] = mais recente; snapshots[1] = a versão anterior a restaurar.
  const previous = snapshots[1];
  if (previous === undefined) return null;

  const tmpLink = join(paths.base, `${previous.name}${DIST_TMP_SUFFIX}`);
  await pointDistAt(paths, previous.name, tmpLink);
  return previous.name;
};

/** Nome do diretório versionado para o qual `dist` (symlink) aponta hoje, ou null. */
export const currentDistTarget = async (paths: PublishPaths): Promise<string | null> => {
  if (!existsSync(paths.dist)) return null;
  const info = await lstat(paths.dist);
  if (!info.isSymbolicLink()) return null;
  const link = await readlink(paths.dist);
  // Armazenamos o alvo relativo (só o nome do snapshot).
  return link.replace(/^\.\//, '');
};

// --- retenção de snapshots --------------------------------------------------

interface Snapshot {
  name: string;
  /** mtime em ms — mais recente primeiro na ordenação. */
  mtimeMs: number;
}

/**
 * Lista os snapshots `dist-<algo>` sob `base`, do mais recente ao mais antigo,
 * ignorando os nomes reservados (`dist`, `dist-staging`, `dist-new`, `dist-old`) e
 * os symlinks temporários. Ordena por mtime; desempata por nome decrescente (os
 * nomes carregam timestamp, então nome maior ≈ mais novo).
 */
export const listSnapshots = async (paths: PublishPaths): Promise<Snapshot[]> => {
  if (!existsSync(paths.base)) return [];
  const entries = await readdir(paths.base, { withFileTypes: true });
  const snapshots: Snapshot[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // symlinks e arquivos fora
    if (!entry.name.startsWith(SNAPSHOT_PREFIX)) continue;
    if (RESERVED_DIST_NAMES.has(entry.name)) continue;
    if (entry.name.endsWith(DIST_TMP_SUFFIX)) continue;
    const info = await stat(join(paths.base, entry.name));
    snapshots.push({ name: entry.name, mtimeMs: info.mtimeMs });
  }
  snapshots.sort(
    (a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0),
  );
  return snapshots;
};

const pruneSnapshots = async (paths: PublishPaths, keep: number): Promise<void> => {
  const snapshots = await listSnapshots(paths);
  const current = await currentDistTarget(paths);
  // Mantém os `keep` mais recentes por mtime. Além disso, NUNCA remove o snapshot
  // para o qual `dist` aponta (mesmo que, após um rollback, ele caia fora dos N) —
  // remover o alvo do symlink deixaria o site fora do ar.
  const toRemove = snapshots.slice(keep).filter((s) => s.name !== current);
  for (const snap of toRemove) {
    await removeIfExists(join(paths.base, snap.name));
  }
};

const removeIfExists = async (path: string): Promise<void> => {
  if (existsSync(path)) {
    await rm(path, { recursive: true, force: true });
  }
};
