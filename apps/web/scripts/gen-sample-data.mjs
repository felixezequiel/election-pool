/**
 * Gerador one-shot da amostra `src/data/sample-data.json`. NÃO faz parte do
 * build; roda manualmente para (re)produzir uma amostra COMPLETA e válida contra
 * `publicDataSchema`. Construir programaticamente as séries evita erro de digitação
 * e prova, na hora da geração, que o JSON passa no schema. Depois de gerar, este
 * script pode ser descartado — o artefato versionado é o JSON.
 *
 * ── Schema versão '2' (MODEL_VERSION 2.0.0, docs/OPEN-QUESTIONS Q-10) ────────
 * A amostra agora exercita os campos novos, porque um campo que a amostra não
 * cobre é um campo que a UI nunca é obrigada a tratar:
 *   - `candidates[].photoPath` / `photoSourceUrl` — dois candidatos COM foto e
 *     dois SEM (`null`), para que o fallback de monograma seja sempre visível em
 *     desenvolvimento;
 *   - `latent.electorate` — branco/nulo e não-sabe como séries, com pontos
 *     `null` DE PROPÓSITO (ausência de medida ≠ zero, R4);
 *   - `polls[].blankNullPct` / `undecidedPct` — alguns declarados, alguns `null`;
 *   - `transitions` — três passos, com pelo menos um fluxo `notIdentifiable`.
 *
 * Como rodar (o pacote de contratos exporta `.ts`, então precisa de loader de TS):
 *   node ../../node_modules/.pnpm/tsx@4.19.2/node_modules/tsx/dist/cli.mjs \
 *     scripts/gen-sample-data.mjs
 *
 * Nomes fictícios ('Andrade', 'Barros'…): a amostra NUNCA contém presidenciável
 * real. As "fotos" da amostra são desenhos abstratos nossos em `public/candidatos/`
 * (não são imagem de pessoa nem de terceiro, docs/08 §2) — no ar, o que entra ali
 * é a foto oficial do registro de candidatura servida por nós.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { publicDataSchema } from '@election-pool/contracts/public-data';
import {
  MODEL_VERSION,
  PUBLIC_DATA_SCHEMA_VERSION,
  TRANSITION_STICKINESS_PRIOR,
  UPDATE_INTERVAL_MINUTES,
} from '@election-pool/contracts/constants';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'src', 'data', 'sample-data.json');

const DAY_MS = 86_400_000;
const BASE = Date.parse('2026-05-16T00:00:00-03:00');
function isoDay(offsetDays) {
  return new Date(BASE + offsetDays * DAY_MS).toISOString().slice(0, 10);
}
function band(mean, half) {
  return {
    mean: round1(mean),
    lo90: round1(Math.max(0, mean - half)),
    hi90: round1(Math.min(100, mean + half)),
  };
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

// Registro de candidatura (proveniência da foto, R6). É link, nunca conteúdo.
const CAND_REGISTRY_URL = 'https://divulgacandcontas.tse.jus.br/';

const candidates = [
  {
    id: 'cand-a',
    displayName: 'Andrade',
    party: 'PXA',
    colorSlot: 1,
    photoPath: '/candidatos/amostra-andrade.svg',
    photoSourceUrl: CAND_REGISTRY_URL,
  },
  {
    id: 'cand-b',
    displayName: 'Barros',
    party: 'PXB',
    colorSlot: 2,
    photoPath: '/candidatos/amostra-barros.svg',
    photoSourceUrl: CAND_REGISTRY_URL,
  },
  // Sem foto casada com segurança: a UI cai para monograma + cor (R4, sem chute).
  {
    id: 'cand-c',
    displayName: 'Cardoso',
    party: 'PXC',
    colorSlot: 3,
    photoPath: null,
    photoSourceUrl: null,
  },
  {
    id: 'demais',
    displayName: 'Demais',
    party: null,
    colorSlot: 8,
    photoPath: null,
    photoSourceUrl: null,
  },
];

const institutes = [
  { id: 'inst-1', displayName: 'Instituto Alfa', method: 'telefone' },
  { id: 'inst-2', displayName: 'Instituto Beta', method: 'presencial' },
  { id: 'inst-3', displayName: 'Instituto Gama', method: 'painel_online' },
];

const N_POINTS = 13;

/**
 * Níveis do eleitorado por passo (i = semana). Os seis estados somam 100 EXATO em
 * qualquer i, e as derivadas somam zero — assim os fluxos de `transitions` podem
 * reconciliar as duas margens de cada passo sem sobra (o que uma amostra
 * inconsistente esconderia da UI).
 */
