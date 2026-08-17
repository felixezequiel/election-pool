/**
 * Adapter ATLASINTEL (docs/04 §3, fonte 4). Herda de `BaseAdapter`, que já
 * resolve V6 (identidade por `tse_id`), alias desconhecido, "nunca parcial" e
 * "ausência ≠ zero". Aqui fica só o que é da fonte.
 *
 * ESTADO HONESTO DESTE ADAPTER — leia antes de ligá-lo no registry:
 * `discover` FUNCIONA e é real (consulta a mesma API pública que o site usa).
 * `parse` RECUSA sempre, porque nenhuma superfície que a etiqueta de crawler nos
 * permite buscar publica resultado nem `tse_id`. O diagnóstico completo, com a
 * tabela de superfícies e os robots.txt reais, está em `parse.ts` e em
 * `__fixtures__/README.md`. Enquanto isso não mudar, **não vale ligar `atlas` no
 * registry**: cada rodada viraria um `ParseError` previsível. O adapter existe
 * para (a) registrar o achado em código verificável e (b) já ter o `discover`
 * pronto quando o bloqueio cair.
 *
 * Por que docs/04 §3 diz "HTML — painel online" e isso não se confirmou: em
 * 2026-08-17 o site é um Nuxt cujo HTML e cuja API só carregam METADADO do
 * release; os números vivem no PDF, hospedado num CDN com `Disallow: /`.
 *
 * Etiqueta (docs/04 §6): usamos o `HttpClient` COMPARTILHADO (robots + 1 req/10s
 * por host + conditional GET + retries), sequencialmente, sem headless browser.
 */

