/**
 * Constantes do protocolo real do PesqEle (capturado ao vivo em 2026-08-16,
 * PesqEle Público 3.9.2 — ver `tasks/T-15-pesqele-real.md` e `docs/OPEN-QUESTIONS.md`
 * Q-09). Ficam aqui, e não em `packages/contracts/src/constants.ts`, porque são
 * detalhes de UMA fonte externa (URLs, ids de campo JSF, rótulos de `<select>`) e
 * não contrato compartilhado — mexer em contracts invalidaria o trabalho de outros
 * agentes (CLAUDE.md). Cada valor traz a origem no comentário.
 */

/** Host do PesqEle Público (docs/04 §1, nível 1 da hierarquia de fontes). */
export const PESQELE_BASE_URL = 'https://pesqele-divulgacao.tse.jus.br';

/**
 * "Consultar as pesquisas eleitorais registradas nos últimos 30 dias" — é
 * exatamente a janela do DiscoveryJob (docs/04 §2). NÃO é `/index.xhtml`: aquela
 * é só o menu e não tem formulário de busca (Q-09). A busca com período livre
 * fica em `/app/pesquisa/listar.xhtml` e não é usada aqui.
 */
export const LISTAR_30_DIAS_PATH = '/app/pesquisa/listar30dias.xhtml';

/** Tela de detalhe, alcançada pelo `<redirect>` da ação `detalhar`. */
export const DETALHAR_PATH = '/app/pesquisa/detalhar.xhtml';

/**
 * Rótulos dos filtros. Resolvemos o VALOR do `<option>` a partir destes rótulos
 * a cada execução: o id da eleição (`81` em 2026-08-16) muda a cada pleito e um
 * id errado devolveria a eleição errada EM SILÊNCIO. Rótulo não encontrado ⇒
 * LANÇA (R4).
 */
export const ELEICAO_LABEL = 'Eleições Gerais 2026';
export const ABRANGENCIA_LABEL = 'BRASIL'; // docs/04 §2: abrangência nacional

/** Ids do formulário de busca (`formPesquisa`) e da DataTable, conforme captura. */
export const FIELD = {
  viewState: 'javax.faces.ViewState',
  form: 'formPesquisa',
  formSubmit: 'formPesquisa_SUBMIT',
  eleicaoSelect: 'formPesquisa:eleicoes_input',
  abrangenciaSelect: 'formPesquisa:filtroUF_input',
  cidadesSelect: 'formPesquisa:selectCidades_input',
  botaoPesquisar: 'formPesquisa:idBtnPesquisar',
  tabela: 'formPesquisa:tabelaPesquisas',
} as const;

/** Chaves do protocolo AJAX do PrimeFaces/JSF (`javax.faces.partial.*`). */
export const AJAX = {
  partial: 'javax.faces.partial.ajax',
  source: 'javax.faces.source',
  execute: 'javax.faces.partial.execute',
  render: 'javax.faces.partial.render',
  behaviorEvent: 'javax.faces.behavior.event',
  partialEvent: 'javax.faces.partial.event',
} as const;

/** Cabeçalhos exigidos pelo PrimeFaces para responder `<partial-response>`. */
export const AJAX_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  'Faces-Request': 'partial/ajax',
  'X-Requested-With': 'XMLHttpRequest',
};

/**
 * Offset de `America/Sao_Paulo` (CLAUDE.md: data sempre com offset). O PesqEle
 * exibe data sem hora nem fuso; o Brasil não tem horário de verão desde 2019
 * (Decreto 9.772/2019), então -03:00 é o offset vigente para todo 2026.
 */
export const SAO_PAULO_OFFSET = '-03:00';
