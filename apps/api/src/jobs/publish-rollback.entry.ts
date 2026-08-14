import { requirePublishBaseDir, resolvePublishPaths } from '../publish/paths.js';
import { rollback } from '../publish/atomic-swap.js';

/**
 * Entrada CLI do rollback (`pnpm publish:rollback`, docs/02 §3.4). Restaura o
 * snapshot `dist-*` mais recente para `dist/`, por swap atômico. IDEMPOTENTE:
 * rodar duas vezes restaura o mesmo estado, sem erro.
 *
 * `PUBLISH_BASE_DIR` é obrigatória. Não toca o banco — é uma operação de sistema
 * de arquivos pura sobre o diretório de publicação.
 */

const main = async (): Promise<void> => {
  const paths = resolvePublishPaths(requirePublishBaseDir());
  const restored = await rollback(paths);
  if (restored === null) {
    console.log(
      JSON.stringify({
        job: 'publish:rollback',
        restored: null,
        note: 'sem snapshot para restaurar',
      }),
    );
    // Sem snapshot é um no-op legítimo (idempotência): não é falha.
    return;
  }
  console.log(JSON.stringify({ job: 'publish:rollback', restored, dist: paths.dist }));
};

main().catch((error: unknown) => {
  // Falha alta, nunca silenciosa (R4).
  console.error('publish:rollback failed:', error);
  process.exit(1);
});
