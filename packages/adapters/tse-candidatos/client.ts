/**
 * Cliente do DivulgaCandContas do TSE (T-17).
 *
 * ÚNICA fonte de foto de candidato autorizada no projeto: o registro público de
 * candidatura da autoridade eleitoral, com a foto que o próprio candidato
 * entregou ao se registrar (docs/08 §2 — imagem de imprensa, agência, rede social
 * ou banco de imagens é obra protegida e está terminantemente fora).
 *
 * A API foi investigada contra o serviço real em 2026-08-16 (o bundle Angular do
 * próprio Divulga é quem documenta as rotas; ver `__fixtures__/README.md`). Os
 * três passos:
 *
 *   1. `GET /eleicao/eleicao-atual?idEleicao=0`
 *      → `sq_ELEICAO` (20322002026 em 2026) e o ano, que CONFERIMOS.
 *   2. `GET /candidatura/listar/{ano}/BR/{sqEleicao}/1/candidatos`
 *      → as 13 candidaturas a Presidente, com nome, número e partido.
 *   3. `GET /candidatura/buscar/{ano}/BR/{sqEleicao}/candidato/{id}`
 *      → `fotoUrl` e `fotoUrlPublicavel`.
 *
 * O passo 3 é obrigatório e não tem atalho: na LISTAGEM o TSE devolve `fotoUrl`
 * vazio e `fotoUrlPublicavel: false` para todo mundo, o que seria lido como
 * "ninguém tem foto". Confirmado nas 13 candidaturas em 2026-08-16.
 *
 * Requisições são SEQUENCIAIS e passam pelo `HttpClient` compartilhado, que impõe
 * robots.txt, 1 req/10s por host, timeout e retries (docs/04 §6). Buscamos o
 * detalhe apenas das candidaturas que casaram com um candidato nosso — não
 * varremos o cadastro inteiro do TSE por esporte.
 */

import { HttpClient, DEFAULT_USER_AGENT } from '../http-client.js';
import { createBase64Fetch, decodeBase64Body, decodeBase64Text } from './binary-fetch.js';
import type { RawFetch } from './binary-fetch.js';
import {
  eleicaoAtualSchema,
  listaCandidatosSchema,
  candidaturaDetalheSchema,
} from './api-schemas.js';
import type { CandidaturaLista, CandidaturaDetalhe } from './api-schemas.js';
import {
  ABRANGENCIA_FEDERAL,
  CARGO_PRESIDENTE,
  DIVULGA_ORIGIN,
  DIVULGA_REST_PREFIX,
  ELECTION_YEAR,
  NATIONAL_UE,
} from './constants.js';

export class TseApiError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'TseApiError';
  }
}

/** Identidade confirmada da eleição alvo. */
export interface EleicaoAlvo {
  /** `sq_ELEICAO`, como string (id, nunca grandeza). */
  idEleicao: string;
  ano: number;
  nome: string;
}

export interface FotoBaixada {
  bytes: Uint8Array;
  /** URL efetivamente baixada (depois de redirects). */
  url: string;
  /** `ETag` devolvido pelo TSE, se houver — ver nota de idempotência abaixo. */
  etag: string | null;
  lastModified: string | null;
}

export interface TseCandidatosClientDeps {
  /**
   * `HttpClient` cujo corpo chega em BASE64 (ver `binary-fetch.ts`). Se omitido,
   * construímos um com o `fetch` global. Instância DEDICADA a este host: o rate
   * limit é por host e nenhum outro adapter fala com `divulgacandcontas`, então
   * não há como burlar o limite de ninguém.
   */
  http?: HttpClient;
  origin?: string;
  userAgent?: string;
}

export class TseCandidatosClient {
  private readonly http: HttpClient;
  private readonly origin: string;

  constructor(deps: TseCandidatosClientDeps = {}) {
    this.origin = deps.origin ?? DIVULGA_ORIGIN;
    this.http =
      deps.http ??
      new HttpClient({
        fetchImpl: createBase64Fetch(globalThis.fetch as unknown as RawFetch),
        userAgent: deps.userAgent ?? process.env['HARVEST_USER_AGENT'] ?? DEFAULT_USER_AGENT,
      });
  }

  private rest(path: string): string {
    return `${this.origin}${DIVULGA_REST_PREFIX}${path}`;
  }

  /** GET + parse JSON, com o corpo chegando em base64. */
  private async getJson(url: string): Promise<unknown> {
    const res = await this.http.request({ url, method: 'GET', headers: { Accept: '*/*' } });
    if (res.status !== 200) {
      throw new TseApiError(`TSE respondeu HTTP ${res.status} em ${url}`);
    }
    const text = decodeBase64Text(res.body);
    try {
      return JSON.parse(text) as unknown;
    } catch (err) {
      // Falha alta: HTML de erro travestido de JSON não vira objeto vazio.
      throw new TseApiError(`Resposta de ${url} não é JSON válido`, err);
    }
  }

