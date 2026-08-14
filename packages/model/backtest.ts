/**
 * Backtest 2022 — o gate que decide se o projeto tem fundamento (docs/07 §4,
 * docs/01 §8). T-09.
 *
 * O que ISTO faz e o que NÃO faz:
 *
 *  - Carrega a fixture versionada `__fixtures__/2022.json` (pesquisas presidenciais
 *    nacionais de 2022, com `tse_id`), roda `runModel` (a API pública do pacote) com
 *    uma `referenceDate` FIXA e SEM nenhum dado posterior ao corte, converte a
 *    estimativa de intenção bruta para votos válidos (docs/01 §4.1/§4.3) e compara
 *    com o resultado oficial da urna (docs/07 §4.1).
 *  - Quatro comparações (docs/07 §4.2): candidato vencedor e vice, no 1º e no 2º
 *    turno. Aprovação = o oficial cai DENTRO do IC 90% da estimativa em válidos.
 *  - Reporta, por comparação, estimativa, IC 90%, LARGURA do IC (docs/07 §4.3),
 *    oficial e veredito. A largura é impressa porque um "passou" com banda estreita
 *    é suspeito de vazamento de dado futuro, não de acerto do modelo.
 *
 * O que NÃO faz, por princípio (CLAUDE.md R1): não ajusta prior, peso, nem constante
 * para fazer o backtest passar. O modelo é consumido como caixa-preta. Nenhum nome
 * de candidato/partido nem termo de espectro aparece NESTE arquivo — o gate de viés
 * (docs/07 §5.1) faz grep aqui. Os ids de candidato e o mapa para o oficial vivem na
 * FIXTURE (json), não no código.
 *
 * Este módulo é um HARNESS de teste. A leitura da fixture (fs) é do harness, não do
 * modelo: `packages/model` continua puro (runModel não faz I/O). A escala honesta é
 * o produto (docs/01 §10, docs/07 §4.3): se passar, é quase certo que a banda ficou
 * larga o bastante — o modelo soma-zero não corrige viés comum a todos os institutos.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  observationSchema,
  type Observation,
  type ModelOutput,
} from '@election-pool/contracts/model-io';
import { SCENARIO_KIND } from '@election-pool/contracts/enums';
import { MODEL_VERSION, PCT_MAX, PCT_MIN } from '@election-pool/contracts/constants';
import { runModel } from './index.js';

const ZERO = 0;
const ONE = 1;

// Cortes do backtest (docs/07 §4.1). São datas de referência FIXAS, não parâmetros
// de modelo — a véspera de cada turno de 2022. Nenhuma pesquisa com `field_end`
// posterior ao corte pode entrar (vazamento de dado futuro invalida tudo).
const CUTOFF_ROUND_1 = '2022-10-01';
const CUTOFF_ROUND_2 = '2022-10-29';

// Casas decimais só de APRESENTAÇÃO (formatação da tabela / do markdown). Não
// entram em nenhuma conta do modelo.
const PRINT_DECIMALS = 1;
const WIDTH_DECIMALS = 2;

// Limite de "banda estreita" para o alerta de suspeita de vazamento (docs/07 §4.3):
// um "passou" com largura de IC abaixo disto é suspeito. É um limiar de RELATÓRIO,
// não do modelo.
const NARROW_BAND_SUSPECT_PP = 4;

// Larguras de coluna da tabela impressa no terminal — apenas alinhamento visual,
// nenhuma delas entra em conta do modelo.
const COL_ROLE = 14;
const COL_PCT = 7;
const COL_CI = 16;
const COL_WIDTH = 11;

// --- Tipos da fixture -------------------------------------------------------

interface FixtureCandidateMeta {
  candidateId: string;
  role: string;
  officialR1ValidPct: number | null;
  officialR2ValidPct: number | null;
  tracked: boolean;
}

interface FixturePoll {
  tseId: string;
  institute: string;
  scenarioKind: string;
  fieldStart: string;
  fieldEnd: string;
  fieldMedianDate: string;
  n: number;
  values: Record<string, number>;
}

interface Fixture {
  cycle: string;
  candidateMeta: FixtureCandidateMeta[];
  runoffPair: [string, string];
  polls: FixturePoll[];
}

// --- Carregamento da fixture ------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));

export function loadFixture(): Fixture {
  const path = join(here, '__fixtures__', '2022.json');
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as Fixture;
}

/**
 * Converte as linhas da fixture em `Observation[]` do modelo, mantendo APENAS as
 * pesquisas cujo `field_end` é anterior ou igual ao corte (docs/07 §4: sem dado
 * futuro). Cada valor por candidato vira uma observação. Passa pelo schema Zod
 * (fronteira, CLAUDE.md) para aplicar os branded types.
 */
