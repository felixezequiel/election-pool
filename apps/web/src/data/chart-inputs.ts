/**
 * Adaptação de `PublicData` para os props tipados dos gráficos de T-11. Fica
 * junto da costura de dados (não nas seções) para que cada seção receba props
 * prontos e o mapeamento schema→gráfico viva num lugar só. Reusa os transforms
 * puros de `charts/lib/transform.ts` (indexação, séries, pontos).
 *
 * Nada aqui inventa número (R4): valor ausente não vira `0`; um poll sem valor
 * para um candidato simplesmente não gera linha/ponto.
 */
import type { PublicData } from '@election-pool/contracts/public-data';
import type { PollTooltipMeta } from '../components/charts/LatentBandChart.astro';
import type { HouseEffectRow } from '../components/charts/HouseEffectPlot.astro';
import type { PollStripRow, PollStripValue } from '../components/charts/PollStrip.astro';
import type { LatentSeries, PollPoint } from '../components/charts/lib/latent-geometry.js';
import type {
  ElectorateBand,
  ElectorateSeriesInput,
} from '../components/charts/lib/electorate-geometry.js';
import type {
  TransitionFlowInput,
  TransitionStateMeta,
} from '../components/charts/lib/transition-geometry.js';
import {
  indexCandidates,
  indexInstitutes,
  toLatentSeries,
  toFirstRoundPollPoints,
  toRunoffPollPoints,
  type CandidateMeta,
  type InstituteIndex,
} from '../components/charts/lib/transform.js';
import { isoDayMs } from '../components/charts/lib/latent-geometry.js';

export interface RunoffChart {
  pair: [string, string];
  title: string;
  series: LatentSeries[];
  points: Omit<PollPoint, 'x' | 'y'>[];
  pollMeta: Record<string, PollTooltipMeta>;
}

/** Um passo de transferência, pronto para o <TransitionPanel>. */
export interface TransitionStepChart {
  fromDate: string;
  toDate: string;
  flows: TransitionFlowInput[];
}

/**
 * Transferência adaptada para a UI (MODEL_VERSION 2.0.0, Q-10). Nada é filtrado
 * aqui: todos os passos e TODOS os fluxos chegam à seção, `notIdentifiable`
 * inclusive — quem decide o tratamento visual é o componente, e a decisão é
 * mostrar, nunca esconder.
 */
export interface TransitionChart {
  states: TransitionStateMeta[];
  steps: TransitionStepChart[];
  /** Tipo derivado do schema (CLAUDE.md: nunca declarado à mão em paralelo). */
  prior: NonNullable<PublicData['transitions']>['prior'];
}

/** Banda 90% de uma grandeza, escala 0–100 (CLAUDE.md). */
type Band = ElectorateBand;

/**
 * Fotografia de UMA data: as grandezas do eleitorado que aquele cenário mediu
 * naquele dia. A data é sempre a do último dia em que a grandeza ÂNCORA foi
 * medida — as pontas de um mesmo retrato têm de vir do mesmo dia, senão a soma
 * não descreve eleitorado nenhum.
 */
export interface SpontaneousSnapshot {
  /** Data ISO (AAAA-MM-DD) do retrato. */
  date: string;
  /** Não citou nome nenhum — a grandeza âncora da espontânea. */
  noCandidate: Band;
  /** Citou branco, nulo ou "nenhum". `null` = não perguntado/publicado. */
  blankNull: Band | null;
  /**
   * Citou ALGUÉM. Vem pronto do contrato e é ARITMÉTICA (complemento para 100,
   * banda somada de forma conservadora) — nunca medida independente. Atravessa
   * marcado como derivado até o desenho, que o exibe com menos autoridade.
   */
  named: Band | null;
}

/** O mesmo retrato, do lado ESTIMULADO — o outro lado do contraste (Q-14). */
export interface ElectorateSnapshot {
  date: string;
  /** Não-sabe da estimulada: a lista de nomes já ancorou a resposta. */
  undecided: Band;
  blankNull: Band | null;
}

/**
 * Pergunta ESPONTÂNEA (docs/OPEN-QUESTIONS Q-14). Série descritiva: NÃO entra em
 * `μ_t` — espontâneo e estimulado são medidas incomparáveis e agrupá-las quebra a
 * restrição de soma (docs/01 §3). Aqui ela existe para ser exibida como o que é:
 * quanto do eleitorado não tem candidato próprio quando ninguém lhe mostra uma
 * lista de nomes.
 */
export interface SpontaneousChart {
  /** Grandezas MEDIDAS para o gráfico de série (`null` = sem medida, R4). */
  series: ElectorateSeriesInput[];
  /** Retrato mais recente com a âncora medida; `null` se nunca mediram. */
  latest: SpontaneousSnapshot | null;
  /** Proveniência da afirmação (R6): sobre quantas pesquisas ela se sustenta. */
  pollCount: number;
  instituteCount: number;
}

