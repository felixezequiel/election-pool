import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { makeTestDatabase, truncateData } from '../db/test-helpers.js';
import { seed } from '../db/seed.js';
import { approve, ApprovalError } from './approve.command.js';
import { ManualApprovalsRepository } from './manual-approvals.repository.js';

/**
 * Integração REAL do comando de aprovação manual (T-07, docs/04 §5) contra o
 * Postgres do docker-compose. Prova o aceite:
 * - `approve` grava a razão e dispara o reprocesso;
 * - sem `--reason` (null/vazio) RECUSA e não grava nada;
 * - tse_id inexistente é recusado (não inventa registro).
 */

const { db } = makeTestDatabase();

const insertRegistration = async (tseId: string): Promise<void> => {
  await db.query(
    `INSERT INTO poll_registrations
       (tse_id, race_id, institute_id, institute_raw_name, contractor_name, contractor_type,
        registered_at, field_start, field_end, sample_size, disclosure_status)
     VALUES ($1,'presidencia-2026','nexus','Nexus','Contratante','veiculo',
             now(), now()::date - 3, now()::date, 2000, 'pending')`,
    [tseId],
  );
};

const seedNexus = async (): Promise<void> => {
  await db.query(
    `INSERT INTO institutes (id, display_name, legal_name, cnpj, primary_method, site_url)
     VALUES ('nexus','Nexus/FSB',NULL,NULL,'telefone',NULL)
     ON CONFLICT (id) DO NOTHING`,
  );
};

describe('ingest:approve (integração)', () => {
  beforeAll(async () => {
    await seed(db);
    await seedNexus();
  });

  afterAll(async () => {
    await db.end();
  });

  beforeEach(async () => {
    await truncateData(db);
    await seedNexus();
  });

  it('grava a aprovação com a razão e reporta os cenários reprocessados', async () => {
    await insertRegistration('BR-06591/2026');
    let reingestedFor: string | null = null;

    const outcome = await approve(
      { tseId: 'BR-06591/2026', reason: 'Candidato X desistiu — movimento real (fato público)' },
      {
        db,
        runReingest: (tseId) => {
          reingestedFor = tseId;
          return Promise.resolve(2);
        },
      },
    );

    expect(outcome.approval.tseId).toBe('BR-06591/2026');
    expect(outcome.approval.reason).toContain('desistiu');
    expect(outcome.scenariosInserted).toBe(2);
    expect(reingestedFor).toBe('BR-06591/2026');

    // persistido e legível de volta
    const stored = await new ManualApprovalsRepository(db).find('BR-06591/2026');
    expect(stored).not.toBeNull();
    expect(stored!.reason).toContain('desistiu');
    expect(stored!.approvedAt).toMatch(/-03:00$/);
  });

  it('sem --reason (null) RECUSA e não grava nada', async () => {
    await insertRegistration('BR-06591/2026');
    let reingested = false;

    await expect(
      approve(
        { tseId: 'BR-06591/2026', reason: null },
        {
          db,
          runReingest: () => {
            reingested = true;
            return Promise.resolve(0);
          },
        },
      ),
    ).rejects.toBeInstanceOf(ApprovalError);

    expect(reingested).toBe(false);
    expect(await new ManualApprovalsRepository(db).find('BR-06591/2026')).toBeNull();
  });

  it('--reason vazio/só espaços RECUSA', async () => {
    await insertRegistration('BR-06591/2026');
    await expect(approve({ tseId: 'BR-06591/2026', reason: '   ' }, { db })).rejects.toBeInstanceOf(
      ApprovalError,
    );
    expect(await new ManualApprovalsRepository(db).find('BR-06591/2026')).toBeNull();
  });

  it('tse_id inexistente é recusado (não inventa registro)', async () => {
    await expect(
      approve({ tseId: 'BR-09999/2026', reason: 'qualquer' }, { db }),
    ).rejects.toBeInstanceOf(ApprovalError);
  });

  it('reaprovar atualiza a razão', async () => {
    await insertRegistration('BR-06591/2026');
    const repo = new ManualApprovalsRepository(db);
    await approve({ tseId: 'BR-06591/2026', reason: 'primeira razão' }, { db });
    await approve({ tseId: 'BR-06591/2026', reason: 'razão corrigida' }, { db });
    const stored = await repo.find('BR-06591/2026');
    expect(stored!.reason).toBe('razão corrigida');
  });
});
