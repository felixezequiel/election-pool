/**
 * Descoberta das URLs de resultado do Paraná Pesquisas.
 *
 * COMO A FONTE ORGANIZA (capturado em 2026-08-17, ver `__fixtures__/README.md`):
 * o site é WordPress. A divulgação vive na categoria "Pesquisas" (`id` 6), e o
 * TÍTULO de cada post carrega o número de registro: "Paraná Pesquisas divulga
 * pesquisa Nacional – Registro TSE n.º BR-07974/2026 – Situação eleitoral para o
 * Executivo Federal em 2026 – Fevereiro/2026". Uma rodada pode gerar VÁRIOS posts
 * (BR-07974/2026 gerou 3: situação eleitoral, avaliação da administração federal,
 * potencial eleitoral) e um post pode anexar VÁRIOS PDFs (o post de março anexa 4
 * releases + o comprovante de registro).
 *
 * Por que a WP REST e não o HTML do tema: a REST devolve `content.rendered` com
 * ~1,9 KB contra ~370 KB da página renderizada, numa fronteira JSON que o Zod
 * valida. Menos custo para quem publica (docs/04 §6) e menos superfície frágil.
 * `robots.txt` (capturado) só proíbe `/wp-admin/`.
 *
 * O que NUNCA fazemos aqui: tocar a categoria "Notícias" (`id` 1), que é clipping
 * de imprensa. Imprensa é nível 4 de docs/04 §1 e exige aprovação explícita.
 *
 * Rede: SEMPRE pelo `HttpClient` compartilhado (`http/shared-client.ts`) — robots,
 * 1 req/10s por host, conditional GET, timeout e retries são dele. UMA requisição
 * por registro. Sem headless browser.
 */

import { z } from 'zod';
import { parse as parseHtml } from 'node-html-parser';
import { sourceCandidateSchema } from '@election-pool/contracts/domain';
import type { PollRegistration, SourceCandidate } from '@election-pool/contracts/domain';
import { ParseError } from '../poll-source-adapter.js';
import type { HttpClient } from '../http-client.js';
import { findTseIds } from './tse-registration.js';
import {
  PARANAPESQUISAS_PESQUISAS_CATEGORY_ID,
  PARANAPESQUISAS_POSTS_ENDPOINT,
  PARANAPESQUISAS_SEARCH_PER_PAGE,
  PARANAPESQUISAS_TSE_REGISTRATION_FILE_MARK,
} from './constants.js';

/**
 * Fronteira HTTP: forma REAL da resposta de `/wp-json/wp/v2/posts` (WP REST v2),
 * restrita aos campos que pedimos em `_fields`. Tipo derivado do schema
 * (CLAUDE.md), nunca declarado em paralelo.
 */
const wpRenderedSchema = z.object({ rendered: z.string() });

const wpPostSchema = z.object({
  id: z.number().int(),
  link: z.string().url(),
  date: z.string(),
  title: wpRenderedSchema,
  content: wpRenderedSchema,
});

const wpPostsSchema = z.array(wpPostSchema);

export type WpPost = z.infer<typeof wpPostSchema>;

/**
 * Prefixo de busca a partir do `tse_id`. A busca da WP REST não lida bem com a
 * barra, então procuramos `BR-07974` e CONFIRMAMOS o `tse_id` completo no título
 * depois — a busca é uma peneira, não a prova de identidade.
 */
const searchTermFor = (tseId: string): string => {
  const m = /^(BR-\d+)\//.exec(tseId.trim());
  const term = m?.[1];
  if (term === undefined) {
    throw new ParseError(`tse_id em formato inesperado para busca: "${tseId}"`);
  }
  return term;
};

/** Monta a URL de busca (uma requisição por registro). */
export const buildSearchUrl = (tseId: string): string => {
  const params = new URLSearchParams({
    categories: String(PARANAPESQUISAS_PESQUISAS_CATEGORY_ID),
    search: searchTermFor(tseId),
    per_page: String(PARANAPESQUISAS_SEARCH_PER_PAGE),
    _fields: 'id,link,date,title,content',
  });
  return `${PARANAPESQUISAS_POSTS_ENDPOINT}?${params.toString()}`;
};

