/**
 * Cliente HTTP educado, compartilhado por todos os adapters (docs/04 §6). Faz o
 * que a spec exige, sem headless browser:
 *
 * - Consulta `robots.txt` (cache 24h) e RECUSA o request se o path for proibido.
 * - Rate limit de 1 req/10s por host (via `PerHostRateLimiter`).
 * - Conditional GET: envia `If-None-Match` / `If-Modified-Since` quando o chamador
 *   fornece o `etag`/`lastModified` do documento salvo. `304 Not Modified` volta
 *   como resultado explícito (`notModified: true`) — o chamador encerra o ciclo
 *   sem reparse.
 * - Timeout de 20s por tentativa (AbortController).
 * - Até 2 retries (3 tentativas no total) com backoff exponencial + jitter, só
 *   para erro de rede/timeout e 5xx. 4xx não é retryado.
 * - `User-Agent` identificável (docs/04 §6).
 *
 * Falha alta (R4): esgotadas as tentativas, LANÇA `HttpError`. Nunca devolve
 * corpo vazio silencioso.
 *
 * Usa o `fetch` global do Node (>=18). O `fetch`, o relógio e o `sleep` são
 * injetáveis para teste sem rede e com fake timers.
 */

import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { PerHostRateLimiter } from './rate-limiter.js';
import { RobotsCache } from './robots.js';
import type { RobotsFetcher } from './robots.js';

// docs/04 §6 — User-Agent identificável. O domínio/contato reais entram via env
// no boot; o default abaixo é a forma canônica exigida pela spec.
export const DEFAULT_USER_AGENT =
  'election-pool/1.0 (+https://election-pool.example/metodologia; contato@election-pool.example)';

const REQUEST_TIMEOUT_MS = 20_000; // docs/04 §6
const MAX_RETRIES = 2; // docs/04 §6 — 2 retries = 3 tentativas
const BACKOFF_BASE_MS = 500;

export class HttpError extends Error {
  constructor(
    message: string,
    cause?: unknown,
    readonly status?: number,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'HttpError';
  }
}

export class RobotsDisallowedError extends Error {
  constructor(readonly url: string) {
    super(`robots.txt proíbe o acesso a ${url}`);
    this.name = 'RobotsDisallowedError';
  }
}

export interface HttpClientClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const realClock: HttpClientClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

export interface FetchRequest {
  url: string;
  method?: 'GET' | 'POST';
  /** Corpo já codificado (ex.: `application/x-www-form-urlencoded` do JSF). */
  body?: string;
  headers?: Record<string, string>;
  /** Conditional GET: valores do documento previamente salvo. */
  etag?: string | null;
  lastModified?: string | null;
}

export interface FetchResponse {
  status: number;
  /** `true` quando o servidor respondeu 304 (nada mudou). */
  notModified: boolean;
  headers: Headers;
  /**
   * Corpo decodificado como UTF-8. Use SÓ para fonte de texto (HTML, XML, JSON).
   * Para binário, use `bytes`: passar isto adiante DESTRÓI o arquivo (ver `bytes`).
   */
  body: string;
  /**
   * Corpo em BYTES, exatamente como veio do servidor.
   *
   * Existe porque a alternativa corrompia PDF em silêncio: o corpo era decodificado
   * como UTF-8 e o `RawStorage` refazia `Buffer.from(body, 'utf8')`, o que troca
   * toda sequência inválida por U+FFFD — irreversível. O sintoma era o adapter
   * reclamando de "PDF sem texto extraível", como se a fonte tivesse publicado uma
   * varredura de imagem; o arquivo tinha sido destruído no caminho de entrada.
   * Achado ao ligar o adapter do Real Time Big Data, cujo PDF tem texto de verdade.
   *
   * Vazio em 304 (não há corpo).
   */
  bytes: Uint8Array;
  url: string;
}

/** Assinatura mínima do `fetch` que usamos (facilita mock nos testes). */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect: 'follow';
    signal: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: Headers;
  url: string;
  /**
   * `arrayBuffer` é a fonte da verdade: o cliente lê os bytes e decodifica o texto
   * a partir deles. `text` fica na assinatura porque mocks antigos de teste o
   * fornecem — quando `arrayBuffer` faltar, o cliente cai em `text`, e nesse
   * caminho binário NÃO sobrevive (é aceitável: só teste usa mock sem bytes).
   */
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}>;

interface HttpClientDeps {
  fetchImpl?: FetchLike;
  robots?: RobotsCache;
  rateLimiter?: PerHostRateLimiter;
  clock?: HttpClientClock;
  userAgent?: string;
  /**
   * URL de um proxy de saída (ex.: `http://user:pass@host:porta`). Deploy em
   * datacenter é barrado por WAF das fontes (403 do TSE observado em prod); com o
   * proxy, o tráfego sai por um IP não-datacenter. Vazio/ausente ⇒ fetch direto.
   */
  proxyUrl?: string | undefined;
}

/**
 * Fetch que sai por um PROXY. Usa o `fetch` do PRÓPRIO undici + `ProxyAgent`, não o
 * `fetch` global do Node: o dispatcher do undici externo é INCOMPATÍVEL com o fetch
 * global (undici interno ≠ externo — dá "invalid onRequestStart"), então trocamos o
 * fetch inteiro, não só o dispatcher. Sem proxy configurado, devolve `null` e o
 * cliente segue no fetch global (comportamento idêntico ao de antes).
 */
