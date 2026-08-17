import { COLOR_SLOT_MIN, COLOR_SLOT_MAX } from '@election-pool/contracts/constants';
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
 * trocar as cores. Os sete primeiros ficam com as cores de identidade (1–7); do
 * oitavo em diante todos COMPARTILHAM o slot 8, o grafite do resíduo — o campo de
 * 2026 tem mais candidatura registrada que a paleta tem cor. Ver o comentário
 * longo em `candidateOrder` para o critério e a pendência que ele deixa aberta.
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
    // `ipec.com.br` NÃO resolve (ENOTFOUND) — verificado ao vivo durante o adapter
    // do Ipec. O domínio real do instituto é este.
    siteUrl: 'https://ipec-inteligencia.com.br',
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
  // Institutos de referência nacional acrescentados junto dos adapters da 2ª
  // rodada. `primaryMethod` é a MODALIDADE PREDOMINANTE declarada pelo próprio
  // instituto na metodologia dele — não é chute nosso, e cada adapter confirma
  // (ou corrige) o valor ao ler a página de metodologia da fonte.
  {
    id: 'poderdata',
    displayName: 'PoderData',
    legalName: 'PoderData Pesquisa, Jornalismo e Comunicação Ltda.',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.telefone,
    siteUrl: 'https://www.poder360.com.br/poderdata',
  },
  {
    id: 'realtime',
    displayName: 'Real Time Big Data',
    legalName: 'Real Time Mídia Ltda.',
    cnpj: null,
    primaryMethod: PRIMARY_METHOD.telefone,
    siteUrl: 'https://www.realtimebigdata.com.br',
  },
  {
    id: 'palver',
    displayName: 'Palver',
    legalName: 'Palver Tecnologia Ltda.',
    cnpj: null,
    // Conferido na metodologia declarada pela PRÓPRIA Palver (relatório da onda):
    // a Pesquisa Palver é survey online com amostra não-probabilística recrutada
    // por anúncio em redes sociais, calibrada por raking contra PNADc — logo
    // `painelOnline`. NÃO é mensageria: o WhatsApp pertence ao outro produto deles
    // (escuta social), que mede MENÇÕES e nunca pode entrar neste agregado.
    primaryMethod: PRIMARY_METHOD.painelOnline,
    siteUrl: 'https://palver.com.br',
  },
];

export const instituteAliases: readonly Alias[] = [
  // ── Razões sociais EXATAS do PesqEle ──────────────────────────────────────
  // O TSE identifica o instituto pela razão social + nome fantasia, não pela
  // marca. Sem estas linhas o DiscoveryJob traz o registro com `institute_id`
  // nulo e alerta de cadastro manual — foi o que aconteceu na primeira colheita
  // real (51 registros, 1 resolvido). Copiadas VERBATIM do que o PesqEle devolve,
  // conferidas uma a uma: normalização de nome é manual, nunca fuzzy (CLAUDE.md).
  // Instituto que ainda não rastreamos permanece SEM alias de propósito: cadastrar
  // exigiria inventar `primaryMethod`, e chute em campo de referência é R4.
  { alias: 'DATAFOLHA INSTITUTO DE PESQUISAS LTDA.', targetId: 'datafolha' },
  { alias: 'QUAEST PESQUISAS, CONSULTORIA E PROJETOS LTDA.', targetId: 'quaest' },
  { alias: 'ATLASINTEL TECNOLOGIA DE DADOS LTDA / ATLASINTEL', targetId: 'atlas' },
  { alias: 'INTELIGENCIA EM PESQUISA E CONSULTORIA LTDA / IPEC', targetId: 'ipec' },
  { alias: 'NEXUS PESQUISA E INTELIGENCIA DE DADOS LTDA / NEXUS', targetId: 'nexus' },
  {
    alias: 'PODERDATA PESQUISA, JORNALISMO E COMUNICACAO LTDA / PODERDATA',
    targetId: 'poderdata',
  },
  { alias: 'REAL TIME MIDIA LTDA / REAL TIME BIG DATA', targetId: 'realtime' },

  // ── Grafias de imprensa / uso corrente ────────────────────────────────────
  { alias: 'Genial/Quaest', targetId: 'quaest' },
  { alias: 'Quaest', targetId: 'quaest' },
  { alias: 'Datafolha', targetId: 'datafolha' },
  { alias: 'Instituto Datafolha', targetId: 'datafolha' },
  { alias: 'Ipec', targetId: 'ipec' },
  { alias: 'AtlasIntel', targetId: 'atlas' },
  { alias: 'Atlas', targetId: 'atlas' },
  { alias: 'Paraná Pesquisas', targetId: 'paranapesquisas' },
  { alias: 'PoderData', targetId: 'poderdata' },
  { alias: 'Real Time Big Data', targetId: 'realtime' },
  { alias: 'RealTime Big Data', targetId: 'realtime' },
  { alias: 'Palver', targetId: 'palver' },
  { alias: 'Nexus', targetId: 'nexus' },
  { alias: 'Nexus Pesquisa', targetId: 'nexus' },
  { alias: 'CNT/MDA', targetId: 'mda' },
  { alias: 'MDA', targetId: 'mda' },
  { alias: 'MDA Pesquisa', targetId: 'mda' },
];

