/**
 * Adapter Quaest / Genial-Quaest (docs/04 §3, fonte 3). Herda de `BaseAdapter`;
 * implementa só o que é da fonte. V6, resolução de alias, "nunca parcial" e
 * "ausência ≠ zero" são do `BaseAdapter`.
 *
 * ## O que a fonte é (investigado ao vivo em 2026-08-17, antes do parser)
 *
 * `quaest.com.br` é um WordPress. `genial-quaest.com.br` NÃO EXISTE (domínio sem
 * registro em DNS) e o site da Genial Investimentos não respondeu — logo a
 * divulgação de primeira mão é o site do próprio instituto (nível 2 de docs/04
 * §1). O contratante espelha os MESMOS PDFs numa landing page
 * (`lp.genialinvestimentos.com.br/pesquisas-genial-quaest/`, nível 3), sem
 * acrescentar dado nem registro TSE.
 *
 * Duas superfícies por rodada:
 *
 * 1. **PDF de rodada** — anexo de um post do tipo `relatorios`. É a divulgação
 *    canônica e é **inútil para extração**: 100% dos gráficos são imagem. Medido
 *    em 4 PDFs de 2 hosts entre jan/2025 e ago/2026 (evidência em
 *    `__fixtures__/2026-08-14-rodada-1-pdf-probe.json`): 197 páginas, 1 único
 *    caractere `%` na camada de texto inteira, zero números pt-BR, zero
 *    ocorrências de registro TSE. Sem OCR (que a v1 não tem) o PDF não rende
 *    número — e o V6 o recusa por não conter o `tse_id`.
 * 2. **Post de blog do instituto** — a ÚNICA superfície com o número de registro
 *    no TSE e os percentuais em texto. É prosa editorial; `parse.ts` explica as
 *    quatro guardas que a tornam utilizável sem inventar número, e por que o
 *    parser recusa mais do que aceita.
 *
 * Índices HTML (`/relatorios/`, `/relatorios-quaest/`, `/blog/`) são montados por
 * JS (JetEngine) e vêm VAZIOS — e a v1 não usa headless browser (CLAUDE.md). O
 * WP REST entrega o mesmo dado como JSON estático, e é por ele que o `discover`
 * localiza o post da rodada.
 *
 * **Desvio deliberado do padrão dos outros adapters:** aqui o `discover` FAZ UMA
 * REQUISIÇÃO. O `nexus` e o `cnt-mda` devolvem URL fixa porque a fonte tem um
 * índice estável; a Quaest não tem — o slug do post é título editorial. A
 * justificativa completa está no docblock de `discover`. A requisição usa o
 * `HttpClient` COMPARTILHADO do processo (robots + 1 req/10 s por host, docs/04
 * §6), injetável para teste, e o `discover` devolve só URLs FINAIS de post: o
 * `HarvestJob` trata cada `SourceCandidate` como documento a buscar e parsear, e
 * um sitemap não é documento de rodada.
 */

import { z } from 'zod';
import type {
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import { sourceCandidateSchema } from '@election-pool/contracts/domain';
import { BaseAdapter } from '../base/base-adapter.js';
import type { BaseAdapterDeps, RawScenario } from '../base/base-adapter.js';
import { ParseError } from '../poll-source-adapter.js';
import { extractPdfText } from '../cnt-mda/pdf.js';
import { HttpClient } from '../http-client.js';
import { sharedHttpClient } from '../http/shared-client.js';
import { quaestArticleText } from './article-body.js';
import { parseQuaestRoundText } from './parse.js';
import {
  QUAEST_ADAPTER_ID,
  QUAEST_INSTITUTE_ID,
  QUAEST_MAX_POST_CANDIDATES,
  QUAEST_POST_LAG_DAYS,
  quaestRestPostsInWindowUrl,
} from './constants.js';

export { QUAEST_ADAPTER_ID, QUAEST_INSTITUTE_ID };

/**
 * Resposta do WP REST validada na FRONTEIRA (CLAUDE.md: Zod em toda fronteira).
 * Só `link` e `date` são usados; `title` NÃO entra — é obra de terceiro e não
 * temos por que ler, muito menos guardar (R3, docs/08 §2).
 */
const wpPostSchema = z.object({
  id: z.number().int(),
  date: z.string().min(1),
  slug: z.string().min(1),
  link: z.string().url(),
});
const wpPostListSchema = z.array(wpPostSchema);

export interface QuaestAdapterDeps extends BaseAdapterDeps {
  /**
   * Cliente HTTP para a caminhada do `discover`. Injetável para teste; o default
   * é o SINGLETON do processo, para que o rate limit de 1 req/10 s por host valha
   * entre todos os adapters (docs/04 §6).
   */
  http?: HttpClient;
}

/** `IsoDate` (data pura ou datetime com offset) → `AAAA-MM-DD`. */
const dayOf = (isoDate: string): string => isoDate.slice(0, 10);

/** `AAAA-MM-DD` + n dias → `AAAA-MM-DD`. Aritmética em UTC, sem `Date` na lógica. */
const addDays = (day: string, days: number): string => {
  const at = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(at)) {
    throw new ParseError(`Data de campo do registro em formato inesperado: "${day}"`);
  }
  const shifted = new Date(at + days * 24 * 60 * 60 * 1000);
  const iso = shifted.toISOString();
  return iso.slice(0, 10);
};

