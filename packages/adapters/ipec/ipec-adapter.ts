/**
 * Adapter Ipec — "Inteligência em Pesquisa e Consultoria Estratégica"
 * (docs/04 §1 nível 2: site do próprio instituto, primeira mão).
 *
 * Herda de `BaseAdapter`, que já resolve as partes perigosas e comuns: V6
 * (confirmação do `tse_id` antes de qualquer extração), alias desconhecido ⇒
 * `UnknownCandidateError`, "nunca parcial" (o `ParsedPoll` inteiro passa pelo
 * Zod) e "ausência ≠ zero". Aqui fica só o que é do Ipec.
 *
 * FONTE, COMO ELA REALMENTE É (investigado antes de escrever o parser):
 *
 * - O domínio é `ipec-inteligencia.com.br`. `ipec.com.br` (que está no seed) NÃO
 *   RESOLVE. Ver `IPEC_SITE_URL`.
 * - `/pesquisas/` é uma SPA AngularJS. O índice de rodadas NÃO está no HTML: vem
 *   de `GET /api/arquivo/ListAtivos/?pageNumber=&idArquivo=&nome=`, que devolve
 *   `{Retorno, Total, TotalPaginas}` (descoberto no JS real do site).
 * - Cada publicação é um PDF em `/Repository/Files/<id>/<nome>.pdf`. Há dois
 *   tipos, e a diferença é decisiva:
 *     · **release** (`… - release.pdf`) — 4–6 páginas, e traz o REGISTRO NO TSE
 *       ("registrada no Tribunal Superior Eleitoral sob o protocolo Nº
 *       BR-01979/2022"). É o documento que o adapter consome.
 *     · **relatório de tabelas** (`…_Relatorio_de_tabelas_Imprensa.pdf`) — 50+
 *       páginas de cross-tabs e SEM número de registro. Verificado: nenhuma
 *       ocorrência de `BR-NNNNN/AAAA` no PDF inteiro. Como o `BaseAdapter`
 *       aplica V6 e recusa documento sem o `tse_id`, esse arquivo é inútil para
 *       nós — e é bom que seja, porque o V6 está fazendo exatamente o seu
 *       trabalho.
 * - **A coleta live está bloqueada.** O host responde 403 com
 *   `Cf-Mitigated: challenge` (desafio Cloudflare que exige JavaScript) para o
 *   site, para o `/robots.txt` e para a API. Sem headless browser na v1
 *   (`CLAUDE.md`; docs/04 §6) não há caminho educado de coleta. Não é bloqueio
 *   ao nosso User-Agent: a única captura de 2026 do Internet Archive para o
 *   domínio também é 403. Ver `IPEC_ACCESS_NOTE`.
 *
 * O `discover` continua devolvendo as URLs candidatas CERTAS, com o motivo
 * explícito. Quem busca é o HarvestJob, com o `HttpClient` compartilhado (robots
 * + 1 req/10s/host, docs/04 §6); ao tomar 403 duas vezes ele desabilita a fonte
 * e alerta, que é a conduta correta (docs/04 §6: "não insista"). O `parse`, por
 * outro lado, funciona hoje sobre qualquer release já salvo em `raw_documents` —
 * é o caminho de `pnpm ingest:reparse` (docs/04 §7), sem rede.
 */

import type {
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import { sourceCandidateSchema } from '@election-pool/contracts/domain';
import { BaseAdapter } from '../base/base-adapter.js';
import type { RawScenario } from '../base/base-adapter.js';
import { ParseError } from '../poll-source-adapter.js';
// O extrator de texto de PDF é o mesmo do cnt-mda (`unpdf`, sem headless): um só
// caminho de PDF no projeto, como pede docs/04 §4.1 para o helper de número.
import { extractPdfText } from '../cnt-mda/pdf.js';
import { parseIpecReleaseText } from './parse.js';
import {
  IPEC_ACCESS_NOTE,
  IPEC_ADAPTER_ID,
  IPEC_INSTITUTE_ID,
  IPEC_LIST_API_URL,
  IPEC_PESQUISAS_URL,
} from './constants.js';

/**
 * `true` quando o documento é PDF. O release do Ipec é sempre PDF; o HTML da
 * `/pesquisas/` é só a casca da SPA e nunca contém resultado.
 */
const isPdf = (raw: RawDocument): boolean =>
  // `contentType` é anulável no contrato: servidor que não manda o header existe.
  // Nesse caso a extensão da URL decide — nunca assumimos PDF por omissão.
  (raw.contentType?.toLowerCase().includes('pdf') ?? false) ||
  raw.url.toLowerCase().endsWith('.pdf');

export class IpecAdapter extends BaseAdapter {
  readonly id = IPEC_ADAPTER_ID;
  readonly instituteId = IPEC_INSTITUTE_ID;

  discover(_reg: PollRegistration): Promise<SourceCandidate[]> {
    // O Ipec não expõe URL por `tse_id`: o release da rodada entra no índice de
    // publicações. Devolvemos o índice (HTML) e a API que o alimenta (JSON), na
    // ordem em que vale tentar. Não buscamos aqui — só apontamos; o `parse`
    // confirma o `tse_id` (V6) antes de aceitar qualquer número.
    const candidates = [
      sourceCandidateSchema.parse({
        url: IPEC_LIST_API_URL,
        reason:
          'Índice de publicações do Ipec em JSON (ListAtivos), que alimenta /pesquisas/; ' +
          `o release em PDF da rodada é listado aqui. ${IPEC_ACCESS_NOTE}`,
      }),
      sourceCandidateSchema.parse({
        url: IPEC_PESQUISAS_URL,
        reason:
          'Página de pesquisas divulgadas do Ipec (SPA AngularJS; o HTML é só a casca, ' +
          `os itens vêm da API). ${IPEC_ACCESS_NOTE}`,
      }),
    ];
    return Promise.resolve(candidates);
  }

  protected async documentToText(raw: RawDocument): Promise<string> {
    if (!isPdf(raw)) {
      // Falha alta: se um dia chegar HTML aqui, é a casca da SPA (sem resultado)
      // ou mudança de estrutura. Nunca tentamos "melhor esforço" sobre ele.
      throw new ParseError(
        `Documento do Ipec não é PDF (contentType "${raw.contentType ?? 'ausente'}", url "${raw.url}"). ` +
          'O resultado do Ipec só existe no release em PDF; o HTML de /pesquisas/ é a casca da SPA.',
      );
    }
    const bytes = await this.storage.readBytes(raw.storagePath);
    return extractPdfText(bytes);
  }

  protected extractScenarios(text: string, _reg: PollRegistration): RawScenario[] {
    return parseIpecReleaseText(text);
  }
}
