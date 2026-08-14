/**
 * Adaptação das fatias de `@election-pool/contracts/public-data` para as formas
 * de entrada dos gráficos. Mantém os componentes ignorantes do schema bruto e dá
 * a T-12 pontos de acoplamento estáveis a `data.json`.
 *
 * Nada aqui inventa número: percentuais faltantes NÃO viram `0` (R4). Um poll
 * sem valor para um candidato simplesmente não gera ponto.
 */
import type { PublicData } from '@election-pool/contracts/public-data';
import { fieldMidpointMs, isoDayMs, type LatentSeries, type PollPoint } from './latent-geometry.js';

/** Metadados de candidato indexados por id (cor/slot/nome). */
export interface CandidateMeta {
  id: string;
  displayName: string;
  colorSlot: number;
}

/** Institutos indexados por id (nome/método), para rótulos de tooltip. */
export type InstituteIndex = Map<string, PublicData['institutes'][number]>;

export function indexCandidates(candidates: PublicData['candidates']): Map<string, CandidateMeta> {
  const m = new Map<string, CandidateMeta>();
  for (const c of candidates) {
    m.set(c.id, { id: c.id, displayName: c.displayName, colorSlot: c.colorSlot });
  }
  return m;
}

export function indexInstitutes(institutes: PublicData['institutes']): InstituteIndex {
  const m: InstituteIndex = new Map();
  for (const i of institutes) m.set(i.id, i);
  return m;
}

/** Uma série datada (`latent.firstRound` ou o `series` de um runoff) → séries por candidato. */
export function toLatentSeries(
  dated: PublicData['latent']['firstRound'],
  candidates: Map<string, CandidateMeta>,
): LatentSeries[] {
  const byCandidate = new Map<string, LatentSeries>();
  for (const day of dated) {
    const t = isoDayMs(day.date);
    for (const [candidateId, band] of Object.entries(day.byCandidate)) {
      const meta = candidates.get(candidateId);
      if (!meta) continue; // candidato desconhecido: não plota (falha alta é no gate, não aqui)
      let s = byCandidate.get(candidateId);
      if (!s) {
        s = {
          candidateId,
          displayName: meta.displayName,
          colorSlot: meta.colorSlot,
          samples: [],
        };
        byCandidate.set(candidateId, s);
      }
      s.samples.push({ t, mean: band.mean, lo90: band.lo90, hi90: band.hi90 });
    }
  }
  const series = [...byCandidate.values()];
  for (const s of series) s.samples.sort((a, b) => a.t - b.t);
  return series;
}

/**
 * Pontos de pesquisa individuais para o 1º turno (um ponto por candidato por
 * pesquisa). `firstRound` nulo (pesquisa só de 2º turno) é ignorado no gráfico
 * de 1º turno.
 */
export function toFirstRoundPollPoints(
  polls: PublicData['polls'],
  candidates: Map<string, CandidateMeta>,
): Omit<PollPoint, 'x' | 'y'>[] {
  const out: Omit<PollPoint, 'x' | 'y'>[] = [];
  for (const poll of polls) {
    if (!poll.firstRound) continue;
    const t = fieldMidpointMs(poll.fieldStart, poll.fieldEnd);
    for (const [candidateId, value] of Object.entries(poll.firstRound)) {
      const meta = candidates.get(candidateId);
      if (!meta) continue;
      out.push({ tseId: poll.tseId, candidateId, colorSlot: meta.colorSlot, t, value });
    }
  }
  return out;
}

/** Pontos de pesquisa para um par de 2º turno específico. */
export function toRunoffPollPoints(
  polls: PublicData['polls'],
  pair: readonly [string, string],
  candidates: Map<string, CandidateMeta>,
): Omit<PollPoint, 'x' | 'y'>[] {
  const out: Omit<PollPoint, 'x' | 'y'>[] = [];
  const [a, b] = pair;
  for (const poll of polls) {
    const match = poll.runoffs.find((r) => r.pair[0] === a && r.pair[1] === b);
    if (!match) continue;
    const t = fieldMidpointMs(poll.fieldStart, poll.fieldEnd);
    for (const [candidateId, value] of Object.entries(match.values)) {
      const meta = candidates.get(candidateId);
      if (!meta) continue;
      out.push({ tseId: poll.tseId, candidateId, colorSlot: meta.colorSlot, t, value });
    }
  }
  return out;
}
