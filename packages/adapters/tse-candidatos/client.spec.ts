/**
 * Cliente do DivulgaCandContas, sem rede: o `HttpClient` real é usado (robots,
 * rate limit, retries, conditional GET), mas o `fetch` é um duplo que devolve as
 * capturas reais dos `__fixtures__`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { HttpClient } from '../http-client.js';
import type { HttpClientClock } from '../http-client.js';
import { createBase64Fetch } from './binary-fetch.js';
import type { RawFetch } from './binary-fetch.js';
import { TseCandidatosClient, TseApiError } from './client.js';

const fixtureText = (name: string): string =>
  readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8');

/** Relógio sem espera: o rate limit de 10s não pode fazer o teste dormir. */
const instantClock: HttpClientClock = {
  now: () => 0,
  sleep: async () => {},
  random: () => 0,
};

interface Rota {
  status?: number;
  body: string | Uint8Array;
  headers?: Record<string, string>;
}

/** Registra as URLs pedidas e responde pelo mapa de rotas (match por sufixo). */
class FakeServer {
  readonly requested: string[] = [];
  constructor(private readonly rotas: Array<{ match: string; rota: Rota }>) {}

  readonly fetch: RawFetch = (url) => {
    this.requested.push(url);
    const hit = this.rotas.find((r) => url.includes(r.match));
    // Rota não declarada (robots.txt inclusive): 404 ⇒ o RobotsCache libera.
    const body = hit?.rota.body ?? '';
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    return Promise.resolve({
      status: hit === undefined ? 404 : (hit.rota.status ?? 200),
      headers: new Headers(hit?.rota.headers ?? {}),
      url,
      arrayBuffer: (): Promise<ArrayBuffer> =>
        Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      text: (): Promise<string> => Promise.resolve(new TextDecoder().decode(bytes)),
    });
  };
}

const makeClient = (server: FakeServer): TseCandidatosClient =>
  new TseCandidatosClient({
    http: new HttpClient({ fetchImpl: createBase64Fetch(server.fetch), clock: instantClock }),
  });

const ROTAS_OK = [
  { match: '/eleicao/eleicao-atual', rota: { body: fixtureText('eleicao-atual.json') } },
  {
    match: '/candidatura/listar/',
    rota: { body: fixtureText('candidatos-presidente-2026.json') },
  },
  {
    match: '/candidatura/buscar/',
    rota: { body: fixtureText('candidato-detalhe-280002542548.json') },
  },
];

describe('TseCandidatosClient contra as capturas reais', () => {
  let server: FakeServer;
  let client: TseCandidatosClient;

  beforeEach(() => {
    server = new FakeServer(ROTAS_OK);
    client = makeClient(server);
  });

  it('descobre a eleição alvo e confirma ano e abrangência', async () => {
    const eleicao = await client.resolveEleicaoAlvo();
    expect(eleicao).toEqual({
      idEleicao: '20322002026',
      ano: 2026,
      nome: 'Eleição Geral Federal 2026',
    });
  });

  it('lista as 13 candidaturas presidenciais nacionais', async () => {
    const candidaturas = await client.listarCandidaturasPresidente('20322002026');
    expect(candidaturas).toHaveLength(13);
    expect(server.requested.at(-1)).toContain(
      '/divulga/rest/v1/candidatura/listar/2026/BR/20322002026/1/candidatos',
    );
  });

  it('busca o detalhe e é ali que a foto autorizada aparece', async () => {
    const detalhe = await client.buscarCandidatura('20322002026', '280002542548');
    expect(detalhe.fotoUrlPublicavel).toBe(true);
    expect(detalhe.fotoUrl).toContain('/divulga/rest/arquivo/img/');
  });

  it('monta a URL pública do registro para a proveniência (R6)', () => {
    expect(client.urlPublicaCandidatura('20322002026', '280002542548')).toBe(
      'https://divulgacandcontas.tse.jus.br/divulga/#/candidato/BR/BR/20322002026/280002542548/2026/BR',
    );
  });

  it('baixa a imagem em bytes íntegros, apesar do caminho de string do HttpClient', async () => {
    // Bytes que NÃO são UTF-8 válido: se o corpo passasse por `text()`, viravam
    // U+FFFD e o JPEG estaria destruído. O base64 é justamente o que evita isso.
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x80, 0x81, 0xfe, 0x00]);
    const s = new FakeServer([{ match: '/arquivo/img/', rota: { body: jpeg } }]);
    const baixada = await makeClient(s).baixarFoto(
      'https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/1/2/BR',
    );
    expect(baixada).not.toBe('not-modified');
    if (baixada === 'not-modified') throw new Error('inesperado');
    expect([...baixada.bytes]).toEqual([...jpeg]);
  });

  it('304 do conditional GET encerra o ciclo sem corpo', async () => {
    const s = new FakeServer([{ match: '/arquivo/img/', rota: { status: 304, body: '' } }]);
    const result = await makeClient(s).baixarFoto(
      'https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/1/2/BR',
      { etag: 'W/"abc"' },
    );
    expect(result).toBe('not-modified');
  });
});

