/**
 * `RealTimeAdapter` de ponta a ponta, sem rede.
 *
 * Duas frentes, deliberadamente separadas:
 *
 * 1. **Dado REAL** (`__fixtures__/*.layout.txt`): exercita `parse` inteiro —
 *    V6, resolução de alias e `parsedPollSchema` — sobre o texto que o
 *    documento real produz. O PDF do instituto não entra no repo (docs/08 §2:
 *    não copiamos o design/gráfico de terceiro), então aqui o texto real é
 *    injetado no lugar da leitura do PDF.
 * 2. **PDF sintético posicionado** (`__fixtures__/make-pdf.ts`): exercita o passo
 *    `documentToText` — extração posicionada, dedupe da camada duplicada e
 *    pareamento por `x` no confronto — num PDF de verdade, com a geometria
 *    transcrita do original.
 *
 * O `realtime-adapter.live.spec.ts` fecha o círculo contra a fonte de verdade.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { SCENARIO_KIND } from '@election-pool/contracts/enums';
import type { PollRegistration, RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { HttpClient } from '../http-client.js';
import type { FetchLike } from '../http-client.js';
import { makeRawFromBytes, makeReg, makeTempStorage } from '../base/test-support.js';
import { resolverFromMap } from '../base/candidate-resolver.js';
import { RealTimeAdapter } from './realtime-adapter.js';
import { REALTIME_INDEX_URL, REALTIME_INSTITUTE_ID } from './constants.js';
import { realtimeTestResolver } from './__fixtures__/aliases.js';
import { syntheticRoundPdf } from './__fixtures__/make-pdf.js';

const MATO_GROSSO_LAYOUT = readFileSync(
  join(import.meta.dirname, '__fixtures__', '02-mato-grosso-BR-06833-2026.layout.txt'),
  'utf8',
);

const reg = (tseId = 'BR-06833/2026'): PollRegistration =>
  makeReg({ tseId, instituteId: REALTIME_INSTITUTE_ID });

/**
 * Adapter com o passo de leitura do PDF trocado pelo texto real congelado. Só o
 * `documentToText` muda; V6, alias e schema seguem sendo do `BaseAdapter`.
 */
class LayoutTextAdapter extends RealTimeAdapter {
  constructor(
    private readonly layout: string,
    resolveCandidate = realtimeTestResolver,
  ) {
    super({ resolveCandidate, http: new HttpClient({ fetchImpl: failingFetch }) });
  }

  protected override documentToText(_raw: RawDocument): Promise<string> {
    return Promise.resolve(this.layout);
  }
}

/** Qualquer requisição nestes testes é erro: eles não podem tocar a rede. */
const failingFetch: FetchLike = () => {
  throw new Error('teste sem rede tentou fazer requisição');
};

/** `RawDocument` mínimo; o corpo não é lido quando `documentToText` é trocado. */
const rawStub = async (): Promise<RawDocument> => {
  const { storage } = makeTempStorage();
  return makeRawFromBytes(storage, 'stub', 'application/pdf');
};

describe('RealTimeAdapter — identidade e contrato', () => {
  it('tem os ids do instituto cadastrado no seed', () => {
    const adapter = new LayoutTextAdapter(MATO_GROSSO_LAYOUT);
    expect(adapter.id).toBe('realtime');
    expect(adapter.instituteId).toBe('realtime');
  });

  it('só aceita registros do próprio instituto', () => {
    const adapter = new LayoutTextAdapter(MATO_GROSSO_LAYOUT);
    expect(adapter.canHandle(reg())).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
  });
});