export function fixtureToObservations(
  fixture: Fixture,
  scenarioKind: string,
  cutoff: string,
): Observation[] {
  const runoffPair = fixture.runoffPair;
  const observations: Observation[] = [];
  for (const poll of fixture.polls) {
    if (poll.scenarioKind !== scenarioKind) continue;
    if (poll.fieldEnd > cutoff) continue; // sem vazamento de dado futuro
    const t2Pair = scenarioKind === SCENARIO_KIND.t2 ? runoffPair : null;
    for (const candidateId of Object.keys(poll.values)) {
      const valuePct = poll.values[candidateId];
      if (valuePct === undefined) continue;
      observations.push(
        observationSchema.parse({
          tseId: poll.tseId,
          instituteId: poll.institute,
          candidateId,
          scenarioKind,
          t2Pair,
          fieldMedianDate: poll.fieldMedianDate,
          sampleSize: poll.n,
          valuePct,
        }),
      );
    }
  }
  return observations;
}

// --- Extração da estimativa na data de referência ---------------------------

interface BandPct {
  meanPct: number;
  lo90Pct: number;
  hi90Pct: number;
}

/**
 * Estimativa de intenção bruta μ_t do candidato no ÚLTIMO nó da série (= data de
 * referência do run). O grid do Kalman termina na `referenceDate` (docs/01 §2,
 * `kalman.ts`), então o último ponto datado é o corte.
 */
function latestFirstRoundBand(output: ModelOutput, candidateId: string): BandPct | null {
  const series = output.latent.firstRound;
  for (let i = series.length - ONE; i >= ZERO; i--) {
    const point = series[i];
    if (!point) continue;
    const band = point.byCandidate[candidateId];
    if (band) return band;
  }
  return null;
}

function latestRunoffBand(
  output: ModelOutput,
  pair: readonly [string, string],
  candidateId: string,
): BandPct | null {
  const normalizedPair = pair[0] <= pair[1] ? [pair[0], pair[1]] : [pair[1], pair[0]];
  for (const runoff of output.latent.runoffs) {
    const rp = runoff.pair;
    const rn = rp[0] <= rp[1] ? [rp[0], rp[1]] : [rp[1], rp[0]];
    if (rn[0] !== normalizedPair[0] || rn[1] !== normalizedPair[1]) continue;
    const series = runoff.series;
    for (let i = series.length - ONE; i >= ZERO; i--) {
      const point = series[i];
      if (!point) continue;
      const band = point.byCandidate[candidateId];
      if (band) return band;
    }
  }
  return null;
}

// --- Conversão de intenção bruta para votos válidos (docs/01 §4.1/§4.3) ------

/**
 * Converte a banda de intenção bruta de um candidato para VOTOS VÁLIDOS,
 * normalizando pela soma das MÉDIAS dos candidatos rastreados (o denominador de
 * válidos exclui brancos/nulos/indecisos/"demais" — o resíduo). A banda (lo/hi) é
 * escalada pelo MESMO fator da média, exatamente como o modelo escala a banda na
 * restrição de soma (docs/01 §4.3, `index.ts`): preserva a largura relativa do IC
 * ao mudar de escala. Não estreita nem alarga a incerteza artificialmente.
 */
function toValidVotes(band: BandPct, trackedMeanSum: number): BandPct {
  if (trackedMeanSum <= ZERO) return band;
  const factor = PCT_MAX / trackedMeanSum;
  return {
    meanPct: clampPct(band.meanPct * factor),
    lo90Pct: clampPct(band.lo90Pct * factor),
    hi90Pct: clampPct(band.hi90Pct * factor),
  };
}

function clampPct(x: number): number {
  if (!Number.isFinite(x)) return PCT_MIN;
  if (x < PCT_MIN) return PCT_MIN;
  if (x > PCT_MAX) return PCT_MAX;
  return x;
}

