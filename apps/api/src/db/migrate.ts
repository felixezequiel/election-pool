/**
 * Roda as migrations no BOOT do orquestrador, ANTES de qualquer job (docs/02 §7:
 * "Migrations rodam no boot do api, antes dos jobs. Falha de migration impede o
 * boot"). Se qualquer migration falhar, LANÇA — o `main.ts` deixa o processo sair
 * com código != 0 e os jobs nunca começam (aceite T-14).
 *
 * Implementação: delega à CLI `node-pg-migrate --tsx` (as migrations são `.ts` e o
 * flag `--tsx` resolve TS; o `runner` programático usa resolução CJS e não enxerga
 * os hooks do tsx para os subpaths de workspace). Rodamos a CLI local do pacote
 * (`node_modules/.bin/node-pg-migrate`) apontando para `infra/migrations`, capturando
 * o exit code: != 0 ⇒ lança e o boot aborta.
 *
 * `NODE_PATH`: as migrations importam `@election-pool/contracts/enums`, mas o
 * node-pg-migrate as resolve a partir do DIRETÓRIO da migration (`infra/migrations`),
 * cuja cadeia de `node_modules` não alcança o pacote de workspace (o pnpm o linka em
 * `apps/api/node_modules`, não na raiz). Adicionamos `apps/api/node_modules` ao
 * `NODE_PATH` para o resolver encontrar o subpath — vale no host e no container. Sem
 * isso, um banco NOVO falha ao CARREGAR as migrations `.ts` (num banco já migrado o
 * carregamento é pulado, o que mascarava o problema).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/api/src/db → apps/api ; e → infra/migrations
const API_DIR = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(API_DIR, '..', '..', 'infra', 'migrations');
/**
 * Binário do runner. No Windows o `node_modules/.bin` contém um shim `.CMD` (e um
 * `.ps1`), não um executável sem extensão — `spawn` do nome puro falha com
 * `ENOENT`, e o sintoma é "migration não roda" numa máquina e roda na outra. O
 * separador do NODE_PATH também é específico da plataforma (`;` no Windows).
 */
const IS_WINDOWS = process.platform === 'win32';
const MIGRATE_BIN = join(
  API_DIR,
  'node_modules',
  '.bin',
  IS_WINDOWS ? 'node-pg-migrate.CMD' : 'node-pg-migrate',
);
const PATH_SEP = IS_WINDOWS ? ';' : ':';
// Onde o pnpm linka `@election-pool/*` (subpaths que as migrations importam). Entra
// no NODE_PATH para o resolver do node-pg-migrate encontrá-los a partir de infra/.
const API_NODE_MODULES = join(API_DIR, 'node_modules');

const EXIT_OK = 0;

export interface MigrateResult {
  /** stdout combinado do runner (para o log estruturado do boot). */
  output: string;
}

/**
 * Aplica todas as migrations pendentes (direção `up`). Resolve com a saída do
 * runner; LANÇA se o processo sair != 0 (nunca engole erro — R4, docs/02 §7).
 */
export const runMigrations = (databaseUrl: string): Promise<MigrateResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      MIGRATE_BIN,
      ['up', '-m', MIGRATIONS_DIR, '--tsx', '--no-lock', '-j', 'ts'],
      {
        cwd: API_DIR,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          NODE_PATH: process.env['NODE_PATH']
            ? `${API_NODE_MODULES}${PATH_SEP}${process.env['NODE_PATH']}`
            : API_NODE_MODULES,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        // O shim .CMD precisa do interpretador de comandos do Windows.
        shell: IS_WINDOWS,
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === EXIT_OK) {
        resolve({ output });
      } else {
        reject(new Error(`migrations falharam (exit ${String(code)}):\n${output}`));
      }
    });
  });
