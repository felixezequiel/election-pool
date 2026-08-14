import { spawn } from 'node:child_process';
import { writeFile, mkdir, rm, copyFile, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PublicData } from '@election-pool/contracts/public-data';
import type { PublishPaths } from './paths.js';

/**
 * Dispara o `astro build` para `dist-staging/` com o `data.json` real como entrada
 * (docs/02 §3.4 passo 2). O acoplamento com a costura de T-12 é deliberado:
 *
 *  - Escrevemos o `data.json` gerado por cima de `apps/web/src/data/sample-data.json`
 *    (a costura designada por T-12 — `load.ts` importa esse caminho e roda
 *    `publicDataSchema.parse`). Assim o site é construído a partir do dado real,
 *    passando pelo MESMO gate de validação que a costura já impõe (R4). É a opção
 *    (a) do handoff de T-12 (sobrescrever a amostra), escolhida por manter o
 *    `load.ts` intocado.
 *  - Também gravamos o `data.json` como arquivo servível em `dist-staging/data.json`
 *    (a API pública em `/data.json`, docs/03 §5). O astro não o serve sozinho
 *    porque ele não está em `public/`; copiá-lo ao staging após o build o publica
 *    em `/data.json`.
 *
 * "Sem warning" (docs/07 §6.3): o astro escreve avisos em stderr e/ou stdout. Nós
 * capturamos ambos, detectamos a palavra de aviso e o exit code; o RenderJob usa
 * `clean` como gate. Falha alta (R4): exit != 0 ⇒ `clean = false`, aborta.
 */

const SEAM_RELATIVE = ['src', 'data', 'sample-data.json'];
const DATA_JSON = 'data.json';
/**
 * Nome do diretório de build LOCAL, dentro do `webDir`. O `astro build` move seus
 * assets internos (`.astro/.prerender` → outDir) com `rename`, que só é atômico
 * DENTRO de um filesystem; se o outDir estiver noutro volume (deploy em container,
 * PUBLISH_BASE_DIR num bind mount), o build lança `EXDEV` (armadilha de T-13/deploy).
 * Construímos SEMPRE num outDir local ao `webDir` — mesmo filesystem que o app e seu
 * `node_modules`/`.astro` — e só então copiamos a árvore pronta para `dist-staging`
 * (a cópia cruza filesystem sem problema: não é a etapa atômica; o swap dentro de
 * PUBLISH_BASE_DIR continua sendo rename same-fs).
 */
const LOCAL_BUILD_DIR = '.dist-build';

export interface AstroBuildDeps {
  paths: PublishPaths;
  /** Diretório do app web (contém package.json do @election-pool/web). */
  webDir: string;
  /** Executor do comando de build; injetável para teste. */
  runBuild?: (args: RunBuildArgs) => Promise<RunBuildResult>;
}

export interface RunBuildArgs {
  webDir: string;
  outDir: string;
}

export interface RunBuildResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AstroBuildOutcome {
  /** exit 0 E sem warning (docs/07 §6.3). */
  clean: boolean;
  exitCode: number;
  hadWarning: boolean;
  output: string;
}

/**
 * 1. Escreve o data.json na costura de T-12 (sobrescreve sample-data.json).
 * 2. Roda `astro build --outDir <dist-staging>`.
 * 3. Copia o data.json para `<dist-staging>/data.json` (servível em /data.json).
 */
