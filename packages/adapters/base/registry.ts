/**
 * Registro de adapters (docs/02 §4). O documento pede um "módulo NestJS"; como
 * NestJS ainda NÃO está montado no projeto (o DiscoveryJob de T-05 é função pura),
 * seguimos o mesmo padrão e implementamos um registro TIPADO simples: um array de
 * adapters + resolução por `canHandle`. Adicionar instituto = adicionar arquivo +
 * uma entrada aqui; nenhum `if/else` espalhado — o requisito real de docs/02 §4.
 *
 * DESVIO REGISTRADO: "módulo NestJS" de docs/02 §4 vira "registro tipado simples".
 * Quando o orquestrador (T-14) montar o Nest, isto vira um provider trivialmente.
 */

import type { PollRegistration } from '@election-pool/contracts/domain';
import type { PollSourceAdapter } from '../poll-source-adapter.js';

export class AdapterRegistry {
  private readonly adapters: readonly PollSourceAdapter[];

  constructor(adapters: readonly PollSourceAdapter[]) {
    // Ids duplicados são erro de configuração: dois adapters com o mesmo id
    // tornam a resolução ambígua. Falha alta no boot (R4), não em produção.
    const ids = new Set<string>();
    for (const adapter of adapters) {
      if (ids.has(adapter.id)) {
        throw new Error(`Adapter id duplicado no registro: "${adapter.id}"`);
      }
      ids.add(adapter.id);
    }
    this.adapters = adapters;
  }

  /**
   * Resolve o adapter que sabe lidar com o registro. Se mais de um `canHandle`
   * (não deveria — cada adapter cobre um `instituteId`), é ambiguidade e lança.
   * Nenhum ⇒ `null` (registro sem adapter conhecido; o HarvestJob ignora com log).
   */
  resolve(reg: PollRegistration): PollSourceAdapter | null {
    const matches = this.adapters.filter((a) => a.canHandle(reg));
    if (matches.length > 1) {
      throw new Error(
        `Mais de um adapter para ${reg.tseId} (instituto ${reg.instituteId ?? 'null'}): ` +
          matches.map((a) => a.id).join(', '),
      );
    }
    return matches[0] ?? null;
  }

  byId(id: string): PollSourceAdapter | null {
    return this.adapters.find((a) => a.id === id) ?? null;
  }

  all(): readonly PollSourceAdapter[] {
    return this.adapters;
  }
}