export class QuaestAdapter extends BaseAdapter {
  readonly id = QUAEST_ADAPTER_ID;
  readonly instituteId = QUAEST_INSTITUTE_ID;

  private readonly http: HttpClient;

  constructor(deps: QuaestAdapterDeps) {
    super(deps);
    this.http = deps.http ?? sharedHttpClient();
  }

  /**
   * **Este adapter FAZ REDE no `discover`, ao contrário do `nexus` e do
   * `cnt-mda`.** Não por preferência: o documento que serve é o post de blog do
   * instituto, e o slug do post é um TÍTULO EDITORIAL — `…/recuperacao-de-flavio-
   * bolsonaro/`, `…/saldo-de-aprovacao-de-lula/`, `…/lula-abre-vantagem-sobre-
   * flavio-bolsonaro/`. Não há data, número de rodada, nem qualquer campo do
   * `PollRegistration` no slug. Derivá-lo seria adivinhar, e adivinhar URL é a
   * versão de rede do erro da Q-09: geraria requisições que só dão 404 e
   * cobertura zero.
   *
   * O que É derivável é a JANELA: o post sai poucos dias depois do fim do campo
   * (2 dias nas duas capturas). Então a caminhada é UMA requisição ao WP REST,
   * filtrando por `after`/`before` em torno de `reg.fieldEnd`, e devolvemos as
   * URLs FINAIS dos posts daquela janela. Nada de sitemap nem de `wp-json` vai
   * para o `HarvestJob`: ele trata cada `SourceCandidate` como documento a buscar
   * e parsear, e um sitemap não é documento de rodada.
   *
   * Quem separa o post certo do vizinho é o **V6** — é exatamente para isso que
   * ele existe. Janela vazia devolve `[]`, porque "o instituto ainda não publicou"
   * é um FATO, não uma falha. Requisição que falha LANÇA (R4): não sabemos as
   * candidatas, e devolver `[]` aí seria o zero silencioso da Q-09.
   */
  async discover(reg: PollRegistration): Promise<SourceCandidate[]> {
    const fieldEnd = dayOf(reg.fieldEnd);
    const after = `${addDays(fieldEnd, -1)}T00:00:00`;
    const before = `${addDays(fieldEnd, QUAEST_POST_LAG_DAYS)}T23:59:59`;
    const url = quaestRestPostsInWindowUrl(after, before);

    const response = await this.http.request({ url, method: 'GET' });
    if (response.status !== 200) {
      throw new ParseError(
        `WP REST da Quaest respondeu ${String(response.status)} em ${url} — ` +
          `não sei quais são as URLs candidatas de ${reg.tseId}. Falha alta em vez de ` +
          `devolver lista vazia, que pareceria "nada publicado" (R4).`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(response.body);
    } catch (err) {
      throw new ParseError(`WP REST da Quaest devolveu JSON inválido em ${url}`, err);
    }
    const parsed = wpPostListSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ParseError(
        `WP REST da Quaest mudou de forma em ${url}: ${parsed.error.message}`,
        parsed.error,
      );
    }

    return parsed.data.slice(0, QUAEST_MAX_POST_CANDIDATES).map((post) =>
      sourceCandidateSchema.parse({
        url: post.link,
        reason:
          `Post do instituto publicado em ${dayOf(post.date)}, dentro de ${String(QUAEST_POST_LAG_DAYS)} ` +
          `dias do fim do campo (${fieldEnd}) de ${reg.tseId}. É a única superfície da Quaest ` +
          `com registro TSE e percentuais em texto; o V6 descarta se for outra rodada.`,
      }),
    );
  }

  /**
   * Dispatch pelo `contentType` do raw, sem palpite: HTML vira o texto do corpo
   * do artigo (um bloco por linha); PDF vira texto via `unpdf` (reusando
   * `cnt-mda/pdf`, sem headless). Qualquer outro tipo LANÇA — nunca tentamos
   * "adivinhar" o formato, porque ler um PDF como HTML devolveria string vazia e
   * o V6 recusaria pelo motivo errado (R4).
   */
  protected async documentToText(raw: RawDocument): Promise<string> {
    if (raw.contentType === null) {
      throw new ParseError(
        `Documento da Quaest sem content-type em ${raw.url}. O adapter não adivinha formato: ` +
          `ler PDF como HTML devolveria texto vazio e o V6 recusaria pelo motivo errado (R4).`,
      );
    }
    const contentType = raw.contentType.toLowerCase();
    if (contentType.includes('html')) {
      return quaestArticleText(await this.storage.readText(raw.storagePath));
    }
    if (contentType.includes('pdf')) {
      return extractPdfText(await this.storage.readBytes(raw.storagePath));
    }
    throw new ParseError(
      `Documento da Quaest com content-type inesperado ("${raw.contentType}") em ${raw.url}. ` +
        `O adapter lê HTML (post do instituto) e PDF (relatório de rodada).`,
    );
  }

  protected extractScenarios(text: string, _reg: PollRegistration): RawScenario[] {
    return parseQuaestRoundText(text);
  }
}
