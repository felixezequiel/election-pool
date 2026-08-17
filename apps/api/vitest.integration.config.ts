import { defineConfig } from 'vitest/config';

/**
 * Suíte de INTEGRAÇÃO — fala com um Postgres real.
 *
 * `fileParallelism: false` aqui é CORREÇÃO, não preguiça: os testes truncam
 * `poll_results`/`poll_scenarios`/`poll_registrations`/`raw_documents` entre casos
 * e compartilham um schema, então dois arquivos ao mesmo tempo se apagam
 * mutuamente. O sintoma é falha intermitente que muda de arquivo a cada execução.
 *
 * O banco usado é DERIVADO (`<banco>_test`) em `db/test-helpers.ts`: a suíte não
 * alcança o banco de desenvolvimento nem se `TEST_DATABASE_URL` for esquecida.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.integration.spec.ts', 'src/db/enum-check-parity.spec.ts'],
    exclude: ['**/node_modules/**'],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
