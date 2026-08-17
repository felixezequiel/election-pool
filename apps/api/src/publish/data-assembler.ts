import { publicDataSchema, type PublicData } from '@election-pool/contracts/public-data';
import {
  observationsSchema,
  electorateObservationsSchema,
  type Observation,
  type ElectorateObservation,
  type LatentPoint,
} from '@election-pool/contracts/model-io';
import { RACES } from '@election-pool/contracts/races';
import { RACE_STATUS, SCENARIO_KIND } from '@election-pool/contracts/enums';
import {
  PUBLIC_DATA_SCHEMA_VERSION,
  UPDATE_INTERVAL_MINUTES,
} from '@election-pool/contracts/constants';
import { runModel } from '@election-pool/model';
import { computeGavetaRates, computeHerding } from '@election-pool/model/diagnostics';
import type { RegistrationRecord } from '@election-pool/model/diagnostics';
import { generatedAtIso, nextUpdateAtIso } from './time.js';
import type {
  ScenarioResultRow,
  ElectorateRow,
  RegistrationRow,
  PollRow,
  CandidateRow,
  InstituteRow,
  RaceRow,
} from './read-model.js';

/**
 * Montagem do `data.json` (docs/03 §5) a partir das linhas do banco + saída do
 * modelo + diagnósticos ricos. PURO: recebe dados já lidos e devolve um
 * `PublicData` — nenhum I/O aqui (o RenderReadModel faz a leitura, o RenderJob
 * escreve). O resultado é VALIDADO contra `publicDataSchema` antes de sair
 * (fronteira Zod, R4): se não bater com o contrato, LANÇA e a publicação aborta.
 *
 * Regras que este montador respeita:
 * - R3/docs/08 §2.1: nenhum campo carrega prosa de terceiros. Só números,
 *   metadata (id, nome, método), datas e LINKS (`sourceUrl`). `methodologyNotes`
 *   é texto NOSSO (docs/01 §10, verbatim).
 * - R6/docs/08 §1: toda pesquisa exibida traz `tseId`.
 * - `otherRaces` deriva de `RACES` (registro único), não de literais.
 * - Diagnósticos vêm das funções PURAS de T-08 (`computeGavetaRates`/
 *   `computeHerding`), nas FORMAS RICAS que casam com `PublicData.diagnostics`
 *   (docs/OPEN-QUESTIONS Q-05). Divergência (§6.3) não tem lar em PublicData hoje
 *   (Q-05) ⇒ fica fora do data.json.
 */

const ZERO = 0;
const TWO = 2;

export interface AssembleInput {
  raceId: string;
  race: RaceRow;
  scenarioResults: readonly ScenarioResultRow[];
  /** Branco/nulo e não-sabe por cenário canônico (MODEL_VERSION 2.0.0, Q-10). */
  electorate: readonly ElectorateRow[];
  registrations: readonly RegistrationRow[];
  polls: readonly PollRow[];
  candidates: readonly CandidateRow[];
  institutes: readonly InstituteRow[];
  /** Instante do run (para generatedAt/nextUpdateAt). */
  now: Date;
  modelVersion: string;
  gitSha: string;
}

export interface AssembleResult {
  data: PublicData;
  /** Passthrough dos gates do modelo — o RenderJob decide publicar por eles. */
  gatesPassed: boolean;
}

/**
 * `data.json`.methodologyNotes — docs/01 §10, VERBATIM (a lista "o que este modelo
 * não faz", publicada na íntegra na UI). Texto NOSSO, não de terceiros. Fonte
 * única deste literal no lado do render; T-12 mantém sua própria cópia para a UI.
 */
const METHODOLOGY_NOTES: readonly string[] = [
  'Não corrige viés que seja comum a todos os institutos',
  'Não prevê resultado eleitoral nem probabilidade de vitória',
  'Não modela correlação entre candidatos além da restrição de soma',
  'Não distingue mudança real de opinião de mudança de metodologia do instituto',
  'Não detecta fraude; os indicadores da §6 têm explicações inocentes e são publicados como diagnóstico, não acusação',
  'Não pondera institutos por acurácia histórica na v1',
  'Não mede transferência de voto: o fluxo entre candidatos é inferido de dado agregado, o que não identifica para onde foi o voto de ninguém — o resultado depende do prior tanto quanto do dado',
];