/** Valida o corpo JSON da WP REST. Corpo inesperado ⇒ LANÇA (R4). */
export const parseWpPosts = (body: string): WpPost[] => {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    throw new ParseError('Resposta da WP REST do Paraná Pesquisas não é JSON válido', err);
  }
  const result = wpPostsSchema.safeParse(json);
  if (!result.success) {
    throw new ParseError(
      `Resposta da WP REST do Paraná Pesquisas fora do formato esperado: ${result.error.message}`,
      result.error,
    );
  }
  return result.data;
};

/**
 * Extrai os links de PDF de um `content.rendered`. O bloco de arquivo do
 * WordPress (`div.wp-block-file`) repete a mesma URL em `<object data>`, no
 * `<a>` do nome e no `<a>` de download — deduplicamos preservando a ordem.
 */
export const pdfLinksFrom = (renderedHtml: string): string[] => {
  const root = parseHtml(renderedHtml);
  const urls: string[] = [];
  const push = (value: string | undefined): void => {
    if (value === undefined) return;
    const url = value.trim();
    if (url.length === 0 || !/\.pdf($|\?)/i.test(url)) return;
    if (!urls.includes(url)) urls.push(url);
  };
  for (const el of root.querySelectorAll('a')) push(el.getAttribute('href'));
  for (const el of root.querySelectorAll('object')) push(el.getAttribute('data'));
  return urls;
};

/** `true` se o PDF é o comprovante de registro no TSE (sem resultado nenhum). */
const isTseRegistrationPdf = (url: string): boolean =>
  url.toLowerCase().includes(PARANAPESQUISAS_TSE_REGISTRATION_FILE_MARK);

/**
 * `true` se o título anuncia a pergunta de VOTO. As outras divulgações da mesma
 * rodada (avaliação de administração, potencial eleitoral, demandas sociais) não
 * têm cenário de intenção de voto. Isto é ORDENAÇÃO, não filtro: um título que
 * não casa continua sendo candidato, só entra depois — assim uma mudança de
 * redação não nos deixa cegos.
 */
const looksElectoral = (title: string): boolean =>
  /situa[çc][ãa]o\s+eleitoral/i.test(title) || /executivo\s+federal/i.test(title);

/**
 * Converte a resposta da busca em URLs candidatas, já ordenadas. Posts cujo
 * título NÃO contém o `tse_id` completo são descartados: a busca da WP é fuzzy e
 * atribuir o PDF de outra rodada é o pior bug do sistema (docs/04 §4.1).
 */
export const candidatesFromPosts = (posts: readonly WpPost[], tseId: string): SourceCandidate[] => {
  const ranked = [...posts]
    .filter((post) => findTseIds(post.title.rendered).includes(tseId))
    .sort(
      (a, b) => Number(looksElectoral(b.title.rendered)) - Number(looksElectoral(a.title.rendered)),
    );

  const seen = new Set<string>();
  const candidates: SourceCandidate[] = [];
  for (const post of ranked) {
    for (const url of pdfLinksFrom(post.content.rendered)) {
      if (isTseRegistrationPdf(url) || seen.has(url)) continue;
      seen.add(url);
      candidates.push(
        sourceCandidateSchema.parse({
          url,
          reason:
            `PDF de release anexado ao post ${String(post.id)} da categoria Pesquisas do Paraná ` +
            `Pesquisas, cujo título declara o registro ${tseId}` +
            (looksElectoral(post.title.rendered) ? ' e a pergunta de situação eleitoral' : ''),
        }),
      );
    }
  }
  return candidates;
};

/**
 * Busca no site do instituto as URLs onde o resultado desta rodada provavelmente
 * está. Devolve lista VAZIA quando a rodada não foi divulgada sob este `tse_id` —
 * é resposta honesta, não falha: o instituto registra muito mais do que divulga
 * (é a própria "taxa de gaveta" de docs/01 §6). Erro de rede ou corpo inesperado
 * LANÇA; nunca devolvemos vazio para esconder falha (R4).
 */
export const discoverParanaPesquisas = async (
  http: HttpClient,
  reg: PollRegistration,
): Promise<SourceCandidate[]> => {
  const url = buildSearchUrl(reg.tseId);
  const res = await http.request({ url });
  if (res.status !== 200) {
    throw new ParseError(
      `Busca no Paraná Pesquisas devolveu HTTP ${String(res.status)} para ${reg.tseId}`,
    );
  }
  return candidatesFromPosts(parseWpPosts(res.body), reg.tseId);
};
