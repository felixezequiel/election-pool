/**
 * Constantes do adapter Quaest (Genial/Quaest). TODAS derivadas das capturas
 * REAIS congeladas em `__fixtures__/` (ver o README de lá para URL, data e como
 * recapturar). Nenhuma foi suposta: cada uma tem, no comentário, a frase ou o
 * campo da captura que a justifica.
 *
 * Por que ficam AQUI e não em `packages/contracts/src/constants.ts`: são
 * particularidades de UMA fonte (o WordPress da Quaest e a redação editorial do
 * instituto), não parâmetros de domínio compartilhados. `contracts` está
 * congelado nesta task e alargá-lo por causa de um seletor de CSS de terceiro
 * invalidaria trabalho de outros agentes (CLAUDE.md). Os limites de VALIDAÇÃO
 * (V1/V3/V7), que SÃO de domínio, continuam vindo de `contracts`.
 */

export const QUAEST_ADAPTER_ID = 'quaest';
export const QUAEST_INSTITUTE_ID = 'quaest';

// === Superfícies da fonte (nível 2 de docs/04 §1: site do próprio instituto) ==
// Verificadas ao vivo em 2026-08-17. `robots.txt` de quaest.com.br só proíbe
// `/wp-admin/` (exceto `admin-ajax.php`) — nada abaixo é bloqueado.
//
// O site é WordPress. A divulgação de uma rodada aparece em DUAS superfícies:
//   1. um post do tipo `relatorios` cujo ANEXO é o PDF da rodada; e
//   2. um post de blog assinado pelo CEO, que é o único lugar onde o número de
//      registro no TSE e os percentuais aparecem em TEXTO.
// As páginas `/relatorios/` e `/relatorios-quaest/` são montadas por JS
// (JetEngine) e vêm VAZIAS no HTML — e a v1 não usa headless browser
// (CLAUDE.md). Por isso a descoberta vai por sitemap + WP REST, que são HTML/JSON
// estáticos e servem o mesmo dado.
export const QUAEST_SITEMAP_INDEX_URL = 'https://quaest.com.br/sitemap_index.xml';
export const QUAEST_SITEMAP_RELATORIOS_URL = 'https://quaest.com.br/relatorios-sitemap1.xml';
export const QUAEST_SITEMAP_POSTS_URL = 'https://quaest.com.br/post-sitemap.xml';
/** Lista os posts do tipo `relatorios` (a rodada e seu PDF anexo). */
export const QUAEST_REST_RELATORIOS_URL =
  'https://quaest.com.br/wp-json/wp/v2/relatorios?per_page=20&orderby=date&order=desc';
/** Lista os posts de blog (onde estão o registro TSE e os percentuais em texto). */
export const QUAEST_REST_POSTS_URL =
  'https://quaest.com.br/wp-json/wp/v2/posts?per_page=20&orderby=date&order=desc';

/**
 * Dias após o FIM DO CAMPO em que o post da rodada pode aparecer. Medido nas duas
 * capturas: campo 31/07–03/08 ⇒ post em 05/08 (2 dias); campo 10–13/07 ⇒ post em
 * 15/07 (2 dias). 14 dias dá folga para divulgação atrasada sem alcançar a rodada
 * seguinte (as rodadas nacionais de 2026 saíram a cada ~11–30 dias). Janela larga
 * não é perigosa: o V6 descarta o post errado — larga demais só custa requisição.
 */
export const QUAEST_POST_LAG_DAYS = 14;

/**
 * Teto de candidatas devolvidas por `discover`. Cada candidata custa ao
 * HarvestJob uma requisição (10 s de rate limit) e um `raw_documents`. Nas duas
 * janelas reais medidas o resultado foi 2 e 3 posts, então 6 é folga com sobra.
 */
export const QUAEST_MAX_POST_CANDIDATES = 6;

/**
 * Posts de blog publicados numa JANELA de datas. É o que o `discover` usa, porque
 * o slug do post é um TÍTULO EDITORIAL e não é derivável do registro — ver o
 * cabeçalho de `quaest-adapter.ts`. `after`/`before` são filtros nativos do WP
 * REST (verificados ao vivo em 2026-08-17: janela do campo de agosto devolve 2
 * posts, a de julho devolve 3, janela sem post devolve `[]`).
 */
