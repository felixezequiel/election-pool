/**
 * TESTE DE FUMAÇA AO VIVO — o antídoto de Q-09 aplicado ao Datafolha.
 *
 * Fixture é foto: prova que o parser lê AQUELE texto, não que a fonte de hoje
 * continua igual. Este teste bate no site real do instituto e verifica as
 * invariantes ESTRUTURAIS que a investigação da T-20 estabeleceu:
 *
 * 1. `/eleicoes/<ano>/` responde e lista rodadas em `/eleicoes/<ano>/<mes>/*.shtml`.
 * 2. A publicação tem `[itemprop="articleBody"]` com parágrafos (o `documentToText`
 *    depende disso).
 * 3. O `robots.txt` do host do "RELATÓRIO COMPLETO" continua proibindo tudo — se um
 *    dia liberar, o caminho bom (PDF com tabelas) se abre e este teste avisa.
 * 4. O `parse` termina de UM dos dois jeitos documentados: cenário íntegro, ou
 *    recusa explícita. Nunca um terceiro comportamento, e nunca cenário com menos
 *    de dois candidatos.
 *
 * OPT-IN por ambiente e FORA do `pnpm verify`: usa rede e o rate limit real é
 * 1 req/10s por host (docs/04 §6), então leva ~30s.
 *
 *     DATAFOLHA_LIVE=1 pnpm --filter @election-pool/adapters test datafolha.live
 */

import { describe, it, expect } from 'vitest';
import { parse as parseHtml } from 'node-html-parser';
import { HttpClient } from '../http-client.js';
import { RobotsDisallowedError } from '../http-client.js';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { makeRawFromBytes, makeReg, makeTempStorage, seedResolver } from '../base/test-support.js';
import { DatafolhaAdapter } from './datafolha-adapter.js';
import {
  ARTICLE_BODY_SELECTOR,
  DATAFOLHA_REPORT_HOST_DISALLOWED,
  datafolhaYearIndex,
} from './constants.js';
import { datafolhaArticleParagraphs } from './parse.js';

const LIVE = process.env['DATAFOLHA_LIVE'] === '1';
const TIMEOUT_MS = 5 * 60 * 1000;
const YEAR = 2026; // ano da eleição em curso (docs/04 §2)

/** Link de rodada dentro do índice do ano: /eleicoes/<ano>/<mes>/<slug>.shtml. */
const roundLinks = (html: string, year: number): string[] => {
  const pattern = new RegExp(
    `https://datafolha\\.folha\\.uol\\.com\\.br/eleicoes/${String(year)}/\\d{2}/[a-z0-9-]+\\.shtml`,
    'g',
  );
  return [...new Set(html.match(pattern) ?? [])];
};

describe.skipIf(!LIVE)('Datafolha ao vivo (datafolha.folha.uol.com.br)', () => {
  it(
    'o índice do ano lista rodadas e a publicação tem corpo parseável',
    async () => {
      const http = new HttpClient();
      const index = await http.request({ url: datafolhaYearIndex(YEAR) });
      expect(index.status).toBe(200);

      const links = roundLinks(index.body, YEAR);
      expect(links.length).toBeGreaterThan(0);

      const url = links[0];
      expect(url).toBeDefined();
      if (url === undefined) return;
      const page = await http.request({ url });
      expect(page.status).toBe(200);

      // Estrutura: corpo presente e com parágrafos.
      expect(parseHtml(page.body).querySelector(ARTICLE_BODY_SELECTOR)).not.toBeNull();
      const paragraphs = datafolhaArticleParagraphs(page.body);
      expect(paragraphs.length).toBeGreaterThan(2);

      // O registro TSE está na publicação? É o dado decisivo da T-20. Não é
      // asserção rígida porque a presença variou entre rodadas capturadas — mas
      // aparece no log para quem rodar o teste.
      const tse = /BR-\d{5}\/\d{4}/.exec(paragraphs.join('\n'))?.[0] ?? null;
      console.log(`[live] ${url}\n[live] registro TSE na publicação: ${tse ?? 'AUSENTE'}`);

      // O parse termina de um dos dois jeitos documentados — nunca de um terceiro.
      const { storage } = makeTempStorage();
      const raw = await makeRawFromBytes(storage, page.body, 'text/html', url);
      const reg = makeReg({
        instituteId: 'datafolha',
        tseId: tse ?? 'BR-00000/2026',
        fieldStart: `${String(YEAR)}-01-01`,
        fieldEnd: `${String(YEAR)}-01-02`,
      });
      const adapter = new DatafolhaAdapter({ resolveCandidate: seedResolver, storage });
      try {
        const parsed = await adapter.parse(raw, reg);
        for (const scenario of parsed.scenarios) {
          // Nunca parcial: cenário publicado tem pelo menos dois candidatos (V7).
          expect(scenario.values.length).toBeGreaterThanOrEqual(2);
        }
        console.log(`[live] parse OK: ${String(parsed.scenarios.length)} cenário(s)`);
      } catch (err) {
        expect(err instanceof ParseError || err instanceof UnknownCandidateError).toBe(true);
        console.log(`[live] parse recusou (esperado): ${(err as Error).message}`);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'o host do relatório em PDF continua proibido por robots.txt',
    async () => {
      const http = new HttpClient();
      // Qualquer path serve: o robots do host é `Disallow: /` para todo agente.
      await expect(
        http.request({ url: `https://${DATAFOLHA_REPORT_HOST_DISALLOWED}/datafolha/` }),
      ).rejects.toBeInstanceOf(RobotsDisallowedError);
    },
    TIMEOUT_MS,
  );
});
