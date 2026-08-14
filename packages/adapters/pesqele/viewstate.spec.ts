import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extractViewState, hasViewState, isSessionExpired, ViewStateError } from './viewstate.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

describe('extractViewState', () => {
  it('extracts the ViewState from the landing page fixture', () => {
    expect(extractViewState(fixture('index.html'))).toBe('VS-INDEX-0001');
  });

  it('extracts the ViewState from a results page', () => {
    expect(extractViewState(fixture('results-page-1.html'))).toBe('VS-RESULTS-P1');
  });

  it('throws (never returns empty) when ViewState is absent', () => {
    expect(() => extractViewState('<html><body>no jsf here</body></html>')).toThrow(ViewStateError);
  });
});

describe('isSessionExpired', () => {
  it('detects a MyFaces ViewExpiredException response', () => {
    expect(isSessionExpired(fixture('session-expired.html'))).toBe(true);
  });

  it('treats a page without ViewState as an expired/lost session', () => {
    expect(isSessionExpired('<html><body>nothing</body></html>')).toBe(true);
  });

  it('a valid results page is not expired', () => {
    expect(isSessionExpired(fixture('results-page-1.html'))).toBe(false);
    expect(hasViewState(fixture('results-page-1.html'))).toBe(true);
  });
});
