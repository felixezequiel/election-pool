/**
 * TESTE AO VIVO E FERRAMENTA DE RECAPTURA — é o teste que a Q-09 diz que faltou.
 *
 * Fixture, por mais real que seja, é uma FOTO: prova que o parser lê aquele
 * documento, não que a fonte de hoje ainda tem aquela estrutura. Este arquivo bate
 * no PoderData de verdade e faz três coisas:
 *
 * 1. `discover()` contra o índice real — falha se voltar vazio (o `seen=0` da Q-09).
 * 2. Parser sobre o texto INTEGRAL do PDF real, sem redação nenhuma. É a prova de
 *    integração de ponta a ponta: se o instituto mudar o layout, aqui quebra.
 * 3. Confere que a redação aplicada à captura de hoje reproduz EXATAMENTE o
 *    arquivo commitado — ou seja, que a fixture continua fiel.
 *
 * É OPT-IN por ambiente e fica FORA do `pnpm verify`: usa rede e o rate limit real
 * é 1 req/10s por host (docs/04 §6), então baixar os 4 relatórios leva ~1 min.
 *
 *     PODERDATA_LIVE=1 pnpm --filter @election-pool/adapters test poderdata.live
 *
 * RECAPTURA. Com `PODERDATA_CAPTURE=1` o mesmo caminho REESCREVE as fixtures a
 * partir da captura de hoje, em vez de compará-las. É o procedimento único de
 * regeneração — não existe script solto:
 *
 *     PODERDATA_CAPTURE=1 pnpm --filter @election-pool/adapters test poderdata.live
 *
 * Depois de recapturar, revise o diff: mudança de estrutura é evento esperado
 * (docs/04 §2), mas tem de ser vista por um humano, não absorvida em silêncio.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpClient } from '../http-client.js';
import { createBase64Fetch, decodeBase64Body } from '../tse-candidatos/binary-fetch.js';
import type { RawFetch } from '../tse-candidatos/binary-fetch.js';
import { extractPdfText } from '../cnt-mda/pdf.js';
import { makeReg } from '../base/test-support.js';
import { resolverFromMap } from '../base/candidate-resolver.js';
import { PoderDataAdapter } from './poderdata-adapter.js';
import { parsePoderDataReport } from './parse.js';
import { redactPoderDataText } from './__fixtures__/redact.js';

const LIVE = process.env['PODERDATA_LIVE'] === '1';
const CAPTURE = process.env['PODERDATA_CAPTURE'] === '1';
const ENABLED = LIVE || CAPTURE;
const TIMEOUT_MS = 5 * 60 * 1000;

const FIXTURES = join(import.meta.dirname, '__fixtures__');

/**
 * As 4 rodadas capturadas, com a URL EXATA de origem e o fim de campo declarado na
 * capa de cada relatório. É a procedência da fixture em forma executável.
 */
const CAPTURED = [
  {
    url: 'https://static.poder360.com.br/2026/05/Relatorio-PoderData-Eleitoral-29mai26-final.pdf',
    fixture: 'BR-04882-2026-28mai2026.txt',
    tseId: 'BR-04882/2026',
    fieldEnd: '2026-05-28',
  },
  {
    url: 'https://static.poder360.com.br/uploads/2026/06/Relatorio-PoderData-Eleitoral-21-24-jun26-final.pdf',
    fixture: 'BR-05722-2026-24jun2026.txt',
    tseId: 'BR-05722/2026',
    fieldEnd: '2026-06-24',
  },
  {
    url: 'https://static.poder360.com.br/uploads/2026/07/Relatorio-PoderData-Eleitoral-16jul26-final.pdf',
    fixture: 'BR-00059-2026-15jul2026.txt',
    tseId: 'BR-00059/2026',
    fieldEnd: '2026-07-15',
  },
  {
    url: 'https://static.poder360.com.br/uploads/2026/07/Relatorio-PoderData-Eleitoral-29jul26-3.pdf',
    fixture: 'BR-07845-2026-29jul2026.txt',
    tseId: 'BR-07845/2026',
    fieldEnd: '2026-07-29',
  },
] as const;

const aliases = new Map<string, string>([
  ['Lula', 'lula'],
  ['Flávio Bolsonaro', 'flavio-bolsonaro'],
  ['Renan Santos', 'renan-santos'],
  ['Ronaldo Caiado', 'ronaldo-caiado'],
  ['Romeu Zema', 'zema'],
  ['Augusto Cury', 'augusto-cury'],
  ['Joaquim Barbosa', 'joaquim-barbosa'],
]);

/** Cliente educado com fetch binário (o corpo do PDF trafega em base64). */
const binaryHttpClient = (): HttpClient =>
  new HttpClient({
    fetchImpl: createBase64Fetch(globalThis.fetch as unknown as RawFetch),
  });

describe.skipIf(!ENABLED)('PoderData ao vivo contra poder360.com.br', () => {
  it(
    'discover() devolve URL de relatório de verdade (nunca lista vazia)',
    async () => {
      const adapter = new PoderDataAdapter({
        resolveCandidate: resolverFromMap(aliases),
        http: new HttpClient(),
      });
      const candidates = await adapter.discover(
        makeReg({ instituteId: 'poderdata', tseId: 'BR-07845/2026', fieldEnd: '2026-07-29' }),
      );
      expect(candidates.length).toBeGreaterThan(0);
      for (const candidate of candidates) {
        expect(candidate.url).toMatch(/Relatorio-PoderData-Eleitoral.*\.pdf$/i);
      }
    },
    TIMEOUT_MS,
  );

  it(
    'o parser lê o PDF REAL sem redação, e a fixture commitada continua fiel',
    async () => {
      const http = binaryHttpClient();
      for (const round of CAPTURED) {
        const response = await http.request({ url: round.url });
        expect(response.status).toBe(200);
        const fullText = await extractPdfText(decodeBase64Body(response.body));

        // (a) o registro TSE está no documento real — é o que o V6 exige.
        expect(fullText).toContain(round.tseId);

        // (b) o parser roda sobre o texto INTEGRAL, com toda a prosa no lugar.
        const scenarios = parsePoderDataReport(fullText, round.fieldEnd);
        expect(scenarios.filter((s) => s.kind === 't1_estimulado')).toHaveLength(1);
        expect(scenarios.filter((s) => s.kind === 't2').length).toBeGreaterThan(0);

        // (c) a fixture é a redação desta captura — ou é reescrita, ou é conferida.
        const redacted = redactPoderDataText(fullText);
        const path = join(FIXTURES, round.fixture);
        if (CAPTURE) {
          writeFileSync(path, redacted, 'utf8');
        } else {
          expect(redacted).toBe(readFileSync(path, 'utf8'));
        }

        // (d) e o resultado da fixture bate com o do documento integral: a redação
        // não mudou nenhum número.
        expect(parsePoderDataReport(readFileSync(path, 'utf8'), round.fieldEnd)).toEqual(scenarios);
      }
    },
    TIMEOUT_MS,
  );
});