export const assemblePublicData = (input: AssembleInput): AssembleResult => {
  const observations = buildObservations(input.scenarioResults);
  const referenceDate = referenceDateFor(input.scenarioResults, input.now);
  const electorateObservations = buildElectorateObservations(input.electorate);

  const model = runModel({ observations, referenceDate, electorateObservations });

  const gaveta = computeGavetaRates(toRegistrationRecords(input.registrations), referenceDate);
  const herding = computeHerding(observations);

  const data = {
    schemaVersion: PUBLIC_DATA_SCHEMA_VERSION,
    generatedAt: generatedAtIso(input.now),
    nextUpdateAt: nextUpdateAtIso(input.now),
    updateIntervalMinutes: UPDATE_INTERVAL_MINUTES,
    modelVersion: input.modelVersion,
    gitSha: input.gitSha,
    race: { id: input.race.id, displayName: input.race.displayName },

    candidates: input.candidates.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      party: c.party,
      colorSlot: c.colorSlot,
      // Foto oficial do TSE (ou null, e a UI usa monograma). `photoSourceUrl` é o
      // registro de candidatura que a originou — proveniência à vista, como o
      // tse_id da pesquisa (R6). É LINK, nunca conteúdo de terceiro (R3).
      photoPath: c.photoPath,
      photoSourceUrl: c.photoSourceUrl,
    })),

    institutes: input.institutes.map((i) => ({
      id: i.id,
      displayName: i.displayName,
      method: i.method,
    })),

    latent: {
      firstRound: model.latent.firstRound.map(toPublicLatentPoint),
      runoffs: model.latent.runoffs.map((r) => ({
        pair: r.pair,
        series: r.series.map(toPublicLatentPoint),
      })),
      // Branco/nulo e não-sabe. `null` num ponto = sem medida ali; a UI
      // interrompe a linha em vez de desenhar zero (R4).
      electorate: model.latent.electorate.map((p) => ({
        date: p.date,
        blankNull: p.blankNull === null ? null : toPublicBand(p.blankNull),
        undecided: p.undecided === null ? null : toPublicBand(p.undecided),
      })),
    },

    // Transferência de votos (Q-10). Passthrough do modelo, incluindo a banda e o
    // veredito `notIdentifiable` de cada fluxo — o montador NÃO filtra fluxo
    // indistinguível de zero. Esconder aqui seria publicar só as setas bonitas.
    transitions:
      model.transitions === null
        ? null
        : {
            states: model.transitions.states.map((s) => ({
              id: s.id,
              kind: s.kind,
              displayName: s.displayName,
            })),
            steps: model.transitions.steps.map((step) => ({
              fromDate: step.fromDate,
              toDate: step.toDate,
              flows: step.flows.map((f) => ({
                from: f.from,
                to: f.to,
                pp: f.pp,
                lo90: f.lo90Pp,
                hi90: f.hi90Pp,
                notIdentifiable: f.notIdentifiable,
              })),
            })),
            prior: model.transitions.prior,
          },

    polls: buildPolls(input.polls, input.scenarioResults),

    houseEffects: model.houseEffects.map((h) => ({
      instituteId: h.instituteId,
      candidateId: h.candidateId,
      effect: h.effectPp,
      lo90: h.lo90Pp,
      hi90: h.hi90Pp,
      nPolls: h.nPolls,
      estimable: h.estimable,
    })),

    diagnostics: {
      gaveta: gaveta.map((g) => ({
        subjectId: g.subjectId,
        subjectKind: g.subjectKind,
        rate: g.rate,
        registered: g.registered,
        disclosed: g.disclosed,
      })),
      herding: herding.map((h) => ({
        windowEnd: h.windowEnd,
        ratio: h.ratio,
        nPolls: h.nPolls,
        flagged: h.flagged,
      })),
    },

    // Erro histórico (docs/01 §7) é contexto descritivo que NÃO entra no modelo e
    // depende de dados de eleições passadas ausentes do pipeline v1 (T-02 não criou
    // tabela). Emitimos vazio: o schema permite, e é honesto — sem inventar número
    // (R4). Preenchê-lo é trabalho de uma fonte histórica futura.
    historicalError: [],

    otherRaces: buildOtherRaces(),

    methodologyNotes: [...METHODOLOGY_NOTES],
  };

  // Fronteira Zod: valida ANTES de qualquer escrita (R4). LANÇA se divergir do
  // contrato — o RenderJob trata como gate reprovado e não publica.
  const parsed = publicDataSchema.parse(data);
  return { data: parsed, gatesPassed: model.gates.passed };
};

