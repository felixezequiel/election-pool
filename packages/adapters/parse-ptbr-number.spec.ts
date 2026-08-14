import { describe, it, expect } from 'vitest';
import { parsePtBrNumber, parsePtBrPercent, PtBrNumberError } from './parse-ptbr-number.js';

describe('parsePtBrNumber', () => {
  it('converts decimal comma', () => {
    expect(parsePtBrNumber('38,8')).toBe(38.8);
  });

  it('handles thousand separators', () => {
    expect(parsePtBrNumber('1.234,5')).toBe(1234.5);
    expect(parsePtBrNumber('2.000')).toBe(2000);
    expect(parsePtBrNumber('150.000,00')).toBe(150000);
  });

  it('handles bare integers and trims whitespace', () => {
    expect(parsePtBrNumber('38')).toBe(38);
    expect(parsePtBrNumber('  12,00 ')).toBe(12);
  });

  it('throws (never returns 0/NaN) on empty or non-numeric input', () => {
    expect(() => parsePtBrNumber('')).toThrow(PtBrNumberError);
    expect(() => parsePtBrNumber('-')).toThrow(PtBrNumberError);
    expect(() => parsePtBrNumber('—')).toThrow(PtBrNumberError);
    expect(() => parsePtBrNumber('N/A')).toThrow(PtBrNumberError);
    expect(() => parsePtBrNumber('1,2,3')).toThrow(PtBrNumberError);
    expect(() => parsePtBrNumber('abc')).toThrow(PtBrNumberError);
  });
});

describe('parsePtBrPercent', () => {
  it('accepts an optional trailing percent sign', () => {
    expect(parsePtBrPercent('38,8%')).toBe(38.8);
    expect(parsePtBrPercent('38,8 %')).toBe(38.8);
    expect(parsePtBrPercent('0')).toBe(0);
    expect(parsePtBrPercent('100')).toBe(100);
  });

  it('throws when outside 0..100', () => {
    expect(() => parsePtBrPercent('100,1')).toThrow(PtBrNumberError);
    expect(() => parsePtBrPercent('-1')).toThrow(PtBrNumberError);
  });
});
