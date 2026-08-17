import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { MODEL_VERSION, DATA_JSON_MAX_AGE_SECONDS } from '@election-pool/contracts/constants';
import type { PublicData } from '@election-pool/contracts/public-data';
import type { Database } from '../db/pool.js';
import { RenderReadModel } from '../publish/read-model.js';
import { assemblePublicData } from '../publish/data-assembler.js';
import { evaluatePublicationGates } from '../publish/publication-gates.js';
import { buildToStaging, type AstroBuildDeps } from '../publish/astro-build.js';
import { atomicSwap } from '../publish/atomic-swap.js';
import { findThirdPartyProse } from '../publish/no-third-party-prose.js';
import { resolvePublishPaths, type PublishPaths } from '../publish/paths.js';

/**
 * RenderJob (docs/02 §3.4, docs/07 §6). Onde as três trilhas se encontram: lê o
 * dado normalized, roda o modelo, monta `data.json`, constrói o site e PUBLICA
 * atomicamente — mas só se TODOS os gates de publicação passarem (docs/07 §6).
 *
 * Disparado por `ModelJob` quando o run passa os gates (docs/02 §3.4); o
 * orquestrador (T-14) fia o gatilho. Idempotente e rodável sozinho por CLI
 * (docs/02 §3): sem novo dado, o gate de frescor (§6.7) impede republicar o mesmo.
 *
 * Filosofia (docs/07 §1): publicar dado velho é aceitável, publicar dado errado
 * não. Qualquer falha ⇒ aborta, mantém o `dist/` atual no ar, emite alerta. Na
 * dúvida, aborta.
 */

export const CRON_TRIGGER = 'after ModelJob gates_passed'; // docs/02 §3.4 (não é cron fixo)

/** docs/02 §3.4: retém os 5 últimos `dist-*` para rollback. */
export const SNAPSHOTS_TO_KEEP = 5;

export type RenderAlert =
  | { kind: 'gates_failed'; detail: string }
  | { kind: 'third_party_prose'; detail: string }
  | { kind: 'render_error'; detail: string }
  | { kind: 'no_race'; detail: string };

export interface RenderResult {
  published: boolean;
  /** Motivo de não ter publicado (quando published=false). */
  abortReason: string | null;
  alerts: RenderAlert[];
  /** Veredito de cada gate (para log estruturado). */
  gateResults: { name: string; ok: boolean; detail: string }[];
  /** O data.json montado (mesmo quando não publica — para inspeção/teste). */
  data: PublicData | null;
  /** Caminho do dist publicado, quando published=true. */
  distPath: string | null;
  /**
   * true quando o que foi publicado é o PLACEHOLDER (estado vazio explicado),
   * não uma estimativa. Vai para as métricas do job — quem lê o log precisa
   * distinguir "site no ar com número" de "site no ar dizendo que não há número".
   */
  placeholder: boolean;
}

export interface RenderDeps {
  db: Database;
  raceId: string;
  /** Diretório-base de publicação (contém dist/ e os diretórios de swap). */
  publishBaseDir: string;
  /** Diretório do app web (@election-pool/web). */
  webDir: string;
  now?: () => Date;
  gitSha?: string;
  /** Injeção do executor de build (teste). */
  runBuild?: AstroBuildDeps['runBuild'];
  /**
   * docs/07 §6.6: há adapter suspeito há mais de 3 ciclos? T-14 fia a métrica real
   * (docs/02 §5). Default false (sem observabilidade montada, assume-se saudável;
   * o orquestrador sobrescreve).
   */
  suspectAdapterOverThreshold?: boolean;
  /**
   * Publicação de PLACEHOLDER: quando ainda NÃO existe `dist/` no ar e o ÚNICO
   * gate reprovado é o do modelo (§6.1), publica mesmo assim. O artefato é o
   * mesmo `data.json` honesto (sem série latente, porque não há), e a UI troca as
   * seções de dado pelo estado vazio explicado — em vez de o visitante receber um
   * 404 do nginx e não saber se o site quebrou ou se ainda não há pesquisa.
   *
   * O que isto NÃO faz: não substitui site bom por placeholder (exige `dist`
   * inexistente), não ignora build sujo, data.json inválido, adapter suspeito nem
   * frescor — todos esses continuam abortando. É estritamente o caso "primeira
   * publicação, ainda sem cobertura".
   */
  allowPlaceholderPublish?: boolean;
}