// --- observações a partir das linhas de cenário -----------------------------

/**
 * Converte (cenário canônico × resultado) em `Observation[]` (model-io). O tempo
 * `t` é a data mediana do campo (docs/01 §1). A validação Zod
 * (`observationsSchema`) é a fronteira de entrada do modelo (T-04 documenta que o
 * chamador valida).
 */
const buildObservations = (rows: readonly ScenarioResultRow[]): Observation[] => {
  const raw = rows.map((r) => ({
    tseId: r.tseId,
    instituteId: r.instituteId,
    candidateId: r.candidateId,
    scenarioKind: r.scenarioKind,
    t2Pair: r.t2Pair,
    fieldMedianDate: medianFieldDate(r.fieldStart, r.fieldEnd),
    sampleSize: r.sampleSize,
    valuePct: r.valuePct,
  }));
  return observationsSchema.parse(raw);
};

/**
 * Data mediana do campo = ponto médio entre início e fim, truncado ao dia
 * (`YYYY-MM-DD`). Aritmética de calendário em UTC (determinística; sem timezone
 * de runtime). Datas de campo são `date` puras no banco (sem hora).
 */
/**
 * Converte as linhas de branco/nulo e não-sabe em `ElectorateObservation[]`
 * (fronteira Zod de entrada do modelo). Cenário cujas DUAS grandezas são `null`
 * é descartado aqui: ele não carrega medida alguma, e mantê-lo só adicionaria uma
 * observação vazia ao modelo. Um cenário com UMA das duas medidas é mantido — a
 * outra segue `null` e o modelo trata como ausência, não como zero (R4).
 */
const buildElectorateObservations = (rows: readonly ElectorateRow[]): ElectorateObservation[] => {
  const raw = rows
    .filter((r) => r.blankNullPct !== null || r.undecidedPct !== null)
    .map((r) => ({
      tseId: r.tseId,
      instituteId: r.instituteId,
      scenarioKind: r.scenarioKind,
      fieldMedianDate: medianFieldDate(r.fieldStart, r.fieldEnd),
      sampleSize: r.sampleSize,
      blankNullPct: r.blankNullPct,
      undecidedPct: r.undecidedPct,
    }));
  return electorateObservationsSchema.parse(raw);
};

const medianFieldDate = (fieldStart: string, fieldEnd: string): string => {
  const startMs = Date.parse(`${fieldStart}T00:00:00Z`);
  const endMs = Date.parse(`${fieldEnd}T00:00:00Z`);
  const midMs = startMs + (endMs - startMs) / TWO;
  return new Date(midMs).toISOString().slice(ZERO, 10);
};

/**
 * A data de referência do run = a data de campo mais recente entre as observações
 * (docs/01 §4.4: a janela ativa é medida contra o "agora" do run). Sem observações,
 * cai para a data de `now` — o run reprovará no gate de cobertura M-1 de qualquer
 * forma, mas fornecemos uma data válida ao modelo.
 */
const referenceDateFor = (rows: readonly ScenarioResultRow[], now: Date): string => {
  let max = '';
  for (const r of rows) {
    const d = medianFieldDate(r.fieldStart, r.fieldEnd);
    if (d > max) max = d;
  }
  return max === '' ? now.toISOString().slice(ZERO, 10) : max;
};

// --- polls (docs/03 §5) -----------------------------------------------------

/**
 * Monta `polls[]` (R6: sempre com `tseId`). Cada pesquisa carrega os valores do
 * cenário de 1º turno (o t1_estimulado canônico, se houver) e os pares de 2º
 * turno. Números crus; `sourceUrl` é link, nunca conteúdo (R3).
 */
