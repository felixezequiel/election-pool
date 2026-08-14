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
import {
  indexCandidates,
  indexInstitutes,
  toLatentSeries,
  toFirstRoundPollPoints,
  toRunoffPollPoints,
  type CandidateMeta,
  type InstituteIndex,
} from '../components/charts/lib/transform.js';

export interface RunoffChart {
  pair: [string, string];
  title: string;
  series: LatentSeries[];
  points: Omit<PollPoint, 'x' | 'y'>[];
  pollMeta: Record<string, PollTooltipMeta>;
}

export interface ChartInputs {
  candidates: Map<string, CandidateMeta>;
  institutes: InstituteIndex;
  firstRound: {
    series: LatentSeries[];
    points: Omit<PollPoint, 'x' | 'y'>[];
    pollMeta: Record<string, PollTooltipMeta>;
  };
  runoffs: RunoffChart[];
  houseRows: HouseEffectRow[];
  stripRows: PollStripRow[];
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

  const firstRound = {
    series: toLatentSeries(data.latent.firstRound, candidates),
    points: toFirstRoundPollPoints(data.polls, candidates),
    pollMeta: buildPollMeta(data.polls, institutes, (p) => p.firstRound),
  };

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
          ? { candidateId: cid, candidateName: cand.displayName, colorSlot: cand.colorSlot, value }
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
    };
  });

  return { candidates, institutes, firstRound, runoffs, houseRows, stripRows };
}
