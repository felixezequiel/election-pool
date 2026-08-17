import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PesqEleClient, PesqEleClientError } from './client.js';
import type {
  DiscoverOptions,
  PesqEleAlert,
  PesqEleRawDocument,
  PesqEleSweepStats,
} from './client.js';
import type { RawRegistration } from './registration.js';
import { HttpClient } from '../http-client.js';
import type { FetchLike, HttpClientClock } from '../http-client.js';
import { RobotsCache } from '../robots.js';
import { PerHostRateLimiter } from '../rate-limiter.js';
import {
  PESQELE_BASE_URL,
  LISTAR_PATH,
  DETALHAR_PATH,
  LIMITE_RESULTADO_DECLARADO,
} from './constants.js';

/**
 * O HTTP é mockado, mas TODA resposta é uma captura real do PesqEle
 * (`__fixtures__/`, 2026-08-16/17). O que este teste prova é o PROTOCOLO e a
 * VARREDURA FATIADA: sessão → filtro e campos de data resolvidos por rótulo →
 * uma busca por fatia → subdivisão quando o total bate no teto → alerta quando
 * nem a fatia de um dia escapa → paginação com o ViewState novo → detalhe só do
 * inédito. A prova de que o protocolo ainda casa com o site ao vivo é o smoke
 * test de `client.live.spec.ts` (opt-in por env).
 */
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const LIST_URL = `${PESQELE_BASE_URL}${LISTAR_PATH}`;
const DETAIL_URL = `${PESQELE_BASE_URL}${DETALHAR_PATH}`;

/** Captura da fatia 10–12/08/2026: 13 registros em 2 páginas (10 + 3). */
const BUSCA_13 = fixture('09-busca-periodo-partial-response.xml');
/** Captura da janela de 30 dias inteira: 50 = NO TETO, e devolvida em `page:1`. */
const BUSCA_NO_TETO = fixture('11-busca-periodo-no-teto-partial-response.xml');
/** Mutação da captura de 13: mesma tabela, zero linha (o caso "fatia vazia"). */
const BUSCA_VAZIA = BUSCA_13.replace('rowCount:13', 'rowCount:0').replace(
  /<tr data-ri="\d+"[\s\S]*?<\/tr>/g,
  '',
);

/** ViewState da sessão capturada em 2026-08-17 (o site repetiu o mesmo em toda
 * resposta desta sessão; a prova de que o cliente RELÊ o novo é o teste do
 * ViewState mutado, mais abaixo). */
const VS_CAPTURA = 'YThjYmVhMmJhZjVmMjY0YjAwMDAwMDAx';

const TSE_LINHA_0 = 'BR-09275/2026'; // data-ri=0 da fatia de 3 dias, detalhe em 12-...
const TSE_LINHA_10 = 'BR-01495/2026'; // data-ri=10 (página 2), detalhe em 13-...

/** As `<tr>` REAIS de uma captura, para montar fragmentos de paginação. */
const linhasDe = (xml: string): string[] =>
  [...xml.matchAll(/<tr data-ri="\d+"[\s\S]*?<\/tr>/g)].map((m) => m[0]);

/**
 * Fragmento de paginação: o envelope `<partial-response>` REAL da captura 10, com
 * as `<tr>` trocadas pelas de outra captura e o `data-ri` deslocado para a página
 * pedida. É mutação de captura real, não HTML inventado — o PesqEle devolve
 * exatamente esta forma (só as linhas, sem cabeçalho) em toda paginação.
 */
const fragmentoDePaginacao = (linhas: readonly string[], first: number): string => {
  const corpo = linhas
    .map((tr, i) => tr.replace(/data-ri="\d+"/, `data-ri="${first + i}"`))
    .join('');
  return fixture('10-paginacao-periodo-pagina2-partial-response.xml').replace(
    /(<update id="formPesquisa:tabelaPesquisas"><!\[CDATA\[)[\s\S]*?(\]\]><\/update>)/,
    (_todo, abre: string, fecha: string) => `${abre}${corpo}${fecha}`,
  );
};

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
  /** Períodos pedidos, na ordem, como 'DD/MM/AAAA..DD/MM/AAAA'. */
  periodos: string[];
}

