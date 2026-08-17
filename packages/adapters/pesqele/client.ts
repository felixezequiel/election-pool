/**
 * Cliente do PesqEle (docs/04 §2), escrito contra o protocolo REAL capturado ao
 * vivo em 2026-08-16/17 (PesqEle Público 3.9.2). O diagnóstico da primeira versão
 * — que assumia uma estrutura inexistente e terminava com `seen=0` sem erro — está
 * em `docs/OPEN-QUESTIONS.md` Q-09; o do teto de 50 registros, em Q-11.
 *
 * ## Por que a varredura é FATIADA por data (T-28)
 *
 * O PesqEle corta TODA listagem em 50 registros e diz isso na própria tela ("O
 * resultado da consulta está limitado a 50 registros"). Medido ao vivo em
 * 2026-08-17, eleição 2026 / abrangência BRASIL: um ano inteiro devolve 50, a
 * janela de 30 dias devolve 50, três dias devolvem 13. Ou seja: a consulta única
 * da janela de 30 dias — que era o que este cliente fazia — devolvia um PISO
 * disfarçado de total, e os registros excedentes desapareciam sem nenhum alerta.
 * Como o PesqEle expira o registro em 30 dias, o que passa do teto é dado perdido
 * para sempre. As dez fatias de 3 dias da mesma janela somam 131 registros.
 *
 * Daí o desenho: varremos a janela de `JANELA_DIAS` em fatias de `FATIA_DIAS`
 * (aritmética na constante), unimos por `tse_id` (o upsert do DiscoveryJob é
 * idempotente, então repetir é inofensivo — omitir não é) e, se ALGUMA fatia voltar
 * com total no teto, subdividimos a fatia. Se nem uma fatia de um dia escapar do
 * teto, emitimos ALERTA e registramos a suspeita: o que não conseguimos garantir
 * como completo tem de ser dito em voz alta (R4), nunca engolido.
 *
 * ## Sequência (uma requisição por vez, nunca em paralelo)
 *
 * 1. `GET /app/pesquisa/listar.xhtml` — abre a sessão (cookies), traz o formulário
 *    de busca por período, o primeiro ViewState e os `<select>` de filtro.
 * 2. Resolve POR RÓTULO: eleição ("Eleições Gerais 2026"), abrangência ("BRASIL")
 *    e os dois campos de data ("Período de registro"). Rótulo ausente ⇒ LANÇA — id
 *    errado devolveria a eleição errada, ou uma busca SEM período (logo, truncada),
 *    em silêncio.
 * 3. Por fatia: `POST` AJAX do botão de busca com o período ⇒ `<partial-response>`
 *    com a tabela em CDATA e o ViewState NOVO noutro `<update>`.
 * 4. Paginação: `POST` AJAX da DataTable (`_pagination/_first/_rows`). A resposta
 *    traz SÓ as `<tr>` da página pedida. Varremos TODAS as páginas do paginador,
 *    inclusive a que a busca já devolveu — a DataTable guarda a página corrente
 *    entre buscas, então a busca de uma fatia nova pode voltar em `page:1`.
 * 5. Detalhe (só para `tse_id` inédito): `POST` AJAX `...:<ri>:detalhar` ⇒
 *    `<redirect url="/app/pesquisa/detalhar.xhtml">` ⇒ `GET` nessa URL. O `data-ri`
 *    é índice GLOBAL e só resolve enquanto a página dele está renderizada — por
 *    isso o detalhe é buscado logo depois de cada página, nunca no fim.
 *
 * O ViewState é relido a CADA resposta. Robots, 1 req/10s, timeout e retries são
 * do `HttpClient` compartilhado (docs/04 §6). Sem headless browser (CLAUDE.md).
 *
 * Custo (Q-09, opção (a)): o detalhe custa 2 requisições por registro; a 1 req/10s,
 * buscar o detalhe de todos custaria horas. Por isso o detalhe só é buscado para
 * `tse_id` inédito — o `tse_id` já visto não muda, e o upsert do DiscoveryJob já é
 * idempotente. Em regime permanente sobram as ~20 requisições das fatias.
 */

