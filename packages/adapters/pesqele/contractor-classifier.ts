/**
 * Classificação de `contractor_type` (docs/04 §2). Tabela de regras EXPLÍCITA:
 *
 * 1. Match por CNPJ quando o registro traz o CNPJ do contratante (mais confiável).
 * 2. Fallback por padrões de nome (regex sobre o nome normalizado).
 * 3. Sem match ⇒ `'desconhecido'`. NUNCA chuta (docs/04 §2, R4).
 *
 * `'desconhecido'` é um valor de enum de verdade — não é `null` nem erro. É a
 * resposta honesta para "não sei classificar isto". A revisão humana reclassifica
 * depois; o pipeline não inventa.
 *
 * Os padrões abaixo são intencionalmente conservadores: preferimos devolver
 * `'desconhecido'` a arriscar uma classificação errada.
 */

import { CONTRACTOR_TYPE } from '@election-pool/contracts/enums';
import type { ContractorType } from '@election-pool/contracts/enums';

/** Só dígitos do CNPJ, para comparar sem depender de máscara. */
const digitsOnly = (raw: string): string => raw.replace(/\D/g, '');

/** Normaliza o nome: minúsculas, sem acento, espaços colapsados. */
const normalizeName = (raw: string): string =>
  raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

interface CnpjRule {
  cnpj: string; // só dígitos
  type: ContractorType;
}

interface NameRule {
  pattern: RegExp;
  type: ContractorType;
}

/**
 * Regras por CNPJ. Preenchidas conforme identificamos contratantes recorrentes.
 * Vazia por padrão: o seed/curadoria adiciona entradas verificadas. Nunca
 * geramos CNPJ por heurística.
 */
const CNPJ_RULES: readonly CnpjRule[] = [];

/**
 * Regras por padrão de nome. Ordem importa: a primeira que casa vence. Padrões
 * genéricos ficam por último. Cada regex tem uma justificativa no comentário.
 */
// Cada padrão é anchorado por `\b` no INÍCIO (começo de palavra). Radicais
// truncados (ex.: `comunicac`, `confederac`) casam como PREFIXO — sem `\b` no
// fim, senão nunca casariam "comunicações"/"confederação". Siglas curtas exatas
// (`tv`, `xp`, `pt`, `cnt`...) trazem o próprio `\b` de fim para não colidir com
// palavras que só começam com essas letras.
const NAME_RULES: readonly NameRule[] = [
  // Veículos de imprensa.
  {
    pattern:
      /\b(tv\b|radio|jornal|revista|portal|editora|comunicac|midia|band\b|globo|sbt\b|record|folha|estadao)/,
    type: CONTRACTOR_TYPE.veiculo,
  },
  // Instituições financeiras.
  {
    pattern:
      /\b(banco|bank\b|corretora|invest|asset|capital|financeir|seguros|xp\b|btg\b|itau|bradesco|safra)/,
    type: CONTRACTOR_TYPE.instituicaoFinanceira,
  },
  // Partidos políticos.
  {
    pattern:
      /\b(partido|diretorio (nacional|estadual|municipal)|pt\b|pl\b|mdb\b|psdb\b|pdt\b|pp\b|republicanos|psol\b|podemos|uniao brasil)/,
    type: CONTRACTOR_TYPE.partido,
  },
  // Comitês / campanhas eleitorais.
  { pattern: /\b(comite|campanha|coligac|candidat)/, type: CONTRACTOR_TYPE.campanha },
  // Entidades de classe / associações / confederações / sindicatos / ONGs.
  {
    pattern:
      /\b(confederac|federac|associac|sindicat|instituto|fundac|conselho|ong\b|entidade|cnt\b|cni\b|fiesp|firjan|oab\b)/,
    type: CONTRACTOR_TYPE.entidade,
  },
];

export interface ContractorInput {
  contractorName: string;
  /** CNPJ do contratante, se o registro do PesqEle trouxer. */
  contractorCnpj?: string | null;
  /** Nome do instituto/empresa que executou a pesquisa (para detectar `proprio`). */
  instituteName?: string | null;
}

/**
 * Classifica o tipo do contratante. `proprio` = o contratante é o próprio
 * instituto (pesquisa espontânea/institucional). Detectado por igualdade de
 * nome normalizado quando o nome do instituto é conhecido.
 */
export const classifyContractor = (input: ContractorInput): ContractorType => {
  const normalizedContractor = normalizeName(input.contractorName);

  if (normalizedContractor.length === 0) {
    return CONTRACTOR_TYPE.desconhecido;
  }

  // 0. Próprio instituto contratou a si mesmo.
  if (input.instituteName != null && input.instituteName.length > 0) {
    if (normalizeName(input.instituteName) === normalizedContractor) {
      return CONTRACTOR_TYPE.proprio;
    }
  }

  // 1. Match por CNPJ (mais confiável).
  if (input.contractorCnpj != null && input.contractorCnpj.length > 0) {
    const cnpj = digitsOnly(input.contractorCnpj);
    const byCnpj = CNPJ_RULES.find((r) => r.cnpj === cnpj);
    if (byCnpj !== undefined) {
      return byCnpj.type;
    }
  }

  // 2. Fallback por padrão de nome.
  const byName = NAME_RULES.find((r) => r.pattern.test(normalizedContractor));
  if (byName !== undefined) {
    return byName.type;
  }

  // 3. Sem match ⇒ desconhecido. Nunca chuta.
  return CONTRACTOR_TYPE.desconhecido;
};

export const __test = { normalizeName, digitsOnly };
