import { join } from 'node:path';

/**
 * Layout de diretórios da publicação (docs/02 §3.4, §7). O nginx serve
 * `<base>/dist` e mais nada. Todos os diretórios do swap moram sob o MESMO
 * `base` — logo, no mesmo filesystem — porque `rename(2)` só é atômico dentro de
 * um filesystem (armadilha de T-13). Se `dist-staging` estivesse noutro volume,
 * o "swap" viraria copy+delete e o nginx poderia ver estado intermediário.
 *
 * `base` vem de `PUBLISH_BASE_DIR`. Em produção é `/var/lib/election-pool`
 * (docs/02 §2). Nos testes é um tmpdir dedicado — nunca embutimos o caminho de
 * produção no código.
 */

export interface PublishPaths {
  /** Raiz que contém `dist` (symlink) e os builds versionados. */
  base: string;
  /**
   * Symlink servido pelo nginx; aponta para o build versionado corrente. Nunca
   * some durante um swap (a troca do symlink é atômica e sem vão).
   */
  dist: string;
  /** Alvo do `astro build`, depois renomeado para o diretório versionado. */
  distStaging: string;
}

const DIST = 'dist';
const DIST_STAGING = 'dist-staging';
// Nomes de swap legados (versões anteriores usavam a dança de 3 renames). Mantidos
// reservados para que a listagem de snapshots os ignore caso restem no disco.
const DIST_NEW = 'dist-new';
const DIST_OLD = 'dist-old';

/** Prefixo dos snapshots retidos (`dist-<timestamp>`). */
export const SNAPSHOT_PREFIX = 'dist-';

/**
 * Nomes reservados sob `base` que NÃO são snapshots de rollback, ainda que
 * comecem por `dist-`. A retenção e o rollback os ignoram.
 */
export const RESERVED_DIST_NAMES: ReadonlySet<string> = new Set([
  DIST,
  DIST_STAGING,
  DIST_NEW,
  DIST_OLD,
]);

export const resolvePublishPaths = (base: string): PublishPaths => ({
  base,
  dist: join(base, DIST),
  distStaging: join(base, DIST_STAGING),
});

/**
 * Diretório-base de publicação a partir do ambiente. Falha alta (R4): sem um
 * destino explícito não há default de produção surpresa — quem opera precisa
 * declarar `PUBLISH_BASE_DIR` (o orquestrador T-14 o injeta).
 */
export const requirePublishBaseDir = (env: NodeJS.ProcessEnv = process.env): string => {
  const base = env['PUBLISH_BASE_DIR'];
  if (base === undefined || base.length === 0) {
    throw new Error(
      'PUBLISH_BASE_DIR não definida: o RenderJob precisa de um diretório-base ' +
        'de publicação (ex.: /var/lib/election-pool). Ver docs/02 §3.4.',
    );
  }
  return base;
};
