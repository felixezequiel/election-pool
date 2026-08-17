/**
 * Parsing dos registros do PesqEle (docs/04 §2) contra a estrutura REAL do site,
 * capturada em 2026-08-16 (PesqEle Público 3.9.2) e congelada em `__fixtures__/`.
 * Ver `docs/OPEN-QUESTIONS.md` Q-09 para o diagnóstico do parser anterior, que foi
 * escrito contra atributos `data-field`/`data-row` que NUNCA existiram no PesqEle.
 *
 * São duas telas, com estratégias diferentes:
 *
 * - **Lista** (`formPesquisa:tabelaPesquisas`): `<tr data-ri="N">` com SEIS `<td>`
 *   sem nenhum atributo semântico. O parse é POSICIONAL — não há alternativa. Por
 *   isso o número de colunas é conferido: coluna a mais/a menos ⇒ LANÇA, porque
 *   uma coluna nova deslocaria todos os campos em silêncio.
 * - **Detalhe** (`detalhar.xhtml`): pares rótulo/valor. O parse é POR RÓTULO, que
 *   sobrevive a mudança de ordem e de `j_id_*` (os ids gerados pelo JSF mudam a
 *   cada build).
 *
 * R3/docs/08 §2.1: extraímos SÓ número e metadado estruturado. O HTML bruto é
 * proveniência (`raw_documents`), nunca é republicado. Em particular, **margem de
 * erro e nível de confiança NÃO existem em campo estruturado no PesqEle** — só
 * dentro do texto metodológico do instituto. Gravamos `null` nos dois; extrair da
 * prosa seria republicar texto de terceiro e inventar precisão.
 *
 * R4: campo obrigatório ausente ou vazio LANÇA. Nunca `?? 0`, nunca `|| ''`.
 */

import { z } from 'zod';
import { parse as parseHtml } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';
import { tseIdSchema } from '@election-pool/contracts/branded';
import { parsePtBrNumber } from '../parse-ptbr-number.js';
import { SAO_PAULO_OFFSET } from './constants.js';

export class PesqEleParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PesqEleParseError';
  }
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const DATA_HORA_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

/**
 * Registro cru do PesqEle, já estruturado, antes de resolução de instituto e
 * classificação de contratante (que são do DiscoveryJob). É a UNIÃO da linha da
 * lista com a tela de detalhe: a lista sozinha não tem datas de campo nem
 * amostra. O tipo é derivado do schema (CLAUDE.md), nunca declarado em paralelo.
 */
export const rawRegistrationSchema = z.object({
  tseId: z.string().min(1),
  instituteName: z.string().min(1),
  // String vazia aqui seria o default silencioso que o R4 proíbe — por isso
  // `min(1)` em todo campo obrigatório, e não só a tipagem `string`.
  contractorName: z.string().min(1),
  contractorCnpj: z.string().min(1).nullable(),
  raceLabel: z.string().min(1), // ex.: 'Presidente'
  registeredAt: z.string().regex(DATA_HORA_ISO), // ISO-8601 com offset
  fieldStart: z.string().regex(DATA_ISO),
  fieldEnd: z.string().regex(DATA_ISO),
  sampleSize: z.number().int().positive(),
  marginOfError: z.number().nullable(), // sempre null no PesqEle — ver cabeçalho
  confidenceLevel: z.number().nullable(), // idem
  costBrl: z.number().nullable(),
});

export type RawRegistration = z.infer<typeof rawRegistrationSchema>;

/** Uma linha da tabela de resultados. `rowIndex` é o `data-ri` do PrimeFaces. */
export interface PesqEleLinhaLista {
  rowIndex: number;
  tseId: string;
  /** Coluna "Empresa Contratada/ Nome Fantasia", como o TSE escreve. */
  instituteName: string;
  /** Coluna "Cargos" — o DiscoveryJob mapeia para `race_id`. */
  raceLabel: string;
  registeredAt: string;
  /** Coluna "Abrangência" (ex.: 'BRASIL'). */
  abrangenciaLabel: string;
}

