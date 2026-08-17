import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Este processo consegue criar symlink no sistema de arquivos?
 *
 * Existe por causa do Windows: criar symlink lá exige privilégio (Developer Mode
 * ou administrador) e, sem ele, `symlink()` falha com `EPERM`. A publicação deste
 * projeto TROCA UM SYMLINK (`dist`, docs/02 §3.4), então os testes de swap atômico
 * e de saúde do `dist` são intrinsecamente Linux — e é em Linux que eles rodam de
 * verdade: no container da API e no CI.
 *
 * Sem esta checagem, o gate rápido (`pnpm test:unit`) ficava VERMELHO em toda
 * máquina Windows por um motivo que não é o código. Vermelho crônico e conhecido é
 * pior que teste pulado: ensina a ignorar o resultado da suíte.
 *
 * A escolha deliberada é pular com motivo VISÍVEL, nunca fingir que passou — e
 * pular só o que depende de symlink, não o arquivo inteiro por precaução.
 */
export const canCreateSymlink = (): boolean => {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), 'symlink-probe-'));
    symlinkSync(dir, join(dir, 'link'), 'dir');
    return true;
  } catch {
    return false;
  } finally {
    if (dir !== null) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Limpeza de sonda não pode derrubar a suíte.
      }
    }
  }
};

/** Motivo exibido no skip, para o resultado nunca ser silencioso. */
export const SYMLINK_SKIP_REASON =
  'requer criação de symlink (Windows sem Developer Mode/admin); roda no container Linux e no CI';
