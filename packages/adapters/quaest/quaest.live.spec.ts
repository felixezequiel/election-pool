/**
 * TESTE DE FUMAÇA AO VIVO contra `quaest.com.br`.
 *
 * Existe porque fixture é foto: as capturas de `__fixtures__/` provam que o
 * parser lê AQUELAS respostas, não que a redação do post de amanhã ainda casa. É
 * a lição literal da Q-09 (`docs/OPEN-QUESTIONS.md`), e no caso da Quaest ela
 * pesa mais do que em qualquer outra fonte: os percentuais só existem em prosa
 * editorial, que muda a cada rodada. Este teste é o alarme.
 *
 * Cobre as duas coisas que só a rede prova: (1) que o `discover` — o único do
 * projeto que faz requisição — devolve URL de POST FINAL, e não a URL
 * intermediária da caminhada; (2) que o post de rodada de hoje ainda é extraível.
 *
 * OPT-IN por ambiente e FORA do `pnpm verify`: usa rede e o rate limit real é
 * 1 req/10 s por host (docs/04 §6), então a execução leva ~1 min.
 *
 *     QUAEST_LIVE=1 pnpm --filter @election-pool/adapters test quaest/quaest.live
 *
 * Usa o `HttpClient` COMPARTILHADO do processo (robots + rate limit por host),
 * sequencial, sem headless browser.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { resolverFromMap } from '../base/candidate-resolver.js';
import { makeReg, makeTempStorage } from '../base/test-support.js';
import { sharedHttpClient } from '../http/shared-client.js';
import { quaestArticleText } from './article-body.js';
import { parseQuaestRoundText } from './parse.js';
import { QuaestAdapter } from './quaest-adapter.js';
import {
  QUAEST_REST_POSTS_URL,
  QUAEST_REST_RELATORIOS_URL,
  QUAEST_SITEMAP_POSTS_URL,
  quaestRestMediaByParentUrl,
} from './constants.js';

const LIVE = process.env['QUAEST_LIVE'] === '1';
const TIMEOUT_MS = 5 * 60 * 1000;

/** Zod na fronteira HTTP: a resposta do WP REST é dado de terceiro (CLAUDE.md). */
const wpPostSchema = z.object({
  id: z.number().int(),
  date: z.string().min(1),
  slug: z.string().min(1),
  link: z.string().url(),
});
const wpPostListSchema = z.array(wpPostSchema);
const wpMediaSchema = z.object({ mime_type: z.string().min(1), source_url: z.string().url() });
const wpMediaListSchema = z.array(wpMediaSchema);

/** Quantos posts recentes vale inspecionar. Cada um custa 1 req (= 10 s de espera). */
const POSTS_TO_INSPECT = 4;
/** Grafia do registro no TSE, como o instituto escreve (pode vir sem o zero à esquerda). */
const TSE_PROTOCOL = /BR[-\s]?(\d{3,6})\/(\d{4})/;
/** Defasagem medida entre o fim do campo e o post (2 dias nas duas capturas). */
const LAG_DAYS_MEASURED = 2;

interface RodadaAoVivo {
  link: string;
  /** Data de publicação do post, `AAAA-MM-DD`. */
  day: string;
  /** Texto do corpo do artigo, já reduzido a blocos. */
  text: string;
}

