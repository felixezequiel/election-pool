import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PesqEleClient, PesqEleClientError } from './client.js';
import type { DiscoverOptions, PesqEleAlert, PesqEleRawDocument } from './client.js';
import type { RawRegistration } from './registration.js';
import { HttpClient } from '../http-client.js';
import type { FetchLike, HttpClientClock } from '../http-client.js';
import { RobotsCache } from '../robots.js';
import { PerHostRateLimiter } from '../rate-limiter.js';
import { PESQELE_BASE_URL, LISTAR_30_DIAS_PATH, DETALHAR_PATH } from './constants.js';

/**
 * O HTTP é mockado, mas TODA resposta é uma captura real do PesqEle
 * (`__fixtures__/`, 2026-08-16). O que este teste prova é o PROTOCOLO: sessão →
 * filtro resolvido por rótulo → busca AJAX → paginação com o ViewState novo →
 * detalhe só do inédito. A prova de que o protocolo ainda casa com o site ao vivo
 * é o smoke test de `client.live.spec.ts` (opt-in por env).
 */
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const LIST_URL = `${PESQELE_BASE_URL}${LISTAR_30_DIAS_PATH}`;
const DETAIL_URL = `${PESQELE_BASE_URL}${DETALHAR_PATH}`;

// A captura tem 50 registros em 5 páginas, mas só as páginas 1 e 2 foram
// congeladas. Reescrevemos o rowCount para 20 para que o cliente percorra
// exatamente as duas páginas que existem em fixture — o resto do XML é intocado.
const BUSCA_DUAS_PAGINAS = fixture('02-busca-partial-response.xml').replace(
  'rowCount:50',
  'rowCount:20',
);

const TSE_PAGINA_1 = 'BR-06783/2026'; // data-ri=0, detalhe em 05-...
const TSE_MULTI = 'BR-07185/2026'; // data-ri=4, detalhe em 06-...

const noWaitClock = (): HttpClientClock => ({
  now: () => 0,
  sleep: () => Promise.resolve(),
  random: () => 0,
});
const noWaitLimiter = (): PerHostRateLimiter =>
  new PerHostRateLimiter({ now: () => 0, sleep: () => Promise.resolve() });
const allowAllRobots = (): RobotsCache =>
  new RobotsCache(() => Promise.resolve({ status: 404, body: '' }));

const ok = (body: string, url: string, headers: Record<string, string> = {}) =>
  Promise.resolve({
    status: 200,
    headers: new Headers(headers),
    url,
    text: () => Promise.resolve(body),
  });

interface Registro {
  bodies: string[];
  urls: string[];
}

/** Servidor falso que segue o protocolo real do PesqEle. */
const fakePesqEle = (
  registro: Registro,
  overrides: { listPage?: string; busca?: string; detalheDe?: (tseId: string) => string } = {},
): FetchLike => {
  const listPage = overrides.listPage ?? fixture('01-listar30dias-page.html');
  const busca = overrides.busca ?? BUSCA_DUAS_PAGINAS;
  const detalheDe =
    overrides.detalheDe ??
    ((tseId: string) =>
      tseId === TSE_MULTI
        ? fixture('06-detalhe-multi-contratante-BR-07185-2026.html')
        : fixture('05-detalhe-BR-06783-2026.html'));

  // A ação `detalhar` só diz QUAL linha; o registro concreto vem do GET seguinte.
  let ultimaLinha = 0;
  const tseIdPorLinha = new Map<number, string>([
    [0, TSE_PAGINA_1],
    [4, TSE_MULTI],
  ]);

  return (url, init) => {
    registro.urls.push(`${init.method} ${url}`);
    if (init.method === 'GET' && url === LIST_URL) {
      return ok(listPage, url, { 'set-cookie': 'JSESSIONID=abc; path=/' });
    }
    if (init.method === 'GET' && url === DETAIL_URL) {
      return ok(detalheDe(tseIdPorLinha.get(ultimaLinha) ?? ''), url);
    }
    const body = init.body ?? '';
    registro.bodies.push(body);
    if (body.includes(encodeURIComponent('detalhar'))) {
      const m = /tabelaPesquisas%3A(\d+)%3Adetalhar/.exec(body);
      ultimaLinha = Number(m?.[1] ?? -1);
      return ok(fixture('04-detalhar-redirect-partial-response.xml'), url);
    }
    if (body.includes(encodeURIComponent('_pagination'))) {
      return ok(fixture('03-paginacao-pagina2-partial-response.xml'), url);
    }
    return ok(busca, url);
  };
};

