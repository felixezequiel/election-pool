/**
 * Adapter Paraná Pesquisas (docs/04 §1 nível 2: site do próprio instituto,
 * `paranapesquisas.com.br`). Herda de `BaseAdapter`; implementa só o que é da
 * fonte. V6, resolução de alias, "nunca parcial" e "ausência ≠ zero" são do
 * `BaseAdapter` e não são reimplementados aqui.
 *
 * - `discover`: consulta a WP REST do próprio site pelo `tse_id` e devolve as URLs
 *   dos PDFs de release (`discover.ts`). Uma requisição por registro, pelo
 *   `HttpClient` COMPARTILHADO (robots + 1 req/10s por host, docs/04 §6). Nunca
 *   toca a categoria de clipping de imprensa (nível 4).
 * - `documentToText`: o resultado desta fonte SÓ existe em PDF — a página do post
 *   não tem um único percentual (verificado na captura: zero `<table>`, zero `%`).
 *   Então lemos os bytes do blob e extraímos texto com o MESMO extrator do
 *   cnt-mda (`cnt-mda/pdf.ts`, `unpdf`, sem headless).
 * - `extractScenarios`: delega a `parseParanaPesquisasPdfText`, passando o
 *   `reg.tseId` — o parser precisa dele para exigir a sentença de registro e para
 *   identificar a coluna corrente das tabelas comparativas.
 *
 * COBERTURA (registrado por honestidade, não é bug): nos 51 registros
 * presidenciais colhidos do PesqEle na janela de 30 dias de agosto/2026 o Paraná
 * Pesquisas NÃO aparece. A divulgação nacional presidencial mais recente do site é
 * de março/2026 (`BR-00873/2026`). O adapter está correto e testado contra as
 * capturas reais; pode ficar sem uso imediato até o instituto voltar a registrar
 * pesquisa nacional de presidente.
 */

import type {
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import { BaseAdapter } from '../base/base-adapter.js';
import type { BaseAdapterDeps, RawScenario } from '../base/base-adapter.js';
import { ParseError } from '../poll-source-adapter.js';
import { extractPdfText } from '../cnt-mda/pdf.js';
import { sharedHttpClient } from '../http/shared-client.js';
import type { HttpClient } from '../http-client.js';
import { discoverParanaPesquisas } from './discover.js';
import { parseParanaPesquisasPdfText } from './parse.js';
import { PARANAPESQUISAS_ADAPTER_ID, PARANAPESQUISAS_INSTITUTE_ID } from './constants.js';

export interface ParanaPesquisasAdapterDeps extends BaseAdapterDeps {
  /**
   * Cliente HTTP educado. Injetável para teste; em produção é o SINGLETON do
   * processo, para que o rate limit por host valha entre todos os adapters.
   */
  http?: HttpClient;
}

export class ParanaPesquisasAdapter extends BaseAdapter {
  readonly id = PARANAPESQUISAS_ADAPTER_ID;
  readonly instituteId = PARANAPESQUISAS_INSTITUTE_ID;

  private readonly http: HttpClient;

  constructor(deps: ParanaPesquisasAdapterDeps) {
    super(deps);
    this.http = deps.http ?? sharedHttpClient();
  }

  discover(reg: PollRegistration): Promise<SourceCandidate[]> {
    return discoverParanaPesquisas(this.http, reg);
  }

  protected async documentToText(raw: RawDocument): Promise<string> {
    // A fonte publica o resultado APENAS em PDF. Se o HarvestJob salvou o HTML do
    // post, não há número nenhum ali: falha alta com a razão explícita (R4), em
    // vez de devolver texto sem cenário e deixar o parser "não achar nada".
    const contentType = raw.contentType ?? '';
    if (!contentType.toLowerCase().includes('pdf')) {
      throw new ParseError(
        `Documento ${raw.url} tem content-type "${contentType || 'ausente'}", não PDF. O ` +
          `resultado do Paraná Pesquisas só existe no PDF de release: a página do post não ` +
          `contém percentual nenhum. Use a URL do PDF devolvida por discover().`,
      );
    }
    const bytes = await this.storage.readBytes(raw.storagePath);
    return extractPdfText(bytes);
  }

  protected extractScenarios(text: string, reg: PollRegistration): RawScenario[] {
    return parseParanaPesquisasPdfText(text, reg.tseId);
  }
}
