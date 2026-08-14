import { describe, it, expect } from 'vitest';
import { publicDataSchema, type PublicData } from './public-data.js';
import { UPDATE_INTERVAL_MINUTES } from './constants.js';

const validFixture: PublicData = {
  schemaVersion: '1',
  generatedAt: '2026-08-14T10:00:00-03:00',
  nextUpdateAt: '2026-08-14T12:00:00-03:00',
  updateIntervalMinutes: UPDATE_INTERVAL_MINUTES,
  modelVersion: '1.0.0',
  gitSha: 'a1b2c3d4e5f6',
  race: { id: 'presidencia-2026', displayName: 'Presidência da República 2026' },
  candidates: [
    { id: 'cand-a', displayName: 'Candidato A', party: 'PARTIDO-A', colorSlot: 1 },
    { id: 'cand-b', displayName: 'Candidato B', party: null, colorSlot: 2 },
  ],
  institutes: [{ id: 'inst-x', displayName: 'Instituto X', method: 'presencial' }],
  latent: {
    firstRound: [
      {
        date: '2026-08-13',
        byCandidate: {
          'cand-a': { mean: 40.5, lo90: 37.2, hi90: 43.8 },
          'cand-b': { mean: 32.1, lo90: 29.0, hi90: 35.2 },
        },
      },
    ],
    runoffs: [
      {
        pair: ['cand-a', 'cand-b'],
        series: [
          {
            date: '2026-08-13',
            byCandidate: {
              'cand-a': { mean: 52.0, lo90: 48.5, hi90: 55.5 },
              'cand-b': { mean: 48.0, lo90: 44.5, hi90: 51.5 },
            },
          },
        ],
      },
    ],
  },
  polls: [
    {
      tseId: 'BR-06591/2026',
      instituteId: 'inst-x',
      contractorName: 'Veículo Y',
      contractorType: 'veiculo',
      fieldStart: '2026-08-10',
      fieldEnd: '2026-08-12',
      sampleSize: 2000,
      marginOfError: 2.0,
      firstRound: { 'cand-a': 41.0, 'cand-b': 31.0 },
      runoffs: [{ pair: ['cand-a', 'cand-b'], values: { 'cand-a': 53.0, 'cand-b': 47.0 } }],
      sourceUrl: 'https://example.org/pesquisa',
    },
  ],
  houseEffects: [
    {
      instituteId: 'inst-x',
      candidateId: 'cand-a',
      effect: 0.8,
      lo90: -0.5,
      hi90: 2.1,
      nPolls: 5,
      estimable: true,
    },
  ],
  diagnostics: {
    gaveta: [
      {
        subjectId: 'inst-x',
        subjectKind: 'institute',
        rate: 0.2,
        registered: 10,
        disclosed: 8,
      },
    ],
    herding: [{ windowEnd: '2026-08-12', ratio: 0.6, nPolls: 5, flagged: false }],
  },
  historicalError: [
    {
      instituteId: 'inst-x',
      election: '2022',
      round: 1,
      candidateLabel: 'Candidato A',
      signedErrorPp: -1.5,
    },
  ],
  otherRaces: [{ id: 'senado-2026', displayName: 'Senado', status: 'planejado' }],
  methodologyNotes: ['Não corrige viés comum a todos os institutos.'],
};

describe('PublicData', () => {
  it('validates a complete fixture', () => {
    const result = publicDataSchema.safeParse(validFixture);
    expect(result.success).toBe(true);
  });

  it('rejects a fixture whose poll is missing tseId (R6)', () => {
    const broken = structuredClone(validFixture) as Record<string, unknown>;
    const polls = broken['polls'] as Array<Record<string, unknown>>;
    const firstPoll = polls[0];
    if (firstPoll === undefined) throw new Error('fixture must have a poll');
    delete firstPoll['tseId'];
    const result = publicDataSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it('rejects a wrong schemaVersion', () => {
    const broken = { ...validFixture, schemaVersion: '2' };
    expect(publicDataSchema.safeParse(broken).success).toBe(false);
  });

  it('requires nextUpdateAt and updateIntervalMinutes', () => {
    const noNext = structuredClone(validFixture) as Record<string, unknown>;
    delete noNext['nextUpdateAt'];
    expect(publicDataSchema.safeParse(noNext).success).toBe(false);

    const noInterval = structuredClone(validFixture) as Record<string, unknown>;
    delete noInterval['updateIntervalMinutes'];
    expect(publicDataSchema.safeParse(noInterval).success).toBe(false);
  });
});
