/**
 * SMOKE TEST AO VIVO da AtlasIntel — e, sobretudo, **detector de destravamento**.
 *
 * Fixture é uma foto: prova que o código lê AQUELA resposta, não que a fonte de
 * hoje ainda é assim (a lição do Q-09). Este teste bate no site de verdade e
 * afirma três coisas, na ordem de importância para a decisão pendente:
 *
 * 1. A API pública continua respondendo e a série `Brazil: National` continua em
 *    `exclusive-polls` (se a Atlas renomear a série, `discover` cega e este teste
 *    é o que avisa).
 * 2. O `robots.txt` de `cdn.atlasintel.org` continua com `Disallow: /` — o
 *    bloqueio que impede o adapter de funcionar. Se um dia ele mudar, ESTE teste
 *    falha e o bloqueio virou notícia boa.
 * 3. Se já existe relatório com `file_created_on >= REPORT_CDN_CUTOFF_DATE`, ele
 *    será servido por `cdn1.atlasintel.org`, que não tem restrição de robots — e
 *    aí é possível capturar um relatório real e finalmente escrever o parser.
 *    O teste IMPRIME esse veredito.
 *
 * OPT-IN por ambiente, FORA do `pnpm verify` (usa rede; 1 req/10s, docs/04 §6):
 *
 *     ATLAS_LIVE=1 pnpm --filter @election-pool/adapters test atlas/atlas.live
 */

import { describe, it, expect } from 'vitest';
import { HttpClient } from '../http-client.js';
import { RobotsCache } from '../robots.js';
import { __test as robotsInternals } from '../robots.js';
import { parsePublicPollsFeed, publicPollsUrl } from './public-polls-api.js';
import { NATIONAL_RELEASE_TITLE, REPORT_CDN_CUTOFF_DATE } from './constants.js';

const LIVE = process.env['ATLAS_LIVE'] === '1';
const TIMEOUT_MS = 3 * 60 * 1000;

describe.skipIf(!LIVE)('AtlasIntel ao vivo', () => {
  it(
    'a API pública responde e a série nacional segue em exclusive-polls',
    async () => {
      const http = new HttpClient();
      const url = publicPollsUrl('exclusive-polls');
      const res = await http.request({ url });
      expect(res.status).toBe(200);

      const feed = parsePublicPollsFeed(res.body, url);
      expect(feed.data.length).toBeGreaterThan(0);

      const nacionais = feed.data.filter((e) => e.title === NATIONAL_RELEASE_TITLE);
      expect(nacionais.length).toBeGreaterThan(0);

      // Veredito de destravamento: relatório no cdn1 ⇒ buscável sem violar §6.
      const noCdn1 = feed.data.filter(
        (e) => e.file_created_on.slice(0, 10) >= REPORT_CDN_CUTOFF_DATE,
      );
      console.log(
        noCdn1.length > 0
          ? `DESTRAVOU: ${String(noCdn1.length)} relatório(s) já no cdn1 — ${noCdn1
              .map((e) => e.slug)
              .join(', ')}`
          : 'AINDA BLOQUEADO: nenhum relatório com file_created_on >= ' +
              `${REPORT_CDN_CUTOFF_DATE} (todos no cdn.atlasintel.org, que proíbe por robots)`,
      );
    },
    TIMEOUT_MS,
  );

  it(
    'o robots.txt do CDN do relatório continua proibindo (é o bloqueio)',
    async () => {
      // Buscamos o robots.txt DIRETAMENTE (é a exceção legítima: é o arquivo que
      // declara a política) e o interpretamos com o parser de produção.
      const res = await fetch('https://cdn.atlasintel.org/robots.txt');
      expect(res.status).toBe(200);
      const rules = robotsInternals.parseRobotsTxt(await res.text());
      expect(robotsInternals.isAllowedByRules(rules, '/qualquer-relatorio.pdf')).toBe(false);

      // E o RobotsCache de produção chega à mesma conclusão pelo caminho normal.
      const cache = new RobotsCache(async (robotsUrl) => {
        const r = await fetch(robotsUrl);
        return { status: r.status, body: await r.text() };
      });
      expect(await cache.isAllowed('https://cdn.atlasintel.org/qualquer-relatorio.pdf')).toBe(
        false,
      );
    },
    TIMEOUT_MS,
  );
});
