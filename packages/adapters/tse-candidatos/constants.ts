/**
 * Constantes do adapter DivulgaCandContas (T-17).
 *
 * Por que aqui e não em `packages/contracts/constants.ts`: o pacote de contratos
 * está CONGELADO (outros agentes dependem dele). CLAUDE.md manda que nenhum valor
 * mágico fique solto; então cada número/identificador abaixo vive num ponto único
 * do NOSSO diretório, com a origem explicada. Se `contracts` reabrir, isto migra
 * para lá sem mudança de semântica.
 *
 * Todos os valores foram verificados contra a API real em 2026-08-16 (ver
 * `__fixtures__/README.md`).
 */

/** Origem do DivulgaCandContas. Única fonte de foto autorizada (docs/08 §2). */
export const DIVULGA_ORIGIN = 'https://divulgacandcontas.tse.jus.br';

/** Prefixo REST descoberto no bundle Angular do próprio Divulga (main.*.js). */
export const DIVULGA_REST_PREFIX = '/divulga/rest/v1';

/**
 * Ano da eleição alvo. O adapter NÃO aceita silenciosamente outro ano: se o
 * `eleicao-atual` do TSE devolver ano diferente, lança (R4 — falha alta). Trocar
 * de ciclo eleitoral é decisão humana, não efeito colateral de um job.
 */
export const ELECTION_YEAR = 2026;

/**
 * Abrangência nacional. No Divulga a "unidade eleitoral" da eleição presidencial
 * é a sigla `BR` — confirmado em `eleicao-atual` (`ues[0].sigla === 'BR'`) e no
 * path da listagem.
 */
export const NATIONAL_UE = 'BR';

/**
 * Código do cargo Presidente. Vem de `GET /candidatura/cargos?ano=2026`, que
 * devolve `{"codigo":1,"nome":"Presidente"}`. Nunca inferimos cargo por nome.
 */
export const CARGO_PRESIDENTE = 1;

/**
 * `tp_ABRANGENCIA` esperado da eleição geral federal ('F'). Serve de segunda
 * confirmação de identidade da eleição, junto do ano — o mesmo espírito da
 * "confirmação de identidade obrigatória" de docs/04 §4.1.
 */
export const ABRANGENCIA_FEDERAL = 'F';

/**
 * Teto de bytes de uma foto oficial. A captura real de 2026-08-16 tinha 6.621
 * bytes; 2 MiB é ~300x isso, folga grande o bastante para uma troca de foto por
 * uma imagem maior e pequena o bastante para que um HTML de erro travestido de
 * imagem, ou um arquivo absurdo, seja recusado em vez de gravado no site.
 */
export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/**
 * Piso de bytes. Abaixo disso não existe JPEG/PNG com conteúdo útil — é resposta
 * truncada ou placeholder. Recusar é melhor que publicar um pixel cinza.
 */
export const MIN_PHOTO_BYTES = 512;

/**
 * Limites de dimensão aceitos, em pixels. A foto oficial de 2026-08-16 era
 * 161x225. O piso (80px) recusa thumbnail inútil; o teto (4000px) recusa imagem
 * de câmera não redimensionada, que pesaria no site estático.
 */
export const MIN_PHOTO_DIMENSION_PX = 80;
export const MAX_PHOTO_DIMENSION_PX = 4000;

/**
 * Diretório público (dentro de `apps/web/public/`) onde as fotos são gravadas, e
 * prefixo do caminho servido. O Astro copia `public/` inteiro para o build, então
 * `public/candidatos/lula.jpg` vira `/candidatos/lula.jpg` no site — é exatamente
 * o formato que `photoPath` exige em `contracts/public-data.ts`.
 */
export const PHOTO_PUBLIC_DIRNAME = 'candidatos';
export const PHOTO_PUBLIC_PREFIX = '/candidatos';

/**
 * Intervalo mínimo entre duas verificações da MESMA foto, em milissegundos.
 *
 * Existe porque o endpoint da imagem do TSE não manda `ETag` nem
 * `Last-Modified` (medição de 2026-08-16): sem validador, "conferir se mudou"
 * significa baixar de novo. Baixar a mesma foto a cada ciclo de 2h seria bater
 * no TSE por nada — um crawler educado é um crawler que sobrevive (docs/04 §6).
 * 24h é a mesma ordem de grandeza do cache de `robots.txt` e é folgada para uma
 * foto de registro de candidatura, que muda raríssimas vezes num ciclo. Quem
 * precisar de imediatismo roda o job com `--force`.
 */
export const PHOTO_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
