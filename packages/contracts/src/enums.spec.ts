import { describe, it, expect } from 'vitest';
import {
  primaryMethodSchema,
  contractorTypeSchema,
  disclosureStatusSchema,
  scenarioKindSchema,
  raceStatusSchema,
  diagnosticKindSchema,
  PRIMARY_METHOD,
  CONTRACTOR_TYPE,
  DISCLOSURE_STATUS,
  SCENARIO_KIND,
  RACE_STATUS,
  DIAGNOSTIC_KIND,
} from './enums.js';

describe('enums mirror the docs/03 CHECK values', () => {
  it('primary_method', () => {
    expect(primaryMethodSchema.options).toEqual([
      'presencial',
      'telefone',
      'painel_online',
      'misto',
    ]);
    expect(primaryMethodSchema.safeParse(PRIMARY_METHOD.misto).success).toBe(true);
    expect(primaryMethodSchema.safeParse('online').success).toBe(false);
  });

  it('contractor_type', () => {
    expect(contractorTypeSchema.options).toEqual([
      'proprio',
      'veiculo',
      'instituicao_financeira',
      'partido',
      'campanha',
      'entidade',
      'outro',
      'desconhecido',
    ]);
    expect(contractorTypeSchema.safeParse(CONTRACTOR_TYPE.campanha).success).toBe(true);
  });

  it('disclosure_status', () => {
    expect(disclosureStatusSchema.options).toEqual([
      'pending',
      'disclosed',
      'presumed_undisclosed',
    ]);
    expect(disclosureStatusSchema.safeParse(DISCLOSURE_STATUS.presumedUndisclosed).success).toBe(
      true,
    );
  });

  it('scenario kind', () => {
    expect(scenarioKindSchema.options).toEqual(['t1_estimulado', 't1_espontaneo', 't2']);
    expect(scenarioKindSchema.safeParse(SCENARIO_KIND.t2).success).toBe(true);
  });

  it('race status', () => {
    expect(raceStatusSchema.options).toEqual(['ativo', 'planejado', 'encerrado']);
    expect(raceStatusSchema.safeParse(RACE_STATUS.ativo).success).toBe(true);
  });

  it('diagnostic kind', () => {
    expect(diagnosticKindSchema.options).toEqual(['gaveta', 'herding', 'divergencia']);
    expect(diagnosticKindSchema.safeParse(DIAGNOSTIC_KIND.herding).success).toBe(true);
  });
});
