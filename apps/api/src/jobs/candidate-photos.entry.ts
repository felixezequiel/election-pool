/**
 * Entry point de `pnpm ingest:photos`. Fino de propósito: resolve dependências,
 * dispara o job, imprime o resumo e sai com código != 0 se houve falha
 * operacional. A lógica vive em `candidate-photos.job.ts`, importável sem efeito
 * colateral pelos testes.
 *
 * Onde as fotos são gravadas: `apps/web/public/candidatos/`. O Astro copia
 * `public/` inteiro para o build, e o `RenderJob` publica esse build em
 * `PUBLISH_BASE_DIR` — logo `public/candidatos/lula.jpg` vira `/candidatos/lula.jpg`
 * no site, que é exatamente o formato de `photoPath` em contracts/public-data.ts.
 * Escrever direto no `PUBLISH_BASE_DIR` seria errado: o próximo build atômico
 * apagaria as fotos.
 *
 * Flags:
 *   --force   reconfere todas as fotos, ignorando a janela de recheck de 24h.
 */

import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { TseCandidatosClient } from '@election-pool/adapters/tse-candidatos/client';
import { configurePgTypes } from '../db/types.js';
import { createDatabase } from '../db/pool.js';
import { CandidatePhotosRepository } from '../db/candidate-photos.repository.js';
import { CandidatePhotosJob } from './candidate-photos.job.js';
import type { CandidatePhotosResult } from './candidate-photos.job.js';

const { Pool } = pg;

/**
 * Diretório físico das fotos. `CANDIDATE_PHOTOS_DIR` sobrescreve (container,
 * teste); o default aponta para `apps/web/public/candidatos` resolvido a partir
 * DESTE arquivo — nunca do `cwd`, que muda conforme quem invoca.
 */
export const resolvePhotosDir = (env: NodeJS.ProcessEnv = process.env): string => {
  const override = env['CANDIDATE_PHOTOS_DIR'];
  if (override !== undefined && override.length > 0) return override;
  return fileURLToPath(new URL('../../../web/public/candidatos', import.meta.url));
};

export const runCandidatePhotosJob = async (
  argv: readonly string[] = process.argv.slice(2),
): Promise<CandidatePhotosResult> => {
  configurePgTypes();
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL não definida (veja infra/.env)');
  }
  const pool = new Pool({ connectionString });
  const db = createDatabase(pool);
  try {
    const job = new CandidatePhotosJob({
      repo: new CandidatePhotosRepository(db),
      client: new TseCandidatosClient(),
      photosDir: resolvePhotosDir(),
      force: argv.includes('--force'),
    });
    const result = await job.run();
    console.log(
      `[photos] candidatos=${result.candidatosLocais} candidaturas=${result.candidaturasTse} ` +
        `casados=${result.casados} novas=${result.novas} atualizadas=${result.atualizadas} ` +
        `inalteradas=${result.inalteradas} downloads=${result.downloads} ` +
        `alertas=${result.alerts.length}`,
    );
    for (const alerta of result.alerts) {
      const linha =
        `[photos][alert] ${alerta.kind} candidato=${alerta.candidateId ?? '-'} ` +
        `candidatura=${alerta.idCandidatura ?? '-'} :: ${alerta.detail}`;
      if (alerta.isError) console.error(linha);
      else console.warn(linha);
    }
    return result;
  } finally {
    await db.end();
  }
};

runCandidatePhotosJob()
  .then((result) => {
    // Alerta de cadastro (candidato sem candidatura, candidatura não rastreada)
    // NÃO é falha: é sinal para revisão humana. Falha operacional — imagem
    // inválida, autorização revogada — sai != 0 para o cron enxergar.
    const errors = result.alerts.filter((a) => a.isError);
    process.exit(errors.length > 0 ? 1 : 0);
  })
  .catch((err: unknown) => {
    console.error('[photos] falhou:', err);
    process.exit(1);
  });
