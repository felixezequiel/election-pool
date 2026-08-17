import { defineConfig } from 'vitest/config';

/**
 * Suíte UNITÁRIA — não toca banco, roda em PARALELO entre arquivos.
 *
 * Existe separada porque antes um único `fileParallelism: false` valia para os 24
 * arquivos: os 11 que não precisam de banco esperavam na fila atrás dos que
 * precisam, e o custo da suíte era a SOMA de tudo. Agora o custo serial é só dos
 * arquivos de integração, em `vitest.integration.config.ts`.
 *
 * `pnpm test:unit` é o laço de feedback rápido; `pnpm test` roda as duas.
 *
 * NOTA de versão: o vitest aqui é 2.1.8, que NÃO entende `test.projects` (isso é
 * vitest 3). Config com `projects` é silenciosamente ignorada — e o efeito colateral
 * é justamente rodar integração em paralelo, com um arquivo truncando as tabelas
 * do outro. Dois arquivos de config explícitos são à prova disso.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    // `enum-check-parity` lê o catálogo do Postgres: é integração, não unitário.
    exclude: [
      '**/node_modules/**',
      'src/**/*.integration.spec.ts',
      'src/db/enum-check-parity.spec.ts',
    ],
    fileParallelism: true,
    testTimeout: 10_000,
  },
});