import type {
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import { sourceCandidateSchema } from '@election-pool/contracts/domain';
import { parse as parseHtml } from 'node-html-parser';
import { BaseAdapter } from '../base/base-adapter.js';
import type { BaseAdapterDeps, RawScenario } from '../base/base-adapter.js';
import { ParseError } from '../poll-source-adapter.js';
import { HttpClient } from '../http-client.js';
import { sharedHttpClient } from '../http/shared-client.js';
import { extractPdfText } from '../cnt-mda/pdf.js';
import { extractAtlasScenarios } from './parse.js';
import { ATLAS_ADAPTER_ID, ATLAS_INSTITUTE_ID, PUBLIC_POLLS_CATEGORIES } from './constants.js';
import type { PublicPollsCategory } from './constants.js';
import {
  buildReportUrl,
  parsePublicPollsFeed,
  pollPageUrl,
  publicPollsUrl,
  selectNationalReleases,
} from './public-polls-api.js';

export interface AtlasAdapterDeps extends BaseAdapterDeps {
  /** Cliente educado compartilhado (docs/04 §6). Injetável para teste sem rede. */
  http?: HttpClient;
  /**
   * Categorias do feed a consultar, em ordem. O default é só `exclusive-polls`
   * porque é a ÚNICA que publica a série nacional presidencial de 2026
   * (verificado nas 539 entradas das três categorias em 2026-08-17), e cada
   * categoria extra custa 10s de rate limit sem trazer candidato. É parâmetro,
   * e não constante, para o dia em que a Atlas mover a série.
   */
  categories?: readonly PublicPollsCategory[];
}

export class AtlasAdapter extends BaseAdapter {
  readonly id = ATLAS_ADAPTER_ID;
  readonly instituteId = ATLAS_INSTITUTE_ID;

  private readonly http: HttpClient;
  private readonly categories: readonly PublicPollsCategory[];

  constructor(deps: AtlasAdapterDeps) {
    super(deps);
    this.http = deps.http ?? sharedHttpClient();
    this.categories = deps.categories ?? [PUBLIC_POLLS_CATEGORIES[0]];
  }

  /**
   * Consulta a API pública de releases e devolve o relatório da rodada como
   * candidato. UMA requisição por categoria, `page=1&limit=20` — igual ao site.
   *
   * Uma página basta e isso é demonstrável: a janela de casamento é de 14 dias
   * (`RELEASE_LAG_MAX_DAYS`) e 20 releases de `exclusive-polls` cobriam ~5 meses
   * na captura de 2026-08-17. Release que não está na página 1 é velho demais
   * para casar a janela.
   *
   * Semântica de falha (R4, e a lição do Q-09):
   * - Feed inacessível, não-200, ou em forma inesperada ⇒ LANÇA.
   * - Feed com `data` VAZIO ⇒ LANÇA. Categoria pública nunca é vazia; vazio é
   *   sinal de mudança de API, não de "nada publicado". Zero silencioso foi
   *   exatamente o que produziu o Q-09.
   * - Feed cheio e nenhum release na janela ⇒ devolve `[]`. Este é o único vazio
   *   legítimo: a rodada existe no PesqEle mas a Atlas ainda não publicou.
   */
  async discover(reg: PollRegistration): Promise<SourceCandidate[]> {
    const candidates: SourceCandidate[] = [];

    for (const category of this.categories) {
      const url = publicPollsUrl(category);
      // Sequencial de propósito: o rate limiter é por host e todas as
      // requisições caem no mesmo host (docs/04 §6).
      const res = await this.http.request({ url });
      if (res.status !== 200) {
        throw new ParseError(
          `Feed de releases da AtlasIntel respondeu HTTP ${String(res.status)} em ${url}`,
        );
      }
      const feed = parsePublicPollsFeed(res.body, url);
      if (feed.data.length === 0) {
        throw new ParseError(
          `Feed "${category}" da AtlasIntel voltou vazio (${url}). Categoria pública ` +
            `não é vazia — trate como mudança de API, não como "nada publicado".`,
        );
      }

      for (const entry of selectNationalReleases(feed.data, reg.fieldEnd)) {
        candidates.push(
          sourceCandidateSchema.parse({
            url: buildReportUrl(entry),
            reason:
              `Relatório da rodada nacional AtlasIntel publicada em ${entry.date} ` +
              `(release ${String(entry.id)}, categoria ${category}, página ${pollPageUrl(entry.slug)}). ` +
              `Único lugar com números. ATENÇÃO: o robots.txt de cdn.atlasintel.org ` +
              `responde "Disallow: /", então o HttpClient recusa este URL enquanto o ` +
              `arquivo for anterior ao corte de CDN (docs/04 §6).`,
          }),
        );
      }
    }

    return candidates;
  }

  /**
   * `RawDocument` → texto. Despacha pelo `contentType` declarado; tipo que não
   * reconhecemos LANÇA (R4) em vez de tentar adivinhar o formato.
   *
   * - PDF: bytes → `extractPdfText` (reusa `cnt-mda/pdf.ts`, `unpdf`, sem
   *   headless). É o caminho que servirá o relatório quando ele for capturável.
   * - HTML/XML: remove `<script>`/`<style>` (ruído de layout que não é conteúdo)
   *   e devolve o texto. É o caminho da página `/poll/<slug>`.
   * - JSON/texto: devolve como está — o feed já é texto legível.
   */
  protected async documentToText(raw: RawDocument): Promise<string> {
    const contentType = raw.contentType?.toLowerCase() ?? '';

    if (contentType.includes('pdf')) {
      const bytes = await this.storage.readBytes(raw.storagePath);
      return extractPdfText(bytes);
    }

    if (contentType.includes('html') || contentType.includes('xml')) {
      const html = await this.storage.readText(raw.storagePath);
      const root = parseHtml(html);
      for (const noise of root.querySelectorAll('script, style')) {
        noise.remove();
      }
      return root.text;
    }

    if (contentType.includes('json') || contentType.includes('text')) {
      return this.storage.readText(raw.storagePath);
    }

    throw new ParseError(
      `Content-Type não suportado pelo adapter atlas: "${raw.contentType ?? 'ausente'}" ` +
        `em ${raw.url}. Não adivinhamos formato de documento de pesquisa (R4).`,
    );
  }

  /** Ver `parse.ts`: recusa documentada, não stub. */
  protected extractScenarios(text: string, _reg: PollRegistration): RawScenario[] {
    return extractAtlasScenarios(text);
  }
}
