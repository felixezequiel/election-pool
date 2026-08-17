import { isEntrypoint } from '../is-entrypoint.js';
import { configurePgTypes } from './types.js';
import { createPool, createDatabase } from './pool.js';
import type { Database } from './pool.js';
import { institutes, instituteAliases, candidates, candidateAliases, races } from './seed-data.js';

/**
 * Seed das tabelas de referência (docs/03 §2.1). Manual e revisado (CLAUDE.md).
 * Idempotente: cada insert usa ON CONFLICT DO NOTHING, então rodar de novo não
 * quebra nem duplica. Não semeia raw/normalized/computed — isso vem do pipeline.
 */

const seed = async (db: Database): Promise<void> => {
  for (const race of races) {
    await db.query(
      `INSERT INTO races (id, display_name, status, sort_order)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [race.id, race.displayName, race.status, race.sortOrder],
    );
  }

  for (const inst of institutes) {
    await db.query(
      `INSERT INTO institutes (id, display_name, legal_name, cnpj, primary_method, site_url)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [inst.id, inst.displayName, inst.legalName, inst.cnpj, inst.primaryMethod, inst.siteUrl],
    );
  }

  for (const alias of instituteAliases) {
    await db.query(
      `INSERT INTO institute_aliases (alias, institute_id)
       VALUES ($1, $2) ON CONFLICT (alias) DO NOTHING`,
      [alias.alias, alias.targetId],
    );
  }

  for (const cand of candidates) {
    await db.query(
      `INSERT INTO candidates (id, display_name, party, color_slot)
       VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
      [cand.id, cand.displayName, cand.party, cand.colorSlot],
    );
  }

  for (const alias of candidateAliases) {
    await db.query(
      `INSERT INTO candidate_aliases (alias, candidate_id)
       VALUES ($1, $2) ON CONFLICT (alias) DO NOTHING`,
      [alias.alias, alias.targetId],
    );
  }
};

const main = async (): Promise<void> => {
  configurePgTypes();
  const pool = createPool();
  const db = createDatabase(pool);
  try {
    await seed(db);
    console.log(
      `seed ok: ${String(races.length)} races, ${String(institutes.length)} institutes, ` +
        `${String(candidates.length)} candidates, ` +
        `${String(instituteAliases.length + candidateAliases.length)} aliases`,
    );
  } finally {
    await db.end();
  }
};

// Só executa a CLI quando este arquivo é o entrypoint. Sem isto, `import { seed }`
// (o boot do orquestrador com `SEED_REFERENCE_ON_BOOT=true`) dispararia o seeder
// de linha de comando como efeito colateral do import.
if (isEntrypoint(import.meta.url)) {
  main().catch((error: unknown) => {
    // Falha alta, nunca silenciosa (R4).
    console.error('seed failed:', error);
    process.exit(1);
  });
}

export { seed };
