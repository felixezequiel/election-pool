import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * "Este módulo está sendo executado como programa, ou apenas importado?"
 *
 * Existe porque vários arquivos deste app são as DUAS coisas: `seed.ts` é CLI
 * (`pnpm db:seed`) e também é importado pelo boot do orquestrador; `main.ts` é o
 * entrypoint do container e é importado pelos testes. Sem o guarda, o import
 * dispara a CLI como efeito colateral.
 *
 * A implementação ingênua — comparar `import.meta.url` com `` `file://${argv[1]}` ``
 * ou usar `endsWith(argv[1])` — QUEBRA NO WINDOWS, e quebra do pior jeito
 * possível: silenciosamente, devolvendo `false`. `import.meta.url` é
 * `file:///C:/Users/.../seed.ts` (barras normais, com drive), enquanto
 * `process.argv[1]` é `C:\Users\...\seed.ts` (contrabarras). Nenhuma das duas
 * comparações casa, o `main()` nunca roda, e o comando termina com código 0 sem
 * fazer nada. Foi assim que um `pnpm db:seed` "bem-sucedido" deixou de inserir
 * qualquer linha, e só o Linux do container escondia o problema.
 *
 * A forma correta é converter os DOIS lados para caminho absoluto do sistema de
 * arquivos e comparar isso. `realpathSync` resolve symlink e diferença de
 * capitalização de drive; se o caminho não existir (caso improvável), caímos no
 * `resolve` puro em vez de lançar — a pergunta "sou o entrypoint?" nunca deve
 * derrubar o processo.
 */
const canonical = (path: string): string => {
  try {
    return realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
};

export const isEntrypoint = (moduleUrl: string): boolean => {
  const argv1 = process.argv[1];
  if (argv1 === undefined || argv1.length === 0) return false;
  return canonical(fileURLToPath(moduleUrl)) === canonical(argv1);
};