export class RenderJob {
  private readonly db: Database;
  private readonly raceId: string;
  private readonly paths: PublishPaths;
  private readonly webDir: string;
  private readonly now: () => Date;
  private readonly gitSha: string;
  private readonly runBuild: AstroBuildDeps['runBuild'];
  private readonly suspectAdapterOverThreshold: boolean;
  private readonly allowPlaceholderPublish: boolean;

  constructor(deps: RenderDeps) {
    this.db = deps.db;
    this.raceId = deps.raceId;
    this.paths = resolvePublishPaths(deps.publishBaseDir);
    this.webDir = deps.webDir;
    this.now = deps.now ?? (() => new Date());
    this.gitSha = deps.gitSha ?? resolveGitSha(deps.webDir);
    this.runBuild = deps.runBuild;
    this.suspectAdapterOverThreshold = deps.suspectAdapterOverThreshold ?? false;
    this.allowPlaceholderPublish = deps.allowPlaceholderPublish ?? false;
  }

  async run(): Promise<RenderResult> {
    const alerts: RenderAlert[] = [];
    const now = this.now();

    // 1. Lê o dado normalized/reference e monta o data.json.
    const read = new RenderReadModel(this.db);
    const race = await read.getRace(this.raceId);
    if (race === null) {
      const detail = `corrida ${this.raceId} inexistente`;
      alerts.push({ kind: 'no_race', detail });
      return this.aborted(detail, alerts, [], null);
    }

    let data: PublicData;
    let gatesPassed: boolean;
    try {
      const [scenarioResults, electorate, registrations, polls, candidates, institutes] =
        await Promise.all([
          read.listCanonicalScenarioResults(this.raceId),
          read.listCanonicalElectorate(this.raceId),
          read.listRegistrations(this.raceId),
          read.listPolls(this.raceId),
          read.listCandidates(this.raceId),
          read.listInstitutes(this.raceId),
        ]);

      const assembled = assemblePublicData({
        raceId: this.raceId,
        race,
        scenarioResults,
        electorate,
        registrations,
        polls,
        candidates,
        institutes,
        now,
        modelVersion: MODEL_VERSION,
        gitSha: this.gitSha,
      });
      data = assembled.data;
      gatesPassed = assembled.gatesPassed;
    } catch (err) {
      // O montador LANÇA quando o data.json não valida ou o modelo viola a
      // restrição de soma (R4). Isso é gate reprovado ⇒ aborta, dist intacto.
      const detail = err instanceof Error ? err.message : String(err);
      alerts.push({ kind: 'render_error', detail });
      return this.aborted(`montagem falhou: ${detail}`, alerts, [], null);
    }

    // 2. Sem prosa de terceiros (docs/08 §2.1, R3): gate bloqueante antes de tudo.
    const proseViolations = findThirdPartyProse(data);
    if (proseViolations.length > 0) {
      const detail = proseViolations.map((v) => `${v.path} (${String(v.length)} chars)`).join('; ');
      alerts.push({ kind: 'third_party_prose', detail });
      return this.aborted(`prosa de terceiros no data.json: ${detail}`, alerts, [], data);
    }

    // 3. Constrói o site para dist-staging com o data.json real.
    const serialized = JSON.stringify(data, null, 2) + '\n';
    let astroClean = false;
    let astroOutput = '';
    try {
      const buildDeps: AstroBuildDeps = { paths: this.paths, webDir: this.webDir };
      if (this.runBuild !== undefined) buildDeps.runBuild = this.runBuild;
      const outcome = await buildToStaging(data, serialized, buildDeps);
      astroClean = outcome.clean;
      astroOutput = outcome.output;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      alerts.push({ kind: 'render_error', detail: `astro build: ${detail}` });
      return this.aborted(`astro build lançou: ${detail}`, alerts, [], data);
    }

    // 4. Gates de publicação (docs/07 §6). TODOS bloqueantes.
    const verdict = await evaluatePublicationGates({
      paths: this.paths,
      modelGatesPassed: gatesPassed,
      astroBuildClean: astroClean,
      dataJsonValidated: true, // o montador já validou contra o schema
      suspectAdapterOverThreshold: this.suspectAdapterOverThreshold,
      newGeneratedAt: data.generatedAt,
    });
    const gateResults = verdict.results;

    let placeholder = false;
    if (!verdict.passed) {
      const failedResults = gateResults.filter((r) => !r.ok);
      const failed = failedResults.map((r) => `${r.name}: ${r.detail}`);
      const detail = failed.join(' | ');

      // Exceção estrita e única: primeira publicação (sem `dist/`) cujo ÚNICO gate
      // reprovado é o do modelo. Publica o estado vazio explicado em vez de deixar
      // o nginx devolvendo 404. Qualquer outro gate reprovado ⇒ aborta como sempre.
      placeholder =
        this.allowPlaceholderPublish &&
        failedResults.every((r) => r.name === 'model_gates_passed') &&
        !existsSync(this.paths.dist);

      if (!placeholder) {
        alerts.push({ kind: 'gates_failed', detail: `${detail} :: astro=${astroOutput.trim()}` });
        return this.aborted(`gate(s) reprovado(s): ${detail}`, alerts, gateResults, data);
      }
      // O alerta continua sendo emitido: publicar placeholder NÃO é normalidade.
      alerts.push({ kind: 'gates_failed', detail: `placeholder publicado :: ${detail}` });
    }

    // 5. Swap atômico (docs/02 §3.4). Snapshot do build ANTERIOR nomeado pelo
    // generatedAt do novo run (nome único e ordenável).
    const snapshotName = `dist-${data.generatedAt.replace(/[:.]/g, '-')}`;
    try {
      await atomicSwap(this.paths, snapshotName, { keep: SNAPSHOTS_TO_KEEP });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      alerts.push({ kind: 'render_error', detail: `swap: ${detail}` });
      return this.aborted(`swap atômico falhou: ${detail}`, alerts, gateResults, data);
    }

    return {
      published: true,
      abortReason: null,
      alerts,
      gateResults,
      data,
      distPath: this.paths.dist,
      placeholder,
    };
  }

  private aborted(
    reason: string,
    alerts: RenderAlert[],
    gateResults: { name: string; ok: boolean; detail: string }[],
    data: PublicData | null,
  ): RenderResult {
    return {
      published: false,
      abortReason: reason,
      alerts,
      gateResults,
      data,
      distPath: null,
      placeholder: false,
    };
  }
}

/**
 * Resolve o git SHA para `data.json`.gitSha. Prioridade: `GIT_SHA` do ambiente (o
 * CI/orquestrador o injeta) ⇒ `git rev-parse HEAD` no diretório ⇒ sentinela
 * `'unknown'`. gitSha é METADATA de proveniência, não valor de pesquisa; um
 * sentinel aqui não corrompe número algum (R4 mira dado de pesquisa). Ainda assim
 * o orquestrador deve sempre injetar `GIT_SHA` em produção.
 */
export const resolveGitSha = (cwd: string): string => {
  const fromEnv = process.env['GIT_SHA'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};

/** docs/03 §5: cabeçalho de cache do /data.json (documentado para o nginx de T-14). */
export const DATA_JSON_CACHE_CONTROL = `public, max-age=${String(DATA_JSON_MAX_AGE_SECONDS)}`;