const LEVELS = {
  'cand-a': (i) => 34 + 0.5 * i,
  'cand-b': (i) => 27 - 0.35 * i,
  'cand-c': (i) => 12 + 0.1 * i,
  demais: (i) => 9 - 0.05 * i,
  'branco-nulo': (i) => 8 + 0.05 * i,
  'nao-sabe': (i) => 10 - 0.25 * i,
};

const firstRound = [];
for (let i = 0; i < N_POINTS; i++) {
  firstRound.push({
    date: isoDay(i * 7),
    byCandidate: {
      'cand-a': band(LEVELS['cand-a'](i), 3.2 - i * 0.05),
      'cand-b': band(LEVELS['cand-b'](i), 3.0 - i * 0.04),
      'cand-c': band(LEVELS['cand-c'](i), 2.4 - i * 0.03),
      demais: band(LEVELS['demais'](i), 2.0),
    },
  });
}

/**
 * Série do eleitorado. Os `null` são deliberados: representam data em que a
 * grandeza NÃO foi medida. Em i=11 as duas faltam, e i=12 fica isolado — é o caso
 * que obriga a UI a desenhar um segmento de um ponto só, sem interpolar por cima
 * do buraco (R4: ausência não é zero).
 */
const BLANK_NULL_MISSING = new Set([8, 11]);
const UNDECIDED_MISSING = new Set([4, 11]);
const electorate = [];
for (let i = 0; i < N_POINTS; i++) {
  electorate.push({
    date: isoDay(i * 7),
    blankNull: BLANK_NULL_MISSING.has(i) ? null : band(LEVELS['branco-nulo'](i), 1.4),
    undecided: UNDECIDED_MISSING.has(i) ? null : band(LEVELS['nao-sabe'](i), 2.1),
  });
}

const runoffSeries = [];
for (let i = 0; i < N_POINTS; i++) {
  runoffSeries.push({
    date: isoDay(i * 7),
    byCandidate: {
      'cand-a': band(51 + 0.15 * i, 3.4 - i * 0.05),
      'cand-b': band(49 - 0.15 * i, 3.4 - i * 0.05),
    },
  });
}

const contractors = [
  { name: 'Veículo Aurora', type: 'veiculo' },
  { name: 'Veículo Boreal', type: 'veiculo' },
];
const polls = [];
const seq = [4, 14, 24, 34, 44, 54, 64, 74, 84];
seq.forEach((offset, k) => {
  const inst = institutes[k % institutes.length];
  const contractor = contractors[k % contractors.length];
  const jitter = (k % 3) - 1;
  const idNum = (6591 + k).toString().padStart(5, '0');
  const week = offset / 7;
  // Institutos que não publicaram a grandeza ⇒ null (≠ publicar zero).
  const blankNullPct =
    k === 2 || k === 7 ? null : round1(LEVELS['branco-nulo'](week) + jitter * 0.4);
  const undecidedPct = k === 5 || k === 7 ? null : round1(LEVELS['nao-sabe'](week) + jitter * 0.6);
  polls.push({
    tseId: `BR-${idNum}/2026`,
    instituteId: inst.id,
    contractorName: contractor.name,
    contractorType: contractor.type,
    fieldStart: isoDay(offset),
    fieldEnd: isoDay(offset + 2),
    sampleSize: 1500 + (k % 4) * 300,
    marginOfError: 2,
    blankNullPct,
    undecidedPct,
    firstRound: {
      'cand-a': round1(LEVELS['cand-a'](week) + jitter),
      'cand-b': round1(LEVELS['cand-b'](week) + jitter * 0.5),
      'cand-c': round1(LEVELS['cand-c'](week)),
      demais: round1(LEVELS['demais'](week)),
    },
    runoffs: [
      {
        pair: ['cand-a', 'cand-b'],
        values: { 'cand-a': round1(51 + jitter), 'cand-b': round1(49 - jitter) },
      },
    ],
    sourceUrl: 'https://www.tse.jus.br/',
  });
});

