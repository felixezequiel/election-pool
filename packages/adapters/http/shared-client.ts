/**
 * Fábrica do `HttpClient` COMPARTILHADO no processo (T-05 já construiu o cliente
 * educado flat na raiz de `packages/adapters`; aqui só amarramos uma instância
 * única). Por que compartilhar: o rate limit é "1 req/10s por HOST" (docs/04 §6).
 * Se cada adapter tivesse seu próprio `PerHostRateLimiter`/`RobotsCache`, dois
 * adapters batendo no mesmo host burlariam o limite. Uma instância no processo
 * garante que o limite (e o cache de robots) valem entre todos os adapters.
 *
 * NÃO reimplementamos nada de robots/rate-limit/conditional-GET: só instanciamos
 * o `HttpClient` de T-05 uma vez e o devolvemos. O User-Agent identificável
 * (domínio/contato reais via env) é injetado aqui, num único ponto.
 */

import { HttpClient, DEFAULT_USER_AGENT } from '../http-client.js';

let shared: HttpClient | undefined;

/**
 * Devolve o `HttpClient` singleton do processo. O User-Agent pode vir de
 * `HARVEST_USER_AGENT` (para injetar domínio/contato reais em produção); na
 * ausência, cai no `DEFAULT_USER_AGENT` canônico de docs/04 §6.
 */
export const sharedHttpClient = (): HttpClient => {
  shared ??= new HttpClient({ userAgent: process.env['HARVEST_USER_AGENT'] ?? DEFAULT_USER_AGENT });
  return shared;
};

/** Reseta o singleton (apenas para testes que precisam de um cliente limpo). */
export const __resetSharedHttpClient = (): void => {
  shared = undefined;
};
