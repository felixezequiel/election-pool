import { COLOR_SLOT_MIN } from '@election-pool/contracts/constants';
import { PRIMARY_METHOD } from '@election-pool/contracts/enums';
import { RACES } from '@election-pool/contracts/races';
import type { Institute, Candidate, RaceRow, Alias } from './reference.repository.js';

/**
 * Dados de seed — MANUAIS e revisados (CLAUDE.md: normalização de nome é manual,
 * nunca fuzzy match). Aliases mapeiam a grafia que aparece no PesqEle/imprensa
 * para o id canônico.
 *
 * `color_slot` de candidato é derivado da posição na lista `candidateOrder`
 * (base COLOR_SLOT_MIN), no mesmo padrão de `palette.ts`/`races.ts`, para não
 * introduzir literais numéricos 2..8 fora de `constants.ts`. Reordenar a lista =
 * trocar as cores. O slot 8 (grafite) fica reservado para "Demais" e não é
 * atribuído a candidato aqui.
 *
 * Corridas vêm do registro único em `@election-pool/contracts/races`.
 */

export const institutes: readonly Institute[] = [
  {
    id: 'quaest',
    displayName: 'Genial/Quaest',
    legalName: 'Quaest Pesquisa e Consultoria S.A.',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.presencial,
    siteUrl: 'https://genial-quaest.com.br',
  },
  {
    id: 'datafolha',
    displayName: 'Datafolha',
    legalName: 'Instituto de Pesquisas Datafolha Ltda.',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.presencial,
    siteUrl: 'https://datafolha.folha.uol.com.br',
  },
  {
    id: 'ipec',
    displayName: 'Ipec',
    legalName: 'Inteligência em Pesquisa e Consultoria Ltda.',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.presencial,
    siteUrl: 'https://www.ipec.com.br',
  },
  {
    id: 'atlas',
    displayName: 'AtlasIntel',
    legalName: 'Atlas Political and Economic Research',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.painelOnline,
    siteUrl: 'https://atlasintel.org',
  },
  {
    id: 'paranapesquisas',
    displayName: 'Paraná Pesquisas',
    legalName: 'Paraná Pesquisas Ltda.',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.telefone,
    siteUrl: 'https://www.paranapesquisas.com.br',
  },
  // Institutos com adapter v1 (nexus HTML, cnt-mda PDF). Sem estes registros +
  // aliases o harvest não resolve adapter (LOG T-06); id = instituteId do adapter.
  {
    id: 'nexus',
    displayName: 'Nexus',
    legalName: 'Nexus Pesquisa e Assessoria Ltda.',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.presencial,
    siteUrl: 'https://nexuspesquisa.com',
  },
  {
    id: 'mda',
    displayName: 'CNT/MDA',
    legalName: 'MDA Pesquisa Ltda.',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.presencial,
    siteUrl: 'https://www.mdaonline.com.br',
  },
];

export const instituteAliases: readonly Alias[] = [
  { alias: 'Genial/Quaest', targetId: 'quaest' },
  { alias: 'Quaest', targetId: 'quaest' },
  { alias: 'Datafolha', targetId: 'datafolha' },
  { alias: 'Instituto Datafolha', targetId: 'datafolha' },
  { alias: 'Ipec', targetId: 'ipec' },
  { alias: 'AtlasIntel', targetId: 'atlas' },
  { alias: 'Atlas', targetId: 'atlas' },
  { alias: 'Paraná Pesquisas', targetId: 'paranapesquisas' },
  { alias: 'Nexus', targetId: 'nexus' },
  { alias: 'Nexus Pesquisa', targetId: 'nexus' },
  { alias: 'CNT/MDA', targetId: 'mda' },
  { alias: 'MDA', targetId: 'mda' },
  { alias: 'MDA Pesquisa', targetId: 'mda' },
];

// Ordem define o color_slot (base COLOR_SLOT_MIN). Slot 8 reservado a "Demais".
const candidateOrder: ReadonlyArray<Omit<Candidate, 'colorSlot'>> = [
  { id: 'lula', displayName: 'Luiz Inácio Lula da Silva', party: 'PT' },
  { id: 'tarcisio', displayName: 'Tarcísio de Freitas', party: 'Republicanos' },
  { id: 'ratinho-junior', displayName: 'Ratinho Junior', party: 'PSD' },
  { id: 'flavio-bolsonaro', displayName: 'Flávio Bolsonaro', party: 'PL' },
  { id: 'ciro-gomes', displayName: 'Ciro Gomes', party: 'PDT' },
  { id: 'simone-tebet', displayName: 'Simone Tebet', party: 'MDB' },
  { id: 'zema', displayName: 'Romeu Zema', party: 'Novo' },
];

export const candidates: readonly Candidate[] = candidateOrder.map((cand, index) => ({
  ...cand,
  colorSlot: index + COLOR_SLOT_MIN,
}));

export const candidateAliases: readonly Alias[] = [
  { alias: 'Lula', targetId: 'lula' },
  { alias: 'Luiz Inácio Lula da Silva', targetId: 'lula' },
  { alias: 'Tarcísio', targetId: 'tarcisio' },
  { alias: 'Tarcísio de Freitas', targetId: 'tarcisio' },
  { alias: 'Ratinho Junior', targetId: 'ratinho-junior' },
  { alias: 'Ratinho Jr.', targetId: 'ratinho-junior' },
  { alias: 'Flávio Bolsonaro', targetId: 'flavio-bolsonaro' },
  { alias: 'Ciro Gomes', targetId: 'ciro-gomes' },
  { alias: 'Ciro', targetId: 'ciro-gomes' },
  { alias: 'Simone Tebet', targetId: 'simone-tebet' },
  { alias: 'Tebet', targetId: 'simone-tebet' },
  { alias: 'Romeu Zema', targetId: 'zema' },
  { alias: 'Zema', targetId: 'zema' },
];

export const races: readonly RaceRow[] = RACES.map((race) => ({
  id: race.id,
  displayName: race.displayName,
  status: race.status,
  sortOrder: race.sortOrder,
}));
