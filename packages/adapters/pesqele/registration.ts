/**
 * Parsing dos registros do PesqEle (docs/04 §2) a partir do HTML da lista/detalhe.
 *
 * IMPORTANTE (R3, docs/08): extraímos SÓ números/metadados estruturados. O HTML
 * bruto vira `raw_documents` (proveniência), nunca é republicado. Aqui não
 * guardamos prosa de terceiros — só os campos do registro.
 *
 * O PesqEle expõe cada registro como uma linha de tabela (`<tr>`) na lista, com
 * o `tse_id` e um link para o detalhe. Como o layout JSF é frágil (docs/04 §2),
 * casamos por rótulos/atributos `data-*` sintéticos definidos na fixture, e
 * qualquer campo obrigatório ausente LANÇA (R4) — nunca vira default.
 *
 * A montagem do objeto `PollRegistration` completo (resolução de instituto,
 * classificação de contratante, `first_seen_at`, `source_expired_at`) é feita
 * pelo DiscoveryJob, não aqui. Este módulo devolve o "cru estruturado".
 */

import { parse as parseHtml } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';
import { parsePtBrNumber } from '../parse-ptbr-number.js';

export class PesqEleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PesqEleParseError';
  }
}

/** Registro cru extraído do PesqEle, antes de resolução/classificação. */
export interface RawRegistration {
  tseId: string;
  instituteName: string;
  contractorName: string;
  contractorCnpj: string | null;
  raceLabel: string; // ex.: 'Presidente da República — Brasil'
  registeredAt: string; // ISO-8601 com offset
  fieldStart: string; // 'AAAA-MM-DD'
  fieldEnd: string; // 'AAAA-MM-DD'
  sampleSize: number;
  marginOfError: number | null; // p.p.
  confidenceLevel: number | null;
  costBrl: number | null;
}

/** Página de resultados: registros + o total de páginas informado pelo JSF. */
export interface RegistrationPage {
  registrations: RawRegistration[];
  currentPage: number;
  totalPages: number;
}

const required = (el: HTMLElement | null, field: string, tseHint: string): string => {
  const text = el?.getAttribute('data-value') ?? el?.text.trim();
  if (text === undefined || text.length === 0) {
    throw new PesqEleParseError(`Campo obrigatório "${field}" ausente no registro ${tseHint}`);
  }
  return text.trim();
};

const optional = (el: HTMLElement | null): string | null => {
  const text = el?.getAttribute('data-value') ?? el?.text.trim();
  return text === undefined || text.length === 0 ? null : text.trim();
};

/**
 * Converte 'DD/MM/AAAA' (formato do PesqEle) para 'AAAA-MM-DD'. Lança se a data
 * não bater o formato — nunca inventa data (R4).
 */
const toIsoDate = (ptDate: string): string => {
  const m = ptDate.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m === null) {
    throw new PesqEleParseError(`Data em formato inesperado: "${ptDate}"`);
  }
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
};

/** 'DD/MM/AAAA HH:mm' → ISO-8601 com offset -03:00 (America/Sao_Paulo). */
const toIsoDateTime = (ptDateTime: string): string => {
  const m = ptDateTime.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (m === null) {
    throw new PesqEleParseError(`Data-hora em formato inesperado: "${ptDateTime}"`);
  }
  const [, dd, mm, yyyy, hh, min] = m;
  const time = hh !== undefined && min !== undefined ? `${hh}:${min}:00` : '00:00:00';
  return `${yyyy}-${mm}-${dd}T${time}-03:00`;
};

const parseRow = (row: HTMLElement): RawRegistration => {
  const cell = (field: string): HTMLElement | null => row.querySelector(`[data-field="${field}"]`);

  const tseId = required(cell('tse_id'), 'tse_id', '(sem id)');
  const sampleRaw = required(cell('sample_size'), 'sample_size', tseId);

  const marginEl = optional(cell('margin_of_error'));
  const confidenceEl = optional(cell('confidence_level'));
  const costEl = optional(cell('cost_brl'));

  return {
    tseId,
    instituteName: required(cell('institute'), 'institute', tseId),
    contractorName: required(cell('contractor'), 'contractor', tseId),
    contractorCnpj: optional(cell('contractor_cnpj')),
    raceLabel: required(cell('race'), 'race', tseId),
    registeredAt: toIsoDateTime(required(cell('registered_at'), 'registered_at', tseId)),
    fieldStart: toIsoDate(required(cell('field_start'), 'field_start', tseId)),
    fieldEnd: toIsoDate(required(cell('field_end'), 'field_end', tseId)),
    sampleSize: Math.trunc(parsePtBrNumber(sampleRaw)),
    marginOfError: marginEl === null ? null : parsePtBrNumber(marginEl),
    confidenceLevel: confidenceEl === null ? null : parsePtBrNumber(confidenceEl),
    costBrl: costEl === null ? null : parsePtBrNumber(costEl),
  };
};

/**
 * Parseia uma página de resultados do PesqEle. Espera uma tabela cujas linhas
 * de dados têm `data-row="registration"`. O total de páginas vem de um elemento
 * `[data-field="total_pages"]` (o paginador JSF). Ausência do paginador ⇒ 1
 * página (lista curta), o que NÃO é um default silencioso de dado de pesquisa.
 */
export const parseRegistrationPage = (html: string): RegistrationPage => {
  const root = parseHtml(html);
  const rows = root.querySelectorAll('[data-row="registration"]');
  const registrations = rows.map(parseRow);

  const totalPagesEl = root.querySelector('[data-field="total_pages"]');
  const currentPageEl = root.querySelector('[data-field="current_page"]');
  const totalPagesText = totalPagesEl?.getAttribute('data-value') ?? totalPagesEl?.text.trim();
  const currentPageText = currentPageEl?.getAttribute('data-value') ?? currentPageEl?.text.trim();

  const totalPages =
    totalPagesText === undefined || totalPagesText.length === 0
      ? 1
      : Math.trunc(parsePtBrNumber(totalPagesText));
  const currentPage =
    currentPageText === undefined || currentPageText.length === 0
      ? 1
      : Math.trunc(parsePtBrNumber(currentPageText));

  return { registrations, currentPage, totalPages };
};

export const __test = { toIsoDate, toIsoDateTime, parseRow };
