/**
 * Adapter nexus (docs/04 §3, fonte 1: `nexus.fsb.com.br/estudos-divulgados`,
 * HTML + PDF). Herda de `BaseAdapter`; implementa só o que é da fonte:
 *
 * - `discover`: aponta a página de estudos divulgados (nível 2 da hierarquia,
 *   docs/04 §1). Não busca — só devolve URLs candidatas.
 * - `documentToText`: lê o HTML salvo do blob. (A rodada do nexus é HTML
 *   estruturado; o PDF é redundante para os números — se um dia só o PDF tiver o
 *   dado, o mesmo adapter ganha um ramo de PDF reusando `cnt-mda/pdf`.)
 * - `extractScenarios`: delega a `parseNexusHtml`.
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
import { parseNexusHtml } from './parse.js';

export const NEXUS_ADAPTER_ID = 'nexus';
export const NEXUS_INSTITUTE_ID = 'nexus';
const NEXUS_STUDIES_URL = 'https://nexus.fsb.com.br/estudos-divulgados';

export class NexusAdapter extends BaseAdapter {
  readonly id = NEXUS_ADAPTER_ID;
  readonly instituteId = NEXUS_INSTITUTE_ID;

  discover(_reg: PollRegistration): Promise<SourceCandidate[]> {
    // O nexus não expõe URL por `tse_id`: a rodada semanal fica no índice de
    // estudos divulgados. Devolvemos o índice como candidato; o HarvestJob busca,
    // salva o raw e o `parse` confirma o `tse_id` (V6) antes de aceitar.
    const candidate = sourceCandidateSchema.parse({
      url: NEXUS_STUDIES_URL,
      reason: 'Índice de estudos divulgados do nexus; a rodada semanal é publicada aqui em HTML',
    });
    return Promise.resolve([candidate]);
  }

  protected async documentToText(raw: RawDocument): Promise<string> {
    return this.storage.readText(raw.storagePath);
  }

  protected extractScenarios(text: string, _reg: PollRegistration): RawScenario[] {
    return parseNexusHtml(text);
  }
}
