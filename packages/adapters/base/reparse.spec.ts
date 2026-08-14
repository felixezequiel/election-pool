import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeTempStorage, makeRawFromBytes, makeReg, seedResolver } from './test-support.js';
import { NexusAdapter } from '../nexus/nexus-adapter.js';
import { CntMdaAdapter } from '../cnt-mda/cnt-mda-adapter.js';
import { makeCntMdaPdf, CNT_MDA_ROUND_LINES } from '../cnt-mda/__fixtures__/make-pdf.js';

/**
 * Determinismo do reparse (docs/04 §7): rodar o parser CORRENTE sobre o MESMO raw
 * já salvo produz saída IDÊNTICA. É a garantia que torna a correção de bug de
 * parser barata — e o `ingest:reparse` (sem rede) confiável. Aqui exercitamos o
 * nível do adapter: mesmo `RawDocument`, dois `parse`, saída byte-a-byte igual.
 */

const nexusHtml = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../nexus/__fixtures__/${name}`, import.meta.url)), 'utf8');

describe('reparse determinístico sobre o raw salvo', () => {
  it('nexus: dois parses do mesmo raw dão saída idêntica', async () => {
    const { storage } = makeTempStorage();
    const adapter = new NexusAdapter({ resolveCandidate: seedResolver, storage });
    const raw = await makeRawFromBytes(storage, nexusHtml('round.html'), 'text/html');
    const reg = makeReg({ tseId: 'BR-06591/2026' });

    const first = await adapter.parse(raw, reg);
    const second = await adapter.parse(raw, reg);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('cnt-mda: dois parses do mesmo raw dão saída idêntica', async () => {
    const { storage } = makeTempStorage();
    const adapter = new CntMdaAdapter({ resolveCandidate: seedResolver, storage });
    const raw = await makeRawFromBytes(
      storage,
      makeCntMdaPdf(CNT_MDA_ROUND_LINES),
      'application/pdf',
    );
    const reg = makeReg({ tseId: 'BR-09912/2026' });

    const first = await adapter.parse(raw, reg);
    const second = await adapter.parse(raw, reg);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