describe('TseCandidatosClient — falha alta, nunca silenciosa (R4)', () => {
  it('recusa eleição de outro ano em vez de ingerir a errada', async () => {
    const outroAno = JSON.stringify({
      eleicao: {
        sq_ELEICAO: 20322002030,
        nr_ANO_REFERENCIA: 2030,
        nm_ELEICAO: 'Eleição Geral Federal 2030',
        tp_ABRANGENCIA: 'F',
      },
    });
    const s = new FakeServer([{ match: '/eleicao/eleicao-atual', rota: { body: outroAno } }]);
    await expect(makeClient(s).resolveEleicaoAlvo()).rejects.toThrow(/esperávamos 2026/);
  });

  it('recusa eleição de abrangência não federal', async () => {
    const municipal = JSON.stringify({
      eleicao: {
        sq_ELEICAO: 1,
        nr_ANO_REFERENCIA: 2026,
        nm_ELEICAO: 'Eleição Municipal',
        tp_ABRANGENCIA: 'M',
      },
    });
    const s = new FakeServer([{ match: '/eleicao/eleicao-atual', rota: { body: municipal } }]);
    await expect(makeClient(s).resolveEleicaoAlvo()).rejects.toThrow(/não é a federal/);
  });

  it('recusa lista vazia de candidaturas (sintoma de mudança de API)', async () => {
    const vazia = JSON.stringify({
      unidadeEleitoral: { sigla: 'BR' },
      cargo: { codigo: 1, nome: 'Presidente' },
      candidatos: [],
    });
    const s = new FakeServer([{ match: '/candidatura/listar/', rota: { body: vazia } }]);
    await expect(makeClient(s).listarCandidaturasPresidente('1')).rejects.toThrow(/veio vazia/);
  });

  it('recusa detalhe de outra candidatura (troca de identidade)', async () => {
    const outro = JSON.stringify({
      id: 999,
      nomeUrna: 'OUTRO',
      nomeCompleto: 'OUTRO DE TAL',
      numero: 1,
      partido: { sigla: 'X', numero: 1 },
    });
    const s = new FakeServer([{ match: '/candidatura/buscar/', rota: { body: outro } }]);
    await expect(makeClient(s).buscarCandidatura('1', '280002542548')).rejects.toThrow(TseApiError);
  });

  it('recusa corpo que não é JSON em vez de devolver objeto vazio', async () => {
    const s = new FakeServer([
      { match: '/eleicao/eleicao-atual', rota: { body: '<html>erro</html>' } },
    ]);
    await expect(makeClient(s).resolveEleicaoAlvo()).rejects.toThrow(/não é JSON válido/);
  });
});

describe('binary-fetch respeita o parsing de robots.txt', () => {
  it('entrega robots.txt como TEXTO, para o HttpClient conseguir bloquear', async () => {
    const robots = 'User-agent: *\nDisallow: /divulga/rest/\n';
    const s = new FakeServer([
      { match: '/robots.txt', rota: { body: robots } },
      { match: '/eleicao/eleicao-atual', rota: { body: fixtureText('eleicao-atual.json') } },
    ]);
    // Se o robots chegasse em base64, o parser não veria o Disallow e passaria.
    await expect(makeClient(s).resolveEleicaoAlvo()).rejects.toThrow(/robots\.txt proíbe/);
  });
});