const dayMinus = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe.skipIf(!LIVE)('Quaest ao vivo contra quaest.com.br', () => {
  /** O post de rodada mais recente do site, achado uma vez e reusado. */
  let rodada: RodadaAoVivo | undefined;
  let inspecionados: string[] = [];

  beforeAll(async () => {
    const http = sharedHttpClient();
    const list = await http.request({ url: QUAEST_REST_POSTS_URL });
    const posts = wpPostListSchema.parse(JSON.parse(list.body));
    inspecionados = [];
    for (const post of posts.slice(0, POSTS_TO_INSPECT)) {
      const page = await http.request({ url: post.link });
      if (page.status !== 200) continue;
      const text = quaestArticleText(page.body);
      inspecionados.push(post.slug);
      // Só posts de rodada eleitoral interessam: têm o registro no TSE.
      if (!TSE_PROTOCOL.test(text)) continue;
      rodada = { link: post.link, day: post.date.slice(0, 10), text };
      break;
    }
  }, TIMEOUT_MS);

  it(
    'a caminhada de proveniência do PDF continua de pé (sitemap + relatorios + anexos)',
    async () => {
      const http = sharedHttpClient();

      const sitemap = await http.request({ url: QUAEST_SITEMAP_POSTS_URL });
      expect(sitemap.status).toBe(200);
      expect(sitemap.body).toContain('<loc>https://quaest.com.br/');

      const relatorios = await http.request({ url: QUAEST_REST_RELATORIOS_URL });
      expect(relatorios.status).toBe(200);
      const posts = wpPostListSchema.parse(JSON.parse(relatorios.body));
      expect(posts.length).toBeGreaterThan(0);

      const first = posts[0];
      expect(first).toBeDefined();
      if (first === undefined) return;
      const media = await http.request({ url: quaestRestMediaByParentUrl(first.id) });
      expect(media.status).toBe(200);
      const anexos = wpMediaListSchema.parse(JSON.parse(media.body));
      // A rodada é publicada como PDF anexo do post `relatorios`.
      expect(anexos.some((a) => a.mime_type === 'application/pdf')).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'discover devolve URL de POST FINAL (nunca sitemap/wp-json) e acha o post da rodada',
    async () => {
      expect(
        rodada,
        `nenhum dos ${String(POSTS_TO_INSPECT)} posts mais recentes é de rodada eleitoral ` +
          `(sem registro TSE no texto): ${inspecionados.join(', ')}`,
      ).toBeDefined();
      if (rodada === undefined) return;

      const { storage } = makeTempStorage();
      const adapter = new QuaestAdapter({
        resolveCandidate: resolverFromMap(new Map()),
        storage,
      });
      // O campo termina poucos dias antes do post; é assim que o registro real chega
      // do PesqEle. A janela do `discover` é derivada daí.
      const fieldEnd = dayMinus(rodada.day, LAG_DAYS_MEASURED);
      const candidates = await adapter.discover(
        makeReg({ instituteId: 'quaest', fieldStart: dayMinus(fieldEnd, 3), fieldEnd }),
      );

      const urls = candidates.map((c) => c.url);
      // O contrato que o HarvestJob exige: cada candidata é um DOCUMENTO de rodada.
      expect(urls.some((u) => u.includes('sitemap'))).toBe(false);
      expect(urls.some((u) => u.includes('wp-json'))).toBe(false);
      expect(urls.every((u) => u.startsWith('https://quaest.com.br/'))).toBe(true);
      expect(
        urls,
        `a janela do discover não alcançou o post da rodada (${rodada.link}). ` +
          `Revise QUAEST_POST_LAG_DAYS.`,
      ).toContain(rodada.link);
    },
    TIMEOUT_MS,
  );

  it(
    'o post de rodada mais recente AINDA é extraível — se falhar aqui, a redação mudou',
    () => {
      expect(rodada).toBeDefined();
      if (rodada === undefined) return;

      let erro: unknown;
      try {
        const scenarios = parseQuaestRoundText(rodada.text);
        expect(scenarios.length).toBeGreaterThan(0);
        expect(scenarios.some((s) => s.kind === 't1_estimulado')).toBe(true);
        for (const scenario of scenarios) {
          expect(scenario.values.length).toBeGreaterThan(0);
          for (const value of scenario.values) {
            expect(value.valuePct).toBeGreaterThan(0);
            expect(value.candidateAlias.length).toBeGreaterThan(0);
          }
        }
      } catch (caught) {
        erro = caught;
      }

      expect(
        erro,
        `o post "${rodada.link}" não é mais extraível — a redação da Quaest mudou. ` +
          `Leia o motivo, atualize as âncoras/guardas de parse.ts e RECAPTURE a fixture ` +
          `antes de tocar o parser: ${erro instanceof Error ? erro.message : String(erro)}`,
      ).toBeUndefined();
    },
    TIMEOUT_MS,
  );
});
