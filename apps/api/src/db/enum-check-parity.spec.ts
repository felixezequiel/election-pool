import { describe, it, expect, afterAll } from 'vitest';
import {
  primaryMethodSchema,
  contractorTypeSchema,
  disclosureStatusSchema,
  scenarioKindSchema,
  raceStatusSchema,
  diagnosticKindSchema,
  jobRunStatusSchema,
} from '@election-pool/contracts/enums';
import { transitionStateKindSchema } from '@election-pool/contracts/model-io';
import { makeTestDatabase } from './test-helpers.js';

/**
 * Teste de CONTRATO (docs/03 §3): os valores dos enums Zod em
 * `@election-pool/contracts/enums` batem 1:1 com os `CHECK (... IN (...))` das
 * migrations. Aqui lemos a definição real da constraint do catálogo do Postgres
 * (pg_get_constraintdef) — depois da migration. O Postgres normaliza
 * `col IN ('a','b')` para `col = ANY (ARRAY['a'::text, 'b'::text])`, então
 * extraímos os literais dessa forma canônica. Se um CHECK e o enum divergirem em
 * valor ou ordem, o teste falha.
 */

const { db } = makeTestDatabase();

afterAll(async () => {
  await db.end();
});

/**
 * Extrai os literais da forma canônica do Postgres
 * `col = ANY (ARRAY['a'::text, 'b'::text])`. Restringe ao trecho ARRAY[...] para
 * não capturar o nome da coluna nem casts.
 */
const parseEnumList = (constraintDef: string): string[] => {
  const arrayMatch = /ARRAY\[([^\]]*)\]/.exec(constraintDef);
  if (arrayMatch === null || arrayMatch[1] === undefined) {
    throw new Error(`CHECK sem ARRAY[...]: ${constraintDef}`);
  }
  return [...arrayMatch[1].matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
};

const fetchCheckValues = async (table: string, column: string): Promise<string[]> => {
  const rows = await db.query<{ def: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
      WHERE t.relname = $1
        AND a.attname = $2
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%ARRAY[%'`,
    [table, column],
  );
  const def = rows[0]?.def;
  if (def === undefined) {
    throw new Error(`CHECK enum não encontrado para ${table}.${column}`);
  }
  return parseEnumList(def);
};

describe('enums TS == CHECK das migrations (docs/03 §3)', () => {
  it('institutes.primary_method', async () => {
    expect(await fetchCheckValues('institutes', 'primary_method')).toEqual(
      primaryMethodSchema.options,
    );
  });

  it('poll_registrations.contractor_type', async () => {
    expect(await fetchCheckValues('poll_registrations', 'contractor_type')).toEqual(
      contractorTypeSchema.options,
    );
  });

  it('poll_registrations.disclosure_status', async () => {
    expect(await fetchCheckValues('poll_registrations', 'disclosure_status')).toEqual(
      disclosureStatusSchema.options,
    );
  });

  it('poll_scenarios.kind', async () => {
    expect(await fetchCheckValues('poll_scenarios', 'kind')).toEqual(scenarioKindSchema.options);
  });

  it('races.status', async () => {
    expect(await fetchCheckValues('races', 'status')).toEqual(raceStatusSchema.options);
  });

  it('model_diagnostics.kind', async () => {
    expect(await fetchCheckValues('model_diagnostics', 'kind')).toEqual(
      diagnosticKindSchema.options,
    );
  });

  it('job_runs.status', async () => {
    expect(await fetchCheckValues('job_runs', 'status')).toEqual(jobRunStatusSchema.options);
  });

  /**
   * `model_electorate_estimates.kind` guarda só os estados que NÃO são candidato
   * (Q-10): cada candidato já tem sua linha em `model_estimates`. A expectativa é
   * o enum do contrato MENOS 'candidate', derivada por exclusão — do mesmo jeito
   * que a migration a deriva —, para que acrescentar um estado novo ao contrato
   * apareça aqui sem ninguém precisar lembrar de editar a lista à mão.
   */
  it('model_electorate_estimates.kind', async () => {
    expect(await fetchCheckValues('model_electorate_estimates', 'kind')).toEqual(
      transitionStateKindSchema.options.filter((kind) => kind !== 'candidate'),
    );
  });
});