export const buildToStaging = async (
  data: PublicData,
  serializedDataJson: string,
  deps: AstroBuildDeps,
): Promise<AstroBuildOutcome> => {
  const seamPath = join(deps.webDir, ...SEAM_RELATIVE);
  // A costura recebe o data.json real; JSON estável (2 espaços) para diffs limpos.
  await writeFile(seamPath, serializedDataJson, 'utf8');

  // Build LOCAL ao webDir (mesmo filesystem que `.astro`/node_modules) para evitar
  // EXDEV no move interno do astro (ver LOCAL_BUILD_DIR). Limpo a cada run.
  const localOut = join(deps.webDir, LOCAL_BUILD_DIR);
  if (existsSync(localOut)) {
    await rm(localOut, { recursive: true, force: true });
  }
  await mkdir(localOut, { recursive: true });

  const run = deps.runBuild ?? defaultRunBuild;
  const result = await run({ webDir: deps.webDir, outDir: localOut });

  const output = `${result.stdout}\n${result.stderr}`;
  const hadWarning = detectWarning(output);
  const clean = result.exitCode === 0 && !hadWarning;

  // Staging limpo em PUBLISH_BASE_DIR. Só materializamos o staging quando o build
  // foi limpo — assim os gates de publicação (§6) que checam dist-staging reprovam
  // corretamente num build sujo/falho (nada meio-pronto no caminho de publicação).
  if (existsSync(deps.paths.distStaging)) {
    await rm(deps.paths.distStaging, { recursive: true, force: true });
  }
  if (clean) {
    // Copia a árvore PRONTA para dist-staging (cruza filesystem sem risco — não é a
    // etapa atômica; o swap dentro de PUBLISH_BASE_DIR segue rename same-fs).
    await cp(localOut, deps.paths.distStaging, { recursive: true });
    // Publica o data.json servível ao lado do site construído.
    await copyFile(seamPath, join(deps.paths.distStaging, DATA_JSON));
  } else {
    // Build sujo: garante que dist-staging exista (vazio) para os gates o inspecionarem.
    await mkdir(deps.paths.distStaging, { recursive: true });
  }
  // Limpa o build local (não polui o webDir versionado entre runs).
  await rm(localOut, { recursive: true, force: true });

  // `data` é aceito para manter a assinatura orientada ao artefato validado; a
  // serialização já veio pronta do chamador (fonte única do texto do JSON).
  void data;

  return { clean, exitCode: result.exitCode, hadWarning, output };
};

/**
 * Marcadores de aviso do PRÓPRIO astro/vite (docs/07 §6.3 exige build sem warning).
 * O astro/vite tagueiam avisos com `[WARN]` ou `[vite] warning`. Casamos esses
 * marcadores em vez de um `warn` solto para não confundir com ruído do ambiente —
 * p.ex. o `Warning: Ignoring extra certs...` do Node (NODE_EXTRA_CA_CERTS apontando
 * para arquivo ausente), que não é um aviso de build. Ainda somos conservadores:
 * qualquer aviso REAL do astro reprova (aborta, mantém dado velho — docs/07 §1).
 */
const ASTRO_WARNING_MARKERS: readonly RegExp[] = [
  /\[WARN\]/i, // logger do astro
  /\[vite\][^\n]*warning/i, // avisos do vite
  /^\s*warn(?:ing)?\b/im, // linha de aviso do logger (início de linha)
];

/** Linhas de ruído do ambiente que NÃO são avisos de build (sandbox). */
const ENV_NOISE_MARKERS: readonly RegExp[] = [/Ignoring extra certs/i];

const detectWarning = (output: string): boolean => {
  const lines = output.split('\n').filter((line) => !ENV_NOISE_MARKERS.some((re) => re.test(line)));
  const cleaned = lines.join('\n');
  return ASTRO_WARNING_MARKERS.some((re) => re.test(cleaned));
};

const defaultRunBuild = (args: RunBuildArgs): Promise<RunBuildResult> =>
  new Promise((resolve, reject) => {
    // `astro build --outDir <abs>`: outDir absoluto e LOCAL ao webDir (mesmo
    // filesystem que `.astro`/node_modules) — o move interno do astro é same-fs, sem
    // EXDEV. A cópia para dist-staging (outro volume) acontece depois, em buildToStaging.
    const child = spawn('pnpm', ['exec', 'astro', 'build', '--outDir', args.outDir], {
      cwd: args.webDir,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
