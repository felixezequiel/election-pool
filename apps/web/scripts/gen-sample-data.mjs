/**
 * Gerador one-shot da amostra `src/data/sample-data.json`. NÃO faz parte do
 * build; roda manualmente para (re)produzir uma amostra COMPLETA e válida contra
 * `publicDataSchema`. Construir programaticamente as séries evita erro de digitação
 * e prova, na hora da geração, que o JSON passa no schema. Depois de gerar, este
 * script pode ser descartado — o artefato versionado é o JSON.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { publicDataSchema } from '@election-pool/contracts/public-data';

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

const candidates = [
  { id: 'cand-a', displayName: 'Andrade', party: 'PXA', colorSlot: 1 },
  { id: 'cand-b', displayName: 'Barros', party: 'PXB', colorSlot: 2 },
  { id: 'cand-c', displayName: 'Cardoso', party: 'PXC', colorSlot: 3 },
  { id: 'demais', displayName: 'Demais', party: null, colorSlot: 8 },
];

const institutes = [
  { id: 'inst-1', displayName: 'Instituto Alfa', method: 'telefone' },
  { id: 'inst-2', displayName: 'Instituto Beta', method: 'presencial' },
  { id: 'inst-3', displayName: 'Instituto Gama', method: 'painel_online' },
];

const N_POINTS = 13;
const firstRound = [];
for (let i = 0; i < N_POINTS; i++) {
  firstRound.push({
    date: isoDay(i * 7),
    byCandidate: {
      'cand-a': band(38 + 0.25 * i, 3.2 - i * 0.05),
      'cand-b': band(31 - 0.12 * i, 3.0 - i * 0.04),
      'cand-c': band(14 + 0.08 * i, 2.4 - i * 0.03),
      demais: band(11 - 0.05 * i, 2.0),
    },
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
  polls.push({
    tseId: `BR-${idNum}/2026`,
    instituteId: inst.id,
    contractorName: contractor.name,
    contractorType: contractor.type,
    fieldStart: isoDay(offset),
    fieldEnd: isoDay(offset + 2),
    sampleSize: 1500 + (k % 4) * 300,
    marginOfError: 2,
    firstRound: {
      'cand-a': round1(38 + offset * 0.03 + jitter),
      'cand-b': round1(31 - offset * 0.02 + jitter * 0.5),
      'cand-c': round1(14 + offset * 0.01),
      demais: 11,
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
];

const data = {
  schemaVersion: '1',
  generatedAt: '2026-08-14T15:00:00-03:00',
  nextUpdateAt: '2026-08-14T17:00:00-03:00',
  updateIntervalMinutes: 120,
  modelVersion: '1.0.0',
  gitSha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
  race: { id: 'presidencia-2026', displayName: 'Presidência da República 2026' },
  candidates,
  institutes,
  latent: {
    firstRound,
    runoffs: [{ pair: ['cand-a', 'cand-b'], series: runoffSeries }],
  },
  polls,
  houseEffects,
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
