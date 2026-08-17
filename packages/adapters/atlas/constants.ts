/**
 * Constantes do adapter ATLASINTEL. Todas descobertas na fonte REAL em
 * 2026-08-17 (ver `__fixtures__/README.md` para o protocolo de captura), não
 * supostas. O CLAUDE.md manda constantes para `packages/contracts/constants.ts`,
 * mas esta task não pode tocar contracts (CONGELADO) — então elas moram aqui,
 * com a origem de cada número/string comentada, como a regra exige. Se algum dia
 * virarem compartilhadas, este é o ponto único a migrar.
 */

export const ATLAS_ADAPTER_ID = 'atlas';
export const ATLAS_INSTITUTE_ID = 'atlas';

/**
 * Origem do site do instituto (nível 2 da hierarquia de docs/04 §1).
 * `robots.txt` responde 404 neste host (verificado em 2026-08-17), o que pela
 * RFC 9309 e por `packages/adapters/robots.ts` significa "sem restrições".
 */
export const ATLAS_SITE_ORIGIN = 'https://atlasintel.org';

/**
 * API pública de releases. NÃO é engenharia reversa de endpoint privado: é o
 * mesmo GET que o site faz para renderizar `/polls/<categoria>`, extraído do
 * bundle do próprio site (`/_nuxt/56c233c.js`):
 *   `$axios.$get("/api/public-polls/".concat(category,"?limit=20&page=1"))`
 * Responde `application/json` com `{ data: [...] }` e não exige token algum.
 */
export const PUBLIC_POLLS_API_PATH = '/api/public-polls';

/**
 * As três categorias existentes, do array `links` do mesmo bundle:
 *   [{id:'general-release-polls'},{id:'exclusive-polls'},{id:'latam-pulse'}]
 * A ordem aqui é a de RELEVÂNCIA para nós, não a do menu: as rodadas nacionais
 * presidenciais de 2026 aparecem SÓ em `exclusive-polls` (verificado nos três
 * feeds completos: 108 + 282 + 149 entradas).
 */
export const PUBLIC_POLLS_CATEGORIES = [
  'exclusive-polls',
  'general-release-polls',
  'latam-pulse',
] as const;

export type PublicPollsCategory = (typeof PUBLIC_POLLS_CATEGORIES)[number];

/** `limit` que o próprio site usa na primeira página (bundle `56c233c.js`). */
export const PUBLIC_POLLS_PAGE_LIMIT = 20;

/** Página de detalhe de um release: `/poll/<slug>`. */
export const POLL_PAGE_PATH = '/poll';

/**
 * O relatório (PDF) NÃO mora no host do site: mora num CDN escolhido pela data
 * de criação do arquivo. A regra é literal do bundle (`/_nuxt/56c233c.js`,
 * módulo 324) e o corte também vem de `window.__NUXT__.config.CDN_CUTOFF_DATE`:
 *
 *   l = "2026-08-13"
 *   c = "https://cdn.atlasintel.org"    // file_created_on ANTES do corte
 *   d = "https://cdn1.atlasintel.org"   // file_created_on NO corte ou depois
 *
 * Isso importa muito para nós porque os dois hosts têm política de robots
 * OPOSTA — ver `report-availability.ts`.
 */
export const REPORT_CDN_CUTOFF_DATE = '2026-08-13';
export const REPORT_CDN_ORIGIN_BEFORE_CUTOFF = 'https://cdn.atlasintel.org';
export const REPORT_CDN_ORIGIN_FROM_CUTOFF = 'https://cdn1.atlasintel.org';

/** `country_code` do feed para o Brasil (o feed cobre 20 países). */
export const BRAZIL_COUNTRY_CODE = 'br';

/**
 * Título EXATO com que a AtlasIntel publica a rodada nacional presidencial.
 * Verificado nas seis rodadas de 2026 no feed `exclusive-polls` (ids 489, 501,
 * 516, 543, 576, 589 — 2026-01-21, 02-25, 03-25, 04-28, 07-01, 07-29): todas
 * têm `title === 'Brazil: National'`. As rodadas estaduais usam outro título
 * ('Brazil: Ceará | Pesquisa Atlas/Focus'), então o casamento por título exato
 * separa nacional de estadual sem heurística.
 *
 * É um rótulo do publicador, não nome de candidato nem de partido (R2 não se
 * aplica: nada aqui é correção direcional).
 *
 * FRAGILIDADE CONHECIDA: se a AtlasIntel renomear a série, `discover` para de
 * achar candidato. É por isso que `discover` LANÇA quando o feed vem vazio e
 * devolve lista vazia (visível, logável) quando o feed veio cheio e nada casou.
 */
export const NATIONAL_RELEASE_TITLE = 'Brazil: National';

/**
 * Janela, em dias, entre o fim do campo (`reg.fieldEnd`, que vem do PesqEle) e
 * a data de publicação do release da Atlas.
 *
 * Origem: medido nas seis rodadas nacionais de 2026. O atraso observado é de
 * 1 a 2 dias (ex.: campo 22–27/07/2026, release 29/07/2026; campo 26–30/06,
 * release 01/07). 14 dias dá folga generosa para atraso de publicação e ainda
 * fica bem abaixo da cadência mensal (~30 dias), então a janela não alcança a
 * rodada seguinte e não corre o risco de casar a rodada errada. A confirmação
 * final de identidade é o V6 do `BaseAdapter`, não esta janela.
 */
export const RELEASE_LAG_MAX_DAYS = 14;
