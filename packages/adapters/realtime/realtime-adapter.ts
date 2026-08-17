/**
 * Adapter `realtime` — REAL TIME BIG DATA (razão social no TSE: "REAL TIME MIDIA
 * LTDA / REAL TIME BIG DATA"). Fonte de NÍVEL 2 da hierarquia de docs/04 §1: o
 * site do próprio instituto, resultado em primeira mão. Nenhum portal de notícia
 * é tocado (CLAUDE.md; docs/08 §2).
 *
 * O QUE A FONTE PUBLICA (investigado ANTES de escrever o parser — a lição da
 * Q-09): `https://realtimebigdata.com.br/pesquisas/` é um índice que linka **um
 * PDF por rodada**, e o nome do arquivo carrega o número de registro TSE. Cada
 * PDF é um deck de 17 páginas com espontânea, estimulada (com recortes),
 * confronto de 2º turno, rejeição e aprovação. O registro
 * (`PESQUISA REGISTRADA: BR-NNNNN/2026`) está na CAPA, em texto extraível — sem
 * ele o `BaseAdapter` recusaria o documento (V6) e este adapter não existiria.
 *
 * Divisão de trabalho:
 * - `discover`: busca o índice pelo `HttpClient` COMPARTILHADO (robots + 1
 *   req/10s por host, docs/04 §6; sem headless) e devolve a URL do PDF da rodada,
 *   selecionada pelo `tse_id` no nome do arquivo. Precisa buscar porque não há
 *   URL construível: a grafia do separador no nome do arquivo varia entre
 *   rodadas.
 * - `documentToText`: bytes do blob → texto normalizado por LAYOUT
 *   (`pdf-layout.ts`). Não reusa `cnt-mda/pdf.ts` porque a ordem de fluxo do PDF
 *   inverte os valores do 2º turno — o cabeçalho de `pdf-layout.ts` documenta a
 *   medição.
 * - `extractScenarios`: delega a `parseRealTimeLayoutText`.
 *
 * V6 (identidade), alias desconhecido ⇒ `UnknownCandidateError`, "nunca parcial"
 * e "ausência ≠ zero" são todos do `BaseAdapter` — não os reimplementamos.
 */

import type {
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import { sourceCandidateSchema } from '@election-pool/contracts/domain';
import { BaseAdapter } from '../base/base-adapter.js';
import type { BaseAdapterDeps, RawScenario } from '../base/base-adapter.js';
import { sharedHttpClient } from '../http/shared-client.js';
import type { HttpClient } from '../http-client.js';
import { REALTIME_ADAPTER_ID, REALTIME_INDEX_URL, REALTIME_INSTITUTE_ID } from './constants.js';
import { parseIndexPdfUrls, selectSourceUrls } from './index-parse.js';
import { asHtmlText, asPdfBytes } from './raw-body.js';
import { pdfToLayoutText } from './pdf-layout.js';
import { parseRealTimeLayoutText } from './parse.js';

export interface RealTimeAdapterDeps extends BaseAdapterDeps {
  /**
   * Cliente HTTP. Default: o SINGLETON do processo — o rate limit é por host e
   * só vale se todos os adapters compartilharem a instância (docs/04 §6).
   */
  http?: HttpClient;
}

export class RealTimeAdapter extends BaseAdapter {
  readonly id = REALTIME_ADAPTER_ID;
  readonly instituteId = REALTIME_INSTITUTE_ID;

  private readonly http: HttpClient;

  constructor(deps: RealTimeAdapterDeps) {
    super(deps);
    this.http = deps.http ?? sharedHttpClient();
  }

  /**
   * URLs candidatas do resultado desta rodada. Uma requisição ao índice, pelo
   * cliente educado; a seleção é pelo `tse_id` no nome do arquivo, então no caso
   * normal devolve UMA URL e o ciclo custa 2 requisições ao host.
   *
   * Lista vazia é resposta legítima: a rodada existe no PesqEle e o instituto
   * ainda não publicou o PDF. Índice sem PDF algum LANÇA (estrutura mudou).
   */
  async discover(reg: PollRegistration): Promise<SourceCandidate[]> {
    const response = await this.http.request({ url: REALTIME_INDEX_URL, method: 'GET' });
    const urls = parseIndexPdfUrls(asHtmlText(response.body));
    return selectSourceUrls(urls, reg.tseId).map((selected) =>
      sourceCandidateSchema.parse({
        url: selected.url,
        reason: selected.registrationInFilename
          ? `Índice /pesquisas/ do instituto; nome do arquivo carrega o registro ${reg.tseId}`
          : 'Índice /pesquisas/ do instituto; arquivo sem registro no nome, V6 confirma ao ler',
      }),
    );
  }

  protected async documentToText(raw: RawDocument): Promise<string> {
    const stored = await this.storage.readBytes(raw.storagePath);
    return pdfToLayoutText(asPdfBytes(stored));
  }

  protected extractScenarios(text: string, _reg: PollRegistration): RawScenario[] {
    return parseRealTimeLayoutText(text);
  }
}
