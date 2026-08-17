import { describe, it, expect } from 'vitest';
import { publicDataSchema, type PublicData } from './public-data.js';
import { UPDATE_INTERVAL_MINUTES } from './constants.js';

const validFixture: PublicData = {
  schemaVersion: '2',
  generatedAt: '2026-08-14T10:00:00-03:00',
  nextUpdateAt: '2026-08-14T12:00:00-03:00',
  updateIntervalMinutes: UPDATE_INTERVAL_MINUTES,
  modelVersion: '2.0.0',
  gitSha: 'a1b2c3d4e5f6',
  race: { id: 'presidencia-2026', displayName: 'Presidência da República 2026' },
  candidates: [
    {
      id: 'cand-a',
      displayName: 'Candidato A',
      party: 'PARTIDO-A',
      colorSlot: 1,
      photoPath: '/candidatos/cand-a.jpg',
      photoSourceUrl: 'https://divulgacandcontas.tse.jus.br/candidatura/cand-a',
    },
    // Sem foto casada com segurança: photoPath null ⇒ a UI cai para monograma.
    {
      id: 'cand-b',
      displayName: 'Candidato B',
      party: null,
      colorSlot: 2,
      photoPath: null,
      photoSourceUrl: null,
    },
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
    // Branco/nulo e não-sabe como séries rastreadas (Q-10).
    electorate: [
      {
        date: '2026-08-13',
        blankNull: { mean: 8.0, lo90: 6.4, hi90: 9.6 },
        undecided: { mean: 19.4, lo90: 17.1, hi90: 21.7 },
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
      blankNullPct: 7.0,
      undecidedPct: 21.0,
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
  /**
   * Desengajamento na espontânea (Q-14). Os números refletem a diferença REAL
   * medida em `BR-06833/2026`: na pergunta aberta 37 p.p. não citam nome nenhum,
   * contra 3 p.p. de não-sabe na estimulada (que está em `latent.electorate`).
   */
  spontaneous: {
    series: [
      {
        date: '2026-08-13',
        noCandidate: { mean: 37.0, lo90: 34.2, hi90: 39.8 },
        blankNull: { mean: 12.0, lo90: 10.1, hi90: 13.9 },
        named: { mean: 51.0, lo90: 46.3, hi90: 55.7 },
      },
      // Ponta sem medida ⇒ null nas três, jamais zero (R4).
      { date: '2026-08-06', noCandidate: null, blankNull: null, named: null },
    ],
    pollCount: 2,
    instituteCount: 1,
  },
  transitions: {
    states: [
      { id: 'cand-a', kind: 'candidate', displayName: 'Candidato A' },
      { id: 'cand-b', kind: 'candidate', displayName: 'Candidato B' },
      { id: 'undecided', kind: 'undecided', displayName: 'Não sabe' },
    ],
    steps: [
      {
        fromDate: '2026-08-06',
        toDate: '2026-08-13',
        flows: [
          {
            from: 'undecided',
            to: 'cand-a',
            pp: 1.2,
            lo90: -0.3,
            hi90: 2.7,
            notIdentifiable: true,
          },
          { from: 'cand-b', to: 'cand-a', pp: 0.9, lo90: 0.2, hi90: 1.6, notIdentifiable: false },
        ],
      },
    ],
    prior: {
      method: 'mínimos quadrados restritos com prior de permanência',
      stickiness: 0.85,
      note: 'Fluxo inferido de dado agregado, não medido.',
    },
  },
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
    const broken = { ...validFixture, schemaVersion: '1' };
    expect(publicDataSchema.safeParse(broken).success).toBe(false);
  });

  // Q-10: a banda e o veredito de identificabilidade são OBRIGATÓRIOS. Um fluxo
  // publicado sem eles seria um número de aparência precisa sem a incerteza que o
  // qualifica — exatamente o que a Q-10 proíbe.
  it('rejects a transition flow without its band', () => {
    const broken = structuredClone(validFixture) as Record<string, unknown>;
    const t = broken['transitions'] as Record<string, unknown>;
    const steps = t['steps'] as Array<Record<string, unknown>>;
    const flows = steps[0]?.['flows'] as Array<Record<string, unknown>>;
    delete flows[0]?.['lo90'];
    expect(publicDataSchema.safeParse(broken).success).toBe(false);
  });

  it('accepts transitions: null (sem passos suficientes para estimar)', () => {
    const noTransitions = { ...validFixture, transitions: null };
    expect(publicDataSchema.safeParse(noTransitions).success).toBe(true);
  });

  // R4: ausência de medida é null, nunca zero — e o contrato precisa aceitar isso.
  it('accepts null blankNull/undecided in an electorate point', () => {
    const data = structuredClone(validFixture) as Record<string, unknown>;
    const latent = data['latent'] as Record<string, unknown>;
    const electorate = latent['electorate'] as Array<Record<string, unknown>>;
    electorate[0] = { date: '2026-08-13', blankNull: null, undecided: null };
    expect(publicDataSchema.safeParse(data).success).toBe(true);
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
