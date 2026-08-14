/**
 * Entry point de `pnpm ingest:discover`. Fino de propósito: só dispara o job e
 * sai com código não-zero se falhar (para o cron/orquestrador detectar). A
 * lógica vive em `discovery.job.ts`, importável sem efeito colateral pelos testes.
 */

import { runDiscoveryJob } from './discovery.job.js';

runDiscoveryJob()
  .then(() => {
    // Alertas (instituto/corrida desconhecidos) NÃO são falha: são sinal para
    // cadastro manual. O job em si teve sucesso.
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('[discovery] falhou:', err);
    process.exit(1);
  });
