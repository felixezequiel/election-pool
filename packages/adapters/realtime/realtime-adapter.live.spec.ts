/**
 * TESTE DE FUMAÇA AO VIVO — o antídoto da Q-09.
 *
 * Fixture é uma foto: prova que o parser lê AQUELE documento, não que a fonte de
 * hoje continua com a mesma estrutura. Este teste bate no site real do REAL TIME
 * BIG DATA, colhe uma rodada de ponta a ponta pelo MESMO caminho de produção
 * (`discover` → `HttpClient` compartilhado → `RawStorage` → `parse`) e falha se a
 * colheita voltar vazia.
 *
 * É OPT-IN e fica FORA do `pnpm verify`: usa rede e o rate limit real é 1 req/10s
 * por host (docs/04 §6), então cada rodada custa ~20s.
 *
 *     REALTIME_LIVE=1 pnpm --filter @election-pool/adapters test realtime-adapter.live
 *
 * Com `REALTIME_CAPTURE=1` ele também RECONGELA as fixtures de texto
 * (`__fixtures__/*.layout.txt`) a partir do PDF ao vivo — é o procedimento de
 * recaptura documentado em `__fixtures__/README.md`.
 *
 * O PDF é buscado com `createBase64Fetch` (de `tse-candidatos/binary-fetch`):
 * `HttpClient` devolve `body: string` e `Response.text()` sobre bytes binários
 * destruiria o PDF. Reusar aquele wrapper — em vez de fazer um `fetch` cru aqui —
 * mantém robots.txt, rate limit, timeout e retries no caminho.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { rawDocumentSchema } from '@election-pool/contracts/domain';
import { HttpClient } from '../http-client.js';
import { createBase64Fetch } from '../tse-candidatos/binary-fetch.js';
import type { RawFetch } from '../tse-candidatos/binary-fetch.js';
import { RawStorage } from '../base/raw-storage.js';
import { makeReg } from '../base/test-support.js';
import { RealTimeAdapter } from './realtime-adapter.js';
import { asPdfBytes } from './raw-body.js';
import { pdfToLayoutText } from './pdf-layout.js';
import { REALTIME_INSTITUTE_ID } from './constants.js';
import { realtimeTestResolver } from './__fixtures__/aliases.js';

const LIVE = process.env['REALTIME_LIVE'] === '1';
const CAPTURE = process.env['REALTIME_CAPTURE'] === '1';
const TIMEOUT_MS = 5 * 60 * 1000;

/** Rodadas presidenciais reais e o nome da fixture de cada uma. */
const ROUNDS: ReadonlyArray<{ tseId: string; fixture: string }> = [
  { tseId: 'BR-06833/2026', fixture: '02-mato-grosso-BR-06833-2026.layout.txt' },
  { tseId: 'BR-05205/2026', fixture: '03-bahia-BR-05205-2026.layout.txt' },
  { tseId: 'BR-01784/2026', fixture: '04-mato-grosso-do-sul-BR-01784-2026.layout.txt' },
];

describe.skipIf(!LIVE)('RealTimeAdapter ao vivo contra realtimebigdata.com.br', () => {
  it(
    'descobre o PDF da rodada pelo índice e extrai cenários de verdade',
    async () => {
      const http = new HttpClient({
        fetchImpl: createBase64Fetch(globalThis.fetch as unknown as RawFetch),
      });
      const storage = new RawStorage(mkdtempSync(join(tmpdir(), 'ep-realtime-live-')));
      const adapter = new RealTimeAdapter({
        resolveCandidate: realtimeTestResolver,
        storage,
        http,
      });

      for (const round of ROUNDS) {
        const reg = makeReg({ tseId: round.tseId, instituteId: REALTIME_INSTITUTE_ID });

        const candidates = await adapter.discover(reg);
        expect(candidates.length).toBeGreaterThan(0);
        const first = candidates[0];
        if (first === undefined) throw new Error('discover devolveu lista vazia');

        const response = await http.request({ url: first.url, method: 'GET' });
        expect(response.status).toBe(200);
        const { contentHash, storagePath } = await storage.store(
          response.body,
          response.headers.get('content-type'),
        );
        const raw = rawDocumentSchema.parse({
          id: randomUUID(),
          url: response.url,
          fetchedAt: new Date().toISOString(),
          httpStatus: response.status,
          contentType: response.headers.get('content-type'),
          contentHash,
          storagePath,
          etag: response.headers.get('etag'),
          lastModified: response.headers.get('last-modified'),
        });

        const parsed = await adapter.parse(raw, reg);
        expect(parsed.tseId).toBe(round.tseId);
        expect(parsed.scenarios.length).toBeGreaterThanOrEqual(3);

        if (CAPTURE) {
          // Recongela a fixture de TEXTO (só rótulos e números, R3/docs/08 §2: o
          // PDF do instituto nunca entra no repo). É o MESMO caminho que
          // `documentToText` usa, chamado diretamente para não furar visibilidade.
          const layout = await pdfToLayoutText(asPdfBytes(await storage.readBytes(storagePath)));
          writeFileSync(join(import.meta.dirname, '__fixtures__', round.fixture), layout, 'utf8');
        }
      }
    },
    TIMEOUT_MS,
  );
});