// --- Uma comparação do backtest ---------------------------------------------

export interface Comparison {
  round: number;
  roleLabel: string;
  candidateId: string;
  cutoff: string;
  estimateValidPct: number;
  lo90ValidPct: number;
  hi90ValidPct: number;
  ciWidthPp: number;
  officialValidPct: number;
  passed: boolean;
}

function compare(
  round: number,
  meta: FixtureCandidateMeta,
  cutoff: string,
  validBand: BandPct,
  officialValidPct: number,
): Comparison {
  const ciWidthPp = validBand.hi90Pct - validBand.lo90Pct;
  const passed = officialValidPct >= validBand.lo90Pct && officialValidPct <= validBand.hi90Pct;
  return {
    round,
    roleLabel: meta.role,
    candidateId: meta.candidateId,
    cutoff,
    estimateValidPct: validBand.meanPct,
    lo90ValidPct: validBand.lo90Pct,
    hi90ValidPct: validBand.hi90Pct,
    ciWidthPp,
    officialValidPct,
    passed,
  };
}

// --- Execução das quatro comparações ----------------------------------------

export interface BacktestResult {
  comparisons: Comparison[];
  allPassed: boolean;
  narrowBandPass: boolean;
}

export function runBacktest(fixture: Fixture): BacktestResult {
  const comparisons: Comparison[] = [];

  // Papéis oficiais: exatamente os candidatos que a fixture mapeia para um
  // resultado de urna. O código não sabe QUEM são — só que têm oficial.
  const r1Targets = fixture.candidateMeta.filter((m) => m.officialR1ValidPct !== null);
  const r2Targets = fixture.candidateMeta.filter((m) => m.officialR2ValidPct !== null);

  // --- 1º turno (corte CUTOFF_ROUND_1) --------------------------------------
  const r1Obs = fixtureToObservations(fixture, SCENARIO_KIND.t1Estimulado, CUTOFF_ROUND_1);
  const r1Out = runModel({ observations: r1Obs, referenceDate: CUTOFF_ROUND_1 });
  const r1TrackedIds = fixture.candidateMeta.filter((m) => m.tracked).map((m) => m.candidateId);
  const r1MeanSum = sumTrackedMeans(r1Out, r1TrackedIds, latestFirstRoundBand);
  for (const meta of r1Targets) {
    const band = latestFirstRoundBand(r1Out, meta.candidateId);
    if (!band)
      throw new Error(`no first-round estimate for ${meta.candidateId} at ${CUTOFF_ROUND_1}`);
    const official = meta.officialR1ValidPct;
    if (official === null) continue;
    comparisons.push(compare(ONE, meta, CUTOFF_ROUND_1, toValidVotes(band, r1MeanSum), official));
  }

  // --- 2º turno (corte CUTOFF_ROUND_2) --------------------------------------
  const r2Obs = fixtureToObservations(fixture, SCENARIO_KIND.t2, CUTOFF_ROUND_2);
  const r2Out = runModel({ observations: r2Obs, referenceDate: CUTOFF_ROUND_2 });
  const pair = fixture.runoffPair;
  const r2Bands = new Map<string, BandPct>();
  for (const meta of r2Targets) {
    const band = latestRunoffBand(r2Out, pair, meta.candidateId);
    if (!band) throw new Error(`no runoff estimate for ${meta.candidateId} at ${CUTOFF_ROUND_2}`);
    r2Bands.set(meta.candidateId, band);
  }
  let r2MeanSum = ZERO;
  for (const band of r2Bands.values()) r2MeanSum += band.meanPct;
  const ROUND_TWO = ONE + ONE;
  for (const meta of r2Targets) {
    const band = r2Bands.get(meta.candidateId);
    const official = meta.officialR2ValidPct;
    if (!band || official === null) continue;
    comparisons.push(
      compare(ROUND_TWO, meta, CUTOFF_ROUND_2, toValidVotes(band, r2MeanSum), official),
    );
  }

  const allPassed = comparisons.every((c) => c.passed);
  const narrowBandPass = comparisons.some((c) => c.passed && c.ciWidthPp < NARROW_BAND_SUSPECT_PP);
  return { comparisons, allPassed, narrowBandPass };
}