/**
 * Candidatos RASTREADOS, na ordem que define o `color_slot` (base
 * COLOR_SLOT_MIN). Os sete primeiros recebem slots 1–7, as cores de identidade
 * da paleta; TODOS os demais recebem o slot 8, o grafite que a paleta reserva ao
 * resíduo "Demais" (docs/05 §2.1). Não é um descuido: a paleta foi desenhada com
 * sete identidades e um resíduo, e o campo de 2026 tem 13 candidaturas
 * registradas no TSE. Não cabe cor distinta para todas.
 *
 * Por que ESTA ordem, e por que ela não é um juízo político (R2): os sete
 * primeiros são os candidatos para os quais existe EVIDÊNCIA de aparecer
 * nomeadamente numa rodada real já capturada de instituto (Quaest BR-06591/2026
 * e releases do Paraná Pesquisas). O critério é "o instituto mediu este nome",
 * que é dado, não espectro. Quem só tem candidatura registrada mas ninguém mede
 * ainda entra rastreado — precisa estar aqui para o alias resolver e a pesquisa
 * não cair em quarentena — mas no slot residual.
 *
 * PENDÊNCIA CONSCIENTE: quando houver série real, a atribuição de slot deveria
 * ser revista contra a média do próprio agregado, não contra a evidência esparsa
 * de hoje. Reordenar esta lista troca as cores; é o único lugar a mudar.
 */