  /**
   * Descobre e CONFIRMA a eleição alvo. Não hardcodamos `sq_ELEICAO`: o número
   * (20322002026) é do deploy atual do TSE e pode mudar. Em compensação, o ano e
   * a abrangência são conferidos contra as constantes — se o TSE virar a chave
   * para outro pleito, o job para com erro em vez de ingerir fotos da eleição
   * errada (docs/04 §4.1: confirmação de identidade é obrigatória).
   */
  async resolveEleicaoAlvo(): Promise<EleicaoAlvo> {
    const url = this.rest('/eleicao/eleicao-atual?idEleicao=0');
    const parsed = eleicaoAtualSchema.parse(await this.getJson(url));
    const { sq_ELEICAO: idEleicao, nr_ANO_REFERENCIA: ano, nm_ELEICAO: nome } = parsed.eleicao;
    if (ano !== ELECTION_YEAR) {
      throw new TseApiError(
        `Eleição corrente do TSE é de ${ano}, esperávamos ${ELECTION_YEAR}. ` +
          'Trocar de ciclo eleitoral é decisão humana — o job não segue sozinho.',
      );
    }
    if (parsed.eleicao.tp_ABRANGENCIA !== ABRANGENCIA_FEDERAL) {
      throw new TseApiError(
        `Abrangência '${parsed.eleicao.tp_ABRANGENCIA}' não é a federal ` +
          `('${ABRANGENCIA_FEDERAL}'): não é a eleição presidencial.`,
      );
    }
    return { idEleicao, ano, nome };
  }

  /**
   * Lista as candidaturas a Presidente, abrangência nacional. Confere que o TSE
   * devolveu o cargo e a UE que pedimos — a URL leva os parâmetros no path e um
   * erro de rota devolveria outra coisa com HTTP 200.
   */
  async listarCandidaturasPresidente(idEleicao: string): Promise<CandidaturaLista[]> {
    const url = this.rest(
      `/candidatura/listar/${ELECTION_YEAR}/${NATIONAL_UE}/${idEleicao}/${CARGO_PRESIDENTE}/candidatos`,
    );
    const parsed = listaCandidatosSchema.parse(await this.getJson(url));
    if (parsed.unidadeEleitoral.sigla !== NATIONAL_UE) {
      throw new TseApiError(
        `TSE devolveu a unidade eleitoral '${parsed.unidadeEleitoral.sigla}', ` +
          `esperávamos '${NATIONAL_UE}'`,
      );
    }
    if (parsed.cargo.codigo !== CARGO_PRESIDENTE) {
      throw new TseApiError(
        `TSE devolveu o cargo ${parsed.cargo.codigo} ('${parsed.cargo.nome}'), ` +
          `esperávamos ${CARGO_PRESIDENTE}`,
      );
    }
    if (parsed.candidatos.length === 0) {
      // Zero candidatura a Presidente é impossível num ciclo em andamento; é
      // sintoma de mudança de API. Falha alta em vez de "nenhuma foto hoje".
      throw new TseApiError(`Lista de candidaturas a Presidente veio vazia em ${url}`);
    }
    return parsed.candidatos;
  }

  /** Detalhe de UMA candidatura — o único lugar com `fotoUrl` de verdade. */
  async buscarCandidatura(idEleicao: string, idCandidatura: string): Promise<CandidaturaDetalhe> {
    const url = this.rest(
      `/candidatura/buscar/${ELECTION_YEAR}/${NATIONAL_UE}/${idEleicao}/candidato/${idCandidatura}`,
    );
    const parsed = candidaturaDetalheSchema.parse(await this.getJson(url));
    if (parsed.id !== idCandidatura) {
      // Confirmação de identidade (docs/04 §4.1): jamais atribuir a foto de uma
      // candidatura a outra. É o pior bug possível deste adapter.
      throw new TseApiError(
        `Detalhe devolvido é da candidatura ${parsed.id}, pedimos ${idCandidatura}`,
      );
    }
    return parsed;
  }

  /**
   * Baixa os bytes da foto oficial.
   *
   * Sobre o conditional GET: mandamos `If-None-Match`/`If-Modified-Since` quando
   * já temos os valores salvos, e um 304 encerra o ciclo sem reescrever nada. Na
   * medição real de 2026-08-16 o TSE NÃO envia `ETag` nem `Last-Modified` nesse
   * endpoint (só `Cache-Control: max-age=240`), então na prática a detecção de
   * troca fica por conta do sha256 dos bytes. Mantemos os cabeçalhos porque
   * custam nada e passam a valer no dia em que o TSE os enviar.
   */
  async baixarFoto(
    fotoUrl: string,
    conditional: { etag?: string | null; lastModified?: string | null } = {},
  ): Promise<FotoBaixada | 'not-modified'> {
    const res = await this.http.request({
      url: fotoUrl,
      method: 'GET',
      headers: { Accept: 'image/*' },
      etag: conditional.etag ?? null,
      lastModified: conditional.lastModified ?? null,
    });
    if (res.notModified) return 'not-modified';
    if (res.status !== 200) {
      throw new TseApiError(`TSE respondeu HTTP ${res.status} ao baixar a foto ${fotoUrl}`);
    }
    return {
      bytes: decodeBase64Body(res.body),
      url: res.url,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
    };
  }

  /**
   * URL PÚBLICA da candidatura no Divulga — é isto que vai para `photoSourceUrl`
   * e cumpre a proveniência (R6): quem olhar a foto no nosso site consegue abrir
   * o registro no TSE e conferir. A rota é a do próprio SPA
   * (`#/candidato/:regiao/:uf/:eleicaoID/:candidatoID/:ano/:sgUe`, com hash
   * routing), lida do bundle Angular. Preferimos a página à URL crua da imagem:
   * a página é o registro, a imagem é só um arquivo dele.
   */
  urlPublicaCandidatura(idEleicao: string, idCandidatura: string): string {
    return (
      `${this.origin}/divulga/#/candidato/${NATIONAL_UE}/${NATIONAL_UE}/` +
      `${idEleicao}/${idCandidatura}/${ELECTION_YEAR}/${NATIONAL_UE}`
    );
  }
}
