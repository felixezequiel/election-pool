import { describe, it, expect } from 'vitest';
import { publicDataSchema } from '@election-pool/contracts/public-data';
import { pctSchema } from '@election-pool/contracts/branded';
import { RACES } from '@election-pool/contracts/races';
import { assemblePublicData, __test } from './data-assembler.js';
import { findThirdPartyProse } from './no-third-party-prose.js';
import type {
  ScenarioResultRow,
  RegistrationRow,
  PollRow,
  CandidateRow,
  InstituteRow,
  RaceRow,
} from './read-model.js';

/**
 * Testes unitários do montador (puro, sem banco). Constroem as linhas do
 * read-model à mão. Um dataset "denso" (≥3 pesquisas, ≥2 institutos, na janela)
 * passa em cobertura; um "esparso" (1 pesquisa) reprova (M-1).
 */

const RACE: RaceRow = { id: 'presidencia-2026', displayName: 'Presidência da República 2026' };
const NOW = new Date('2026-08-14T15:00:00-03:00');

/** Percentual branded (Pct) — as linhas do read-model são validadas em produção. */
const pct = (n: number): ScenarioResultRow['valuePct'] => pctSchema.parse(n);

const candidates: CandidateRow[] = [
  { id: 'lula', displayName: 'Luiz Inácio Lula da Silva', party: 'PT', colorSlot: 1 },
  { id: 'tarcisio', displayName: 'Tarcísio de Freitas', party: 'Republicanos', colorSlot: 2 },
];

const institutes: InstituteRow[] = [
  { id: 'quaest', displayName: 'Genial/Quaest', method: 'presencial' },
  { id: 'datafolha', displayName: 'Datafolha', method: 'presencial' },
];

/** Datas de campo recentes (dentro da janela de 45 dias contra NOW). */
const FIELD_DATES = ['2026-08-01', '2026-08-05', '2026-08-09'];
const INSTS = ['quaest', 'datafolha', 'quaest'];
const TSE = ['BR-06591/2026', 'BR-06592/2026', 'BR-06593/2026'];

const denseScenarioResults = (): ScenarioResultRow[] => {
  const rows: ScenarioResultRow[] = [];
  FIELD_DATES.forEach((date, i) => {
    const tseId = TSE[i]!;
    const instituteId = INSTS[i]!;
    // 1º turno estimulado com dois candidatos rastreados.
    rows.push({
      tseId,
      instituteId,
      scenarioKind: 't1_estimulado',
      t2Pair: null,
      fieldStart: date,
      fieldEnd: date,
      sampleSize: 2000,
      candidateId: 'lula',
      valuePct: pct(40 + i),
    });
    rows.push({
      tseId,
      instituteId,
      scenarioKind: 't1_estimulado',
      t2Pair: null,
      fieldStart: date,
      fieldEnd: date,
      sampleSize: 2000,
      candidateId: 'tarcisio',
      valuePct: pct(32 - i),
    });
    // 2º turno (par ordenado).
    rows.push({
      tseId,
      instituteId,
      scenarioKind: 't2',
      t2Pair: ['lula', 'tarcisio'],
      fieldStart: date,
      fieldEnd: date,
      sampleSize: 2000,
      candidateId: 'lula',
      valuePct: pct(52),
    });
    rows.push({
      tseId,
      instituteId,
      scenarioKind: 't2',
      t2Pair: ['lula', 'tarcisio'],
      fieldStart: date,
      fieldEnd: date,
      sampleSize: 2000,
      candidateId: 'tarcisio',
      valuePct: pct(48),
    });
  });
  return rows;
};

const denseRegistrations = (): RegistrationRow[] =>
  TSE.map((_, i) => ({
    instituteId: INSTS[i]!,
    contractorName: 'Veículo Aurora',
    registeredAt: '2026-06-01',
    disclosed: true,
  }));

const densePolls = (): PollRow[] =>
  TSE.map((tseId, i) => ({
    tseId,
    instituteId: INSTS[i]!,
    contractorName: 'Veículo Aurora',
    contractorType: 'veiculo',
    fieldStart: FIELD_DATES[i]!,
    fieldEnd: FIELD_DATES[i]!,
    sampleSize: 2000,
    marginOfError: 2,
    sourceUrl: 'https://www.tse.jus.br/',
  }));

const denseInput = () => ({
  raceId: RACE.id,
  race: RACE,
  scenarioResults: denseScenarioResults(),
  registrations: denseRegistrations(),
  polls: densePolls(),
  candidates,
  institutes,
  now: NOW,
  modelVersion: '1.0.0',
  gitSha: 'abc1234',
});