describe('RealTimeAdapter.parse sobre a rodada REAL de Mato Grosso', () => {
  it('devolve um ParsedPoll válido com o tse_id do registro e os três cenários', async () => {
    const adapter = new LayoutTextAdapter(MATO_GROSSO_LAYOUT);
    const parsed = await adapter.parse(await rawStub(), reg());

    expect(parsed.tseId).toBe('BR-06833/2026');
    expect(parsed.scenarios.map((scenario) => scenario.kind)).toEqual([
      SCENARIO_KIND.t1Espontaneo,
      SCENARIO_KIND.t1Estimulado,
      SCENARIO_KIND.t2,
    ]);
    const t2 = parsed.scenarios[2];
    expect(t2?.t2Pair).toEqual(['LULA (PT)', 'FLÁVIO BOLSONARO (PL)']);
    expect(t2?.values).toEqual([
      { candidateAlias: 'LULA (PT)', valuePct: 37 },
      { candidateAlias: 'FLÁVIO BOLSONARO (PL)', valuePct: 51 },
    ]);
  });

  it('V6: RECUSA o documento quando o registro é de outra rodada', async () => {
    const adapter = new LayoutTextAdapter(MATO_GROSSO_LAYOUT);
    // O documento é o de BR-06833/2026; o registro pedido é outro.
    await expect(adapter.parse(await rawStub(), reg('BR-09999/2026'))).rejects.toThrow(ParseError);
    await expect(adapter.parse(await rawStub(), reg('BR-09999/2026'))).rejects.toThrow(
      /não contém o tse_id do registro/,
    );
  });

  it('V6: RECUSA quando só o ano coincide (não basta parte do número)', async () => {
    const adapter = new LayoutTextAdapter(MATO_GROSSO_LAYOUT);
    await expect(adapter.parse(await rawStub(), reg('BR-06834/2026'))).rejects.toThrow(ParseError);
  });

  it('alias desconhecido ⇒ UnknownCandidateError (quarentena, nunca auto-cria)', async () => {
    // Resolver com o seed manual só: 'Renan Santos' não está cadastrado.
    const partial = resolverFromMap(new Map([['Lula', 'lula']]));
    const adapter = new LayoutTextAdapter(MATO_GROSSO_LAYOUT, partial);
    await expect(adapter.parse(await rawStub(), reg())).rejects.toThrow(UnknownCandidateError);
  });

  it('não devolve parcial: um alias irreconhecível derruba o documento inteiro', async () => {
    const partial = resolverFromMap(new Map([['Lula', 'lula']]));
    const adapter = new LayoutTextAdapter(MATO_GROSSO_LAYOUT, partial);
    let parsed: unknown = 'não deveria chegar aqui';
    try {
      parsed = await adapter.parse(await rawStub(), reg());
    } catch {
      parsed = undefined;
    }
    expect(parsed).toBeUndefined();
  });
});

describe('RealTimeAdapter.documentToText sobre um PDF posicionado', () => {
  it('extrai os cenários de um PDF (dedupe da camada duplicada + pareamento por x)', async () => {
    const { storage } = makeTempStorage();
    const raw = await makeRawFromBytes(storage, syntheticRoundPdf(), 'application/pdf');
    const adapter = new RealTimeAdapter({
      resolveCandidate: realtimeTestResolver,
      storage,
      http: new HttpClient({ fetchImpl: failingFetch }),
    });

    const parsed = await adapter.parse(raw, reg());
    expect(parsed.scenarios.map((scenario) => scenario.kind)).toEqual([
      SCENARIO_KIND.t1Espontaneo,
      SCENARIO_KIND.t1Estimulado,
      SCENARIO_KIND.t2,
    ]);

    // O PDF sintético escreve o valor do finalista da ESQUERDA por ÚLTIMO no
    // fluxo, como o real. Se a extração usasse a ordem de fluxo, este par viria
    // trocado.
    const t2 = parsed.scenarios[2];
    expect(t2?.values).toEqual([
      { candidateAlias: 'LULA (PT)', valuePct: 37 },
      { candidateAlias: 'FLÁVIO BOLSONARO (PL)', valuePct: 51 },
    ]);
    expect(t2?.blankNullPct).toBe(6);
    expect(t2?.undecidedPct).toBe(6);

    // A seção de rejeição tem divisória e gráfico, e NÃO é cenário de voto.
    expect(parsed.scenarios).toHaveLength(3);
  });

  it('lança quando o corpo bruto não é um PDF, dizendo a causa provável', async () => {
    const { storage } = makeTempStorage();
    const raw = await makeRawFromBytes(storage, '<html>não sou um pdf</html>', 'application/pdf');
    const adapter = new RealTimeAdapter({
      resolveCandidate: realtimeTestResolver,
      storage,
      http: new HttpClient({ fetchImpl: failingFetch }),
    });
    await expect(adapter.parse(raw, reg())).rejects.toThrow(/não é um PDF/);
  });

  it('aceita o PDF que trafegou em base64 pelo HttpClient', async () => {
    // `createBase64Fetch` (tse-candidatos/binary-fetch) existe porque
    // `Response.text()` destrói binário. Se o cliente compartilhado estiver
    // nesse modo, o blob guarda base64 — e o adapter tem de funcionar igual.
    const { storage } = makeTempStorage();
    const base64 = Buffer.from(syntheticRoundPdf()).toString('base64');
    const raw = await makeRawFromBytes(storage, base64, 'application/pdf');
    const adapter = new RealTimeAdapter({
      resolveCandidate: realtimeTestResolver,
      storage,
      http: new HttpClient({ fetchImpl: failingFetch }),
    });
    const parsed = await adapter.parse(raw, reg());
    expect(parsed.scenarios).toHaveLength(3);
  });
});