function sumTrackedMeans(
  output: ModelOutput,
  trackedIds: readonly string[],
  pick: (o: ModelOutput, id: string) => BandPct | null,
): number {
  let sum = ZERO;
  for (const id of trackedIds) {
    const band = pick(output, id);
    if (band) sum += band.meanPct;
  }
  return sum;
}

// --- Formatação -------------------------------------------------------------

function fmt(x: number, decimals: number): string {
  return x.toFixed(decimals);
}

function verdictOf(c: Comparison): string {
  return c.passed ? 'PASS' : 'FAIL';
}

function comparisonRow(c: Comparison): string {
  const estimate = `${fmt(c.estimateValidPct, PRINT_DECIMALS)}%`;
  const ci = `[${fmt(c.lo90ValidPct, PRINT_DECIMALS)}, ${fmt(c.hi90ValidPct, PRINT_DECIMALS)}]`;
  const width = `${fmt(c.ciWidthPp, WIDTH_DECIMALS)} p.p.`;
  const official = `${fmt(c.officialValidPct, PRINT_DECIMALS)}%`;
  return `R${c.round} ${c.roleLabel.padEnd(COL_ROLE)} est ${estimate.padStart(COL_PCT)}  IC90 ${ci.padStart(COL_CI)}  largura ${width.padStart(COL_WIDTH)}  urna ${official.padStart(COL_PCT)}  ${verdictOf(c)}`;
}

export function formatTable(result: BacktestResult): string {
  const lines: string[] = [];
  lines.push('Backtest 2022 — quatro comparações (docs/07 §4)');
  lines.push('');
  for (const c of result.comparisons) lines.push(comparisonRow(c));
  lines.push('');
  lines.push(`Veredito geral: ${result.allPassed ? 'PASSOU (4/4)' : 'REPROVOU'}`);
  const passedCount = result.comparisons.filter((c) => c.passed).length;
  lines.push(`Comparações aprovadas: ${passedCount} de ${result.comparisons.length}`);
  if (result.narrowBandPass) {
    lines.push(
      `ALERTA: alguma comparação passou com IC < ${NARROW_BAND_SUSPECT_PP} p.p. — ` +
        'suspeite de vazamento de dado futuro antes de comemorar (docs/07 §4.3).',
    );
  }
  return lines.join('\n');
}

// --- Geração do docs/BACKTEST-RESULTS.md ------------------------------------

function gitSha(): { sha: string; note: string } {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      cwd: here,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (sha) return { sha, note: '' };
  } catch {
    // sem repositório git disponível neste ambiente — cai no placeholder abaixo.
  }
  return {
    sha: 'UNAVAILABLE',
    note:
      '> `git_sha` indisponível no ambiente de execução (não é um repositório git); ' +
      'placeholder registrado conforme docs/07 §4.4 exige registrar mesmo assim.',
  };
}

function mdRow(c: Comparison): string {
  const est = `${fmt(c.estimateValidPct, PRINT_DECIMALS)}%`;
  const ci = `[${fmt(c.lo90ValidPct, PRINT_DECIMALS)}; ${fmt(c.hi90ValidPct, PRINT_DECIMALS)}]`;
  const width = `${fmt(c.ciWidthPp, WIDTH_DECIMALS)}`;
  const official = `${fmt(c.officialValidPct, PRINT_DECIMALS)}%`;
  return `| ${c.round}º | ${c.roleLabel} | ${est} | ${ci} | ${width} | ${official} | ${verdictOf(c)} |`;
}

