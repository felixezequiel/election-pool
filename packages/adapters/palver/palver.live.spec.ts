/**
 * CANÁRIO AO VIVO contra `www.palver.com.br` — o antídoto da Q-09.
 *
 * Fixture, por real que seja, é uma foto: prova que o parser lê AQUELE documento,
 * não que a fonte de hoje ainda é aquela. Este teste bate na Palver de verdade e
 * afirma o que sabemos ser verdade em 2026-08-17:
 *
 * 1. os dois endpoints devolvem PDF;
 * 2. o registro `BR-06596/2026` está na camada de texto dos dois (V6 é viável);
 * 3. o relatório DECLARA as três seções de intenção de voto;
 * 4. e mesmo assim `parse` LANÇA, porque as páginas de resultado são imagem.
 *
 * A asserção (4) é de propósito uma afirmação sobre o BLOQUEIO. No dia em que a
 * Palver publicar uma onda com camada de texto nos resultados — ou os microdados
 * prometidos para depois do 2º turno — este teste FALHA, e a falha é o aviso de
 * que a colheita ficou possível. É um canário, não uma trava.
 *
 * OPT-IN por ambiente e FORA do `pnpm verify`: usa rede e baixa ~17 MB.
 *
 *     PALVER_LIVE=1 pnpm --filter @election-pool/adapters test palver/palver.live
 *
 * Etiqueta (docs/04 §6): o `HttpClient` do projeto — robots.txt, 1 req/10s por
 * host, timeout, retries. Sequencial, sem headless. `robots.txt` de
 * `www.palver.com.br` respondia 404 em 2026-08-17 (sem restrição declarada).
 *
 * Por que NÃO o `sharedHttpClient()`: o corpo aqui é PDF, e o caminho de string do
 * `HttpClient` decodifica como UTF-8, o que destruiria os bytes. Usamos a mesma
 * adaptação binária de `tse-candidatos` (`createBase64Fetch`) sobre a MESMA classe
 * educada — nada de robots/rate-limit é reimplementado. É uma instância separada
 * apenas porque o singleton compartilhado é o de texto; num harvest de produção o
 * `HttpClient` binário é que deveria ser o singleton para este host.
 */

import { describe, it, expect } from 'vitest';
import { ParseError } from '../poll-source-adapter.js';
import { documentContainsTseId } from '../base/tse-id.js';
import { extractPdfText } from '../cnt-mda/pdf.js';
import { HttpClient, DEFAULT_USER_AGENT } from '../http-client.js';
import { createBase64Fetch, decodeBase64Body } from '../tse-candidatos/binary-fetch.js';
import type { RawFetch } from '../tse-candidatos/binary-fetch.js';
import { parsePalverReportText } from './parse.js';
import { PALVER_TSE_ID } from './__fixtures__/make-pdf.js';

const LIVE = process.env['PALVER_LIVE'] === '1';
const TIMEOUT_MS = 5 * 60 * 1000;

const RELATORIO_URL = 'https://www.palver.com.br/api/surveys/voting-intention-2026-august/report';
const PRESS_RELEASE_URL =
  'https://www.palver.com.br/api/surveys/voting-intention-2026-august/press-release';

describe.skipIf(!LIVE)('Palver ao vivo (canário de estrutura)', () => {
  it(
    'a fonte primária está de pé, confirma o registro TSE, e os resultados seguem rasterizados',
    async () => {
      const http = new HttpClient({
        fetchImpl: createBase64Fetch(globalThis.fetch as unknown as RawFetch),
        userAgent: process.env['HARVEST_USER_AGENT'] ?? DEFAULT_USER_AGENT,
      });

      const relatorio = await http.request({ url: RELATORIO_URL, method: 'GET' });
      expect(relatorio.status).toBe(200);
      const textoRelatorio = await extractPdfText(decodeBase64Body(relatorio.body));

      // V6 é viável: o registro está na camada de texto (grafado `BR -06596/2026`).
      expect(documentContainsTseId(textoRelatorio, PALVER_TSE_ID)).toBe(true);

      // As três seções de intenção de voto continuam declaradas.
      expect(textoRelatorio).toContain('1º Turno (Espontânea)');
      expect(textoRelatorio).toContain('1º Turno (Estimulada)');
      expect(textoRelatorio).toContain('2º Turno (Estimulada)');

      // E continuam sem número. Se esta expectativa cair, a colheita ficou possível.
      let erro: unknown;
      try {
        parsePalverReportText(textoRelatorio);
      } catch (e) {
        erro = e;
      }
      expect(
        erro,
        'parse NÃO lançou: a Palver passou a publicar resultado em camada de texto. ' +
          'Recapture a fixture e reveja a task T-26 — a colheita virou possível.',
      ).toBeInstanceOf(ParseError);
      expect((erro as ParseError).message).toContain('RASTERIZADOS');

      const press = await http.request({ url: PRESS_RELEASE_URL, method: 'GET' });
      expect(press.status).toBe(200);
      const textoPress = await extractPdfText(decodeBase64Body(press.body));
      expect(documentContainsTseId(textoPress, PALVER_TSE_ID)).toBe(true);
    },
    TIMEOUT_MS,
  );
});