const makeClient = (fetchImpl: FetchLike, onRawDocument?: (d: PesqEleRawDocument) => void) =>
  new PesqEleClient({
    http: new HttpClient({
      fetchImpl,
      robots: allowAllRobots(),
      rateLimiter: noWaitLimiter(),
      clock: noWaitClock(),
    }),
    now: () => new Date('2026-08-16T12:00:00Z'),
    ...(onRawDocument === undefined ? {} : { onRawDocument }),
  });

/** Consome o generator inteiro e devolve todos os registros emitidos. */
const drenar = async (
  client: PesqEleClient,
  options: DiscoverOptions = {},
): Promise<RawRegistration[]> => {
  const todos: RawRegistration[] = [];
  for await (const pagina of client.discover(options)) {
    todos.push(...pagina);
  }
  return todos;
};

const semDetalhe: DiscoverOptions = { shouldFetchDetalhe: () => false };

describe('PesqEleClient — protocolo real (listar30dias + AJAX PrimeFaces)', () => {
  it('abre a sessão em listar30dias.xhtml, NÃO em index.xhtml', async () => {
    const registro: Registro = { bodies: [], urls: [] };

    await drenar(makeClient(fakePesqEle(registro)), semDetalhe);

    expect(registro.urls[0]).toBe(`GET ${LIST_URL}`);
    expect(registro.urls.join(' ')).not.toContain('index.xhtml');
  });

  it('envia os filtros resolvidos por rótulo e o ViewState da página', async () => {
    const registro: Registro = { bodies: [], urls: [] };

    await drenar(makeClient(fakePesqEle(registro)), semDetalhe);

    const buscaBody = registro.bodies[0]!;
    expect(buscaBody).toContain(`${encodeURIComponent('formPesquisa:eleicoes_input')}=81`);
    expect(buscaBody).toContain(`${encodeURIComponent('formPesquisa:filtroUF_input')}=BR`);
    expect(buscaBody).toContain(`${encodeURIComponent('javax.faces.partial.ajax')}=true`);
    expect(buscaBody).toContain(
      `${encodeURIComponent('javax.faces.ViewState')}=MmZjNGRjNTEwNjcyZjIzYTAwMDAwMDAx`,
    );
  });

  it('pagina com o ViewState NOVO da busca e com _first explícito', async () => {
    const registro: Registro = { bodies: [], urls: [] };

    await drenar(makeClient(fakePesqEle(registro)), semDetalhe);

    const paginacao = registro.bodies.find((b) => b.includes(encodeURIComponent('_pagination')))!;
    expect(paginacao).toContain(
      `${encodeURIComponent('formPesquisa:tabelaPesquisas_first')}=${encodeURIComponent('10')}`,
    );
    expect(paginacao).toContain(
      `${encodeURIComponent('javax.faces.ViewState')}=MmZjNGRjNTEwNjcyZjIzYTAwMDAwMDAx`,
    );
  });

  it('percorre as duas páginas e vê os 20 tse_id, buscando detalhe só do inédito', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    const vistos: string[] = [];

    const registros = await drenar(makeClient(fakePesqEle(registro)), {
      onTseIdSeen: (tseId) => vistos.push(tseId),
      shouldFetchDetalhe: (tseId) => tseId === TSE_PAGINA_1,
    });

    expect(vistos).toHaveLength(20); // TODOS os tse_id são reportados
    expect(vistos[0]).toBe(TSE_PAGINA_1);
    expect(registros).toHaveLength(1); // só o inédito virou registro
    expect(registros[0]?.tseId).toBe(TSE_PAGINA_1);
    expect(registros[0]?.sampleSize).toBe(1200);
    expect(registros[0]?.marginOfError).toBeNull();

    // Um único detalhe ⇒ 2 requisições (POST detalhar + GET detalhar.xhtml).
    expect(registro.urls.filter((u) => u.endsWith(DETAIL_URL))).toHaveLength(1);
  });

  it('busca o detalhe pela linha certa (data-ri) mesmo na página 2', async () => {
    const registro: Registro = { bodies: [], urls: [] };

    const registros = await drenar(makeClient(fakePesqEle(registro)), {
      shouldFetchDetalhe: (tseId) => tseId === TSE_MULTI,
    });

    expect(registros).toHaveLength(1);
    expect(registros[0]?.tseId).toBe(TSE_MULTI);
    // Dois contratantes ⇒ CNPJ ambíguo vira null, nomes preservados.
    expect(registros[0]?.contractorCnpj).toBeNull();
    expect(registros[0]?.contractorName).toContain('EMPRESA FOLHA DA MANHA S.A.');
  });

  it('entrega o corpo bruto de cada documento para virar raw_documents (R3)', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    const brutos: PesqEleRawDocument[] = [];

    await drenar(
      makeClient(fakePesqEle(registro), (d) => brutos.push(d)),
      {
        shouldFetchDetalhe: (tseId) => tseId === TSE_PAGINA_1,
      },
    );

    expect(brutos.map((d) => d.step)).toEqual([
      'lista',
      'busca',
      'detalhe',
      'detalhe',
      'paginacao',
    ]);
    expect(brutos[0]?.fetchedAt).toBe('2026-08-16T12:00:00.000Z');
    expect(brutos[0]?.body.length).toBeGreaterThan(0);
  });
});

