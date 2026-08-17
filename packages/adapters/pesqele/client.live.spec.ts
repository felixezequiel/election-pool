import { describe, it, expect } from 'vitest';
import { PesqEleClient } from './client.js';
import { HttpClient } from '../http-client.js';
import { LIMITE_RESULTADO_DECLARADO } from './constants.js';
import type { PesqEleAlert, PesqEleSweepStats } from './client.js';
import type { RawRegistration } from './registration.js';

/**
 * TESTE DE FUMAÇA AO VIVO — é o teste que faltou em T-05 (Q-09) e o canário do
 * conserto de T-28.
 *
 * Fixture, por mais real que seja, é uma foto: prova que o parser lê AQUELA
 * resposta, não que o protocolo ainda casa com o site de hoje. Este teste bate no
 * PesqEle de verdade e falha se a coleta voltar vazia OU se voltar presa no teto de
 * 50 registros — o sintoma exato do bug que a varredura fatiada conserta.
 *
 * É OPT-IN por ambiente e fica FORA do `pnpm verify`: usa rede e o rate limit real
 * é 1 req/10s (docs/04 §6), o que dá ~4 min de execução.
 *
 *     PESQELE_LIVE=1 pnpm --filter @election-pool/adapters test pesqele/client.live
 */

const LIVE = process.env['PESQELE_LIVE'] === '1';
const TIMEOUT_MS = 15 * 60 * 1000;

describe.skipIf(!LIVE)('PesqEleClient ao vivo contra o pesqele-divulgacao.tse.jus.br', () => {
  it(
    'a varredura fatiada da janela de 30 dias passa do teto de 50 registros',
    async () => {
      const client = new PesqEleClient({ http: new HttpClient() });
      const vistos = new Set<string>();
      const alertas: PesqEleAlert[] = [];
      let stats: PesqEleSweepStats | undefined;

      for await (const _pagina of client.discover({
        onTseIdSeen: (tseId) => vistos.add(tseId),
        onAlert: (a) => alertas.push(a),
        onSweepStats: (s) => {
          stats = s;
        },
        // Sem detalhe: aqui o que se prova é a COBERTURA da listagem, e o detalhe
        // custaria 2 requisições por registro (Q-09).
        shouldFetchDetalhe: () => false,
      })) {
        void _pagina;
      }

      expect(alertas.filter((a) => a.kind === 'empty_search')).toEqual([]);
      // A prova do conserto: a consulta única devolvia exatamente 50 (truncado).
      expect(vistos.size).toBeGreaterThan(LIMITE_RESULTADO_DECLARADO);
      expect(stats?.tseIdsDistintos).toBe(vistos.size);
      expect(stats?.fatias).toBeGreaterThanOrEqual(10);
      // Se alguma fatia continuar no teto mesmo com um dia, o número acima é um
      // PISO e o alerta tem de estar aí — nunca silêncio.
      if ((stats?.truncagensSuspeitas ?? 0) > 0) {
        expect(alertas.map((a) => a.kind)).toContain('truncation_suspected');
      }
    },
    TIMEOUT_MS,
  );

  it(
    'devolve um registro completo, com detalhe, numa fatia estreita',
    async () => {
      const client = new PesqEleClient({ http: new HttpClient() });
      const vistos: string[] = [];
      let primeiro: RawRegistration | undefined;

      for await (const pagina of client.discover({
        // Três dias bastam para provar que o detalhe continua de pé sem pagar o
        // custo da janela inteira.
        janelaDias: 3,
        larguraFatiaDias: 3,
        onTseIdSeen: (tseId) => vistos.push(tseId),
        shouldFetchDetalhe: (tseId) => tseId === vistos[0],
      })) {
        if (pagina.length > 0) {
          primeiro = pagina[0];
          break;
        }
      }

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