const candidateOrder: ReadonlyArray<Omit<Candidate, 'colorSlot'>> = [
  // Slots 1–7: medidos por instituto em rodada real capturada.
  { id: 'lula', displayName: 'Luiz Inácio Lula da Silva', party: 'PT' },
  { id: 'flavio-bolsonaro', displayName: 'Flávio Bolsonaro', party: 'PL' },
  { id: 'ronaldo-caiado', displayName: 'Ronaldo Caiado', party: 'PSD' },
  { id: 'renan-santos', displayName: 'Renan Santos', party: 'Missão' },
  { id: 'zema', displayName: 'Romeu Zema', party: 'Novo' },
  { id: 'jair-bolsonaro', displayName: 'Jair Bolsonaro', party: 'PL' },
  { id: 'pablo-marcal', displayName: 'Pablo Marçal', party: 'PRTB' },

  // Slot 8 (resíduo) — candidaturas registradas no TSE em 2026 sem medição
  // própria observada ainda. Rastreadas para o alias resolver.
  { id: 'augusto-cury', displayName: 'Augusto Cury', party: 'Avante' },
  { id: 'clariana-barao', displayName: 'Clariana Barão', party: 'DC' },
  { id: 'edmilson-costa', displayName: 'Edmilson Costa', party: 'PCB' },
  { id: 'hertz-dias', displayName: 'Hertz Dias', party: 'PSTU' },
  { id: 'rui-costa-pimenta', displayName: 'Rui Costa Pimenta', party: 'PCO' },
  { id: 'samara', displayName: 'Samara', party: 'UP' },
  { id: 'wilson-grassi', displayName: 'Wilson Grassi', party: 'Democrata' },
  { id: 'aldo-rebelo', displayName: 'Aldo Rebelo', party: null },

  // Slot 8 — PRÉ-candidatos que NÃO registraram candidatura em 2026 (conferido
  // no DivulgaCandContas). Ficam rastreados porque rodadas anteriores à
  // desistência os mediram e `poll_results` é imutável (R5): remover daqui
  // quebraria a leitura do histórico já colhido.
  { id: 'tarcisio', displayName: 'Tarcísio de Freitas', party: 'Republicanos' },
  { id: 'ratinho-junior', displayName: 'Ratinho Junior', party: 'PSD' },
  { id: 'ciro-gomes', displayName: 'Ciro Gomes', party: 'PDT' },
  { id: 'simone-tebet', displayName: 'Simone Tebet', party: 'MDB' },

  // Slot 8 — o RESÍDUO. Não é pessoa: é o agregado que a fonte publica como
  // "Outros" (a barra com os candidatos que ela não mostra individualmente).
  // Precisa existir como entidade rastreada porque descartar o número no parser
  // seria perder dado publicado em silêncio (R4), e a restrição de soma do modelo
  // (docs/01 §4.3) conta com o resíduo para fechar 100. A paleta já reserva o
  // grafite do slot 8 a ele (docs/05 §2.1) e a amostra do front já o chamava
  // 'Demais'. Mapear "Outros" para um candidato real inventaria uma pessoa.
  { id: 'joaquim-barbosa', displayName: 'Joaquim Barbosa', party: null },
  { id: 'cabo-daciolo', displayName: 'Cabo Daciolo', party: 'Mobiliza' },
  { id: 'demais', displayName: 'Demais', party: null },
];

/** Quantos candidatos recebem cor de identidade; o resto vai para o resíduo. */
const IDENTITY_SLOTS = COLOR_SLOT_MAX - COLOR_SLOT_MIN; // 7 = slots 1..7

export const candidates: readonly Candidate[] = candidateOrder.map((cand, index) => ({
  ...cand,
  colorSlot: index < IDENTITY_SLOTS ? index + COLOR_SLOT_MIN : COLOR_SLOT_MAX,
}));

