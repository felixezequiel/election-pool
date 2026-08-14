/**
 * Cliente do PesqEle (docs/04 §2). Cuida do protocolo JSF/MyFaces:
 *
 * 1. GET inicial em `index.xhtml` → estabelece a sessão (cookie JSESSIONID) e
 *    lê o primeiro `javax.faces.ViewState`. A landing traz um `formAviso`
 *    (aviso legal) que é submetido para chegar à busca.
 * 2. POST do filtro: eleição 2026, abrangência nacional (BR), janela dos últimos
 *    30 dias. Reenvia o ViewState corrente; lê o novo da resposta.
 * 3. Paginação também é POST com ViewState (não dá pra pular por URL, docs/04 §2).
 * 4. Se a resposta indicar sessão/ViewState expirado, reestabelece a sessão UMA
 *    vez e repete o passo — sem entrar em loop (docs/04 armadilha).
 *
 * Sequencial por natureza: um POST depende do ViewState do anterior. Nunca
 * paralelizamos requisições ao TSE (docs/04 armadilha). O rate limit de 1
 * req/10s e o robots.txt são impostos pelo `HttpClient` compartilhado.
 *
 * NÃO usa headless browser (CLAUDE.md "O que não fazer").
 */

import type { HttpClient, FetchResponse } from '../http-client.js';
import { extractViewState, isSessionExpired } from './viewstate.js';
import { parseRegistrationPage } from './registration.js';
import type { RawRegistration } from './registration.js';

// docs/04 §2 — filtros fixos do DiscoveryJob.
const ELECTION_YEAR = '2026';
const SCOPE_NATIONAL = 'BR';
const WINDOW_DAYS = 30;

const BASE_URL = 'https://pesqele-divulgacao.tse.jus.br';
const INDEX_PATH = '/index.xhtml';

// Nomes de campo do JSF. O id do PesqEle real muda entre deploys; mantemos os
// nomes canônicos aqui, num único lugar, para o dia em que a estrutura mudar
// (docs/04 §2: "trate mudança de estrutura como evento esperado").
const FIELD = {
  viewState: 'javax.faces.ViewState',
  formSearch: 'formPesquisa',
  election: 'formPesquisa:eleicao',
  scope: 'formPesquisa:abrangencia',
  periodStart: 'formPesquisa:periodoInicio',
  periodEnd: 'formPesquisa:periodoFim',
  searchButton: 'formPesquisa:btnPesquisar',
  pageInput: 'formPesquisa:tabela:pagina',
  avisoForm: 'formAviso',
  avisoSubmit: 'formAviso_SUBMIT',
  avisoAccept: 'formAviso:aceitar',
} as const;

export interface PesqEleClientDeps {
  http: HttpClient;
  /** Relógio injetável para o cálculo da janela de 30 dias (determinismo/teste). */
  now?: () => Date;
  baseUrl?: string;
}

interface Session {
  cookie: string;
  viewState: string;
}

const formatDmy = (d: Date): string => {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
};