export const quaestRestPostsInWindowUrl = (afterIso: string, beforeIso: string): string =>
  `https://quaest.com.br/wp-json/wp/v2/posts?per_page=${String(QUAEST_MAX_POST_CANDIDATES)}` +
  `&orderby=date&order=asc&after=${afterIso}&before=${beforeIso}&_fields=id,date,slug,link`;

/**
 * Anexos de um post `relatorios` (o PDF da rodada). Verificado com o post 4768
 * ("…1º Turno – Rodada 1 – 14/08/2026"), cuja resposta está congelada em
 * `__fixtures__/2026-08-17-wp-rest-media-parent-4768.json`.
 */
export const quaestRestMediaByParentUrl = (postId: number): string =>
  `https://quaest.com.br/wp-json/wp/v2/media?parent=${String(postId)}&per_page=50`;

// === Estrutura do post (Elementor) ==========================================
// Presente e idêntico nas DUAS capturas (2026-07-15 e 2026-08-05). O corpo do
// artigo é o único bloco que o parser lê; menu, rodapé e banner de cookies ficam
// fora por construção.
export const QUAEST_ARTICLE_BODY_SELECTOR =
  '.elementor-widget-theme-post-content .elementor-widget-container';
/** Elementos de bloco dentro do corpo do artigo, na ordem do documento. */
export const QUAEST_ARTICLE_BLOCK_SELECTOR = 'p, h2, h3, li';

// === Âncoras de cenário =====================================================
// Frases (normalizadas: sem acento, minúsculas) com que o instituto ABRE o
// parágrafo de cada cenário. Só o parágrafo ancorado é lido — é essa restrição
// de escopo que impede o parser de capturar percentual de subgrupo ou de outra
// pergunta que aparece em outros parágrafos do mesmo post.
//
// Origem, verbatim das capturas:
//   t1_estimulado — "No cenário estimulado de primeiro turno, …"      (2026-08-05)
//                   "…apresentados no cenário estimulado de primeiro turno, …" (2026-07-15)
//   t1_espontaneo — "…é captado na intenção de voto espontânea."      (2026-07-15)
//   t2            — "Nas projeções para o segundo turno, …"           (2026-08-05)
//                   "Em uma simulação de segundo turno, …"            (2026-07-15)
export const QUAEST_SCENARIO_ANCHORS = {
  t1_estimulado: ['cenario estimulado de primeiro turno'],
  t1_espontaneo: ['intencao de voto espontanea'],
  t2: ['para o segundo turno', 'simulacao de segundo turno'],
} as const;

/**
 * Rótulos do cenário. São NOSSOS, não do instituto: o post é prosa e não tem
 * rótulo de cenário para copiar, e copiar a frase de abertura colocaria texto de
 * terceiro em `poll_scenarios.label` (R3, docs/08 §2). Como `docs/03` §2.4 usa
 * `UNIQUE (tse_id, kind, label)`, o rótulo precisa ser ESTÁVEL entre rodadas —
 * mais uma razão para não vir da redação, que muda a cada post.
 */
export const QUAEST_SCENARIO_LABELS = {
  t1_estimulado: '1º turno estimulado',
  t1_espontaneo: '1º turno espontâneo',
  t2: '2º turno',
} as const;

// === Guardas de leitura =====================================================

/**
 * Marcadores de SUBGRUPO ou de OUTRA PERGUNTA. Um percentual cercado por
 * qualquer um deles é recusado: no post de 2026-08-05 o parágrafo
 * "Na simulação de segundo turno, o apoio a Flávio saltou de 74% para 81% entre
 * os eleitores que se identificam como 'direita não-bolsonarista'…" casa a mesma
 * âncora de 2º turno do parágrafo nacional, e sem esta guarda o adapter
 * publicaria número de recorte como se fosse nacional. Também barra as séries de
 * potencial de voto / rejeição / desconhecimento / aprovação, que são outras
 * perguntas do mesmo levantamento.
 */