const buildPolls = (
  polls: readonly PollRow[],
  scenarioResults: readonly ScenarioResultRow[],
): PublicData['polls'] => {
  // Indexa resultados por tse_id.
  const byTse = new Map<string, ScenarioResultRow[]>();
  for (const r of scenarioResults) {
    const bucket = byTse.get(r.tseId) ?? [];
    bucket.push(r);
    byTse.set(r.tseId, bucket);
  }

  return polls.map((p) => {
    const rows = byTse.get(p.tseId) ?? [];

    // 1º turno: junta os valores dos cenários t1 (estimulado tem prioridade
    // implícita; se ambos existirem canônicos, o último a escrever vence por
    // candidato — mas o canônico por (kind) é único, então não há conflito real).
    const firstRound: Record<string, number> = {};
    for (const r of rows) {
      if (
        r.scenarioKind === SCENARIO_KIND.t1Estimulado ||
        r.scenarioKind === SCENARIO_KIND.t1Espontaneo
      ) {
        firstRound[r.candidateId] = r.valuePct;
      }
    }

    // 2º turno: um objeto por par ordenado.
    const runoffMap = new Map<string, { pair: [string, string]; values: Record<string, number> }>();
    for (const r of rows) {
      if (r.scenarioKind !== SCENARIO_KIND.t2 || r.t2Pair === null) continue;
      const pair = orderPair(r.t2Pair);
      const key = `${pair[0]} ${pair[1]}`;
      const entry = runoffMap.get(key) ?? { pair, values: {} };
      entry.values[r.candidateId] = r.valuePct;
      runoffMap.set(key, entry);
    }
    const runoffs = [...runoffMap.values()].sort((a, b) => comparePair(a.pair, b.pair));

    return {
      tseId: p.tseId,
      instituteId: p.instituteId,
      contractorName: p.contractorName,
      contractorType: p.contractorType,
      fieldStart: p.fieldStart,
      fieldEnd: p.fieldEnd,
      sampleSize: p.sampleSize,
      marginOfError: p.marginOfError,
      // Passa direto: `null` significa "o instituto não publicou a grandeza" e
      // precisa chegar assim ao público, para a UI distinguir de um zero medido.
      blankNullPct: p.blankNullPct,
      undecidedPct: p.undecidedPct,
      firstRound: Object.keys(firstRound).length > ZERO ? firstRound : null,
      runoffs,
      sourceUrl: p.sourceUrl,
    };
  });
};

const orderPair = (pair: readonly [string, string]): [string, string] => {
  const [a, b] = pair;
  return a <= b ? [a, b] : [b, a];
};

const comparePair = (a: readonly [string, string], b: readonly [string, string]): number => {
  if (a[0] < b[0]) return -1;
  if (a[0] > b[0]) return 1;
  if (a[1] < b[1]) return -1;
  if (a[1] > b[1]) return 1;
  return ZERO;
};

// --- latente ----------------------------------------------------------------

interface ModelLatentPoint {
  date: string;
  byCandidate: Record<string, { meanPct: number; lo90Pct: number; hi90Pct: number }>;
}

/** Banda do modelo (…Pct) para a forma pública (mean/lo90/hi90). */
const toPublicBand = (band: LatentPoint): { mean: number; lo90: number; hi90: number } => ({
  mean: band.meanPct,
  lo90: band.lo90Pct,
  hi90: band.hi90Pct,
});

/** Converte um ponto latente do modelo (meanPct/lo90Pct/hi90Pct) ao público (mean/lo90/hi90). */
const toPublicLatentPoint = (
  p: ModelLatentPoint,
): { date: string; byCandidate: Record<string, { mean: number; lo90: number; hi90: number }> } => {
  const byCandidate: Record<string, { mean: number; lo90: number; hi90: number }> = {};
  for (const [candidateId, band] of Object.entries(p.byCandidate)) {
    byCandidate[candidateId] = { mean: band.meanPct, lo90: band.lo90Pct, hi90: band.hi90Pct };
  }
  return { date: p.date, byCandidate };
};

// --- diagnósticos: adaptação para as funções puras de T-08 ------------------

const toRegistrationRecords = (rows: readonly RegistrationRow[]): RegistrationRecord[] =>
  rows.map((r) => ({
    instituteId: r.instituteId,
    contractorName: r.contractorName,
    registeredAt: r.registeredAt,
    disclosed: r.disclosed,
  }));

// --- otherRaces (docs/00 §7) ------------------------------------------------

/**
 * `otherRaces` deriva do registro único `RACES` (@election-pool/contracts/races),
 * não de literais (LOG/handoff T-12). O contrato público só admite `ativo` |
 * `planejado`; `RACES` da v1 só tem esses dois status, então filtramos por
 * segurança de tipo e ordenamos por `sortOrder`.
 */
const buildOtherRaces = (): PublicData['otherRaces'] =>
  [...RACES]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((r) => r.status === RACE_STATUS.ativo || r.status === RACE_STATUS.planejado)
    .map((r) => ({
      id: r.id,
      displayName: r.displayName,
      status: r.status as 'ativo' | 'planejado',
    }));

export const __test = { medianFieldDate, referenceDateFor, buildObservations, METHODOLOGY_NOTES };
