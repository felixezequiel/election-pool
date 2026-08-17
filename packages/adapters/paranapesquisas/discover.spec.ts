/**
 * Specs de `discover` contra a resposta REAL da WP REST do Paraná Pesquisas
 * (`__fixtures__/wp-search-BR-07974-2026.json`, capturada em 2026-08-17). Sem
 * rede: o `HttpClient` recebe um `fetch` duplo, mas é o cliente EDUCADO de
 * verdade — robots, rate limit e retries continuam no caminho.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpClient } from '../http-client.js';
import type { FetchLike } from '../http-client.js';
import { RobotsCache } from '../robots.js';
import { PerHostRateLimiter } from '../rate-limiter.js';
import { ParseError } from '../poll-source-adapter.js';
import { makeReg } from '../base/test-support.js';
import { ParanaPesquisasAdapter } from './paranapesquisas-adapter.js';
import { buildSearchUrl, candidatesFromPosts, parseWpPosts, pdfLinksFrom } from './discover.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const SEARCH_JSON = fixture('wp-search-BR-07974-2026.json');
const FEV_ID = 'BR-07974/2026';

/** `robots.txt` REAL do host (capturado): só `/wp-admin/` é proibido. */
const REAL_ROBOTS = [
  'User-agent: *',
  'Disallow: /wp-admin/',
  'Allow: /wp-admin/admin-ajax.php',
  '',
  'Sitemap: https://paranapesquisas.com.br/sitemap_index.xml',
].join('\n');

const makeClient = (
  body: string,
  status = 200,
): { http: HttpClient; fetchImpl: ReturnType<typeof vi.fn<FetchLike>> } => {
  const fetchImpl = vi.fn<FetchLike>((url) =>
    Promise.resolve({
      status,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      url,
      text: () => Promise.resolve(body),
    }),
  );
  const http = new HttpClient({
    fetchImpl,
    robots: new RobotsCache(() => Promise.resolve({ status: 200, body: REAL_ROBOTS })),
    rateLimiter: new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() }),
    clock: { now: () => 0, sleep: () => Promise.resolve(), random: () => 0.5 },
  });
  return { http, fetchImpl };
};

const regFor = (tseId: string) => makeReg({ tseId, instituteId: 'paranapesquisas' });

describe('buildSearchUrl', () => {
  it('busca na categoria Pesquisas (6) pelo prefixo do registro, nunca em Notícias', () => {
    const url = buildSearchUrl(FEV_ID);
    expect(url).toBe(
      'https://paranapesquisas.com.br/wp-json/wp/v2/posts?categories=6&search=BR-07974' +
        '&per_page=20&_fields=id%2Clink%2Cdate%2Ctitle%2Ccontent',
    );
    // categoria 1 é o clipping de imprensa (nível 4 de docs/04 §1)
    expect(url).not.toContain('categories=1');
  });

  it('LANÇA se o tse_id não estiver na forma canônica', () => {
    expect(() => buildSearchUrl('SP-04624/2026')).toThrow(ParseError);
  });
});

describe('pdfLinksFrom (bloco wp-block-file real)', () => {
  it('deduplica a URL repetida em <object data>, no nome e no botão Baixar', () => {
    const posts = parseWpPosts(SEARCH_JSON);
    const eleitoral = posts.find((p) => /Situação eleitoral/i.test(p.title.rendered));
    expect(eleitoral).toBeDefined();
    expect(pdfLinksFrom(eleitoral?.content.rendered ?? '')).toEqual([
      'https://paranapesquisas.com.br/wp-content/uploads/2026/02/Nacional_Fev261.pdf',
      'https://paranapesquisas.com.br/wp-content/uploads/2026/02/1-JOB026_023_BR_-RegistroTSE_BR-07974.pdf',
    ]);
  });
});

describe('candidatesFromPosts (3 posts reais para o mesmo tse_id)', () => {
  const posts = parseWpPosts(SEARCH_JSON);

  it('põe o release de situação eleitoral em PRIMEIRO e exclui o comprovante de registro', () => {
    const candidates = candidatesFromPosts(posts, FEV_ID);
    expect(candidates[0]?.url).toBe(
      'https://paranapesquisas.com.br/wp-content/uploads/2026/02/Nacional_Fev261.pdf',
    );
    expect(candidates[0]?.reason).toContain(FEV_ID);
    // o PDF do próprio registro no TSE não tem cenário nenhum
    expect(candidates.some((c) => /RegistroTSE/i.test(c.url))).toBe(false);
    // os outros dois posts da mesma rodada continuam candidatos, depois
    expect(candidates).toHaveLength(3);
  });

  it('BORDA — descarta post cujo título é de OUTRA rodada (a busca da WP é fuzzy)', () => {
    expect(candidatesFromPosts(posts, 'BR-08254/2026')).toEqual([]);
  });
});

describe('parseWpPosts (fronteira HTTP validada com Zod)', () => {
  it('LANÇA em corpo que não é JSON', () => {
    expect(() => parseWpPosts('<html>erro do proxy</html>')).toThrow(ParseError);
  });

  it('LANÇA em JSON fora do formato da WP REST', () => {
    expect(() => parseWpPosts('[{"id":1}]')).toThrow(ParseError);
  });
});

describe('ParanaPesquisasAdapter.discover (uma requisição por registro)', () => {
  it('devolve as URLs dos PDFs de release da rodada', async () => {
    const { http, fetchImpl } = makeClient(SEARCH_JSON);
    const adapter = new ParanaPesquisasAdapter({ resolveCandidate: () => null, http });
    const candidates = await adapter.discover(regFor(FEV_ID));
    expect(candidates.map((c) => c.url)).toContain(
      'https://paranapesquisas.com.br/wp-content/uploads/2026/02/Nacional_Fev261.pdf',
    );
    // exatamente UMA requisição de busca (o robots vem do fetcher injetado)
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toContain('/wp-json/wp/v2/posts?');
  });

  it('BORDA — rodada registrada e NÃO divulgada devolve lista vazia, sem inventar URL', async () => {
    const { http } = makeClient('[]');
    const adapter = new ParanaPesquisasAdapter({ resolveCandidate: () => null, http });
    // O instituto registra muito mais do que divulga (taxa de gaveta, docs/01 §6).
    expect(await adapter.discover(regFor('BR-01234/2026'))).toEqual([]);
  });

  it('LANÇA em resposta HTTP não-200 — nunca devolve vazio para esconder falha', async () => {
    const { http } = makeClient('nope', 403);
    const adapter = new ParanaPesquisasAdapter({ resolveCandidate: () => null, http });
    await expect(adapter.discover(regFor(FEV_ID))).rejects.toThrow(/HTTP 403/);
  });
});
