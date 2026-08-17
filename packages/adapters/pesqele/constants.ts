/**
 * Constantes do protocolo real do PesqEle (capturado ao vivo em 2026-08-16 e
 * 2026-08-17, PesqEle Público 3.9.2 — ver `tasks/T-15-pesqele-real.md`,
 * `tasks/T-28-pesqele-teto-50.md` e `docs/OPEN-QUESTIONS.md` Q-09 e Q-11).
 * Ficam aqui, e não em `packages/contracts/src/constants.ts`, porque são
 * detalhes de UMA fonte externa (URLs, ids de campo JSF, rótulos de `<select>`) e
 * não contrato compartilhado — mexer em contracts invalidaria o trabalho de outros
 * agentes (CLAUDE.md). Cada valor traz a origem no comentário.
 */

/** Host do PesqEle Público (docs/04 §1, nível 1 da hierarquia de fontes). */
export const PESQELE_BASE_URL = 'https://pesqele-divulgacao.tse.jus.br';

/**
 * "Consultar as pesquisas eleitorais registradas nos últimos 30 dias". Foi a tela
 * usada até T-28 e NÃO é mais: o servidor corta a listagem em 50 registros e essa
 * tela não tem filtro de período, então não há como escapar do teto por ela — a
 * janela de 30 dias inteira volta truncada e sem aviso (Q-11). Fica registrada
 * aqui porque é a tela que o TSE oferece no menu e continua sendo a referência do
 * requisito de produto (docs/04 §2). Não é `/index.xhtml`: aquela é só o menu e
 * não tem formulário de busca (Q-09).
 */
export const LISTAR_30_DIAS_PATH = '/app/pesquisa/listar30dias.xhtml';

/**
 * Busca com PERÍODO LIVRE ("Período de registro: <de> à <até>"). É a tela que o
 * DiscoveryJob usa desde T-28: só ela permite fatiar a janela em pedaços pequenos
 * o bastante para nenhuma consulta bater no teto de 50 (Q-11). Ela também é a
 * única que DECLARA o teto na própria página (ver `LIMITE_RESULTADO_DECLARADO`).
 * Mesmo protocolo AJAX/DataTable da tela de 30 dias, com duas diferenças
 * verificadas ao vivo em 2026-08-17:
 *
 * 1. A tabela tem a coluna "Eleição" no lugar de "Cargos" — por isso o parse das
 *    colunas passou a ser guiado pelo cabeçalho, e não por índice fixo.
 * 2. A DataTable GUARDA a página corrente entre buscas: uma busca feita depois de
 *    paginar volta em `page:1`, não em `page:0`. O cliente varre todas as páginas
 *    do paginador em vez de supor que a busca traz a primeira.
 */
export const LISTAR_PATH = '/app/pesquisa/listar.xhtml';

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

/**
 * Rótulo do par de campos de data em `listar.xhtml`. Os ids reais dos dois inputs
 * são gerados pelo JSF (`formPesquisa:j_id_2n_input` e `formPesquisa:j_id_2p_input`
 * em 2026-08-17) e mudam a cada build do PesqEle — hardcodá-los faria a busca ir
 * SEM período e voltar truncada em 50, que é exatamente o bug que T-28 conserta.
 * Por isso os nomes são resolvidos a partir deste rótulo em tempo de execução
 * (`periodo-inputs.ts`), e rótulo ausente LANÇA (R4).
 */
export const PERIODO_REGISTRO_LABEL = 'Período de registro';

/**
 * Teto de registros que o PesqEle devolve por consulta. Não é uma suposição
 * nossa: a própria tela de `listar.xhtml` declara, em vermelho, "O resultado da
 * consulta está limitado a 50 registros. Utilize os filtros para pesquisar."
 * (`formPesquisa:j_id_3r`, capturado em 2026-08-17). Medido ao vivo no mesmo dia:
 * período de um ano inteiro ⇒ 50; janela de 30 dias ⇒ 50; janela de 3 dias ⇒ 13.
 * Total igual ao teto é SUSPEITA de truncagem, nunca "o total é esse mesmo".
 *
 * A constante existe para o caso do rótulo mudar/sumir; o valor usado em cada
 * consulta é o DECLARADO pela resposta, e divergência entre os dois vira alerta
 * (`limit_mismatch`) — nunca silêncio.
 */
export const LIMITE_RESULTADO_DECLARADO = 50;

/**
 * Janela que cada ciclo precisa cobrir: os registros do PesqEle expiram em 30
 * dias (docs/04 §2), então tudo que não for colhido dentro desse prazo é dado
 * perdido para sempre. É requisito de produto, não parâmetro de tuning.
 */
export const JANELA_DIAS = 30;

/**
 * Largura de cada fatia de data da varredura, em dias. A conta (medida ao vivo em
 * 2026-08-17, eleição 2026 / BRASIL, contando por data de registro):
 *
 * - 30 dias inteiros ⇒ 50 (TRUNCADO). As dez fatias de 3 dias da mesma janela
 *   somaram **131** registros: 11, 20, 12, 16, 4, 16, 16, 13, 11, 12.
 * - Pico observado numa fatia de 3 dias: 20 ⇒ margem de 2,5x até o teto de 50.
 * - Custo: ~10 fatias × (1 busca + ~1 paginação) + 1 GET inicial ≈ 20 requisições
 *   ≈ 3,5 min a 1 req/10s (docs/04 §6), contra ~1 min da consulta única que
 *   perdia 62% dos registros. Fatia mais estreita quase não muda o custo (o
 *   dominante é o total de páginas: 131/10 ≈ 13 requisições de qualquer forma).
 *
 * Se o volume crescer perto do pleito e uma fatia de 3 dias bater no teto, a
 * varredura SUBDIVIDE a fatia automaticamente até 1 dia antes de desistir — esta
 * largura é o ponto de partida, não um limite.
 */
export const FATIA_DIAS = 3;

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