export interface ChartInputs {
  candidates: Map<string, CandidateMeta>;
  institutes: InstituteIndex;
  firstRound: {
    series: LatentSeries[];
    points: Omit<PollPoint, 'x' | 'y'>[];
    pollMeta: Record<string, PollTooltipMeta>;
    /** Domínio de tempo (ms) do gráfico de 1º turno, para alinhar outros eixos. */
    xDomain: [number, number] | undefined;
  };
  /** Branco/nulo e não-sabe (MODEL_VERSION 2.0.0). Ponto sem medida vira `null`. */
  electorate: ElectorateSeriesInput[];
  /** Último retrato medido da estimulada — o outro lado do contraste (Q-14). */
  electorateLatest: ElectorateSnapshot | null;
  /** Pergunta espontânea (Q-14); `null` = nenhum instituto publicou o cenário. */
  spontaneous: SpontaneousChart | null;
  runoffs: RunoffChart[];
  houseRows: HouseEffectRow[];
  stripRows: PollStripRow[];
  transitions: TransitionChart | null;
}

function buildPollMeta(
  polls: PublicData['polls'],
  institutes: InstituteIndex,
  pick: (poll: PublicData['polls'][number]) => Record<string, number> | null,
): Record<string, PollTooltipMeta> {
  const meta: Record<string, PollTooltipMeta> = {};
  for (const poll of polls) {
    const values = pick(poll);
    if (!values) continue;
    const inst = institutes.get(poll.instituteId);
    meta[poll.tseId] = {
      tseId: poll.tseId,
      instituteName: inst?.displayName ?? poll.instituteId,
      contractorName: poll.contractorName,
      contractorType: poll.contractorType,
      sampleSize: poll.sampleSize,
      fieldStart: poll.fieldStart,
      fieldEnd: poll.fieldEnd,
      values,
    };
  }
  return meta;
}

function runoffLabel(
  pair: readonly [string, string],
  candidates: Map<string, CandidateMeta>,
): string {
  const a = candidates.get(pair[0])?.displayName ?? pair[0];
  const b = candidates.get(pair[1])?.displayName ?? pair[1];
  return `${a} × ${b}`;
}

