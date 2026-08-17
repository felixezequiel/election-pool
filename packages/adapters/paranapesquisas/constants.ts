/**
 * Constantes da fonte Paraná Pesquisas. Toda origem está citada: nenhum número
 * ou string aqui foi inventado — todos vieram de uma captura REAL do site
 * (2026-08-17), documentada em `__fixtures__/README.md`.
 *
 * Por que NÃO em `packages/contracts/constants.ts`: aquele arquivo carrega
 * parâmetros de MODELO (docs/01) e está congelado para esta task. Estas são
 * coordenadas de UMA fonte externa — mudam quando o site muda, não quando a
 * metodologia muda. Mesmo padrão de `pesqele/constants.ts` e
 * `tse-candidatos/constants.ts`.
 */

/** `id` do adapter no `AdapterRegistry` (docs/02 §4). */
export const PARANAPESQUISAS_ADAPTER_ID = 'paranapesquisas';

/** `instituteId` do seed (T-02 `seed-data.ts`: `institutes[].id`). */
export const PARANAPESQUISAS_INSTITUTE_ID = 'paranapesquisas';

/**
 * Origem canônica. Verificado em 2026-08-17: `https://www.paranapesquisas.com.br`
 * responde 301 para o host SEM `www`. Usamos o destino do redirect para não gastar
 * um salto a cada requisição (o rate limit de 1 req/10s por host é caro).
 */
export const PARANAPESQUISAS_ORIGIN = 'https://paranapesquisas.com.br';

/**
 * Arquivo da categoria "Pesquisas" — a página de divulgação do instituto.
 * Verificado em 2026-08-17: `GET /pesquisas/` ⇒ 200, e é o `link` que a própria
 * WP REST devolve para a categoria (`/wp-json/wp/v2/categories?slug=pesquisas`).
 */
export const PARANAPESQUISAS_INDEX_URL = `${PARANAPESQUISAS_ORIGIN}/pesquisas/`;

/**
 * Endpoint da WP REST API de posts. O site é WordPress e `robots.txt`
 * (capturado em 2026-08-17) só proíbe `/wp-admin/` — `/wp-json/` é permitido.
 * Preferimos a REST ao HTML do tema porque devolve `content.rendered` (~1,9 KB)
 * em vez da página inteira (~370 KB): menos banda para quem publica (docs/04 §6,
 * "não impor custo a quem publica o dado") e uma fronteira JSON validável com Zod.
 */
export const PARANAPESQUISAS_POSTS_ENDPOINT = `${PARANAPESQUISAS_ORIGIN}/wp-json/wp/v2/posts`;

/**
 * `id` da categoria "Pesquisas" na WP REST. Capturado em 2026-08-17 de
 * `/wp-json/wp/v2/categories?slug=pesquisas` ⇒ `{"id":6,"slug":"pesquisas"}`.
 * As outras categorias do site são 1 (`noticias`, clipping de imprensa) e 6040
 * (`destaque`). Filtramos por 6 para NUNCA cair no clipping de imprensa — isso
 * seria fonte de nível 4 (docs/04 §1), proibida antes de esgotar a primária.
 */
export const PARANAPESQUISAS_PESQUISAS_CATEGORY_ID = 6;

/**
 * Quantos posts pedir por busca. Capturado em 2026-08-17: uma rodada nacional
 * gera vários posts com o MESMO `tse_id` (BR-07974/2026 tem 3: situação
 * eleitoral, avaliação da administração federal, potencial eleitoral). 20 é folga
 * ampla sobre o maior valor observado e cabe num só request.
 */
export const PARANAPESQUISAS_SEARCH_PER_PAGE = 20;

/**
 * Sufixo que identifica o PDF do PRÓPRIO registro no TSE (não é release de
 * resultado). Observado em 2026-08-17 nos dois posts capturados:
 * `1-JOB026_023_BR_-RegistroTSE_BR-07974.pdf` e
 * `1-JOB026_044_BR_-RegistroTSE_BR-00873.pdf`. Esse PDF é o comprovante de
 * registro: prova de proveniência, mas NÃO contém cenário nenhum. Excluímos das
 * candidatas porque entregá-lo ao HarvestJob garantiria um `ParseError` por
 * documento sem cenário, o que incrementaria o contador de falhas do adapter
 * (`validation/failure-counter.ts`) e o marcaria como suspeito sem motivo.
 */
export const PARANAPESQUISAS_TSE_REGISTRATION_FILE_MARK = 'registrotse';
