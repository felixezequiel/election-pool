/**
 * CANÁRIO AO VIVO contra `ipec-inteligencia.com.br` — o antídoto da Q-09, no
 * mesmo espírito do canário da Palver (T-26).
 *
 * Fixture, por real que seja, é uma foto: prova que o parser lê AQUELE documento,
 * não que a fonte de hoje ainda é aquela — e, no caso do Ipec, nem que a fonte
 * seja alcançável. Este teste bate no Ipec de verdade e afirma o que sabemos ser
 * verdade em 2026-08-17:
 *
 * 1. o domínio do seed (`ipec.com.br`) NÃO RESOLVE;
 * 2. o domínio real (`www.ipec-inteligencia.com.br`) responde **403** com
 *    `Cf-Mitigated: challenge` — desafio Cloudflare que exige JavaScript;
 * 3. a API do índice de publicações (`/api/arquivo/ListAtivos/`) também responde 403.
 *
 * As três asserções são, de propósito, afirmações sobre o BLOQUEIO. No dia em que
 * o Ipec liberar o acesso a cliente sem JavaScript, este teste FALHA — e a falha é
 * o aviso de que a colheita live ficou possível e o `discover` deste adapter passa
 * a valer de fato. É um canário, não uma trava.
 *
 * OPT-IN por ambiente e FORA do `pnpm verify`: usa rede.
 *
 *     IPEC_LIVE=1 pnpm --filter @election-pool/adapters test ipec/ipec.live
 *
 * Etiqueta (docs/04 §6): usa o `HttpClient` do projeto — robots.txt, 1 req/10s por
 * host, timeout, retries, User-Agent identificável. Sequencial, sem headless. Só
 * requisições GET, no total três, e nenhuma repetição de 403 além do que o próprio
 * teste afirma (docs/04 §6 "fonte que retornar 403/429 duas vezes é desabilitada
 * automaticamente" vale para o HarvestJob, não para uma verificação pontual).
 *
 * Nota sobre `robots.txt`: ele TAMBÉM responde 403. Pela RFC 9309 §2.3.1.4 (e pela
 * implementação de `robots.ts`), 4xx em robots significa "sem restrições
 * declaradas" — então não há regra do Ipec sendo desrespeitada aqui. Se um dia o
 * `robots.txt` ficar acessível e proibir, o `HttpClient` recusa sozinho
 * (`RobotsDisallowedError`) e este teste passa a falhar por esse motivo, o que
 * também é informação boa.
 */

import { describe, it, expect } from 'vitest';
import { HttpClient, DEFAULT_USER_AGENT } from '../http-client.js';
import { IPEC_LIST_API_URL, IPEC_PESQUISAS_URL } from './constants.js';

const LIVE = process.env['IPEC_LIVE'] === '1';
const TIMEOUT_MS = 3 * 60 * 1000;

/** O que o seed (`seed-data.ts`) traz hoje — e que não existe. */
const SEED_SITE_URL = 'https://www.ipec.com.br/';

describe.skipIf(!LIVE)('Ipec ao vivo (canário de acesso)', () => {
  it(
    'o domínio do seed não resolve e o domínio real segue atrás do desafio Cloudflare',
    async () => {
      const http = new HttpClient({
        userAgent: process.env['HARVEST_USER_AGENT'] ?? DEFAULT_USER_AGENT,
      });

      // 1. O domínio do seed não existe. Erro de DNS, não HTTP.
      await expect(http.request({ url: SEED_SITE_URL, method: 'GET' })).rejects.toThrow();

      // 2. A página de pesquisas do domínio real: 403 do Cloudflare.
      const pesquisas = await http.request({ url: IPEC_PESQUISAS_URL, method: 'GET' });
      expect(pesquisas.status).toBe(403);
      // O corpo do desafio se identifica; se isso mudar, o bloqueio mudou.
      expect(pesquisas.body).toMatch(/challenge|Just a moment/i);

      // 3. A API que alimenta o índice: mesmo 403. Não há rota de escape sem JS.
      const api = await http.request({ url: IPEC_LIST_API_URL, method: 'GET' });
      expect(api.status).toBe(403);
    },
    TIMEOUT_MS,
  );
});