import type { HttpClient } from '../http-client.js';
import {
  PESQELE_BASE_URL,
  LISTAR_PATH,
  DETALHAR_PATH,
  ELEICAO_LABEL,
  ABRANGENCIA_LABEL,
  LIMITE_RESULTADO_DECLARADO,
  JANELA_DIAS,
  FATIA_DIAS,
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
import { resolvePeriodoInputs } from './periodo-inputs.js';
import type { PeriodoInputs } from './periodo-inputs.js';
import {
  dataLocalDe,
  fatiarJanela,
  paraDataPtBr,
  rotuloDaFatia,
  subdividirFatia,
} from './janela.js';
import type { FatiaPeriodo } from './janela.js';
import {
  parseTabelaResultado,
  parseLinhasLista,
  parseDetalhe,
  toRawRegistration,
} from './registration.js';
import type {
  PesqEleColunas,
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
 * Alerta do cliente. Existe por causa da armadilha central desta fonte: sucesso
 * silencioso. Foi o silêncio que escondeu o `seen=0` de T-05 por uma task inteira
 * (Q-09) e a perda de 62% dos registros por outra (Q-11).
 *
 * - `empty_search`: a varredura inteira não viu NENHUM registro.
 * - `truncation_suspected`: uma fatia continuou com o total exatamente no teto
 *   mesmo depois de subdividida até um único dia. Há registros que não conseguimos
 *   ver, e o número colhido é um PISO.
 * - `limit_mismatch`: o teto que a resposta declara não é o que conhecemos (ou o
 *   aviso desapareceu da página). A detecção de truncagem depende desse número,
 *   então uma mudança dele precisa ser vista por gente.
 */
export interface PesqEleAlert {
  kind: 'empty_search' | 'truncation_suspected' | 'limit_mismatch';
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

/**
 * Contagem verificável da varredura, para o resultado do job e para o log. É o que
 * permite responder "faltou alguém?" sem reabrir o site: se `truncagensSuspeitas`
 * é 0 e `fatiasNoTeto` é 0, nenhuma consulta chegou perto do teto e o total é o
 * total. `linhasVistas` maior que `tseIdsDistintos` é esperado só se houver
 * subdivisão (a fatia mãe e as filhas cobrem o mesmo dia); com a partição exata de
 * datas, sem subdivisão, os dois números batem.
 */
export interface PesqEleSweepStats {
  /** Janela varrida, em data de registro (ISO, `America/Sao_Paulo`). */
  janela: FatiaPeriodo;
  /** Consultas de fatia executadas, incluindo as geradas por subdivisão. */
  fatias: number;
  /** Fatias cujo total voltou no teto (suspeita que dispara a subdivisão). */
  fatiasNoTeto: number;
  /** Fatias que continuaram no teto mesmo com um único dia ⇒ perda possível. */
  truncagensSuspeitas: number;
  /** Linhas de lista lidas, com repetição. */
  linhasVistas: number;
  /** `tse_id` distintos vistos na varredura inteira. */
  tseIdsDistintos: number;
  /** Teto declarado pela última resposta lida, ou `null` se não veio declarado. */
  limiteDeclarado: number | null;
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
  /** Recebe a contagem da varredura ao final (inclusive se ela terminou vazia). */
  onSweepStats?: (stats: PesqEleSweepStats) => void;
  /**
   * Janela varrida, em dias. O default é `JANELA_DIAS` porque é EXIGÊNCIA DE
   * PRODUTO (docs/04 §2: o registro expira em 30 dias). Sobrescrever só faz
   * sentido em teste ou num backfill pontual.
   */
  janelaDias?: number;
  /** Largura inicial da fatia, em dias. Default `FATIA_DIAS` (ver a conta lá). */
  larguraFatiaDias?: number;
}

export interface PesqEleClientDeps {
  http: HttpClient;
  baseUrl?: string;
  now?: () => Date;
  /** Recebe o corpo bruto de cada documento (R3: evidência de proveniência). */
  onRawDocument?: (doc: PesqEleRawDocument) => void | Promise<void>;
}

/**
 * Estado mutável de UMA varredura (não do cliente): o teto só precisa ser
 * alertado uma vez, mesmo com dez fatias lendo o mesmo aviso.
 */
interface Varredura {
  stats: PesqEleSweepStats;
  vistos: Set<string>;
  alertouLimite: boolean;
}

interface Session {
  cookie: string;
  viewState: string;
  /** Valores resolvidos por rótulo, reenviados em todo POST do formulário. */
  eleicaoValue: string;
  abrangenciaValue: string;
  /** Nomes dos dois inputs de data, resolvidos por rótulo (ids são `j_id_*`). */
  periodo: PeriodoInputs;
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
   * Varre a janela de 30 dias em fatias de data (eleição 2026 / BRASIL) e emite UMA
   * PÁGINA por vez, para o DiscoveryJob persistir em transação por página. Só
   * entram no array os registros com detalhe buscado (inéditos); os já conhecidos
   * são reportados por `onTseIdSeen`.
   */
  async *discover(
    options: DiscoverOptions = {},
  ): AsyncGenerator<RawRegistration[], void, undefined> {
    const dias = options.janelaDias ?? JANELA_DIAS;
    const largura = options.larguraFatiaDias ?? FATIA_DIAS;
    const fatias = fatiarJanela({ fim: dataLocalDe(this.now()), dias, largura });
    const primeira = fatias[0];
    const ultima = fatias[fatias.length - 1];
    if (primeira === undefined || ultima === undefined) {
      throw new PesqEleClientError(`Janela de ${dias} dia(s) não produziu nenhuma fatia`);
    }

    const stats: PesqEleSweepStats = {
      janela: { inicio: primeira.inicio, fim: ultima.fim },
      fatias: 0,
      fatiasNoTeto: 0,
      truncagensSuspeitas: 0,
      linhasVistas: 0,
      tseIdsDistintos: 0,
      limiteDeclarado: null,
    };
    const varredura: Varredura = { stats, vistos: new Set<string>(), alertouLimite: false };

    const session = await this.abrirSessao();
    try {
      for (const fatia of fatias) {
        yield* this.varrerFatia(session, fatia, options, varredura);
      }

      if (varredura.vistos.size === 0) {
        // Filtro válido + zero resultado NÃO é sucesso: ou a janela está realmente
        // vazia, ou o filtro deixou de casar. Quem chama precisa saber.
        options.onAlert?.({
          kind: 'empty_search',
          detail: `Varredura de ${stats.fatias} fatia(s) entre ${paraDataPtBr(stats.janela.inicio)} e ${paraDataPtBr(stats.janela.fim)} com eleição "${ELEICAO_LABEL}" e abrangência "${ABRANGENCIA_LABEL}" devolveu 0 registros`,
        });
      }
    } finally {
      // `finally` porque a contagem vale igual se a varredura morreu no meio: é
      // ela que diz até onde chegamos antes do erro.
      stats.tseIdsDistintos = varredura.vistos.size;
      options.onSweepStats?.(stats);
    }
  }

  /**
   * Varre UMA fatia de data. Se o total voltar no teto, subdivide e varre as duas
   * metades no lugar desta (a subdivisão é recursiva). Chegando a uma fatia de um
   * único dia ainda no teto, colhe o que dá — nunca joga fora o piso — e ALERTA.
   */
  private async *varrerFatia(
    session: Session,
    fatia: FatiaPeriodo,
    options: DiscoverOptions,
    varredura: Varredura,
  ): AsyncGenerator<RawRegistration[], void, undefined> {
    const { stats } = varredura;
    const tabela = await this.buscar(session, fatia);
    stats.fatias += 1;

    const teto = this.tetoDaResposta(tabela.limiteDeclarado, options, varredura);
    if (tabela.paginador.totalRecords >= teto) {
      stats.fatiasNoTeto += 1;
      const metades = subdividirFatia(fatia);
      if (metades !== null) {
        // Não colhe esta fatia: as metades cobrem exatamente o mesmo período e,
        // sendo mais estreitas, veem o que o teto escondia aqui.
        for (const metade of metades) {
          yield* this.varrerFatia(session, metade, options, varredura);
        }
        return;
      }
      stats.truncagensSuspeitas += 1;
      options.onAlert?.({
        kind: 'truncation_suspected',
        detail: `Fatia ${rotuloDaFatia(fatia)} voltou com ${tabela.paginador.totalRecords} registros, no teto de ${teto}, e não há como estreitar mais que um dia: há registros invisíveis para nós nesse dia e o total colhido é um PISO`,
      });
      // Segue colhendo os `teto` registros visíveis: dado a menos é pior que dado
      // parcial declarado.
    }

    yield* this.colherPaginas(session, fatia, tabela, options, varredura);
  }

  /**
   * Colhe TODAS as páginas do paginador da fatia. A página que a busca já devolveu
   * é aproveitada e não é rebuscada; as outras vêm por paginação AJAX.
   *
   * Por que não `for (pagina = 1; …)` como antes: a DataTable do PesqEle guarda a
   * página corrente entre buscas — depois de paginar numa fatia, a busca da fatia
   * seguinte volta em `page:1` (verificado ao vivo em 2026-08-17, e congelado na
   * fixture `11-busca-periodo-no-teto`). Supor `page:0` faria a página 0 ser
   * simplesmente pulada, em silêncio.
   */
  private async *colherPaginas(
    session: Session,
    fatia: FatiaPeriodo,
    tabela: PesqEleTabelaResultado,
    options: DiscoverOptions,
    varredura: Varredura,
  ): AsyncGenerator<RawRegistration[], void, undefined> {
    const { totalRecords, rowsPerPage, page } = tabela.paginador;
    if (totalRecords === 0) return;

    if (tabela.linhas.length > 0) {
      yield await this.comDetalhe(session, fatia, tabela.linhas, options, varredura);
    }

    const totalPaginas = Math.ceil(totalRecords / rowsPerPage);
    for (let pagina = 0; pagina < totalPaginas; pagina++) {
      if (pagina === page) continue; // já veio na resposta da busca
      const esperado = Math.min(rowsPerPage, totalRecords - pagina * rowsPerPage);
      const linhas = await this.irParaPagina(session, fatia, tabela.colunas, {
        pagina,
        rowsPerPage,
        esperado,
      });
      yield await this.comDetalhe(session, fatia, linhas, options, varredura);
    }
  }

  /**
   * Teto vigente para julgar truncagem. O número DECLARADO pela resposta manda; a
   * constante é a referência conhecida. Divergência ou ausência ⇒ ALERTA uma única
   * vez por varredura (dez fatias não precisam repetir o mesmo aviso dez vezes).
   */
  private tetoDaResposta(
    declarado: number | null,
    options: DiscoverOptions,
    varredura: Varredura,
  ): number {
    const { stats } = varredura;
    const primeiraVez = !varredura.alertouLimite;
    if (declarado === null) {
      if (primeiraVez) {
        varredura.alertouLimite = true;
        options.onAlert?.({
          kind: 'limit_mismatch',
          detail: `O PesqEle não declarou mais o teto de registros na resposta da busca; a detecção de truncagem segue com a constante conhecida (${LIMITE_RESULTADO_DECLARADO}), que pode estar desatualizada`,
        });
      }
      return LIMITE_RESULTADO_DECLARADO;
    }
    if (declarado !== LIMITE_RESULTADO_DECLARADO && primeiraVez) {
      varredura.alertouLimite = true;
      options.onAlert?.({
        kind: 'limit_mismatch',
        detail: `O PesqEle declara teto de ${declarado} registros, mas a constante do adapter é ${LIMITE_RESULTADO_DECLARADO}: revise a largura da fatia (LIMITE_RESULTADO_DECLARADO / FATIA_DIAS) antes de confiar na contagem`,
      });
    }
    stats.limiteDeclarado = declarado;
    return declarado;
  }

  /** Passo 1+2: sessão, ViewState inicial e campos de filtro resolvidos por rótulo. */
  private async abrirSessao(): Promise<Session> {
    const url = `${this.baseUrl}${LISTAR_PATH}`;
    const res = await this.http.request({ url, method: 'GET' });
    await this.registrarBruto('lista', url, res.body);

    return {
      cookie: mergeCookies('', res.headers),
      viewState: extractViewStateFromHtml(res.body),
      eleicaoValue: resolveOptionValue(res.body, FIELD.eleicaoSelect, ELEICAO_LABEL),
      abrangenciaValue: resolveOptionValue(res.body, FIELD.abrangenciaSelect, ABRANGENCIA_LABEL),
      periodo: resolvePeriodoInputs(res.body),
    };
  }

  /**
   * Campos do formulário reenviados em todo POST (o JSF re-decodifica o form). O
   * período vai em TODA requisição, inclusive na paginação: sem ele o JSF
   * re-decodificaria o formulário com as datas vazias e a página seguinte viria do
   * resultado sem filtro — 50 registros de outra coisa, com cara de acerto.
   */
  private camposFiltro(session: Session, fatia: FatiaPeriodo): Record<string, string> {
    return {
      [FIELD.form]: FIELD.form,
      [FIELD.eleicaoSelect]: session.eleicaoValue,
      [FIELD.abrangenciaSelect]: session.abrangenciaValue,
      [FIELD.cidadesSelect]: '',
      [session.periodo.inicio]: paraDataPtBr(fatia.inicio),
      [session.periodo.fim]: paraDataPtBr(fatia.fim),
      [FIELD.formSubmit]: '1',
    };
  }

  /** Passo 3: POST do botão de busca para uma fatia. Devolve a tabela da fatia. */
  private async buscar(session: Session, fatia: FatiaPeriodo): Promise<PesqEleTabelaResultado> {
    const partial = await this.postAjax(session, 'busca', {
      [AJAX.partial]: 'true',
      [AJAX.source]: FIELD.botaoPesquisar,
      [AJAX.execute]: FIELD.form,
      [AJAX.render]: FIELD.form,
      [FIELD.botaoPesquisar]: FIELD.botaoPesquisar,
      ...this.camposFiltro(session, fatia),
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
    fatia: FatiaPeriodo,
    colunas: PesqEleColunas,
    alvo: { pagina: number; rowsPerPage: number; esperado: number },
  ): Promise<PesqEleLinhaLista[]> {
    const { pagina, rowsPerPage, esperado } = alvo;
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
      ...this.camposFiltro(session, fatia),
    });

    // A resposta da paginação re-renderiza SÓ a DataTable (um fragmento de `<tr>`),
    // sem cabeçalho — daí passar o mapa de colunas lido na busca.
    const linhas = parseLinhasLista(requireUpdate(partial, FIELD.tabela), colunas);
    if (linhas.length !== esperado) {
      // Contagem diferente da prometida pelo paginador significa que o conjunto
      // mudou embaixo de nós (registro novo entrou no meio da coleta) e que os
      // índices de linha já não valem. Abortar é o certo: o run seguinte
      // recomeça e as páginas já persistidas continuam válidas (transação por
      // página). Seguir adiante atribuiria detalhe ao registro errado.
      throw new PesqEleClientError(
        `Página ${pagina} da fatia ${rotuloDaFatia(fatia)} voltou com ${linhas.length} linhas; o paginador prometia ${esperado}`,
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
    fatia: FatiaPeriodo,
    linhas: readonly PesqEleLinhaLista[],
    options: DiscoverOptions,
    varredura: Varredura,
  ): Promise<RawRegistration[]> {
    const { stats, vistos } = varredura;
    const registros: RawRegistration[] = [];
    for (const linha of linhas) {
      stats.linhasVistas += 1;
      vistos.add(linha.tseId);
      options.onTseIdSeen?.(linha.tseId);
      // Registro já conhecido não é rebuscado: o `tse_id` do PesqEle não muda e
      // o detalhe custaria 2 requisições a 1 req/10s (Q-09). Não é alerta — é o
      // regime permanente esperado.
      const buscar = (await options.shouldFetchDetalhe?.(linha.tseId)) ?? true;
      if (!buscar) continue;
      const detalhe = await this.buscarDetalhe(session, fatia, linha);
      registros.push(toRawRegistration(linha, detalhe));
    }
    return registros;
  }

  private async buscarDetalhe(
    session: Session,
    fatia: FatiaPeriodo,
    linha: PesqEleLinhaLista,
  ): Promise<PesqEleDetalhe> {
    const acao = `${FIELD.tabela}:${linha.rowIndex}:detalhar`;
    const partial = await this.postAjax(session, 'detalhe', {
      [AJAX.partial]: 'true',
      [AJAX.source]: acao,
      // `@all` é o que o commandLink do PesqEle envia; com menos que isso o JSF
      // não processa a linha e a navegação não acontece.
      [AJAX.execute]: '@all',
      [acao]: acao,
      ...this.camposFiltro(session, fatia),
    });

    if (partial.redirectUrl === null) {
      // Verificado ao vivo: quando o `data-ri` pedido NÃO está na página que a
      // DataTable tem renderizada, o JSF não acha a linha e responde sem
      // `<redirect>`. Isso é falha de sincronia, não "registro sem detalhe".
      throw new PesqEleClientError(
        `Ação detalhar de ${linha.tseId} (data-ri=${linha.rowIndex}) não devolveu <redirect>: a linha não está na página renderizada ou o protocolo mudou`,
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
    const url = `${this.baseUrl}${LISTAR_PATH}`;
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
