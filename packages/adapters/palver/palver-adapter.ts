/**
 * Adapter Palver — fonte de NÍVEL 2 de docs/04 §1 (site do próprio instituto).
 *
 * ## Item verificado antes de escrever uma linha: é pesquisa REGISTRADA?
 *
 * Sim. A Palver tem DOIS produtos que não podem ser confundidos:
 *
 * 1. **Monitoramento de narrativa / escuta social** — a plataforma que a empresa
 *    vende, que acompanha menções em imprensa, rádio, TV, redes e aplicativos de
 *    mensagem. Isso é medida de MENÇÃO e **nunca** entra neste sistema.
 * 2. **Pesquisa Palver** — survey quantitativo online por questionário
 *    estruturado, amostra não-probabilística recrutada por anúncios em redes
 *    sociais, com cotas de sexo/faixa etária/geografia e calibração por raking
 *    (IPF) ancorada em PNADc 2024 e no 2º turno de 2022. Registrada no TSE sob
 *    **BR-06596/2026**, divulgada em 2026-08-10, campo de 03 a 07/08/2026 (o
 *    `config.yaml` da onda diz 03 a 09/08 — divergência da própria fonte,
 *    registrada em `__fixtures__/README.md`), n=5.000, IC 95%, margem ± 3 p.p.
 *
 * O que este adapter colhe é (2), e SÓ (2). O recrutamento é por anúncio em rede
 * social com formulário de link único — **não** é coleta por mensageria/WhatsApp,
 * ao contrário do que o comentário do `instituto` no seed sugere (ver relatório da
 * task). O enum `painelOnline` continua correto; a justificativa escrita é que
 * está errada.
 *
 * ## Estado da colheita: ligado, mas sem número disponível
 *
 * Dois bloqueios REAIS, ambos verificados ao vivo, e nenhum deles resolvível por
 * código deste adapter:
 *
 * - **Os resultados não estão em camada de texto.** O relatório publicado é um
 *   deck cujas páginas de resultado são gráficos rasterizados. `parse` LANÇA com
 *   diagnóstico explícito (ver `parse.ts`). Sem OCR — fora de escopo na v1 — não
 *   há número. A Palver promete os MICRODADOS depois do 2º turno; é aí que a
 *   colheita fica viável.
 * - **`BR-06596/2026` não está na janela de 30 dias do PesqEle.** Varredura ao
 *   vivo em 2026-08-17 trouxe 50 registros nacionais e a sequência 06596 cai no
 *   vão entre `BR-06267/2026` e `BR-06773/2026`. Por docs/08 §1, pesquisa sem
 *   registro localizado no PesqEle não entra no agregado — logo o `DiscoveryJob`
 *   nunca produz um `PollRegistration` para este adapter tratar hoje.
 *
 * O adapter existe porque a fonte é uma referência de transparência (código de
 * calibração aberto, compromisso de microdados) e porque o `discover` já aponta
 * para os documentos certos no dia em que o registro aparecer. V6, resolução de
 * alias, "nunca parcial" e "ausência ≠ zero" são do `BaseAdapter`.
 */

import type {
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import { sourceCandidateSchema } from '@election-pool/contracts/domain';
import { BaseAdapter } from '../base/base-adapter.js';
import type { RawScenario } from '../base/base-adapter.js';
import { extractPdfText } from '../cnt-mda/pdf.js';
import { parsePalverReportText } from './parse.js';

export const PALVER_ADAPTER_ID = 'palver';
export const PALVER_INSTITUTE_ID = 'palver';

/**
 * Endpoints REAIS do site da Palver, lidos dos `href` da página `/survey`
 * (capturados em 2026-08-17; ambos devolvem `application/pdf` com HTTP 200). Não
 * há URL por `tse_id` nem índice de ondas: a página lista a onda corrente e os
 * dois downloads. Por isso `discover` devolve as duas, e o V6 do `BaseAdapter`
 * confirma a identidade do documento antes de qualquer número ser aceito.
 */
const PALVER_RELATORIO_URL =
  'https://www.palver.com.br/api/surveys/voting-intention-2026-august/report';
const PALVER_PRESS_RELEASE_URL =
  'https://www.palver.com.br/api/surveys/voting-intention-2026-august/press-release';

/**
 * Espelho versionado por ONDA no repositório aberto da Palver
 * (`palverdata/pesquisa-palver`). Vale como candidato porque é a mesma fonte
 * primária (a própria Palver publica ali), o caminho carrega a data de divulgação
 * — o que o endpoint do site não faz — e cada onda divulgada ganha uma tag git.
 * Fica DEPOIS das URLs do site: o site é o canal de divulgação, o repositório é o
 * espelho.
 */
const PALVER_REPO_ONDA_RELATORIO_URL =
  'https://raw.githubusercontent.com/palverdata/pesquisa-palver/main/divulgacao/2026-08-10/relatorio-onda-01.pdf';

export class PalverAdapter extends BaseAdapter {
  readonly id = PALVER_ADAPTER_ID;
  readonly instituteId = PALVER_INSTITUTE_ID;

  discover(_reg: PollRegistration): Promise<SourceCandidate[]> {
    // Ordem = ordem de tentativa. O relatório é o único documento com chance de
    // trazer os cenários; o press release traz o registro TSE e a metodologia, mas
    // NÃO traz número de intenção de voto (verificado na captura real) — entra como
    // candidato porque é o documento que confirma a identidade da rodada.
    const candidates = [
      {
        url: PALVER_RELATORIO_URL,
        reason:
          'Relatório completo da onda corrente no site da Palver (nível 2); é o documento ' +
          'que traz as seções de 1º turno espontâneo/estimulado e de 2º turno',
      },
      {
        url: PALVER_REPO_ONDA_RELATORIO_URL,
        reason:
          'Espelho do mesmo relatório no repositório aberto da Palver, com o caminho ' +
          'versionado pela data de divulgação da onda',
      },
      {
        url: PALVER_PRESS_RELEASE_URL,
        reason:
          'Press release da onda; carrega o número de registro no TSE e a metodologia ' +
          'declarada, sem os percentuais',
      },
    ].map((c) => sourceCandidateSchema.parse(c));
    return Promise.resolve(candidates);
  }

  /**
   * A Palver publica só PDF (o `/survey` é uma SPA sem os números no HTML).
   * Extração de texto pelo mesmo caminho do cnt-mda (`unpdf`, sem headless).
   */
  protected async documentToText(raw: RawDocument): Promise<string> {
    const bytes = await this.storage.readBytes(raw.storagePath);
    return extractPdfText(bytes);
  }

  protected extractScenarios(text: string, _reg: PollRegistration): RawScenario[] {
    return parsePalverReportText(text);
  }
}
