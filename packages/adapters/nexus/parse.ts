/**
 * Parser do nexus (docs/04 §3, fonte 1). O nexus publica a rodada semanal como
 * página HTML estruturada com o registro TSE e um ou mais cenários. Extraímos SÓ
 * números e rótulos estruturados (R3, docs/08) — nunca guardamos/republicamos a
 * prosa; o HTML bruto vira `raw_documents` como proveniência.
 *
 * A página real é frágil (como todo HTML de terceiro). Casamos por atributos
 * `data-*` sintéticos definidos na fixture — o mesmo padrão de robustez de T-05
 * para o PesqEle. Qualquer campo obrigatório ausente LANÇA (R4); nunca vira
 * default. O `tse_id` NÃO é lido daqui como verdade — a confirmação V6 é feita
 * pelo `BaseAdapter` sobre o texto do documento.
 *
 * Estrutura esperada (fixture):
 *   [data-scenario] com [data-scenario-kind] e [data-scenario-label]
 *     [data-row="value"] com [data-candidate] e [data-pct]
 *   Os rótulos de brancos/nulos e indecisos vêm como linhas normais e são
 *   classificados por `categorizeLine`.
 */

import { parse as parseHtml } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';
import { scenarioKindSchema } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { applyLine, categorizeLine } from '../base/scenario-lines.js';
import type { ScenarioAccumulator } from '../base/scenario-lines.js';
import type { RawScenario } from '../base/base-adapter.js';

const attr = (el: HTMLElement, name: string): string | null => {
  const value = el.getAttribute(name);
  return value === undefined || value.trim().length === 0 ? null : value.trim();
};

const parseScenarioKind = (raw: string, label: string): RawScenario['kind'] => {
  const parsed = scenarioKindSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ParseError(`Cenário "${label}" com kind desconhecido: "${raw}"`);
  }
  return parsed.data;
};

const parseT2Pair = (el: HTMLElement): [string, string] | undefined => {
  const raw = attr(el, 'data-t2-pair');
  if (raw === null) return undefined;
  const parts = raw
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length !== 2) {
    throw new ParseError(`Cenário de 2º turno com par inválido: "${raw}" (esperado 2 candidatos)`);
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) {
    throw new ParseError(`Cenário de 2º turno com par inválido: "${raw}"`);
  }
  return [a, b];
};

const parseScenario = (el: HTMLElement): RawScenario => {
  const label = attr(el, 'data-scenario-label');
  const kindRaw = attr(el, 'data-scenario-kind');
  if (label === null) throw new ParseError('Cenário sem data-scenario-label');
  if (kindRaw === null) throw new ParseError(`Cenário "${label}" sem data-scenario-kind`);
  const kind = parseScenarioKind(kindRaw, label);

  const rows = el.querySelectorAll('[data-row="value"]');
  if (rows.length === 0) {
    throw new ParseError(`Cenário "${label}" sem nenhuma linha de valor`);
  }

  const acc: ScenarioAccumulator = { values: [] };
  for (const row of rows) {
    const candidate = attr(row, 'data-candidate');
    const pct = attr(row, 'data-pct');
    if (candidate === null) throw new ParseError(`Linha de valor sem data-candidate em "${label}"`);
    if (pct === null) throw new ParseError(`Candidato "${candidate}" sem data-pct em "${label}"`);
    applyLine(acc, categorizeLine(candidate, pct));
  }

  const t2Pair = kind === scenarioKindSchema.enum.t2 ? parseT2Pair(el) : undefined;

  const scenario: RawScenario = {
    kind,
    label,
    values: acc.values,
    ...(t2Pair === undefined ? {} : { t2Pair }),
    ...(acc.blankNullPct === undefined ? {} : { blankNullPct: acc.blankNullPct }),
    ...(acc.undecidedPct === undefined ? {} : { undecidedPct: acc.undecidedPct }),
  };
  return scenario;
};

/**
 * Extrai todos os cenários do HTML do nexus. LANÇA se a página não tiver nenhum
 * bloco de cenário — é sinal de mudança de estrutura (evento esperado, docs/04),
 * não motivo para devolver vazio silencioso.
 */
export const parseNexusHtml = (html: string): RawScenario[] => {
  const root = parseHtml(html);
  const blocks = root.querySelectorAll('[data-scenario]');
  if (blocks.length === 0) {
    throw new ParseError('Nenhum bloco [data-scenario] no HTML do nexus (estrutura mudou?)');
  }
  return blocks.map(parseScenario);
};
