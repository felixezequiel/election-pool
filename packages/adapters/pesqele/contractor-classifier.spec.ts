import { describe, it, expect } from 'vitest';
import { classifyContractor } from './contractor-classifier.js';
import { CONTRACTOR_TYPE } from '@election-pool/contracts/enums';

describe('classifyContractor', () => {
  it('classifies a media outlet by name pattern', () => {
    expect(classifyContractor({ contractorName: 'TV Fixture Comunicações Ltda' })).toBe(
      CONTRACTOR_TYPE.veiculo,
    );
    expect(classifyContractor({ contractorName: 'Jornal do Fixture' })).toBe(
      CONTRACTOR_TYPE.veiculo,
    );
  });

  it('classifies a financial institution', () => {
    expect(classifyContractor({ contractorName: 'Banco Fixture S.A.' })).toBe(
      CONTRACTOR_TYPE.instituicaoFinanceira,
    );
  });

  it('classifies a class entity / confederation', () => {
    expect(classifyContractor({ contractorName: 'Confederação Nacional Fixture' })).toBe(
      CONTRACTOR_TYPE.entidade,
    );
  });

  it('classifies a party', () => {
    expect(classifyContractor({ contractorName: 'Partido Fixture Brasileiro' })).toBe(
      CONTRACTOR_TYPE.partido,
    );
  });

  it('detects proprio when contractor equals the institute (accent/case-insensitive)', () => {
    expect(
      classifyContractor({
        contractorName: 'Instituto FIXTURE de Pesquisas',
        instituteName: 'Instituto Fixture de Pesquisas',
      }),
    ).toBe(CONTRACTOR_TYPE.proprio);
  });

  it('returns desconhecido (not null, no guess) when nothing matches', () => {
    const result = classifyContractor({ contractorName: 'Sociedade Anônima Genérica' });
    expect(result).toBe(CONTRACTOR_TYPE.desconhecido);
    expect(result).not.toBeNull();
  });

  it('returns desconhecido on empty name — never throws, never guesses', () => {
    expect(classifyContractor({ contractorName: '   ' })).toBe(CONTRACTOR_TYPE.desconhecido);
  });
});