/** Estado do paginador da DataTable, lido do config do widget PrimeFaces. */
export interface PesqElePaginador {
  /** Total de registros do filtro (o "Total de registros: N" do rodapé). */
  totalRecords: number;
  /** Registros por página (10 na captura de 2026-08-16). */
  rowsPerPage: number;
  /** Índice da página corrente, base 0. */
  page: number;
}

export interface PesqEleTabelaResultado {
  linhas: PesqEleLinhaLista[];
  paginador: PesqElePaginador;
}

/** Um contratante da tela de detalhe (pode haver mais de um). */
export interface PesqEleContratante {
  name: string;
  /** CPF/CNPJ só com dígitos, como o TSE publica. */
  cpfCnpj: string;
}

/** Campos estruturados da tela de detalhe. */
export interface PesqEleDetalhe {
  tseId: string;
  registeredAt: string;
  raceLabel: string;
  /** Rótulo da eleição, conferido contra o filtro pedido (evita tela errada). */
  eleicaoLabel: string;
  instituteName: string;
  instituteCnpj: string;
  sampleSize: number;
  fieldStart: string;
  fieldEnd: string;
  /** `null` só quando o campo "Valor" existe e está vazio. */
  costBrl: number | null;
  contratantes: PesqEleContratante[];
}

// --- helpers ---------------------------------------------------------------

/** Normaliza texto vindo do HTML: NBSP vira espaço, espaços colapsam. */
const cleanText = (raw: string): string =>
  raw
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Compara rótulos ignorando acento, caixa, espaço e o ':' final. */
const normalizeLabel = (raw: string): string =>
  cleanText(raw)
    .replace(/:\s*$/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const required = (value: string, field: string, hint: string): string => {
  const text = cleanText(value);
  if (text.length === 0) {
    throw new PesqEleParseError(`Campo obrigatório "${field}" vazio no registro ${hint}`);
  }
  return text;
};

/** Valida o `tse_id` pelo schema do contrato. Fora do formato ⇒ LANÇA (R4). */
const requireTseId = (raw: string, hint: string): string => {
  const text = cleanText(raw);
  const parsed = tseIdSchema.safeParse(text);
  if (!parsed.success) {
    throw new PesqEleParseError(`tse_id inválido em ${hint}: "${text}"`);
  }
  return text;
};

/** 'DD/MM/AAAA' → 'AAAA-MM-DD'. Formato inesperado ⇒ LANÇA (nunca inventa data). */
const toIsoDate = (ptDate: string): string => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cleanText(ptDate));
  if (m === null) {
    throw new PesqEleParseError(`Data em formato inesperado: "${ptDate}"`);
  }
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * 'DD/MM/AAAA' → 'AAAA-MM-DDT00:00:00-03:00'. O PesqEle publica a data de
 * registro SEM hora; a meia-noite de São Paulo é a leitura fiel dessa data numa
 * coluna `timestamptz`, não um valor inventado.
 */
const toIsoDateTime = (ptDate: string): string =>
  `${toIsoDate(ptDate)}T00:00:00${SAO_PAULO_OFFSET}`;

/** 'R$ 148.800,00' → 148800. Sem valor ⇒ `null` (o campo existe e está vazio). */
const parseValorBrl = (raw: string): number | null => {
  const text = cleanText(raw).replace(/^R\$\s*/, '');
  if (text.length === 0) return null;
  return parsePtBrNumber(text);
};

// --- lista -----------------------------------------------------------------

// A tabela real tem SEIS colunas, nesta ordem, sem atributo semântico algum.
const COLUNA = {
  tseId: 0,
  empresa: 1,
  cargos: 2,
  dataRegistro: 3,
  abrangencia: 4,
  acoes: 5,
} as const;
const COLUNAS_ESPERADAS = 6;