function buildProxiedFetch(proxyUrl: string | undefined): FetchLike | null {
  if (proxyUrl === undefined || proxyUrl.length === 0) return null;
  const dispatcher = new ProxyAgent(proxyUrl);
  const proxied = (url: string, init: Parameters<FetchLike>[1]): ReturnType<FetchLike> =>
    undiciFetch(url, {
      ...init,
      dispatcher,
    } as Parameters<typeof undiciFetch>[1]) as unknown as ReturnType<FetchLike>;
  return proxied;
}

const isRetryableStatus = (status: number): boolean => status >= 500 && status < 600;

/**
 * Bytes do corpo, lidos UMA vez. 304 não tem corpo. Mock de teste que só
 * implementa `text()` cai no caminho de texto — binário não sobrevive ali, o que é
 * aceitável porque `fetch` real sempre traz `arrayBuffer`.
 */
const readBodyBytes = async (res: {
  status: number;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}): Promise<Uint8Array> => {
  if (res.status === 304) return new Uint8Array();
  if (res.arrayBuffer !== undefined) return new Uint8Array(await res.arrayBuffer());
  return new Uint8Array(Buffer.from(await res.text(), 'utf8'));
};

export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly robots: RobotsCache;
  private readonly rateLimiter: PerHostRateLimiter;
  private readonly clock: HttpClientClock;
  private readonly userAgent: string;

  constructor(deps: HttpClientDeps = {}) {
    this.clock = deps.clock ?? realClock;
    this.userAgent = deps.userAgent ?? DEFAULT_USER_AGENT;
    // Precedência: fetch injetado (teste) > fetch via proxy (se configurado) > fetch global.
    this.fetchImpl =
      deps.fetchImpl ?? buildProxiedFetch(deps.proxyUrl) ?? (globalThis.fetch as unknown as FetchLike);
    this.rateLimiter = deps.rateLimiter ?? new PerHostRateLimiter();
    // O RobotsCache reusa este mesmo cliente para buscar robots.txt, mas sem
    // recursão de robots (o fetcher abaixo é um GET cru, já com UA + rate limit).
    const robotsFetcher: RobotsFetcher = async (robotsUrl) => {
      const res = await this.rawFetchWithRetries({ url: robotsUrl, method: 'GET' });
      return { status: res.status, body: res.body };
    };
    this.robots = deps.robots ?? new RobotsCache(robotsFetcher);
  }

  /**
   * Executa uma requisição respeitando robots + rate limit + conditional GET +
   * retries. Recusa (lança `RobotsDisallowedError`) se o robots proibir.
   */
  async request(req: FetchRequest): Promise<FetchResponse> {
    const allowed = await this.robots.isAllowed(req.url);
    if (!allowed) {
      throw new RobotsDisallowedError(req.url);
    }
    await this.rateLimiter.acquire(req.url);
    return this.rawFetchWithRetries(req);
  }

  /** Igual a `request`, mas sem consultar robots (usado para o próprio robots.txt). */
  private async rawFetchWithRetries(req: FetchRequest): Promise<FetchResponse> {
    const headers = this.buildHeaders(req);
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await this.clock.sleep(this.backoffMs(attempt));
      }
      try {
        const res = await this.doFetch(req, headers);
        if (isRetryableStatus(res.status)) {
          // 5xx: retryável. Guarda o erro e tenta de novo; se acabaram as
          // tentativas, cai fora do loop e LANÇA (nunca devolve 5xx como sucesso).
          lastError = new HttpError(`HTTP ${res.status} em ${req.url}`, undefined, res.status);
          if (attempt < MAX_RETRIES) continue;
          break;
        }
        // Lê UMA vez em bytes e decodifica a partir deles: o corpo de uma resposta
        // só pode ser consumido uma vez, e é a forma binária que preserva tudo.
        const raw = await readBodyBytes(res);
        return {
          status: res.status,
          notModified: res.status === 304,
          headers: res.headers,
          body: new TextDecoder('utf-8').decode(raw),
          bytes: raw,
          url: res.url.length > 0 ? res.url : req.url,
        };
      } catch (err) {
        lastError = err;
        if (attempt >= MAX_RETRIES) break;
      }
    }
    throw new HttpError(`Falha ao buscar ${req.url} após ${MAX_RETRIES + 1} tentativas`, lastError);
  }

  private buildHeaders(req: FetchRequest): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...req.headers,
    };
    if (req.etag != null && req.etag.length > 0) {
      headers['If-None-Match'] = req.etag;
    }
    if (req.lastModified != null && req.lastModified.length > 0) {
      headers['If-Modified-Since'] = req.lastModified;
    }
    if (req.method === 'POST' && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
    }
    return headers;
  }

  private async doFetch(
    req: FetchRequest,
    headers: Record<string, string>,
  ): Promise<{ status: number; headers: Headers; url: string; text: () => Promise<string> }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const init = {
        method: req.method ?? 'GET',
        headers,
        redirect: 'follow' as const,
        signal: controller.signal,
        ...(req.body === undefined ? {} : { body: req.body }),
      };
      return await this.fetchImpl(req.url, init);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Backoff exponencial com jitter cheio (docs/04 §6). */
  private backoffMs(attempt: number): number {
    const ceiling = BACKOFF_BASE_MS * 2 ** (attempt - 1);
    return Math.floor(this.clock.random() * ceiling);
  }
}