describe('PesqEleClient — falha alta em vez de silêncio', () => {
  it('busca válida com ZERO resultado emite ALERTA e não finge sucesso', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    const alertas: PesqEleAlert[] = [];
    const client = makeClient(
      fakePesqEle(registro, { busca: fixture('07-busca-vazia-partial-response.xml') }),
    );

    const registros = await drenar(client, { onAlert: (a) => alertas.push(a) });

    expect(registros).toHaveLength(0);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.kind).toBe('empty_search');
    expect(alertas[0]?.detail).toContain('0 registros');
  });

  it('LANÇA se o rótulo da eleição sumir do <select> (nunca cai num id default)', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    const semEleicao = fixture('01-listar30dias-page.html').replace(
      '<option value="81" data-escape="true">Elei&#231;&#245;es Gerais 2026</option>',
      '',
    );
    const client = makeClient(fakePesqEle(registro, { listPage: semEleicao }));

    await expect(drenar(client)).rejects.toThrow(/Eleições Gerais 2026/);
  });

  it('LANÇA quando a sessão expira (ViewExpiredException), sem repetir em loop', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    const expirada =
      '<?xml version="1.0" encoding="ISO-8859-1"?><partial-response><error>' +
      '<error-name>class javax.faces.application.ViewExpiredException</error-name>' +
      '</error></partial-response>';
    const client = makeClient(fakePesqEle(registro, { busca: expirada }));

    await expect(drenar(client)).rejects.toThrow(PesqEleClientError);

    // Uma tentativa de busca, não um loop de reestabelecimento.
    expect(registro.bodies).toHaveLength(1);
  });

  it('LANÇA se o detalhe trouxer OUTRO registro (índice de linha fora de sincronia)', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    const client = makeClient(
      fakePesqEle(registro, {
        // Sempre devolve o detalhe do BR-07185, inclusive para a linha 0.
        detalheDe: () => fixture('06-detalhe-multi-contratante-BR-07185-2026.html'),
      }),
    );

    await expect(
      drenar(client, { shouldFetchDetalhe: (tseId) => tseId === TSE_PAGINA_1 }),
    ).rejects.toThrow(/fora de sincronia/);
  });

  it('mantém o cookie de sessão em todas as requisições seguintes', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    const cookies: (string | undefined)[] = [];
    const base = fakePesqEle(registro);
    const espiao: FetchLike = (url, init) => {
      cookies.push(init.headers['Cookie']);
      return base(url, init);
    };

    await drenar(makeClient(espiao), semDetalhe);

    expect(cookies[0]).toBeUndefined(); // GET inicial: ainda não há cookie
    expect(cookies.slice(1).every((c) => c === 'JSESSIONID=abc')).toBe(true);
  });
});

describe('PesqEleClient — educação de crawler (docs/04 §6)', () => {
  it('respeita robots.txt: path proibido derruba a coleta em vez de insistir', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    const client = new PesqEleClient({
      http: new HttpClient({
        fetchImpl: fakePesqEle(registro),
        robots: new RobotsCache(() =>
          Promise.resolve({ status: 200, body: 'User-agent: *\nDisallow: /app/' }),
        ),
        rateLimiter: noWaitLimiter(),
        clock: noWaitClock(),
      }),
    });

    await expect(drenar(client)).rejects.toThrow(/robots/i);
  });

  it('não paraleliza: uma requisição por vez, em ordem', async () => {
    const registro: Registro = { bodies: [], urls: [] };
    let emVoo = 0;
    let maxEmVoo = 0;
    const base = fakePesqEle(registro);
    const contando: FetchLike = async (url, init) => {
      emVoo += 1;
      maxEmVoo = Math.max(maxEmVoo, emVoo);
      try {
        return await base(url, init);
      } finally {
        emVoo -= 1;
      }
    };

    await drenar(makeClient(contando), { shouldFetchDetalhe: (t) => t === TSE_PAGINA_1 });

    expect(maxEmVoo).toBe(1);
  });
});
