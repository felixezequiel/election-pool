/**
 * Cliente do PesqEle (docs/04 §2), escrito contra o protocolo REAL capturado ao
 * vivo em 2026-08-16 (PesqEle Público 3.9.2). O diagnóstico da versão anterior —
 * que assumia uma estrutura inexistente e terminava com `seen=0` sem erro — está
 * em `docs/OPEN-QUESTIONS.md` Q-09.
 *
 * Sequência (uma requisição por vez, nunca em paralelo):
 *
 * 1. `GET /app/pesquisa/listar30dias.xhtml` — abre a sessão (cookies) e traz o
 *    formulário de busca, o primeiro ViewState e os `<select>` de filtro.
 *    NÃO passamos por `/index.xhtml`: é só o menu, não tem busca.
 * 2. Resolve, POR RÓTULO, o valor da eleição ("Eleições Gerais 2026") e da
 *    abrangência ("BRASIL"). Rótulo ausente ⇒ LANÇA — id errado devolveria a
 *    eleição errada em silêncio.
 * 3. `POST` AJAX do botão de busca ⇒ `<partial-response>` com a tabela em CDATA
 *    e o ViewState NOVO noutro `<update>`.
 * 4. Paginação: `POST` AJAX da DataTable (`_pagination/_first/_rows`). A resposta
 *    traz SÓ as `<tr>` da página pedida.
 * 5. Detalhe (só para `tse_id` inédito): `POST` AJAX `...:<ri>:detalhar` ⇒
 *    `<redirect url="/app/pesquisa/detalhar.xhtml">` ⇒ `GET` nessa URL.
 *
 * O ViewState é relido a CADA resposta. Robots, 1 req/10s, timeout e retries são
 * do `HttpClient` compartilhado (docs/04 §6). Sem headless browser (CLAUDE.md).
 *
 * Custo (Q-09, opção (a) recomendada): o detalhe custa 2 requisições por
 * registro; a 1 req/10s, colher os 50 do dia levaria ~17 min. Por isso o detalhe
 * só é buscado para `tse_id` inédito — o `tse_id` já visto não muda, e o upsert
 * do DiscoveryJob já é idempotente.
 */

import type { HttpClient } from '../http-client.js';
import {
  PESQELE_BASE_URL,
  LISTAR_30_DIAS_PATH,
  DETALHAR_PATH,
  ELEICAO_LABEL,
  ABRANGENCIA_LABEL,
  FIELD,
  AJAX,
  AJAX_HEADERS,
} from './constants.js';
import { parsePartialResponse, requireUpdate } from './partial-response.js';
import type { PartialResponse } from './partial-response.js';
import {
  extractViewStateFromHtml,
  extractViewStateFromPartial,
  isSessionExpired,
} from './viewstate.js';
import { resolveOptionValue } from './select-options.js';
import {
  parseTabelaResultado,
  parseLinhasLista,
  parseDetalhe,
  toRawRegistration,
} from './registration.js';
import type {
  PesqEleDetalhe,
  PesqEleLinhaLista,
  PesqEleTabelaResultado,
  RawRegistration,
} from './registration.js';

export class PesqEleClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PesqEleClientError';
  }
}

/**
 * Alerta do cliente. Existe por causa da armadilha central de T-05: busca válida
 * que volta VAZIA é indistinguível de filtro errado se ninguém reclamar. Foi o
 * silêncio que escondeu o bug por uma task inteira.
 */
export interface PesqEleAlert {
  kind: 'empty_search';
  detail: string;
}

/** Documento bruto buscado, para virar `raw_documents` (R3: proveniência). */
export interface PesqEleRawDocument {
  url: string;
  /** 'lista' | 'busca' | 'paginacao' | 'detalhe' — o passo que o produziu. */
  step: 'lista' | 'busca' | 'paginacao' | 'detalhe';
  body: string;
  fetchedAt: string;
}

export interface DiscoverOptions {
  /**
   * `false` ⇒ o detalhe NÃO é buscado e o registro não é emitido (mas o `tse_id`
   * ainda é reportado por `onTseIdSeen`, para não ser marcado como expirado).
   * Ausente ⇒ busca o detalhe de todos (o cliente sozinho não sabe o que já
   * existe no banco).
   */
  shouldFetchDetalhe?: (tseId: string) => boolean | Promise<boolean>;
  /** Chamado para TODO `tse_id` visto na lista, inclusive os já conhecidos. */
  onTseIdSeen?: (tseId: string) => void;
  onAlert?: (alert: PesqEleAlert) => void;
}

export interface PesqEleClientDeps {
  http: HttpClient;
  baseUrl?: string;
  now?: () => Date;
  /** Recebe o corpo bruto de cada documento (R3: evidência de proveniência). */
  onRawDocument?: (doc: PesqEleRawDocument) => void | Promise<void>;
}

interface Session {
  cookie: string;
  viewState: string;
  /** Valores resolvidos por rótulo, reenviados em todo POST do formulário. */
  eleicaoValue: string;
  abrangenciaValue: string;
}

const encodeForm = (fields: Record<string, string>): string =>
  Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