export function renderMarkdown(result: BacktestResult, generatedAt: string): string {
  const { sha, note } = gitSha();
  const passedCount = result.comparisons.filter((c) => c.passed).length;
  const verdict = result.allPassed ? 'PASSOU (4/4)' : `REPROVOU (${passedCount}/4)`;

  const lines: string[] = [];
  lines.push('# Resultados do backtest 2022');
  lines.push('');
  lines.push('> ARQUIVO GERADO por `pnpm --filter @election-pool/model model:backtest`.');
  lines.push('> NÃO editar à mão (docs/07 §4.4). Resultados reprovados também são gravados.');
  lines.push('');
  lines.push(`- **Data do run:** ${generatedAt}`);
  lines.push(`- **model_version:** ${MODEL_VERSION}`);
  lines.push(`- **git_sha:** ${sha}`);
  if (note) lines.push('');
  if (note) lines.push(note);
  lines.push('');
  lines.push('## As quatro comparações (docs/07 §4.2)');
  lines.push('');
  lines.push('Estimativa e IC 90% em VOTOS VÁLIDOS (docs/01 §4.1/§4.3). Largura em p.p.');
  lines.push('Aprovação = o resultado da urna cai dentro do IC 90%.');
  lines.push('');
  lines.push('| Turno | Papel | Estimativa | IC 90% | Largura | Urna | Veredito |');
  lines.push('|-------|-------|-----------|--------|---------|------|----------|');
  for (const c of result.comparisons) lines.push(mdRow(c));
  lines.push('');
  lines.push(`**Veredito geral: ${verdict}.**`);
  lines.push('');
  lines.push('## Leitura honesta (docs/07 §4.3)');
  lines.push('');
  lines.push(
    'O modelo v1 usa restrição de soma-zero (docs/01 §1.1) e **não tem mecanismo para ' +
      'corrigir viés comum a todos os institutos**. No 1º turno de 2022 esse viés existiu e ' +
      'foi grande: as pesquisas subestimaram o vice na urna em vários pontos. Portanto:',
  );
  lines.push('');
  lines.push(
    '- Um "PASSOU" aqui **não** significa que o modelo previu o desvio — significa, quase ' +
      'sempre, que a banda ficou larga o bastante para conter o erro. Largura honesta é o ' +
      'produto, e deve ser comunicada como tal na UI.',
  );
  lines.push(
    `- Um "PASSOU" com IC estreito (< ${NARROW_BAND_SUSPECT_PP} p.p. de largura) é ` +
      'SUSPEITO de vazamento de dado futuro na fixture, não de genialidade do modelo.',
  );
  if (result.narrowBandPass) {
    lines.push('');
    lines.push(
      `> ALERTA: ao menos uma comparação passou com IC < ${NARROW_BAND_SUSPECT_PP} p.p. ` +
        'Revisar a fixture quanto a vazamento de dado futuro.',
    );
  }
  lines.push('');
  lines.push('## Proveniência');
  lines.push('');
  lines.push(
    'Fixture: `packages/model/__fixtures__/2022.json` — pesquisas presidenciais nacionais ' +
      'de 2022 reconstruídas do registro público (PesqEle + divulgações dos institutos), em ' +
      'intenção BRUTA. Nenhum valor foi ajustado para o backtest passar (CLAUDE.md R1). ' +
      'Corte do 1º turno: ' +
      CUTOFF_ROUND_1 +
      '. Corte do 2º turno: ' +
      CUTOFF_ROUND_2 +
      '. Nenhuma pesquisa com `field_end` posterior ao corte entra no run (sem vazamento).',
  );
  lines.push('');
  return lines.join('\n');
}

// --- Entrypoint do script `model:backtest` ----------------------------------

export function writeResultsFile(result: BacktestResult): string {
  const generatedAt = new Date().toISOString();
  const md = renderMarkdown(result, generatedAt);
  const outPath = join(here, '..', '..', 'docs', 'BACKTEST-RESULTS.md');
  writeFileSync(outPath, md, 'utf8');
  return outPath;
}

/**
 * Roda o backtest, imprime a tabela e (re)gera `docs/BACKTEST-RESULTS.md`.
 * Chamado por `backtest.entry.ts` (o alvo do script `model:backtest`). Devolve
 * `true` se as quatro comparações passaram — o chamador decide o código de saída.
 */
export function main(): boolean {
  const fixture = loadFixture();
  const result = runBacktest(fixture);
  process.stdout.write(formatTable(result));
  process.stdout.write('\n');
  const outPath = writeResultsFile(result);
  process.stdout.write(`\nGerado: ${outPath}\n`);
  if (!result.allPassed) {
    process.stdout.write(
      '\nBacktest REPROVOU. Registrado em docs/BACKTEST-RESULTS.md (o histórico de ' +
        'falhas é parte da credibilidade do projeto, docs/07 §4.4). NÃO ajuste o modelo ' +
        'para passar (R1); investigue os dados de entrada.\n',
    );
  }
  return result.allPassed;
}
