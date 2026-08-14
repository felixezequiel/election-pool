/**
 * Entrypoint do script `model:backtest` (T-09, docs/07 §4). Roda o backtest de
 * 2022, imprime a tabela (com a LARGURA do IC) e (re)gera `docs/BACKTEST-RESULTS.md`.
 *
 * Fino de propósito: toda a lógica vive em `backtest.ts`. Sai com código 1 se o
 * backtest reprovar, para poder falhar em CI (o gate M-7, docs/07 §3). Isto é o
 * único módulo do pacote que fecha o processo — `backtest.ts` continua sem efeito
 * colateral de saída, para ser testável.
 */

import { main } from './backtest.js';

const ok = main();
if (!ok) process.exitCode = 1;