// house effects: pares (instituto, candidato). inst-3 tem um par estimable:false
// (nPolls 1) e outro estimável — cobre o "—" da UI e o caso estimável no mesmo instituto.
const houseEffects = [
  {
    instituteId: 'inst-1',
    candidateId: 'cand-a',
    effect: 1.4,
    lo90: 0.2,
    hi90: 2.6,
    nPolls: 6,
    estimable: true,
  },
  {
    instituteId: 'inst-1',
    candidateId: 'cand-b',
    effect: -0.9,
    lo90: -2.1,
    hi90: 0.3,
    nPolls: 6,
    estimable: true,
  },
  {
    instituteId: 'inst-2',
    candidateId: 'cand-a',
    effect: -1.8,
    lo90: -3.4,
    hi90: -0.2,
    nPolls: 5,
    estimable: true,
  },
  {
    instituteId: 'inst-2',
    candidateId: 'cand-b',
    effect: 0.6,
    lo90: -0.8,
    hi90: 2.0,
    nPolls: 5,
    estimable: true,
  },
  {
    instituteId: 'inst-3',
    candidateId: 'cand-a',
    effect: 0,
    lo90: 0,
    hi90: 0,
    nPolls: 1,
    estimable: false,
  },
  {
    instituteId: 'inst-3',
    candidateId: 'cand-c',
    effect: 0.3,
    lo90: -1.9,
    hi90: 2.5,
    nPolls: 4,
    estimable: true,
  },
];

// ── Transferência de votos (Q-10) ──────────────────────────────────────────
// Estados: os candidatos rastreados + branco/nulo + não-sabe.
const transitionStates = [
  { id: 'cand-a', kind: 'candidate', displayName: 'Andrade' },
  { id: 'cand-b', kind: 'candidate', displayName: 'Barros' },
  { id: 'cand-c', kind: 'candidate', displayName: 'Cardoso' },
  { id: 'demais', kind: 'candidate', displayName: 'Demais' },
  { id: 'branco-nulo', kind: 'blank_null', displayName: 'Branco e nulo' },
  { id: 'nao-sabe', kind: 'undecided', displayName: 'Não sabe' },
];

/**
 * Fluxos CRUZADOS de um passo semanal, em p.p. do eleitorado. Foram escolhidos
 * para reconciliar exatamente as derivadas de LEVELS: a soma das entradas menos
 * as saídas de cada estado é a variação dele de um passo para o outro. Dois deles
 * têm banda que CRUZA ZERO (`notIdentifiable`) — é o caso que a UI precisa
 * mostrar como indistinguível de zero, jamais esconder (Q-10 condição 3).
 */
const CROSS_FLOWS = [
  { from: 'nao-sabe', to: 'cand-a', pp: 0.4, lo90: 0.12, hi90: 0.71, notIdentifiable: false },
  { from: 'nao-sabe', to: 'cand-c', pp: 0.15, lo90: -0.09, hi90: 0.4, notIdentifiable: true },
  { from: 'cand-b', to: 'cand-a', pp: 0.1, lo90: -0.14, hi90: 0.35, notIdentifiable: true },
  { from: 'cand-b', to: 'branco-nulo', pp: 0.35, lo90: 0.08, hi90: 0.63, notIdentifiable: false },
  { from: 'cand-c', to: 'demais', pp: 0.05, lo90: -0.16, hi90: 0.27, notIdentifiable: true },
  { from: 'demais', to: 'cand-b', pp: 0.1, lo90: -0.12, hi90: 0.33, notIdentifiable: true },
  { from: 'branco-nulo', to: 'nao-sabe', pp: 0.3, lo90: 0.05, hi90: 0.56, notIdentifiable: false },
];

/** Semilargura da banda do fluxo de permanência: larga, porque é resíduo. */
const STAY_BAND_HALF_PP = 1.6;

function buildStep(iFrom) {
  const flows = [];
  for (const f of CROSS_FLOWS) flows.push({ ...f });
  // Permanência = tamanho do estado na data de origem menos o que sai dele.
  for (const state of transitionStates) {
    const size = LEVELS[state.id](iFrom);
    const out = CROSS_FLOWS.filter((f) => f.from === state.id).reduce((s, f) => s + f.pp, 0);
    const stay = round2(size - out);
    flows.push({
      from: state.id,
      to: state.id,
      pp: stay,
      lo90: round2(Math.max(0, stay - STAY_BAND_HALF_PP)),
      hi90: round2(stay + STAY_BAND_HALF_PP),
      notIdentifiable: false,
    });
  }
  return { fromDate: isoDay(iFrom * 7), toDate: isoDay((iFrom + 1) * 7), flows };
}