describe('assemblePublicData', () => {
  it('produces a schema-valid data.json from a dense dataset and passes coverage', () => {
    const { data, gatesPassed } = assemblePublicData(denseInput());

    // Fronteira: valida de novo (o montador já valida, mas confirmamos aqui).
    expect(() => publicDataSchema.parse(data)).not.toThrow();
    expect(gatesPassed).toBe(true);

    expect(data.schemaVersion).toBe('1');
    expect(data.race.id).toBe('presidencia-2026');
    expect(data.updateIntervalMinutes).toBe(120);
    expect(data.generatedAt).toMatch(/-03:00$/);
    expect(data.nextUpdateAt).toMatch(/-03:00$/);
    expect(data.candidates).toHaveLength(2);
    expect(data.latent.firstRound.length).toBeGreaterThan(0);
    expect(data.latent.runoffs).toHaveLength(1);
    expect(data.latent.runoffs[0]!.pair).toEqual(['lula', 'tarcisio']);
    expect(data.polls).toHaveLength(3);
    expect(data.polls.every((p) => p.tseId.length > 0)).toBe(true); // R6
  });

  it('otherRaces derives from RACES (not literals) and only exposes ativo|planejado', () => {
    const { data } = assemblePublicData(denseInput());
    const expected = [...RACES]
      .filter((r) => r.status === 'ativo' || r.status === 'planejado')
      .map((r) => r.id);
    expect(data.otherRaces.map((r) => r.id)).toEqual(expected);
    expect(data.otherRaces.every((r) => r.status === 'ativo' || r.status === 'planejado')).toBe(
      true,
    );
  });

  it('generated data.json has no third-party prose (docs/08 §2.1)', () => {
    const { data } = assemblePublicData(denseInput());
    expect(findThirdPartyProse(data)).toEqual([]);
  });

  it('methodologyNotes are the docs/01 §10 verbatim list (our text)', () => {
    const { data } = assemblePublicData(denseInput());
    expect(data.methodologyNotes).toEqual([...__test.METHODOLOGY_NOTES]);
    expect(data.methodologyNotes.length).toBe(6);
  });

  it('polls carry firstRound and runoff values from the scenarios', () => {
    const { data } = assemblePublicData(denseInput());
    const poll = data.polls.find((p) => p.tseId === 'BR-06591/2026')!;
    expect(poll.firstRound).not.toBeNull();
    expect(poll.firstRound!['lula']).toBe(40);
    expect(poll.runoffs).toHaveLength(1);
    expect(poll.runoffs[0]!.values['lula']).toBe(52);
    expect(poll.sourceUrl).toBe('https://www.tse.jus.br/'); // link, nunca conteúdo (R3)
  });

  it('gaveta diagnostics carry registered/disclosed separately (docs/06 §5)', () => {
    // 1 registro, não divulgado, janela já passada ⇒ rate 1.0 sobre registered 1.
    const input = {
      ...denseInput(),
      registrations: [
        {
          instituteId: 'quaest',
          contractorName: 'Campanha X',
          registeredAt: '2026-06-01', // janela (5+15d) já passada em 2026-08
          disclosed: false,
        },
      ] as RegistrationRow[],
    };
    const { data } = assemblePublicData(input);
    const inst = data.diagnostics.gaveta.find(
      (g) => g.subjectId === 'quaest' && g.subjectKind === 'institute',
    );
    expect(inst).toBeDefined();
    expect(inst!.registered).toBe(1);
    expect(inst!.disclosed).toBe(0);
    expect(inst!.rate).toBe(1);
  });

  it('fails coverage (M-1) on a sparse dataset (1 poll)', () => {
    const oneDate = FIELD_DATES[0]!;
    const scenarioResults: ScenarioResultRow[] = [
      {
        tseId: 'BR-06591/2026',
        instituteId: 'quaest',
        scenarioKind: 't1_estimulado',
        t2Pair: null,
        fieldStart: oneDate,
        fieldEnd: oneDate,
        sampleSize: 2000,
        candidateId: 'lula',
        valuePct: pct(40),
      },
      {
        tseId: 'BR-06591/2026',
        instituteId: 'quaest',
        scenarioKind: 't1_estimulado',
        t2Pair: null,
        fieldStart: oneDate,
        fieldEnd: oneDate,
        sampleSize: 2000,
        candidateId: 'tarcisio',
        valuePct: pct(32),
      },
    ];
    const { data, gatesPassed } = assemblePublicData({
      ...denseInput(),
      scenarioResults,
      registrations: [
        { instituteId: 'quaest', contractorName: 'V', registeredAt: '2026-06-01', disclosed: true },
      ],
      polls: [
        {
          tseId: 'BR-06591/2026',
          instituteId: 'quaest',
          contractorName: 'V',
          contractorType: 'veiculo',
          fieldStart: oneDate,
          fieldEnd: oneDate,
          sampleSize: 2000,
          marginOfError: 2,
          sourceUrl: 'https://www.tse.jus.br/',
        },
      ],
    });
    // O data.json ainda é schema-válido, mas os gates de modelo reprovam (M-1).
    expect(() => publicDataSchema.parse(data)).not.toThrow();
    expect(gatesPassed).toBe(false);
  });
});

describe('medianFieldDate', () => {
  it('is the midpoint of the field window, truncated to the day', () => {
    expect(__test.medianFieldDate('2026-08-01', '2026-08-05')).toBe('2026-08-03');
    expect(__test.medianFieldDate('2026-08-01', '2026-08-02')).toBe('2026-08-01'); // 1.5 dia → trunca
    expect(__test.medianFieldDate('2026-08-10', '2026-08-10')).toBe('2026-08-10');
  });
});
