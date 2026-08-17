/**
 * Adapter Datafolha. A fonte é o site do PRÓPRIO instituto
 * (`datafolha.folha.uol.com.br/eleicoes`) — nível 2 da hierarquia de docs/04 §1,
 * não a matéria da Folha (nível 4, que exigiria aprovação explícita e que o
 * CLAUDE.md proíbe antes de esgotar as primárias). A primária EXISTE, é pública e
 * traz o registro TSE no corpo da publicação; então nível 4 não é necessário.
 *
 * O que este adapter herda do `BaseAdapter` e não reimplementa: V6 (identidade por
 * `tse_id`), alias desconhecido ⇒ `UnknownCandidateError`, "nunca parcial" (Zod no
 * `ParsedPoll`) e "ausência ≠ zero".
 *
 * O que é específico da fonte:
 * - `discover`: índice do ano da rodada + índice da seção. O Datafolha não tem URL
 *   por `tse_id`; a rodada mora em `/eleicoes/<ano>/<mes>/<slug>.shtml` e o índice
 *   do ano a lista. O `HarvestJob` busca, salva o raw e o `parse` confirma o V6.
 *   **Não devolvemos o PDF "RELATÓRIO COMPLETO"**: ele mora em host cujo
 *   `robots.txt` é `Disallow: /` para todo agente (docs/04 §6 é não-negociável).
 * - `documentToText`: HTML do blob → parágrafos de `[itemprop="articleBody"]`.
 *   Restringir ao corpo fortalece o V6 (o registro tem de estar na publicação, não
 *   num teaser de outra rodada).
 * - `extractScenarios`: delega a `parseDatafolhaText`.
 *
 * LIMITE CONHECIDO E DELIBERADO (ver relatório da T-20 e `__fixtures__/README.md`):
 * nas rodadas PRESIDENCIAIS capturadas, o Datafolha escreve o percentual dos dois
 * primeiros colocados preso a uma descrição ("o atual presidente", "o presidenciável
 * do PL") e não a um nome. O parser recusa o documento nesse caso, em vez de
 * adivinhar quem é a descrição. Consequência honesta: hoje este adapter manda a
 * rodada presidencial para quarentena e não publica número nenhum. Isso é o
 * comportamento correto — R4 e docs/04 §4.1 — e é preferível a um cenário sem os
 * dois líderes ou, pior, com o número deles no candidato errado.
 */

import type {
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import { sourceCandidateSchema } from '@election-pool/contracts/domain';
import { BaseAdapter } from '../base/base-adapter.js';
import type { RawScenario } from '../base/base-adapter.js';
import {
  DATAFOLHA_ADAPTER_ID,
  DATAFOLHA_ELECTIONS_INDEX,
  DATAFOLHA_INSTITUTE_ID,
  datafolhaYearIndex,
} from './constants.js';
import { datafolhaArticleParagraphs, parseDatafolhaText } from './parse.js';

/** Ano de campo do registro, para escolher o índice certo (`/eleicoes/<ano>/`). */
const yearOf = (isoDate: string): number => {
  const m = /^(\d{4})/.exec(isoDate);
  const year = m?.[1];
  if (year === undefined) {
    // Nunca acontece com `IsoDate` válido; ainda assim não inventamos ano (R4).
    throw new Error(`Data do registro em formato inesperado: "${isoDate}"`);
  }
  return Number(year);
};

export class DatafolhaAdapter extends BaseAdapter {
  readonly id = DATAFOLHA_ADAPTER_ID;
  readonly instituteId = DATAFOLHA_INSTITUTE_ID;

  discover(reg: PollRegistration): Promise<SourceCandidate[]> {
    const year = yearOf(reg.fieldEnd);
    const candidates = [
      sourceCandidateSchema.parse({
        url: datafolhaYearIndex(year),
        reason:
          `Índice de ${String(year)} da seção de eleições do próprio Datafolha; ` +
          `a rodada é publicada em /eleicoes/${String(year)}/<mes>/<slug>.shtml`,
      }),
      sourceCandidateSchema.parse({
        url: DATAFOLHA_ELECTIONS_INDEX,
        reason: 'Índice da seção de eleições do Datafolha (fallback quando o ano ainda não abriu)',
      }),
    ];
    return Promise.resolve(candidates);
  }

  protected async documentToText(raw: RawDocument): Promise<string> {
    const html = await this.storage.readText(raw.storagePath);
    return datafolhaArticleParagraphs(html).join('\n\n');
  }

  protected extractScenarios(text: string, _reg: PollRegistration): RawScenario[] {
    return parseDatafolhaText(text);
  }
}