const transitions = {
  states: transitionStates,
  steps: [buildStep(9), buildStep(10), buildStep(11)],
  prior: {
    method: 'permanencia_regularizada',
    stickiness: TRANSITION_STICKINESS_PRIOR,
    /**
     * Nota NOSSA (docs/08 §2: nada de prosa de terceiro), curta de propósito e
     * abaixo dos 200 caracteres do gate de prosa. É AQUI que a participação
     * medida do prior é publicada — o run real escreve a medição do próprio
     * passo; a amostra reproduz o formato para a UI ter o que exibir.
     */
    note: 'O ajuste ao dado desloca 7,0 de 91,0 p.p. de massa por passo: cerca de 92% do fluxo publicado vem do prior de permanência, não do dado.',
  },
};

const diagnostics = {
  gaveta: [
    { subjectId: 'inst-1', subjectKind: 'institute', rate: 20, registered: 10, disclosed: 8 },
    { subjectId: 'inst-2', subjectKind: 'institute', rate: 60, registered: 5, disclosed: 2 },
    // 1 de 1 = taxa 1.0 (100%) sobre um único registro (docs/06 §5).
    { subjectId: 'campanha-a', subjectKind: 'contractor', rate: 100, registered: 1, disclosed: 0 },
  ],
  herding: [{ windowEnd: isoDay(84), ratio: 0.42, nPolls: 5, flagged: true }],
};

const historicalError = [
  {
    instituteId: 'inst-1',
    election: '2022',
    round: 1,
    candidateLabel: 'Candidato de esquerda',
    signedErrorPp: -1.8,
  },
  {
    instituteId: 'inst-1',
    election: '2022',
    round: 2,
    candidateLabel: 'Candidato de esquerda',
    signedErrorPp: -0.9,
  },
  {
    instituteId: 'inst-2',
    election: '2022',
    round: 1,
    candidateLabel: 'Candidato de direita',
    signedErrorPp: 2.1,
  },
  {
    instituteId: 'inst-3',
    election: '2018',
    round: 1,
    candidateLabel: 'Candidato de direita',
    signedErrorPp: 3.4,
  },
];

// docs/01 §10 — VERBATIM. Cada item é um bullet, sem editar nem resumir.
const methodologyNotes = [
  'Não corrige viés que seja comum a todos os institutos',
  'Não prevê resultado eleitoral nem probabilidade de vitória',
  'Não modela correlação entre candidatos além da restrição de soma',
  'Não distingue mudança real de opinião de mudança de metodologia do instituto',
  'Não detecta fraude; os indicadores da §6 têm explicações inocentes e são publicados como diagnóstico, não acusação',
  'Não pondera institutos por acurácia histórica na v1',
  'Não mede transferência de voto: o fluxo entre candidatos é inferido de dado agregado, o que não identifica para onde foi o voto de ninguém — o resultado depende do prior tanto quanto do dado (MODEL_VERSION 2.0.0, Q-10)',
];

const data = {
  schemaVersion: PUBLIC_DATA_SCHEMA_VERSION,
  generatedAt: '2026-08-14T15:00:00-03:00',
  nextUpdateAt: '2026-08-14T17:00:00-03:00',
  updateIntervalMinutes: UPDATE_INTERVAL_MINUTES,
  modelVersion: MODEL_VERSION,
  gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  race: { id: 'presidencia-2026', displayName: 'Presidência da República 2026' },
  candidates,
  institutes,
  latent: {
    firstRound,
    runoffs: [{ pair: ['cand-a', 'cand-b'], series: runoffSeries }],
    electorate,
  },
  polls,
  houseEffects,
  transitions,
  diagnostics,
  historicalError,
  otherRaces: [
    { id: 'presidencia-2026', displayName: 'Presidência da República 2026', status: 'ativo' },
    { id: 'governos-estaduais-2026', displayName: 'Governos estaduais', status: 'planejado' },
    { id: 'senado-2026', displayName: 'Senado', status: 'planejado' },
    { id: 'aprovacao-presidencial', displayName: 'Aprovação presidencial', status: 'planejado' },
  ],
  methodologyNotes,
};

const parsed = publicDataSchema.parse(data);
writeFileSync(OUT, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
console.log(`gen-sample-data: OK — escrito ${OUT}`);