export const QUAEST_SUBGROUP_MARKERS: readonly string[] = [
  'entre os eleitores',
  'entre as ',
  'dos eleitores',
  'da direita',
  'bolsonarist',
  'independentes',
  'potencial de voto',
  'rejeicao',
  'desconhecimento',
  'aprovacao',
  'desaprovacao',
  'voto definitivo',
  'nao afeta',
  'lembranca',
  'eleitorado geral',
  'entrevistados',
];

/**
 * Construção de TENDÊNCIA do português: "de A% … para B%" (com ou sem o mês).
 * B é sempre o valor CORRENTE; A é a rodada anterior. Colapsamos para B ANTES de
 * extrair — sem isso, "a oscilação de Flávio Bolsonaro de 28% em julho para 30%
 * em agosto" (2026-08-05) entregaria 28, isto é, o número da RODADA ANTERIOR
 * atribuído a este registro. É o pior bug previsto em docs/04 §4.1, e o V6 não
 * pegaria: o `tse_id` correto está no mesmo documento.
 */
export const QUAEST_TREND_PATTERN_SOURCE =
  'de\\s+(\\d{1,3}(?:,\\d+)?)%(?:\\s+em\\s+[a-z\\u00e0-\\u00fc]+(?:\\s+de\\s+\\d{4})?)?' +
  '\\s+para\\s+(\\d{1,3}(?:,\\d+)?)%(?:\\s+em\\s+[a-z\\u00e0-\\u00fc]+(?:\\s+de\\s+\\d{4})?)?';

/** Um percentual: número pt-BR seguido de `%`. O valor é convertido pelo helper único. */
export const QUAEST_PERCENT_PATTERN_SOURCE = '(\\d{1,3}(?:,\\d+)?)\\s*%';

/**
 * Fronteira de oração. Delimita a JANELA de contexto de cada percentual: só o
 * trecho entre a fronteira anterior e o `%` pode nomear o dono do número. Sem
 * isso, "…ao passo que Romeu Zema registra 2%. O contingente de eleitores
 * indecisos…" faria o rótulo de Zema encostar na palavra "indecisos" da oração
 * seguinte (2026-08-05).
 */
export const QUAEST_CLAUSE_BOUNDARY_SOURCE =
  '[.,;:]|\\benquanto\\b|\\bao passo que\\b|\\bfrente a\\b|\\bacompanhado por\\b|\\bcontra\\b';

/**
 * Palavras de ligação toleradas DENTRO de um nome próprio ("Luiz Inácio Lula da
 * Silva", "Ronaldo Caiado e Renan Santos"). Nunca abrem um nome.
 */
export const QUAEST_NAME_PARTICLES: readonly string[] = ['de', 'da', 'do', 'das', 'dos', 'e'];

/**
 * Marcador DISTRIBUTIVO: um único percentual que vale para cada nome da lista.
 * "Ronaldo Caiado e Renan Santos somam 4% das intenções de voto cada"
 * (2026-08-05). Sem o "cada", nome composto por "e" é ambíguo e o parser recusa.
 */
export const QUAEST_DISTRIBUTIVE_MARKER = 'cada';

/**
 * Rótulos de brancos/nulos e de indecisos NA PROSA. `base/scenario-lines` não
 * serve aqui de propósito: ele casa rótulo EXATO ('Branco/Nulo'), e o que a
 * Quaest escreve é "os votos brancos, nulos ou de quem declara que não vai votar
 * totalizam 8%" e "O contingente de eleitores indecisos se fixa em 10%". A
 * conversão do número continua no helper único (`parsePtBrPercent`).
 */
export const QUAEST_BLANK_NULL_KEYWORDS: readonly string[] = [
  'brancos',
  'branco',
  'nulos',
  'nulo',
  'abstenc',
  'nenhum',
];
export const QUAEST_UNDECIDED_KEYWORDS: readonly string[] = [
  'indecis',
  'nao sabe',
  'nao respond',
  'nao opin',
];