export const candidateAliases: readonly Alias[] = [
  // ── Grafias observadas em rodada REAL de instituto ────────────────────────
  // Cada linha abaixo saiu de uma captura, não de suposição: sem elas a pesquisa
  // inteira cai em quarentena por `UnknownCandidateError` (correto, mas rende
  // zero dado). Normalização é MANUAL e revisada — nunca fuzzy match (CLAUDE.md).
  { alias: 'Ronaldo Caiado', targetId: 'ronaldo-caiado' },
  { alias: 'RONALDO CAIADO', targetId: 'ronaldo-caiado' },
  { alias: 'Caiado', targetId: 'ronaldo-caiado' },
  { alias: 'Renan Santos', targetId: 'renan-santos' },
  { alias: 'RENAN SANTOS', targetId: 'renan-santos' },
  { alias: 'Jair Bolsonaro', targetId: 'jair-bolsonaro' },
  { alias: 'Bolsonaro', targetId: 'jair-bolsonaro' },
  { alias: 'Flávio', targetId: 'flavio-bolsonaro' },
  { alias: 'Pablo Marçal', targetId: 'pablo-marcal' },
  { alias: 'PABLO MARÇAL', targetId: 'pablo-marcal' },
  { alias: 'Marçal', targetId: 'pablo-marcal' },
  { alias: 'Aldo Rebelo', targetId: 'aldo-rebelo' },
  { alias: 'Aldo Rebello', targetId: 'aldo-rebelo' },

  // ── Grafias oficiais do DivulgaCandContas (nome de urna do registro) ──────
  { alias: 'ESCRITOR AUGUSTO CURY', targetId: 'augusto-cury' },
  { alias: 'Augusto Cury', targetId: 'augusto-cury' },
  { alias: 'CLARIANA BARAO', targetId: 'clariana-barao' },
  { alias: 'Clariana Barão', targetId: 'clariana-barao' },
  { alias: 'EDMILSON COSTA', targetId: 'edmilson-costa' },
  { alias: 'Edmilson Costa', targetId: 'edmilson-costa' },
  { alias: 'HERTZ DIAS', targetId: 'hertz-dias' },
  { alias: 'Hertz Dias', targetId: 'hertz-dias' },
  { alias: 'RUI COSTA PIMENTA', targetId: 'rui-costa-pimenta' },
  { alias: 'Rui Costa Pimenta', targetId: 'rui-costa-pimenta' },
  { alias: 'SAMARA', targetId: 'samara' },
  { alias: 'Samara', targetId: 'samara' },
  { alias: 'VETERINÁRIO WILSON GRASSI', targetId: 'wilson-grassi' },
  { alias: 'Wilson Grassi', targetId: 'wilson-grassi' },

  // ── Grafias que o MESMO documento imprime de formas diferentes ─────────────
  // Real Time Big Data escreve o nome de três maneiras conforme o gráfico:
  // espontânea sem partido, estimulada com partido, 2º turno em caixa alta. O
  // resolver casa alias EXATO por decisão de projeto (normalização é manual,
  // nunca fuzzy), então cada grafia precisa da sua linha revisada.
  { alias: 'Lula (PT)', targetId: 'lula' },
  { alias: 'LULA (PT)', targetId: 'lula' },
  { alias: 'Flávio Bolsonaro (PL)', targetId: 'flavio-bolsonaro' },
  { alias: 'FLÁVIO BOLSONARO (PL)', targetId: 'flavio-bolsonaro' },
  { alias: 'Romeu Zema (Novo)', targetId: 'zema' },
  { alias: 'ROMEU ZEMA (NOVO)', targetId: 'zema' },
  { alias: 'Ronaldo Caiado (PSD)', targetId: 'ronaldo-caiado' },
  { alias: 'RONALDO CAIADO (PSD)', targetId: 'ronaldo-caiado' },
  { alias: 'Renan Santos (Missão)', targetId: 'renan-santos' },
  // Grafia com partido em caixa mista — foi ELA que mandou a primeira rodada real
  // do Real Time para quarentena, com o PDF já lido corretamente.
  { alias: 'Escritor Augusto Cury (Avante)', targetId: 'augusto-cury' },
  { alias: 'Augusto Cury (Avante)', targetId: 'augusto-cury' },
  { alias: 'Cabo Daciolo', targetId: 'cabo-daciolo' },
  { alias: 'Cabo Daciolo (Mobiliza)', targetId: 'cabo-daciolo' },
  { alias: 'CABO DACIOLO (MOBILIZA)', targetId: 'cabo-daciolo' },
  { alias: 'Jair Bolsonaro (PL)', targetId: 'jair-bolsonaro' },
  { alias: 'JAIR BOLSONARO (PL)', targetId: 'jair-bolsonaro' },
  { alias: 'Pablo Marçal (PRTB)', targetId: 'pablo-marcal' },
  { alias: 'Joaquim Barbosa (sem partido)', targetId: 'joaquim-barbosa' },

  // O agregado "Outros" vai para o resíduo, não para uma pessoa.
  { alias: 'Outros', targetId: 'demais' },
  { alias: 'outros', targetId: 'demais' },
  { alias: 'Demais', targetId: 'demais' },

  // PoderData mediu Joaquim Barbosa em maio/junho e ele SAI dos cenários em
  // julho — é o caso real de "ausência não é zero" (docs/04 §4.1).
  { alias: 'Joaquim Barbosa', targetId: 'joaquim-barbosa' },

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
