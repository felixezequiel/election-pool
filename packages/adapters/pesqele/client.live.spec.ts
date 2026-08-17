import { describe, it, expect } from 'vitest';
import { PesqEleClient } from './client.js';
import { HttpClient } from '../http-client.js';
import type { RawRegistration } from './registration.js';

/**
 * TESTE DE FUMAÇA AO VIVO — é o teste que faltou em T-05 (Q-09).
 *
 * Fixture, por mais real que seja, é uma foto: prova que o parser lê AQUELA
 * resposta, não que o protocolo ainda casa com o site de hoje. Este teste bate no
 * PesqEle de verdade e falha se a coleta voltar vazia.
 *
 * É OPT-IN por ambiente e fica FORA do `pnpm verify`: usa rede, o rate limit real
 * é 1 req/10s (docs/04 §6) e a execução leva ~1 min.
 *
 *     PESQELE_LIVE=1 pnpm --filter @election-pool/adapters test pesqele/client.live
 *
 * Para não custar 17 min ao TSE, buscamos o detalhe de UM registro só e paramos
 * na primeira página.
 */

const LIVE = process.env['PESQELE_LIVE'] === '1';
const TIMEOUT_MS = 5 * 60 * 1000;

describe.skipIf(!LIVE)('PesqEleClient ao vivo contra o pesqele-divulgacao.tse.jus.br', () => {
  it(
    'devolve registros de verdade (seen > 0) e um detalhe completo',
    async () => {
      const client = new PesqEleClient({ http: new HttpClient() });
      const vistos: string[] = [];
      const alertas: string[] = [];
      let primeiro: RawRegistration | undefined;

      for await (const pagina of client.discover({
        onTseIdSeen: (tseId) => vistos.push(tseId),
        onAlert: (a) => alertas.push(a.kind),
        // Só o primeiro registro da página paga o custo do detalhe.
        shouldFetchDetalhe: (tseId) => tseId === vistos[0],
      })) {
        primeiro = pagina[0];
        break; // uma página basta para provar que o protocolo está de pé
      }

      expect(alertas).toEqual([]);
      expect(vistos.length).toBeGreaterThan(0);
      expect(primeiro).toBeDefined();
      expect(primeiro?.tseId).toBe(vistos[0]);
      expect(primeiro?.sampleSize).toBeGreaterThan(0);
      expect(primeiro?.fieldStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(primeiro?.fieldEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(primeiro?.contractorName.length).toBeGreaterThan(0);
      // R3: o PesqEle não tem campo estruturado para estes dois.
      expect(primeiro?.marginOfError).toBeNull();
      expect(primeiro?.confidenceLevel).toBeNull();
    },
    TIMEOUT_MS,
  );
});
