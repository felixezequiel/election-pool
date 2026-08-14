/**
 * Parser do relatório CNT/MDA (docs/04 §3, fonte 2: PDF, "relatório mais completo
 * do mercado"). O texto extraído do PDF vem em linhas. Extraímos só números e
 * rótulos estruturados (R3) — a prosa é ignorada; o PDF bruto vira `raw_documents`.
 *
 * Estrutura de linhas esperada:
 *   - Um cabeçalho de cenário: linha contendo "Cenário" seguida de uma pista de
 *     tipo ("Estimulado", "Espontâneo", "Segundo Turno"/"2º Turno").
 *   - Linhas de valor: "<rótulo> <número pt-BR>" (ex.: "Lula 38,8").
 *   - Rótulos de brancos/nulos e indecisos são classificados por `categorizeLine`.
 *
 * Regras duras:
 * - Uma linha de valor cujo número seja lixo LANÇA (R4) — nunca vira 0.
 * - Candidato ausente do cenário simplesmente não entra (docs/04 §4.1).
 * - Cenário de 2º turno tem os DOIS candidatos como par (`t2Pair`), na ordem de
 *   aparição. O par é de aliases; a resolução para id é do BaseAdapter/HarvestJob.
 * - Nenhum cenário reconhecido ⇒ LANÇA (estrutura mudou, docs/04).
 */

import { scenarioKindSchema } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { applyLine, categorizeLine } from '../base/scenario-lines.js';
import type { ScenarioAccumulator } from '../base/scenario-lines.js';
import type { RawScenario } from '../base/base-adapter.js';

/** Uma linha de valor: "<rótulo> <número>" no fim. Captura rótulo e número cru. */
const VALUE_LINE = /^(.+?)\s+(-?\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*%?$/;

const normalize = (line: string): string => line.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface HeaderMatch {
  kind: RawScenario['kind'];
  label: string;
}

/**
 * Reconhece um cabeçalho de cenário. Devolve `null` se a linha não for cabeçalho.
 * Só linhas que anunciam um cenário ("Cenário …") entram; a pista de tipo decide
 * o `kind`. Sem pista de 2º turno nem de espontâneo ⇒ 1º turno estimulado (o caso
 * padrão do relatório).
 */
const matchHeader = (line: string): HeaderMatch | null => {
  const n = normalize(line);
  if (!n.includes('cenario')) return null;
  const label = line.trim();
  if (n.includes('segundo turno') || n.includes('2o turno') || n.includes('2 turno')) {
    return { kind: scenarioKindSchema.enum.t2, label };
  }
  if (n.includes('espontane')) {
    return { kind: scenarioKindSchema.enum.t1_espontaneo, label };
  }
  return { kind: scenarioKindSchema.enum.t1_estimulado, label };
};

interface Building {
  kind: RawScenario['kind'];
  label: string;
  acc: ScenarioAccumulator;
  /** Aliases de candidato na ordem de aparição (para o par de 2º turno). */
  candidateOrder: string[];
}

const finalize = (b: Building): RawScenario => {
  const base: RawScenario = {
    kind: b.kind,
    label: b.label,
    values: b.acc.values,
    ...(b.acc.blankNullPct === undefined ? {} : { blankNullPct: b.acc.blankNullPct }),
    ...(b.acc.undecidedPct === undefined ? {} : { undecidedPct: b.acc.undecidedPct }),
  };
  if (b.kind === scenarioKindSchema.enum.t2) {
    if (b.candidateOrder.length !== 2) {
      throw new ParseError(
        `Cenário de 2º turno "${b.label}" com ${String(b.candidateOrder.length)} candidatos ` +
          `(esperado exatamente 2)`,
      );
    }
    const [a, c] = b.candidateOrder;
    if (a === undefined || c === undefined) {
      throw new ParseError(`Cenário de 2º turno "${b.label}" com par incompleto`);
    }
    return { ...base, t2Pair: [a, c] };
  }
  return base;
};

/**
 * Parseia o texto do PDF do CNT/MDA em cenários. Percorre linha a linha: cabeçalho
 * abre um cenário; linhas de valor alimentam o cenário corrente. LANÇA se nenhum
 * cenário for reconhecido.
 */
export const parseCntMdaText = (text: string): RawScenario[] => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const scenarios: RawScenario[] = [];
  let current: Building | null = null;

  const flush = (): void => {
    if (current !== null && current.acc.values.length > 0) {
      scenarios.push(finalize(current));
    }
    current = null;
  };

  for (const line of lines) {
    const header = matchHeader(line);
    if (header !== null) {
      flush();
      current = { kind: header.kind, label: header.label, acc: { values: [] }, candidateOrder: [] };
      continue;
    }
    if (current === null) continue; // preâmbulo/rodapé antes do primeiro cenário

    const m = VALUE_LINE.exec(line);
    if (m === null) continue; // linha de prosa/observação sem número: ignorada
    const [, label, rawValue] = m;
    if (label === undefined || rawValue === undefined) continue;
    const categorized = categorizeLine(label, rawValue);
    if (categorized.kind === 'candidate') {
      current.candidateOrder.push(categorized.alias);
    }
    applyLine(current.acc, categorized);
  }
  flush();

  if (scenarios.length === 0) {
    throw new ParseError('Nenhum cenário reconhecido no PDF do CNT/MDA (estrutura mudou?)');
  }
  return scenarios;
};