const parseLinha = (tr: HTMLElement): PesqEleLinhaLista => {
  const ri = tr.getAttribute('data-ri');
  if (ri === undefined || !/^\d+$/.test(ri)) {
    throw new PesqEleParseError(`Linha da lista sem data-ri numérico: "${String(ri)}"`);
  }
  const rowIndex = Number(ri);

  const tds = tr.querySelectorAll('td');
  if (tds.length !== COLUNAS_ESPERADAS) {
    // Coluna a mais/a menos deslocaria TODOS os campos em silêncio (o parse é
    // posicional). Falhar aqui é o que impede atribuir o dado errado.
    throw new PesqEleParseError(
      `Linha data-ri=${rowIndex} tem ${tds.length} colunas; esperado ${COLUNAS_ESPERADAS}`,
    );
  }
  const celula = (index: number): string => tds[index]?.text ?? '';

  const hint = `data-ri=${rowIndex}`;
  const tseId = requireTseId(celula(COLUNA.tseId), hint);
  return {
    rowIndex,
    tseId,
    instituteName: required(celula(COLUNA.empresa), 'empresa contratada', tseId),
    raceLabel: required(celula(COLUNA.cargos), 'cargos', tseId),
    registeredAt: toIsoDateTime(required(celula(COLUNA.dataRegistro), 'data de registro', tseId)),
    abrangenciaLabel: required(celula(COLUNA.abrangencia), 'abrangência', tseId),
  };
};

/**
 * Linhas de um fragmento HTML qualquer que contenha `<tr data-ri>`. Serve tanto
 * para a tabela inteira (resposta da busca) quanto para o fragmento só-de-linhas
 * que a paginação PrimeFaces devolve.
 */
export const parseLinhasLista = (html: string): PesqEleLinhaLista[] =>
  parseHtml(html)
    .querySelectorAll('tr[data-ri]')
    .map((tr) => parseLinha(tr));

/**
 * Config do widget DataTable, que é a fonte AUTORITATIVA da paginação:
 * `paginator:{...,rows:10,rowCount:50,page:0,...}`. Ausência ⇒ LANÇA: sem saber
 * quantas páginas existem, pararíamos na primeira e chamaríamos isso de sucesso.
 */
const PAGINADOR_RE = /rows:(\d+),\s*rowCount:(\d+),\s*page:(\d+)/;

export const parsePaginador = (html: string): PesqElePaginador => {
  const m = PAGINADOR_RE.exec(html);
  if (m === null) {
    throw new PesqEleParseError(
      'Config do paginador da DataTable ausente na resposta do PesqEle (estrutura mudou?)',
    );
  }
  const [, rows, rowCount, page] = m;
  const paginador = {
    rowsPerPage: Number(rows),
    totalRecords: Number(rowCount),
    page: Number(page),
  };
  if (paginador.rowsPerPage <= 0) {
    throw new PesqEleParseError(`Paginador com rows inválido: ${paginador.rowsPerPage}`);
  }
  return paginador;
};

/**
 * Parseia a resposta da BUSCA: a tabela completa (linhas + paginador). O número
 * de linhas é conferido contra o paginador — divergência significa que estamos
 * lendo uma página parcial e achando que é o total.
 */
export const parseTabelaResultado = (html: string): PesqEleTabelaResultado => {
  const linhas = parseLinhasLista(html);
  const paginador = parsePaginador(html);

  const esperadoNaPagina = Math.max(
    0,
    Math.min(
      paginador.rowsPerPage,
      paginador.totalRecords - paginador.page * paginador.rowsPerPage,
    ),
  );
  if (linhas.length !== esperadoNaPagina) {
    throw new PesqEleParseError(
      `Página ${paginador.page} trouxe ${linhas.length} linhas; o paginador diz ${esperadoNaPagina} (total ${paginador.totalRecords})`,
    );
  }
  return { linhas, paginador };
};

// --- detalhe ---------------------------------------------------------------

// Rótulos da tela de detalhe, exatamente como o TSE os escreve (a comparação é
// feita sem acento/caixa por `normalizeLabel`).
const ROTULO = {
  numero: 'Número de identificação',
  dataRegistro: 'Data de registro',
  cargos: 'Cargo(s)',
  empresa: 'Empresa contratada/ Nome Fantasia',
  eleicao: 'Eleição',
  entrevistados: 'Entrevistados',
  dataInicio: 'Data de início da pesquisa',
  dataTermino: 'Data de término da pesquisa',
  valor: 'Valor',
  contratantes: 'Contratante(s)',
} as const;