const novoRegistro = (): Registro => ({ bodies: [], urls: [], periodos: [] });

/** Corpo urlencoded → mapa de campos (o fake precisa ler o período pedido). */
const camposDoCorpo = (body: string): Map<string, string> => {
  const campos = new Map<string, string>();
  for (const par of body.split('&')) {
    const eq = par.indexOf('=');
    if (eq <= 0) continue;
    campos.set(decodeURIComponent(par.slice(0, eq)), decodeURIComponent(par.slice(eq + 1)));
  }
  return campos;
};

interface FakeOptions {
  listPage?: string;
  /** Resposta da busca em função do período pedido. Default: sempre a de 13. */
  buscaDoPeriodo?: (inicio: string, fim: string) => string;
  /** Resposta da paginação em função do `_first` pedido. Default: a captura 10. */
  paginacaoDoFirst?: (first: number) => string;
  detalheDe?: (rowIndex: number) => string;
}

/** Servidor falso que segue o protocolo real do PesqEle em `listar.xhtml`. */
const fakePesqEle = (registro: Registro, overrides: FakeOptions = {}): FetchLike => {
  const listPage = overrides.listPage ?? fixture('08-listar-periodo-page.html');
  const buscaDoPeriodo = overrides.buscaDoPeriodo ?? (() => BUSCA_13);
  const paginacaoDoFirst =
    overrides.paginacaoDoFirst ??
    (() => fixture('10-paginacao-periodo-pagina2-partial-response.xml'));
  const detalheDe =
    overrides.detalheDe ??
    ((rowIndex: number) =>
      rowIndex === 10
        ? fixture('13-detalhe-pagina2-BR-01495-2026.html')
        : fixture('12-detalhe-BR-09275-2026.html'));

  // A ação `detalhar` só diz QUAL linha; o registro concreto vem do GET seguinte.
  let ultimaLinha = 0;

  return (url, init) => {
    registro.urls.push(`${init.method} ${url}`);
    if (init.method === 'GET' && url === LIST_URL) {
      return ok(listPage, url, { 'set-cookie': 'JSESSIONID=abc; path=/' });
    }
    if (init.method === 'GET' && url === DETAIL_URL) {
      return ok(detalheDe(ultimaLinha), url);
    }
    const body = init.body ?? '';
    registro.bodies.push(body);
    const campos = camposDoCorpo(body);
    const inicio = campos.get('formPesquisa:j_id_2n_input') ?? '';
    const fim = campos.get('formPesquisa:j_id_2p_input') ?? '';

    const source = campos.get('javax.faces.source') ?? '';
    const acao = /tabelaPesquisas:(\d+):detalhar/.exec(source);
    if (acao !== null) {
      ultimaLinha = Number(acao[1]);
      return ok(fixture('04-detalhar-redirect-partial-response.xml'), url);
    }
    if (campos.has('formPesquisa:tabelaPesquisas_pagination')) {
      return ok(paginacaoDoFirst(Number(campos.get('formPesquisa:tabelaPesquisas_first'))), url);
    }
    registro.periodos.push(`${inicio}..${fim}`);
    return ok(buscaDoPeriodo(inicio, fim), url);
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
    // 17/08/2026 é a data das medições que motivaram T-28; a janela default vai
    // de 19/07 a 17/08.
    now: () => new Date('2026-08-17T12:00:00Z'),
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
/** Uma fatia só, para os testes que olham o comportamento por fatia. */
const umaFatia: DiscoverOptions = { janelaDias: 3, larguraFatiaDias: 3 };

describe('PesqEleClient — protocolo real (listar.xhtml + AJAX PrimeFaces)', () => {
  it('abre a sessão na busca por período, NÃO em index.xhtml nem na tela de 30 dias', async () => {
    const registro = novoRegistro();

    await drenar(makeClient(fakePesqEle(registro)), { ...umaFatia, ...semDetalhe });

    expect(registro.urls[0]).toBe(`GET ${LIST_URL}`);
    expect(registro.urls.join(' ')).not.toContain('index.xhtml');
    expect(registro.urls.join(' ')).not.toContain('listar30dias');
  });

  it('envia os filtros e o PERÍODO resolvidos por rótulo, com o ViewState da página', async () => {
    const registro = novoRegistro();

    await drenar(makeClient(fakePesqEle(registro)), { ...umaFatia, ...semDetalhe });

    const buscaBody = registro.bodies[0]!;
    expect(buscaBody).toContain(`${encodeURIComponent('formPesquisa:eleicoes_input')}=81`);
    expect(buscaBody).toContain(`${encodeURIComponent('formPesquisa:filtroUF_input')}=BR`);
    // Os dois campos de data são os `j_id_*` resolvidos a partir do rótulo
    // "Período de registro" — não uma constante no código.
    expect(buscaBody).toContain(
      `${encodeURIComponent('formPesquisa:j_id_2n_input')}=${encodeURIComponent('15/08/2026')}`,
    );
    expect(buscaBody).toContain(
      `${encodeURIComponent('formPesquisa:j_id_2p_input')}=${encodeURIComponent('17/08/2026')}`,
    );
    expect(buscaBody).toContain(`${encodeURIComponent('javax.faces.partial.ajax')}=true`);
    expect(buscaBody).toContain(`${encodeURIComponent('javax.faces.ViewState')}=${VS_CAPTURA}`);
  });

  it('cobre a janela de 30 dias em 10 fatias contíguas, da mais antiga à mais recente', async () => {
    const registro = novoRegistro();

    const stats: PesqEleSweepStats[] = [];
    await drenar(makeClient(fakePesqEle(registro, { buscaDoPeriodo: () => BUSCA_VAZIA })), {
      onSweepStats: (s) => stats.push(s),
    });

    expect(registro.periodos).toHaveLength(10);
    expect(registro.periodos[0]).toBe('19/07/2026..21/07/2026');
    expect(registro.periodos[9]).toBe('15/08/2026..17/08/2026');
    expect(stats[0]?.janela).toEqual({ inicio: '2026-07-19', fim: '2026-08-17' });
    expect(stats[0]?.fatias).toBe(10);
  });

  it('pagina com o ViewState NOVO da busca, com _first explícito e com o período da fatia', async () => {
    const registro = novoRegistro();

    await drenar(makeClient(fakePesqEle(registro)), { ...umaFatia, ...semDetalhe });

    const paginacao = registro.bodies.find((b) => b.includes(encodeURIComponent('_pagination')))!;
    expect(paginacao).toContain(
      `${encodeURIComponent('formPesquisa:tabelaPesquisas_first')}=${encodeURIComponent('10')}`,
    );
    expect(paginacao).toContain(`${encodeURIComponent('javax.faces.ViewState')}=${VS_CAPTURA}`);
    // Sem o período na paginação o JSF re-decodificaria o formulário sem filtro e
    // a página 2 viria de outro resultado.
    expect(paginacao).toContain(
      `${encodeURIComponent('formPesquisa:j_id_2n_input')}=${encodeURIComponent('15/08/2026')}`,
    );
  });

  it('RELÊ o ViewState da resposta da busca e é ele que vai na paginação', async () => {
    const registro = novoRegistro();
    const vsNovo = 'Vmlld1N0YXRlTm92bzAwMDAwMDAx';
    const buscaComVsNovo = BUSCA_13.replaceAll(VS_CAPTURA, vsNovo);

    await drenar(makeClient(fakePesqEle(registro, { buscaDoPeriodo: () => buscaComVsNovo })), {
      ...umaFatia,
      ...semDetalhe,
    });

    const paginacao = registro.bodies.find((b) => b.includes(encodeURIComponent('_pagination')))!;
    // Reenviar o ViewState velho derruba a sessão, e o sintoma é uma página vazia
    // — indistinguível de "não há resultado" (T-15).
    expect(paginacao).toContain(`${encodeURIComponent('javax.faces.ViewState')}=${vsNovo}`);
    expect(paginacao).not.toContain(VS_CAPTURA);
  });

  it('percorre as duas páginas da fatia e vê os 13 tse_id, buscando detalhe só do inédito', async () => {
    const registro = novoRegistro();
    const vistos: string[] = [];

    const registros = await drenar(makeClient(fakePesqEle(registro)), {
      ...umaFatia,
      onTseIdSeen: (tseId) => vistos.push(tseId),
      shouldFetchDetalhe: (tseId) => tseId === TSE_LINHA_0,
    });

    expect(vistos).toHaveLength(13); // TODOS os tse_id são reportados
    expect(vistos[0]).toBe(TSE_LINHA_0);
    expect(registros).toHaveLength(1); // só o inédito virou registro
    expect(registros[0]?.tseId).toBe(TSE_LINHA_0);
    expect(registros[0]?.sampleSize).toBe(1600);
    expect(registros[0]?.marginOfError).toBeNull();
    // O `raceLabel` vem do DETALHE: a lista por período não tem coluna de cargo.
    expect(registros[0]?.raceLabel).toBe('Presidente');

    // Um único detalhe ⇒ 2 requisições (POST detalhar + GET detalhar.xhtml).
    expect(registro.urls.filter((u) => u.endsWith(DETAIL_URL))).toHaveLength(1);
  });

  it('busca o detalhe pela linha certa (data-ri global) mesmo na página 2', async () => {
    const registro = novoRegistro();

    const registros = await drenar(makeClient(fakePesqEle(registro)), {
      ...umaFatia,
      shouldFetchDetalhe: (tseId) => tseId === TSE_LINHA_10,
    });

    expect(registros).toHaveLength(1);
    expect(registros[0]?.tseId).toBe(TSE_LINHA_10);
    expect(registros[0]?.sampleSize).toBeGreaterThan(0);
  });

  it('não pula a página 0 quando a busca volta em page:1 (a DataTable guarda a página)', async () => {
    const registro = novoRegistro();
    const vistos: string[] = [];

    // BUSCA_NO_TETO é a captura real de uma busca feita depois de paginar: ela
    // volta com `page:1`. Se o cliente assumisse `page:0`, as 10 primeiras linhas
    // do resultado desapareceriam sem nenhum sinal.
    await drenar(
      makeClient(
        fakePesqEle(registro, {
          buscaDoPeriodo: () => BUSCA_NO_TETO,
          paginacaoDoFirst: (first) => fragmentoDePaginacao(linhasDe(BUSCA_NO_TETO), first),
        }),
      ),
      {
        janelaDias: 1,
        larguraFatiaDias: 1,
        onTseIdSeen: (tseId) => vistos.push(tseId),
        shouldFetchDetalhe: () => false,
      },
    );

    const firsts = registro.bodies
      .filter((b) => b.includes(encodeURIComponent('_pagination')))
      .map((b) => camposDoCorpo(b).get('formPesquisa:tabelaPesquisas_first'));
    // 5 páginas no total (50/10); a página 1 já veio na busca, então são pedidas
    // as páginas 0, 2, 3 e 4 — a página 0 INCLUÍDA.
    expect(firsts).toEqual(['0', '20', '30', '40']);
    expect(vistos).toHaveLength(50);
  });

  it('entrega o corpo bruto de cada documento para virar raw_documents (R3)', async () => {
    const registro = novoRegistro();
    const brutos: PesqEleRawDocument[] = [];

    await drenar(
      makeClient(fakePesqEle(registro), (d) => brutos.push(d)),
      {
        ...umaFatia,
        shouldFetchDetalhe: (tseId) => tseId === TSE_LINHA_0,
      },
    );

    expect(brutos.map((d) => d.step)).toEqual([
      'lista',
      'busca',
      'detalhe',
      'detalhe',
      'paginacao',
    ]);
    expect(brutos[0]?.fetchedAt).toBe('2026-08-17T12:00:00.000Z');
    expect(brutos[0]?.body.length).toBeGreaterThan(0);
  });
});

describe('PesqEleClient — teto de 50 registros: subdividir e, no limite, ALERTAR', () => {
  /** Resposta no teto para fatia larga; a de 13 registros para fatia de 1 dia. */
  const tetoAcimaDeUmDia = (inicio: string, fim: string): string =>
    inicio === fim ? BUSCA_13 : BUSCA_NO_TETO;

  it('SUBDIVIDE a fatia que volta no teto, em vez de aceitar o total truncado', async () => {
    const registro = novoRegistro();
    const alertas: PesqEleAlert[] = [];
    const stats: PesqEleSweepStats[] = [];

    await drenar(makeClient(fakePesqEle(registro, { buscaDoPeriodo: tetoAcimaDeUmDia })), {
      ...umaFatia,
      ...semDetalhe,
      onAlert: (a) => alertas.push(a),
      onSweepStats: (s) => stats.push(s),
    });

    // Fatia de 3 dias no teto ⇒ metades 15/08 e 16–17/08; a de 2 dias ainda no
    // teto ⇒ 16/08 e 17/08. As de um dia escapam do teto e são colhidas.
    expect(registro.periodos).toEqual([
      '15/08/2026..17/08/2026',
      '15/08/2026..15/08/2026',
      '16/08/2026..17/08/2026',
      '16/08/2026..16/08/2026',
      '17/08/2026..17/08/2026',
    ]);
    expect(stats[0]?.fatiasNoTeto).toBe(2);
    expect(stats[0]?.truncagensSuspeitas).toBe(0);
    // Nenhuma truncagem sobrou sem resolver ⇒ nenhum alerta.
    expect(alertas).toEqual([]);
  });

  it('a fatia no teto NÃO é colhida pela mãe (as filhas cobrem o mesmo período)', async () => {
    const registro = novoRegistro();
    const stats: PesqEleSweepStats[] = [];

    await drenar(makeClient(fakePesqEle(registro, { buscaDoPeriodo: tetoAcimaDeUmDia })), {
      ...umaFatia,
      ...semDetalhe,
      onSweepStats: (s) => stats.push(s),
    });

    // 3 fatias de um dia × 13 linhas da captura = 39 linhas lidas. Se a fatia mãe
    // (truncada) também fosse colhida, entrariam mais 50 linhas de um total que
    // sabemos incompleto.
    expect(stats[0]?.linhasVistas).toBe(39);
    expect(stats[0]?.tseIdsDistintos).toBe(13); // a captura repetida é a mesma
  });

  it('fatia de UM DIA ainda no teto ⇒ ALERTA truncation_suspected e o total é um PISO', async () => {
    const registro = novoRegistro();
    const alertas: PesqEleAlert[] = [];
    const stats: PesqEleSweepStats[] = [];
    const vistos: string[] = [];

    await drenar(
      makeClient(
        fakePesqEle(registro, {
          buscaDoPeriodo: () => BUSCA_NO_TETO,
          paginacaoDoFirst: (first) => fragmentoDePaginacao(linhasDe(BUSCA_NO_TETO), first),
        }),
      ),
      {
        janelaDias: 1,
        larguraFatiaDias: 1,
        ...semDetalhe,
        onAlert: (a) => alertas.push(a),
        onSweepStats: (s) => stats.push(s),
        onTseIdSeen: (t) => vistos.push(t),
      },
    );

    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.kind).toBe('truncation_suspected');
    expect(alertas[0]?.detail).toContain('17/08/2026');
    expect(alertas[0]?.detail).toContain('PISO');
    expect(stats[0]?.truncagensSuspeitas).toBe(1);
    expect(stats[0]?.fatiasNoTeto).toBe(1);
    // Mesmo suspeito de truncagem, o que é visível continua sendo colhido: dado a
    // menos seria pior que dado parcial declarado.
    expect(vistos).toHaveLength(50);
  });

  it('reporta a contagem quando quem consome ABANDONA a varredura no meio', async () => {
    const registro = novoRegistro();
    const stats: PesqEleSweepStats[] = [];
    const client = makeClient(fakePesqEle(registro));

    // `break` num `for await` chama `.return()` do generator: quem para no meio
    // (o smoke test ao vivo faz isso) também precisa saber até onde se chegou.
    for await (const pagina of client.discover({
      ...semDetalhe,
      onSweepStats: (s) => stats.push(s),
    })) {
      void pagina;
      break;
    }

    expect(stats).toHaveLength(1);
    expect(stats[0]?.fatias).toBe(1);
    expect(stats[0]?.tseIdsDistintos).toBe(10); // só a primeira página da 1ª fatia
  });

  it('usa o teto DECLARADO pela resposta e alerta quando ele não é o esperado', async () => {
    const registro = novoRegistro();
    const alertas: PesqEleAlert[] = [];
    const outroTeto = BUSCA_13.replace('limitado a 50 registros', 'limitado a 13 registros');

    await drenar(makeClient(fakePesqEle(registro, { buscaDoPeriodo: () => outroTeto })), {
      janelaDias: 1,
      larguraFatiaDias: 1,
      ...semDetalhe,
      onAlert: (a) => alertas.push(a),
    });

    // O total (13) passou a ser o próprio teto declarado ⇒ suspeita de truncagem…
    expect(alertas.map((a) => a.kind)).toEqual(['limit_mismatch', 'truncation_suspected']);
    expect(alertas[0]?.detail).toContain('13');
    expect(alertas[0]?.detail).toContain(String(LIMITE_RESULTADO_DECLARADO));
  });

  it('teto que sumiu da página alerta uma ÚNICA vez e cai na constante conhecida', async () => {
    const registro = novoRegistro();
    const alertas: PesqEleAlert[] = [];
    const semAviso = BUSCA_13.replace(/O resultado da consulta est[\s\S]{0,80}?registros\./, '');

    const stats: PesqEleSweepStats[] = [];
    await drenar(makeClient(fakePesqEle(registro, { buscaDoPeriodo: () => semAviso })), {
      ...semDetalhe,
      onAlert: (a) => alertas.push(a),
      onSweepStats: (s) => stats.push(s),
    });

    // 10 fatias, um único alerta (não dez avisos iguais no log).
    expect(stats[0]?.fatias).toBe(10);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.kind).toBe('limit_mismatch');
    expect(stats[0]?.limiteDeclarado).toBeNull();
  });

  it('contagem da varredura fecha: fatias, linhas, distintos e teto declarado', async () => {
    const registro = novoRegistro();
    const stats: PesqEleSweepStats[] = [];

    await drenar(makeClient(fakePesqEle(registro)), {
      ...semDetalhe,
      onSweepStats: (s) => stats.push(s),
    });

    expect(stats).toHaveLength(1);
    expect(stats[0]).toEqual({
      janela: { inicio: '2026-07-19', fim: '2026-08-17' },
      fatias: 10,
      fatiasNoTeto: 0,
      truncagensSuspeitas: 0,
      linhasVistas: 130, // 10 fatias × 13 linhas da mesma captura
      tseIdsDistintos: 13,
      limiteDeclarado: LIMITE_RESULTADO_DECLARADO,
    });
  });

  it('reporta a contagem mesmo quando a varredura MORRE no meio', async () => {
    const registro = novoRegistro();
    const stats: PesqEleSweepStats[] = [];
    const explodeNaSegunda = (() => {
      let n = 0;
      return (): string => {
        n += 1;
        if (n === 2)
          return '<partial-response><error><error-name>boom</error-name></error></partial-response>';
        return BUSCA_13;
      };
    })();

    await expect(
      drenar(makeClient(fakePesqEle(registro, { buscaDoPeriodo: explodeNaSegunda })), {
        ...semDetalhe,
        onSweepStats: (s) => stats.push(s),
      }),
    ).rejects.toThrow(PesqEleClientError);

    expect(stats).toHaveLength(1);
    expect(stats[0]?.fatias).toBe(1); // até onde deu tempo de chegar
    expect(stats[0]?.tseIdsDistintos).toBe(13);
  });
});