describe('RealTimeAdapter.discover', () => {
  const indexHtml = readFileSync(
    join(import.meta.dirname, '__fixtures__', '01-pesquisas-index.html'),
    'utf8',
  );

  const clientServing = (body: string, contentType = 'text/html'): HttpClient => {
    const fetchImpl: FetchLike = (url) =>
      Promise.resolve({
        status: 200,
        headers: new Headers({ 'content-type': contentType }),
        url,
        // robots.txt do host permite tudo (verificado ao vivo); devolvemos a
        // resposta real para o cliente não recusar por robots.
        text: () =>
          Promise.resolve(url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow:' : body),
      });
    return new HttpClient({
      fetchImpl,
      clock: { now: () => 0, sleep: async () => {}, random: () => 0 },
    });
  };

  const adapterWith = (http: HttpClient): RealTimeAdapter =>
    new RealTimeAdapter({ resolveCandidate: realtimeTestResolver, http });

  it('aponta o PDF da rodada, lendo o índice do próprio instituto', async () => {
    const candidates = await adapterWith(clientServing(indexHtml)).discover(reg());
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.url).toContain('Mato-Grosso-BR-06833-2026-Ago26.pdf');
    // O `reason` é texto NOSSO — nenhum título nem prosa da fonte (R3).
    expect(candidates[0]?.reason).toContain('BR-06833/2026');
  });

  it('devolve lista vazia para rodada ainda não publicada', async () => {
    const candidates = await adapterWith(clientServing(indexHtml)).discover(reg('BR-99999/2026'));
    expect(candidates).toHaveLength(0);
  });

  it('lança quando o índice não tem link de PDF nenhum', async () => {
    const empty = '<html><body><a href="/contato/">contato</a></body></html>';
    await expect(adapterWith(clientServing(empty)).discover(reg())).rejects.toThrow(ParseError);
  });

  it('lança quando o índice volta com corpo vazio', async () => {
    await expect(adapterWith(clientServing('')).discover(reg())).rejects.toThrow(/corpo vazio/);
  });

  it('busca o índice canônico do instituto, e nada mais', async () => {
    const requested: string[] = [];
    const fetchImpl: FetchLike = (url) => {
      requested.push(url);
      return Promise.resolve({
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        url,
        text: () =>
          Promise.resolve(url.endsWith('/robots.txt') ? 'User-agent: *\nDisallow:' : indexHtml),
      });
    };
    const http = new HttpClient({
      fetchImpl,
      clock: { now: () => 0, sleep: async () => {}, random: () => 0 },
    });
    await adapterWith(http).discover(reg());
    // robots.txt (exigência de docs/04 §6) + o índice. Nenhum portal de notícia.
    expect(requested).toEqual(['https://realtimebigdata.com.br/robots.txt', REALTIME_INDEX_URL]);
  });
});