/**
 * Valor de um par rótulo/valor: o `<td>` que contém o `<label>` do rótulo e o
 * `<td>` seguinte com o valor. Rótulo ausente ⇒ LANÇA (a tela mudou, e seguir
 * adiante produziria registro pela metade).
 */
const valorPorRotulo = (root: HTMLElement, rotulo: string): string => {
  const alvo = normalizeLabel(rotulo);
  for (const label of root.querySelectorAll('label')) {
    if (normalizeLabel(label.text) !== alvo) continue;
    const celulaRotulo = label.closest('td');
    const celulaValor = celulaRotulo?.nextElementSibling;
    if (celulaValor === undefined || celulaValor === null) {
      throw new PesqEleParseError(`Rótulo "${rotulo}" sem célula de valor ao lado`);
    }
    return cleanText(celulaValor.text);
  }
  throw new PesqEleParseError(`Rótulo "${rotulo}" ausente na tela de detalhe do PesqEle`);
};

/**
 * 'CNPJ: 09409427000112 - RAZAO SOCIAL / NOME FANTASIA' → `{ cnpj, name }`.
 * O prefixo varia entre `CNPJ:` e `CPF/CNPJ:` conforme o registro.
 */
const IDENTIFICADOR_RE = /(?:CPF\s*\/\s*CNPJ|CNPJ|CPF)\s*:\s*([\d./-]+)\s*-\s*/g;

const parseEmpresa = (raw: string, hint: string): { name: string; cnpj: string } => {
  IDENTIFICADOR_RE.lastIndex = 0;
  const m = IDENTIFICADOR_RE.exec(raw);
  if (m === null || m[1] === undefined) {
    throw new PesqEleParseError(`CNPJ da empresa contratada ausente em ${hint}: "${raw}"`);
  }
  const name = required(raw.slice(m.index + m[0].length), 'empresa contratada', hint);
  return { name, cnpj: m[1].replace(/\D/g, '') };
};

/**
 * A célula de contratantes lista uma ou mais entradas, cada uma no formato
 * `CPF/CNPJ: <id> - <nome> Origem do Recurso: (...)`, separadas por vírgula.
 * Cortamos em "Origem do Recurso:" DE PROPÓSITO: aquilo é texto livre escrito
 * pelo contratante e R3/docs/08 §2.1 proíbe armazenar prosa de terceiro.
 * Nenhum contratante ⇒ LANÇA: `contractor_name` é obrigatório no contrato e
 * string vazia seria exatamente o default silencioso que o R4 proíbe.
 */
const ORIGEM_RECURSO_RE = /\s*Origem do Recurso\s*:.*$/;

const parseContratantes = (raw: string, hint: string): PesqEleContratante[] => {
  IDENTIFICADOR_RE.lastIndex = 0;
  const marcadores = [...raw.matchAll(IDENTIFICADOR_RE)];
  if (marcadores.length === 0) {
    throw new PesqEleParseError(`Nenhum contratante identificável em ${hint}: "${raw}"`);
  }

  return marcadores.map((marcador, i) => {
    const inicio = marcador.index + marcador[0].length;
    const fim = marcadores[i + 1]?.index ?? raw.length;
    const bruto = raw
      .slice(inicio, fim)
      .replace(ORIGEM_RECURSO_RE, '')
      .replace(/[,\s]+$/, '');
    const cpfCnpj = marcador[1]?.replace(/\D/g, '') ?? '';
    if (cpfCnpj.length === 0) {
      throw new PesqEleParseError(`Contratante sem CPF/CNPJ em ${hint}`);
    }
    return { name: required(bruto, 'contratante', hint), cpfCnpj };
  });
};

