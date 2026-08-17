/**
 * Adapter PoderData (docs/04 §3, fonte 5). Herda de `BaseAdapter`; implementa só o
 * que é da fonte. V6 (identidade por `tse_id`), resolução de alias, "nunca
 * parcial" e "ausência ≠ zero" são do `BaseAdapter` e não são reimplementados
 * aqui.
 *
 * A FONTE. O dado sai do relatório técnico em PDF do PRÓPRIO instituto
 * (`static.poder360.com.br/.../Relatorio-PoderData-Eleitoral-*.pdf`), que é o
 * nível 2 da hierarquia de docs/04 §1. O HTML do Poder360 é usado APENAS como
 * índice de links — nenhum número, título ou trecho de matéria entra no dado
 * (R3, docs/08 §2.1). A justificativa completa da distinção "divulgação x
 * matéria" está no cabeçalho de `constants.ts`.
 *
 * Educação de crawler: `discover` usa o `HttpClient` COMPARTILHADO do processo
 * (robots.txt + 1 req/10s por host + conditional GET + retries, docs/04 §6),
 * sequencialmente, sem headless browser.
 */

import { parse as parseHtml } from 'node-html-parser';
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
import { sharedHttpClient } from '../http/shared-client.js';
import type { HttpClient } from '../http-client.js';
import {
  PODERDATA_ADAPTER_ID,
  PODERDATA_DISCLOSURE_INDEX_URLS,
  PODERDATA_INSTITUTE_ID,
  PODERDATA_REPORT_URL_PATTERN,
} from './constants.js';
import { parsePoderDataReport } from './parse.js';

const HTTP_OK = 200;

/**
 * Chave de ordenação por ano/mês do caminho da URL
 * (`/uploads/2026/07/Relatorio-...`). Serve para tentar a rodada mais recente
 * primeiro — os dois índices reais listam em ordens OPOSTAS, e sem isto a página
 * institucional (mais antiga primeiro) faria baixar 4 PDFs antes do certo. É só
 * otimização: quem decide qual PDF é da rodada é o V6, no `parse`.
 */
const recencyKey = (url: string): number => {
  const match = /\/(\d{4})\/(\d{2})\//.exec(url);
  const year = match?.[1];
  const month = match?.[2];
  if (year === undefined || month === undefined) return 0;
  return Number(year) * 100 + Number(month);
};

/**
 * Extrai do HTML do índice as URLs de relatório eleitoral. Só lê `href` — o texto
 * do post não é tocado (R3).
 */
export const extractReportUrls = (html: string, baseUrl: string): string[] => {
  const root = parseHtml(html);
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const anchor of root.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href');
    if (href === undefined || href.trim().length === 0) continue;
    let absolute: string;
    try {
      absolute = new URL(href.trim(), baseUrl).toString();
    } catch {
      continue; // href malformado no HTML de terceiro: ignorar, não é dado
    }
    if (!PODERDATA_REPORT_URL_PATTERN.test(absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    urls.push(absolute);
  }
  return urls.sort((a, b) => recencyKey(b) - recencyKey(a));
};

export interface PoderDataAdapterDeps extends BaseAdapterDeps {
  /** Injetável para teste; em produção é o cliente educado compartilhado. */
  http?: HttpClient;
}

export class PoderDataAdapter extends BaseAdapter {
  readonly id = PODERDATA_ADAPTER_ID;
  readonly instituteId = PODERDATA_INSTITUTE_ID;

  private readonly http: HttpClient;

  constructor(deps: PoderDataAdapterDeps) {
    super(deps);
    this.http = deps.http ?? sharedHttpClient();
  }

  /**
   * O PoderData não expõe URL por `tse_id`: os relatórios ficam listados num
   * índice. Percorremos os índices conhecidos em ordem, SEQUENCIALMENTE, e
   * devolvemos os PDFs encontrados no primeiro que der resultado.
   *
   * Índice que não devolve nenhum PDF LANÇA. Um `discover` que retorna lista vazia
   * é "sucesso silencioso com zero dado" — exatamente o que a Q-09 descreve e o
   * que R4 proíbe.
   */
  async discover(_reg: PollRegistration): Promise<SourceCandidate[]> {
    const failures: string[] = [];
    for (const indexUrl of PODERDATA_DISCLOSURE_INDEX_URLS) {
      const response = await this.http.request({ url: indexUrl });
      if (response.status !== HTTP_OK) {
        failures.push(`${indexUrl}: HTTP ${String(response.status)}`);
        continue;
      }
      const urls = extractReportUrls(response.body, indexUrl);
      if (urls.length === 0) {
        failures.push(`${indexUrl}: nenhum PDF de relatório eleitoral no índice`);
        continue;
      }
      return urls.map((url) =>
        sourceCandidateSchema.parse({
          url,
          reason:
            'Relatório técnico em PDF publicado pelo próprio PoderData (nível 2 de docs/04 §1); ' +
            'traz o registro TSE e as tabelas de intenção de voto',
        }),
      );
    }
    throw new ParseError(
      `Nenhum índice do PoderData devolveu URL de relatório: ${failures.join('; ')}. ` +
        `Recusando em vez de devolver lista vazia (Q-09: zero dado não é sucesso).`,
    );
  }

  protected async documentToText(raw: RawDocument): Promise<string> {
    const bytes = await this.storage.readBytes(raw.storagePath);
    // Reusa a extração de texto de PDF do cnt-mda (`unpdf`, sem headless) — é o
    // reuso previsto em docs/04 §3 e evita replicar a lógica.
    return extractPdfText(bytes);
  }

  protected extractScenarios(text: string, reg: PollRegistration): RawScenario[] {
    // `fieldEnd` do registro confirma que a onda lida é a da rodada (o relatório
    // publica a série histórica inteira em cada gráfico).
    return parsePoderDataReport(text, reg.fieldEnd);
  }
}