/** Junta `set-cookie` num header `Cookie` (JSESSIONID, sticky, BIGipServer, TS…). */
const mergeCookies = (existing: string, headers: Headers): string => {
  const jar = new Map<string, string>();
  for (const pair of existing.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  for (const raw of headers.getSetCookie?.() ?? []) {
    const first = raw.split(';')[0];
    if (first === undefined) continue;
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
};

export class PesqEleClient {
  private readonly http: HttpClient;
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly onRawDocument: ((doc: PesqEleRawDocument) => void | Promise<void>) | undefined;

  constructor(deps: PesqEleClientDeps) {
    this.http = deps.http;
    this.baseUrl = deps.baseUrl ?? PESQELE_BASE_URL;
    this.now = deps.now ?? (() => new Date());
    this.onRawDocument = deps.onRawDocument;
  }

  /**
   * Percorre TODAS as páginas do filtro (eleição 2026 / BRASIL / últimos 30 dias)
   * e emite UMA PÁGINA por vez, para o DiscoveryJob persistir em transação por
   * página. Só entram no array os registros com detalhe buscado (inéditos); os
   * já conhecidos são reportados por `onTseIdSeen`.
   */
  async *discover(
    options: DiscoverOptions = {},
  ): AsyncGenerator<RawRegistration[], void, undefined> {
    const session = await this.abrirSessao();
    const tabela = await this.buscar(session);

    if (tabela.paginador.totalRecords === 0) {
      // Filtro válido + zero resultado NÃO é sucesso: ou a janela de 30 dias está
      // realmente vazia, ou o filtro deixou de casar. Quem chama precisa saber.
      options.onAlert?.({
        kind: 'empty_search',
        detail: `Busca com eleição "${ELEICAO_LABEL}" e abrangência "${ABRANGENCIA_LABEL}" devolveu 0 registros`,
      });
      return;
    }

    yield await this.comDetalhe(session, tabela.linhas, options);

    const { totalRecords, rowsPerPage } = tabela.paginador;
    const totalPaginas = Math.ceil(totalRecords / rowsPerPage);
    for (let pagina = 1; pagina < totalPaginas; pagina++) {
      const esperado = Math.min(rowsPerPage, totalRecords - pagina * rowsPerPage);
      const linhas = await this.irParaPagina(session, pagina, rowsPerPage, esperado);
      yield await this.comDetalhe(session, linhas, options);
    }
  }

  /** Passo 1+2: sessão, ViewState inicial e valores de filtro resolvidos por rótulo. */
  private async abrirSessao(): Promise<Session> {
    const url = `${this.baseUrl}${LISTAR_30_DIAS_PATH}`;
    const res = await this.http.request({ url, method: 'GET' });
    await this.registrarBruto('lista', url, res.body);

    return {
      cookie: mergeCookies('', res.headers),
      viewState: extractViewStateFromHtml(res.body),
      eleicaoValue: resolveOptionValue(res.body, FIELD.eleicaoSelect, ELEICAO_LABEL),
      abrangenciaValue: resolveOptionValue(res.body, FIELD.abrangenciaSelect, ABRANGENCIA_LABEL),
    };
  }

  /** Campos do formulário reenviados em todo POST (o JSF re-decodifica o form). */
  private camposFiltro(session: Session): Record<string, string> {
    return {
      [FIELD.form]: FIELD.form,
      [FIELD.eleicaoSelect]: session.eleicaoValue,
      [FIELD.abrangenciaSelect]: session.abrangenciaValue,
      [FIELD.cidadesSelect]: '',
      [FIELD.formSubmit]: '1',
    };
  }

  /** Passo 3: POST do botão de busca. Devolve a tabela completa da página 1. */
  private async buscar(session: Session): Promise<PesqEleTabelaResultado> {
    const partial = await this.postAjax(session, 'busca', {
      [AJAX.partial]: 'true',
      [AJAX.source]: FIELD.botaoPesquisar,
      [AJAX.execute]: FIELD.form,
      [AJAX.render]: FIELD.form,
      [FIELD.botaoPesquisar]: FIELD.botaoPesquisar,
      ...this.camposFiltro(session),
    });
    return parseTabelaResultado(requireUpdate(partial, FIELD.form));
  }

  /**
   * Passo 4: paginação da DataTable. `first` é o índice global da primeira linha
   * da página (base 0) e vai EXPLÍCITO na requisição — não dependemos do estado
   * de página guardado no servidor.
   */
  private async irParaPagina(
    session: Session,
    pagina: number,
    rowsPerPage: number,
    esperado: number,
  ): Promise<PesqEleLinhaLista[]> {
    const partial = await this.postAjax(session, 'paginacao', {
      [AJAX.partial]: 'true',
      [AJAX.source]: FIELD.tabela,
      [AJAX.execute]: FIELD.tabela,
      [AJAX.render]: FIELD.tabela,
      [AJAX.behaviorEvent]: 'page',
      [AJAX.partialEvent]: 'page',
      [`${FIELD.tabela}_pagination`]: 'true',
      [`${FIELD.tabela}_first`]: String(pagina * rowsPerPage),
      [`${FIELD.tabela}_rows`]: String(rowsPerPage),
      [`${FIELD.tabela}_skipChildren`]: 'true',
      [`${FIELD.tabela}_encodeFeature`]: 'true',
      ...this.camposFiltro(session),
    });

    // A resposta da paginação re-renderiza SÓ a DataTable (um fragmento de `<tr>`).
    const linhas = parseLinhasLista(requireUpdate(partial, FIELD.tabela));
    if (linhas.length !== esperado) {
      // Contagem diferente da prometida pelo paginador significa que o conjunto
      // mudou embaixo de nós (registro novo entrou no meio da coleta) e que os
      // índices de linha já não valem. Abortar é o certo: o run seguinte
      // recomeça e as páginas já persistidas continuam válidas (transação por
      // página). Seguir adiante atribuiria detalhe ao registro errado.
      throw new PesqEleClientError(
        `Página ${pagina} voltou com ${linhas.length} linhas; o paginador prometia ${esperado}`,
      );
    }
    return linhas;
  }

  /**
   * Passo 5: para cada linha inédita, busca o detalhe e monta o registro. Linha
   * já conhecida é apenas reportada (`onTseIdSeen`) — ver custo em Q-09.
   */
  private async comDetalhe(
    session: Session,
    linhas: readonly PesqEleLinhaLista[],
    options: DiscoverOptions,
  ): Promise<RawRegistration[]> {
    const registros: RawRegistration[] = [];
    for (const linha of linhas) {
      options.onTseIdSeen?.(linha.tseId);
      // Registro já conhecido não é rebuscado: o `tse_id` do PesqEle não muda e
      // o detalhe custaria 2 requisições a 1 req/10s (Q-09). Não é alerta — é o
      // regime permanente esperado.
      const buscar = (await options.shouldFetchDetalhe?.(linha.tseId)) ?? true;
      if (!buscar) continue;
      const detalhe = await this.buscarDetalhe(session, linha);
      registros.push(toRawRegistration(linha, detalhe));
    }
    return registros;
  }

  private async buscarDetalhe(session: Session, linha: PesqEleLinhaLista): Promise<PesqEleDetalhe> {
    const acao = `${FIELD.tabela}:${linha.rowIndex}:detalhar`;
    const partial = await this.postAjax(session, 'detalhe', {
      [AJAX.partial]: 'true',
      [AJAX.source]: acao,
      // `@all` é o que o commandLink do PesqEle envia; com menos que isso o JSF
      // não processa a linha e a navegação não acontece.
      [AJAX.execute]: '@all',
      [acao]: acao,
      ...this.camposFiltro(session),
    });

    if (partial.redirectUrl === null) {
      throw new PesqEleClientError(
        `Ação detalhar de ${linha.tseId} não devolveu <redirect> (protocolo mudou?)`,
      );
    }

    const url = new URL(partial.redirectUrl, this.baseUrl).toString();
    if (!url.endsWith(DETALHAR_PATH)) {
      throw new PesqEleClientError(`detalhar de ${linha.tseId} redirecionou para ${url}`);
    }

    const res = await this.http.request({
      url,
      method: 'GET',
      headers: { Cookie: session.cookie },
    });
    session.cookie = mergeCookies(session.cookie, res.headers);
    await this.registrarBruto('detalhe', url, res.body);
    return parseDetalhe(res.body);
  }

  /**
   * POST AJAX genérico: injeta o ViewState corrente, lê o NOVO da resposta (o
   * `detalhar` não traz um; nesse caso o antigo continua válido, verificado ao
   * vivo) e falha alto se a sessão tiver expirado — sem retry silencioso, porque
   * repetir com a mesma sessão morta só produziria outra página vazia.
   */
  private async postAjax(
    session: Session,
    step: PesqEleRawDocument['step'],
    fields: Record<string, string>,
  ): Promise<PartialResponse> {
    const url = `${this.baseUrl}${LISTAR_30_DIAS_PATH}`;
    const res = await this.http.request({
      url,
      method: 'POST',
      headers: { ...AJAX_HEADERS, Cookie: session.cookie },
      body: encodeForm({ ...fields, [FIELD.viewState]: session.viewState }),
    });
    session.cookie = mergeCookies(session.cookie, res.headers);
    await this.registrarBruto(step, url, res.body);

    const partial = parsePartialResponse(res.body);
    if (isSessionExpired(partial)) {
      throw new PesqEleClientError(
        'Sessão do PesqEle expirou (ViewExpiredException) no meio da coleta; o próximo run recomeça',
      );
    }
    if (partial.errorName !== null) {
      throw new PesqEleClientError(`PesqEle respondeu com erro JSF: ${partial.errorName}`);
    }
    // Nem toda parcial traz ViewState (o `detalhar` só devolve `<redirect>`).
    if ([...partial.updates.keys()].some((id) => id.includes(FIELD.viewState))) {
      session.viewState = extractViewStateFromPartial(partial);
    }
    return partial;
  }

  private async registrarBruto(
    step: PesqEleRawDocument['step'],
    url: string,
    body: string,
  ): Promise<void> {
    await this.onRawDocument?.({ step, url, body, fetchedAt: this.now().toISOString() });
  }
}