/** Coleta os cookies de `set-cookie` numa string `name=value; name=value`. */
const mergeCookies = (existing: string, headers: Headers): string => {
  const jar = new Map<string, string>();
  for (const pair of existing.split(';')) {
    const [k, ...rest] = pair.split('=');
    if (k !== undefined && k.trim().length > 0 && rest.length > 0) {
      jar.set(k.trim(), rest.join('=').trim());
    }
  }
  const setCookie = headers.getSetCookie?.() ?? [];
  for (const raw of setCookie) {
    const first = raw.split(';')[0];
    if (first === undefined) continue;
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
};

const encodeForm = (fields: Record<string, string>): string =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

export class PesqEleClient {
  private readonly http: HttpClient;
  private readonly now: () => Date;
  private readonly baseUrl: string;

  constructor(deps: PesqEleClientDeps) {
    this.http = deps.http;
    this.now = deps.now ?? (() => new Date());
    this.baseUrl = deps.baseUrl ?? BASE_URL;
  }

  /**
   * Percorre TODAS as páginas do resultado filtrado e devolve os registros crus.
   * Sequencial: cada página é um POST que depende do ViewState da anterior.
   * `onPage` é chamado por página, permitindo ao DiscoveryJob persistir em
   * transação por página (falha de rede não corrompe estado).
   */
  async *discover(): AsyncGenerator<RawRegistration[], void, undefined> {
    const session = await this.establishSession();
    // A resposta do filtro JÁ é a primeira página de resultados — não fazemos
    // um GET extra ao TSE só para relê-la (etiqueta, docs/04 §6).
    const firstPageHtml = await this.applyFilters(session);
    const firstPage = parseRegistrationPage(firstPageHtml);
    yield firstPage.registrations;

    for (let page = firstPage.currentPage + 1; page <= firstPage.totalPages; page++) {
      const html = await this.gotoPage(session, page);
      session.viewState = this.readViewState(html, session);
      yield parseRegistrationPage(html).registrations;
    }
  }

  /** GET inicial + submissão do aviso. Devolve cookie + ViewState prontos. */
  private async establishSession(): Promise<Session> {
    const res = await this.http.request({ url: `${this.baseUrl}${INDEX_PATH}`, method: 'GET' });
    const cookie = mergeCookies('', res.headers);
    const viewState = extractViewState(res.body);

    // Se a landing tem o aviso, submete para liberar a busca.
    if (res.body.includes(FIELD.avisoForm)) {
      const accepted = await this.http.request({
        url: `${this.baseUrl}${INDEX_PATH}`,
        method: 'POST',
        headers: { Cookie: cookie },
        body: encodeForm({
          [FIELD.avisoForm]: FIELD.avisoForm,
          [FIELD.avisoSubmit]: '1',
          [FIELD.avisoAccept]: FIELD.avisoAccept,
          [FIELD.viewState]: viewState,
        }),
      });
      const cookie2 = mergeCookies(cookie, accepted.headers);
      return {
        cookie: cookie2,
        viewState: this.readViewState(accepted.body, { cookie, viewState }),
      };
    }
    return { cookie, viewState };
  }

  /**
   * POST do filtro fixo (eleição 2026, BR, últimos 30 dias). Muta `session`
   * (cookie/ViewState) e devolve o HTML da primeira página de resultados.
   */
  private async applyFilters(session: Session): Promise<string> {
    const end = this.now();
    const start = new Date(end.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const res = await this.postJsf(session, {
      [FIELD.formSearch]: FIELD.formSearch,
      [FIELD.election]: ELECTION_YEAR,
      [FIELD.scope]: SCOPE_NATIONAL,
      [FIELD.periodStart]: formatDmy(start),
      [FIELD.periodEnd]: formatDmy(end),
      [FIELD.searchButton]: FIELD.searchButton,
    });
    session.cookie = mergeCookies(session.cookie, res.headers);
    session.viewState = this.readViewState(res.body, session);
    return res.body;
  }

  /** POST de paginação. */
  private async gotoPage(session: Session, page: number): Promise<string> {
    const res = await this.postJsf(session, {
      [FIELD.formSearch]: FIELD.formSearch,
      [FIELD.pageInput]: String(page),
    });
    return res.body;
  }

  /**
   * POST JSF genérico com ViewState. Se a resposta indicar sessão expirada,
   * reestabelece a sessão UMA vez e repete — sem loop.
   */
  private async postJsf(
    session: Session,
    fields: Record<string, string>,
    retriedAfterExpiry = false,
  ): Promise<FetchResponse> {
    const res = await this.http.request({
      url: `${this.baseUrl}${INDEX_PATH}`,
      method: 'POST',
      headers: { Cookie: session.cookie },
      body: encodeForm({ ...fields, [FIELD.viewState]: session.viewState }),
    });

    if (isSessionExpired(res.body)) {
      if (retriedAfterExpiry) {
        throw new Error('Sessão do PesqEle expirou repetidamente; abortando sem loop');
      }
      const fresh = await this.establishSession();
      session.cookie = fresh.cookie;
      session.viewState = fresh.viewState;
      return this.postJsf(session, fields, true);
    }
    return res;
  }

  private readViewState(html: string, previous: Session): string {
    try {
      return extractViewState(html);
    } catch {
      // Mantém o anterior se a resposta parcial não trouxer um novo (raro).
      return previous.viewState;
    }
  }
}