export function buildChartInputs(data: PublicData): ChartInputs {
  const candidates = indexCandidates(data.candidates);
  const institutes = indexInstitutes(data.institutes);

  const firstRoundSeries = toLatentSeries(data.latent.firstRound, candidates);
  const firstRoundPoints = toFirstRoundPollPoints(data.polls, candidates);

  /**
   * Domínio de tempo do gráfico de 1º turno, calculado do MESMO jeito que
   * `buildLatentGeometry` calcula o dele (séries + pontos de pesquisa). Serve
   * para o gráfico do eleitorado usar exatamente o mesmo eixo: as duas leituras
   * só são comparáveis se a mesma coluna vertical for a mesma data.
   */
  const allT = [
    ...firstRoundSeries.flatMap((s) => s.samples.map((p) => p.t)),
    ...firstRoundPoints.map((p) => p.t),
  ];
  const xDomain: [number, number] | undefined =
    allT.length > 0 ? [Math.min(...allT), Math.max(...allT)] : undefined;

  const firstRound = {
    series: firstRoundSeries,
    points: firstRoundPoints,
    pollMeta: buildPollMeta(data.polls, institutes, (p) => p.firstRound),
    xDomain,
  };

  /**
   * Branco/nulo e não-sabe. O `null` do contrato ATRAVESSA intacto até a
   * geometria: nenhum `?? 0`, nenhuma interpolação aqui (R4). Quem decide o que
   * fazer com a ausência é o desenho — e o que ele faz é interromper a linha.
   */
  const electorate: ElectorateSeriesInput[] = [
    {
      key: 'blankNull',
      displayName: 'Branco e nulo',
      points: data.latent.electorate.map((d) => ({ t: isoDayMs(d.date), band: d.blankNull })),
    },
    {
      key: 'undecided',
      displayName: 'Não sabe',
      points: data.latent.electorate.map((d) => ({ t: isoDayMs(d.date), band: d.undecided })),
    },
  ];

  /**
   * Último retrato MEDIDO da estimulada. A data é a do último dia com `undecided`
   * medido — é essa a grandeza que entra no contraste com a espontânea. Branco/
   * nulo vem do MESMO dia (pode ser `null`); não vale ir buscar num dia vizinho
   * para "completar" o retrato.
   */
  const electorateMeasured = data.latent.electorate.filter((d) => d.undecided !== null);
  const lastElectorate = electorateMeasured[electorateMeasured.length - 1];
  const electorateLatest: ElectorateSnapshot | null =
    lastElectorate && lastElectorate.undecided
      ? {
          date: lastElectorate.date,
          undecided: lastElectorate.undecided,
          blankNull: lastElectorate.blankNull,
        }
      : null;

  /**
   * Pergunta espontânea (Q-14). `null` no contrato = nenhum instituto publicou
   * cenário espontâneo; a UI diz isso em vez de desenhar eixo vazio. Como em
   * todo o resto desta costura, o `null` de um ponto ATRAVESSA intacto: nenhum
   * `?? 0`, nenhuma interpolação aqui (R4).
   */
  const spontaneousMeasured = (data.spontaneous?.series ?? []).filter(
    (d) => d.noCandidate !== null,
  );
  const lastSpontaneous = spontaneousMeasured[spontaneousMeasured.length - 1];
  const spontaneous: SpontaneousChart | null = data.spontaneous
    ? {
        series: [
          {
            key: 'noCandidate',
            displayName: 'Não citaram nenhum nome',
            points: data.spontaneous.series.map((d) => ({
              t: isoDayMs(d.date),
              band: d.noCandidate,
            })),
          },
          {
            key: 'blankNull',
            displayName: 'Branco, nulo ou nenhum',
            points: data.spontaneous.series.map((d) => ({
              t: isoDayMs(d.date),
              band: d.blankNull,
            })),
          },
        ],
        latest:
          lastSpontaneous && lastSpontaneous.noCandidate
            ? {
                date: lastSpontaneous.date,
                noCandidate: lastSpontaneous.noCandidate,
                blankNull: lastSpontaneous.blankNull,
                named: lastSpontaneous.named,
              }
            : null,
        pollCount: data.spontaneous.pollCount,
        instituteCount: data.spontaneous.instituteCount,
      }
    : null;

  const runoffs: RunoffChart[] = data.latent.runoffs.map((r) => {
    const pair: [string, string] = [r.pair[0], r.pair[1]];
    return {
      pair,
      title: `Segundo turno — ${runoffLabel(pair, candidates)}`,
      series: toLatentSeries(r.series, candidates),
      points: toRunoffPollPoints(data.polls, pair, candidates),
      pollMeta: buildPollMeta(data.polls, institutes, (poll) => {
        const match = poll.runoffs.find((x) => x.pair[0] === pair[0] && x.pair[1] === pair[1]);
        return match ? match.values : null;
      }),
    };
  });

  const houseRows: HouseEffectRow[] = data.houseEffects.map((h) => {
    const cand = candidates.get(h.candidateId);
    const inst = institutes.get(h.instituteId);
    return {
      instituteId: h.instituteId,
      instituteName: inst?.displayName ?? h.instituteId,
      candidateId: h.candidateId,
      candidateName: cand?.displayName ?? h.candidateId,
      colorSlot: cand?.colorSlot ?? 8,
      effect: h.effect,
      lo90: h.lo90,
      hi90: h.hi90,
      nPolls: h.nPolls,
      estimable: h.estimable,
    };
  });

  const stripRows: PollStripRow[] = data.polls.map((poll) => {
    const values: PollStripValue[] = Object.entries(poll.firstRound ?? {})
      .map(([cid, value]) => {
        const cand = candidates.get(cid);
        return cand
          ? {
              candidateId: cid,
              candidateName: cand.displayName,
              colorSlot: cand.colorSlot,
              photoPath: cand.photoPath,
              value,
            }
          : null;
      })
      .filter((v): v is PollStripValue => v !== null);
    const inst = institutes.get(poll.instituteId);
    return {
      tseId: poll.tseId,
      instituteName: inst?.displayName ?? poll.instituteId,
      contractorName: poll.contractorName,
      sampleSize: poll.sampleSize,
      fieldStart: poll.fieldStart,
      fieldEnd: poll.fieldEnd,
      sourceUrl: poll.sourceUrl,
      values,
      // Declarados pela pesquisa. `null` = o instituto não publicou a grandeza,
      // que NÃO é o mesmo que publicar zero — a UI mostra os dois diferente (R4).
      blankNullPct: poll.blankNullPct,
      undecidedPct: poll.undecidedPct,
    };
  });

  /**
   * Estados da transferência: o `colorSlot` só existe para candidatura. Branco/
   * nulo e não-sabe ficam com `null` de propósito — não recebem cor do espectro
   * de candidatos porque não são candidatura (docs/05 §2.1).
   */
  const transitions: TransitionChart | null = data.transitions
    ? {
        states: data.transitions.states.map(
          (s): TransitionStateMeta => ({
            id: s.id,
            kind: s.kind,
            displayName: s.displayName,
            colorSlot: s.kind === 'candidate' ? (candidates.get(s.id)?.colorSlot ?? null) : null,
          }),
        ),
        steps: data.transitions.steps.map((step) => ({
          fromDate: step.fromDate,
          toDate: step.toDate,
          flows: step.flows.map(
            (f): TransitionFlowInput => ({
              from: f.from,
              to: f.to,
              pp: f.pp,
              lo90: f.lo90,
              hi90: f.hi90,
              notIdentifiable: f.notIdentifiable,
            }),
          ),
        })),
        prior: data.transitions.prior,
      }
    : null;

  return {
    candidates,
    institutes,
    firstRound,
    electorate,
    electorateLatest,
    spontaneous,
    runoffs,
    houseRows,
    stripRows,
    transitions,
  };
}