/** Parseia a tela `detalhar.xhtml`. Todo campo abaixo é obrigatório (R4). */
export const parseDetalhe = (html: string): PesqEleDetalhe => {
  const root = parseHtml(html);

  const tseId = requireTseId(valorPorRotulo(root, ROTULO.numero), 'tela de detalhe');
  const empresa = parseEmpresa(valorPorRotulo(root, ROTULO.empresa), tseId);

  const entrevistados = parsePtBrNumber(
    required(valorPorRotulo(root, ROTULO.entrevistados), 'entrevistados', tseId),
  );
  if (!Number.isInteger(entrevistados) || entrevistados <= 0) {
    throw new PesqEleParseError(`Entrevistados inválido em ${tseId}: ${entrevistados}`);
  }

  return {
    tseId,
    registeredAt: toIsoDateTime(
      required(valorPorRotulo(root, ROTULO.dataRegistro), 'data de registro', tseId),
    ),
    raceLabel: required(valorPorRotulo(root, ROTULO.cargos), 'cargos', tseId),
    eleicaoLabel: required(valorPorRotulo(root, ROTULO.eleicao), 'eleição', tseId),
    instituteName: empresa.name,
    instituteCnpj: empresa.cnpj,
    sampleSize: entrevistados,
    fieldStart: toIsoDate(
      required(valorPorRotulo(root, ROTULO.dataInicio), 'data de início da pesquisa', tseId),
    ),
    fieldEnd: toIsoDate(
      required(valorPorRotulo(root, ROTULO.dataTermino), 'data de término da pesquisa', tseId),
    ),
    costBrl: parseValorBrl(valorPorRotulo(root, ROTULO.valor)),
    contratantes: parseContratantes(valorPorRotulo(root, ROTULO.contratantes), tseId),
  };
};

// --- junção ----------------------------------------------------------------

/**
 * Une linha da lista + detalhe num `RawRegistration`.
 *
 * Confere que os dois falam do MESMO registro (docs/04 §4.1: "confirmação de
 * identidade obrigatória"). A tela de detalhe é alcançada por índice de linha
 * (`data-ri`) numa sessão JSF — se a sessão paginar por baixo dos panos, o
 * índice apontaria para outro registro e nós atribuiríamos os números da rodada
 * errada. Divergência ⇒ LANÇA.
 *
 * Havendo mais de um contratante, `contractorName` traz todos (separados por
 * ' + ') e `contractorCnpj` fica `null`: com dois CNPJs não existe "o" CNPJ do
 * contratante, e chutar o primeiro seria inventar (docs/04 §2). A lista completa
 * continua disponível em `PesqEleDetalhe.contratantes`.
 */
const SEPARADOR_CONTRATANTES = ' + ';

export const toRawRegistration = (
  linha: PesqEleLinhaLista,
  detalhe: PesqEleDetalhe,
): RawRegistration => {
  if (linha.tseId !== detalhe.tseId) {
    throw new PesqEleParseError(
      `Detalhe de ${detalhe.tseId} não corresponde à linha ${linha.tseId} (sessão fora de sincronia)`,
    );
  }
  const [primeiro] = detalhe.contratantes;
  // Validação Zod na fronteira de SAÍDA do adapter (CLAUDE.md): o que sai daqui
  // vai virar linha de `poll_registrations`. Campo vazio ou fora de forma LANÇA.
  return rawRegistrationSchema.parse({
    tseId: detalhe.tseId,
    instituteName: detalhe.instituteName,
    contractorName: detalhe.contratantes.map((c) => c.name).join(SEPARADOR_CONTRATANTES),
    contractorCnpj: detalhe.contratantes.length === 1 ? (primeiro?.cpfCnpj ?? null) : null,
    raceLabel: detalhe.raceLabel,
    registeredAt: detalhe.registeredAt,
    fieldStart: detalhe.fieldStart,
    fieldEnd: detalhe.fieldEnd,
    sampleSize: detalhe.sampleSize,
    // R3: margem de erro e nível de confiança NÃO existem em campo estruturado
    // no PesqEle — só dentro da prosa metodológica do instituto. `null` é a
    // resposta honesta; extrair da prosa seria republicar texto de terceiro.
    marginOfError: null,
    confidenceLevel: null,
    costBrl: detalhe.costBrl,
  });
};

export const __test = { toIsoDate, toIsoDateTime, normalizeLabel, parseValorBrl, parseEmpresa };