describe('PesqEleClient — falha alta em vez de silêncio', () => {
  it('varredura inteira com ZERO resultado emite ALERTA e não finge sucesso', async () => {
    const registro = novoRegistro();
    const alertas: PesqEleAlert[] = [];
    const client = makeClient(fakePesqEle(registro, { buscaDoPeriodo: () => BUSCA_VAZIA }));

    const registros = await drenar(client, { onAlert: (a) => alertas.push(a) });

    expect(registros).toHaveLength(0);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.kind).toBe('empty_search');
    expect(alertas[0]?.detail).toContain('0 registros');
    expect(alertas[0]?.detail).toContain('10 fatia');
  });

  it('fatia vazia no meio da varredura NÃO é alerta (nem todo trio de dias tem registro)', async () => {
    const registro = novoRegistro();
    const alertas: PesqEleAlert[] = [];

    await drenar(
      makeClient(
        fakePesqEle(registro, {
          buscaDoPeriodo: (inicio) => (inicio === '19/07/2026' ? BUSCA_13 : BUSCA_VAZIA),
        }),
      ),
      { ...semDetalhe, onAlert: (a) => alertas.push(a) },
    );

    expect(alertas).toEqual([]);
  });

  it('LANÇA se o rótulo da eleição sumir do <select> (nunca cai num id default)', async () => {
    const registro = novoRegistro();
    const semEleicao = fixture('08-listar-periodo-page.html').replace(
      '<option value="81" data-escape="true">Elei&#231;&#245;es Gerais 2026</option>',
      '',
    );
    const client = makeClient(fakePesqEle(registro, { listPage: semEleicao }));

    await expect(drenar(client, umaFatia)).rejects.toThrow(/Eleições Gerais 2026/);
  });

  it('LANÇA se o rótulo do período sumir (busca sem período voltaria truncada)', async () => {
    const registro = novoRegistro();
    const semPeriodo = fixture('08-listar-periodo-page.html').replace(
      /Per&#237;odo de registro/g,
      'Outro filtro',
    );
    const client = makeClient(fakePesqEle(registro, { listPage: semPeriodo }));

    await expect(drenar(client, umaFatia)).rejects.toThrow(/Período de registro/);
  });

  it('LANÇA quando a sessão expira (ViewExpiredException), sem repetir em loop', async () => {
    const registro = novoRegistro();
    const expirada =
      '<?xml version="1.0" encoding="ISO-8859-1"?><partial-response><error>' +
      '<error-name>class javax.faces.application.ViewExpiredException</error-name>' +
      '</error></partial-response>';
    const client = makeClient(fakePesqEle(registro, { buscaDoPeriodo: () => expirada }));

    await expect(drenar(client, umaFatia)).rejects.toThrow(PesqEleClientError);

    // Uma tentativa de busca, não um loop de reestabelecimento.
    expect(registro.bodies).toHaveLength(1);
  });

  it('LANÇA se o detalhe trouxer OUTRO registro (índice de linha fora de sincronia)', async () => {
    const registro = novoRegistro();
    const client = makeClient(
      fakePesqEle(registro, {
        // Sempre devolve o detalhe da linha 10, inclusive para a linha 0.
        detalheDe: () => fixture('13-detalhe-pagina2-BR-01495-2026.html'),
      }),
    );

    await expect(
      drenar(client, { ...umaFatia, shouldFetchDetalhe: (tseId) => tseId === TSE_LINHA_0 }),
    ).rejects.toThrow(/fora de sincronia/);
  });

  it('mantém o cookie de sessão em todas as requisições seguintes', async () => {
    const registro = novoRegistro();
    const cookies: (string | undefined)[] = [];
    const base = fakePesqEle(registro);
    const espiao: FetchLike = (url, init) => {
      cookies.push(init.headers['Cookie']);
      return base(url, init);
    };

    await drenar(makeClient(espiao), { ...umaFatia, ...semDetalhe });

    expect(cookies[0]).toBeUndefined(); // GET inicial: ainda não há cookie
    expect(cookies.slice(1).every((c) => c === 'JSESSIONID=abc')).toBe(true);
  });
});

describe('PesqEleClient — educação de crawler (docs/04 §6)', () => {
  it('respeita robots.txt: path proibido derruba a coleta em vez de insistir', async () => {
    const registro = novoRegistro();
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

    await expect(drenar(client, umaFatia)).rejects.toThrow(/robots/i);
  });

  it('não paraleliza: uma requisição por vez, em ordem', async () => {
    const registro = novoRegistro();
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

    await drenar(makeClient(contando), {
      ...umaFatia,
      shouldFetchDetalhe: (t) => t === TSE_LINHA_0,
    });

    expect(maxEmVoo).toBe(1);
  });

  it('a varredura da janela de 30 dias custa ~20 requisições, não centenas', async () => {
    const registro = novoRegistro();

    await drenar(makeClient(fakePesqEle(registro)), semDetalhe);

    // 1 GET inicial + 10 buscas + 10 paginações (2 páginas por fatia). A 1 req/10s
    // isso é ~3,5 min de ciclo — a conta que está documentada em FATIA_DIAS.
    expect(registro.urls).toHaveLength(21);
  });
});
