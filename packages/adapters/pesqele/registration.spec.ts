import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRegistrationPage, PesqEleParseError, __test } from './registration.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

describe('parseRegistrationPage — list + detail from a representative response', () => {
  it('parses page 1 with two registrations and the paginator', () => {
    const page = parseRegistrationPage(fixture('results-page-1.html'));
    expect(page.currentPage).toBe(1);
    expect(page.totalPages).toBe(2);
    expect(page.registrations).toHaveLength(2);

    const first = page.registrations[0]!;
    expect(first.tseId).toBe('BR-06591/2026');
    expect(first.instituteName).toBe('Instituto Fixture de Pesquisas');
    expect(first.contractorName).toBe('TV Fixture Comunicações Ltda');
    expect(first.contractorCnpj).toBe('12.345.678/0001-90');
    expect(first.registeredAt).toBe('2026-08-10T14:30:00-03:00');
    expect(first.fieldStart).toBe('2026-08-05');
    expect(first.fieldEnd).toBe('2026-08-08');
    expect(first.sampleSize).toBe(2000);
    expect(first.marginOfError).toBe(2.2);
    expect(first.confidenceLevel).toBe(95);
    expect(first.costBrl).toBe(150000);

    const second = page.registrations[1]!;
    expect(second.tseId).toBe('BR-06592/2026');
    // Optional fields absent in the source stay null — never coerced to 0.
    expect(second.contractorCnpj).toBeNull();
    expect(second.costBrl).toBeNull();
  });

  it('parses the last page', () => {
    const page = parseRegistrationPage(fixture('results-page-2.html'));
    expect(page.currentPage).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.registrations[0]!.tseId).toBe('BR-06593/2026');
  });

  it('throws when a required field is missing (fail loud, R4)', () => {
    const broken =
      '<table><tr data-row="registration"><td data-field="institute" data-value="X"></td></tr></table>';
    expect(() => parseRegistrationPage(broken)).toThrow(PesqEleParseError);
  });
});

describe('date helpers', () => {
  it('converts DD/MM/AAAA to ISO date', () => {
    expect(__test.toIsoDate('05/08/2026')).toBe('2026-08-05');
  });

  it('rejects malformed dates (never invents)', () => {
    expect(() => __test.toIsoDate('2026-08-05')).toThrow(PesqEleParseError);
  });

  it('converts DD/MM/AAAA HH:mm to ISO datetime -03:00', () => {
    expect(__test.toIsoDateTime('10/08/2026 14:30')).toBe('2026-08-10T14:30:00-03:00');
  });
});
