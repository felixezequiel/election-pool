/**
 * Adapter CNT/MDA (docs/04 §3, fonte 2: portal CNT, PDF de relatório completo).
 * Herda de `BaseAdapter`; implementa só o que é da fonte:
 *
 * - `discover`: aponta o portal de pesquisas da CNT (nível 3 da hierarquia,
 *   docs/04 §1: release do contratante). Não busca — só devolve URLs candidatas.
 * - `documentToText`: lê os BYTES do PDF salvo no blob e extrai texto (`unpdf`,
 *   sem headless).
 * - `extractScenarios`: delega a `parseCntMdaText`.
 *
 * V6, resolução de alias, "nunca parcial" e "ausência ≠ zero" são do `BaseAdapter`.
 */

import type {
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import { sourceCandidateSchema } from '@election-pool/contracts/domain';
import { BaseAdapter } from '../base/base-adapter.js';
import type { RawScenario } from '../base/base-adapter.js';
import { extractPdfText } from './pdf.js';
import { parseCntMdaText } from './parse.js';

export const CNT_MDA_ADAPTER_ID = 'cnt-mda';
export const CNT_MDA_INSTITUTE_ID = 'mda';
const CNT_SURVEYS_URL = 'https://cnt.org.br/pesquisas';

export class CntMdaAdapter extends BaseAdapter {
  readonly id = CNT_MDA_ADAPTER_ID;
  readonly instituteId = CNT_MDA_INSTITUTE_ID;

  discover(_reg: PollRegistration): Promise<SourceCandidate[]> {
    const candidate = sourceCandidateSchema.parse({
      url: CNT_SURVEYS_URL,
      reason: 'Portal de pesquisas da CNT; o relatório MDA (PDF) da rodada é publicado aqui',
    });
    return Promise.resolve([candidate]);
  }

  protected async documentToText(raw: RawDocument): Promise<string> {
    const bytes = await this.storage.readBytes(raw.storagePath);
    return extractPdfText(bytes);
  }

  protected extractScenarios(text: string, _reg: PollRegistration): RawScenario[] {
    return parseCntMdaText(text);
  }
}
