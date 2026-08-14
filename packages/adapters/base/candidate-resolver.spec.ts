import { describe, it, expect } from 'vitest';
import { resolverFromMap, resolveCandidateOrThrow } from './candidate-resolver.js';
import { UnknownCandidateError } from '../poll-source-adapter.js';

describe('resolução de alias de candidato', () => {
  const resolver = resolverFromMap(new Map([['Lula', 'lula']]));

  it('resolve um alias conhecido (trim das pontas é ruído de layout, não ambiguidade)', () => {
    expect(resolveCandidateOrThrow(resolver, 'Lula')).toBe('lula');
    expect(resolveCandidateOrThrow(resolver, '  Lula  ')).toBe('lula');
  });

  it('LANÇA UnknownCandidateError para alias desconhecido — nunca auto-cria', () => {
    expect(() => resolveCandidateOrThrow(resolver, 'Fulano')).toThrow(UnknownCandidateError);
    try {
      resolveCandidateOrThrow(resolver, 'Fulano');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownCandidateError);
      expect((err as UnknownCandidateError).alias).toBe('Fulano');
    }
  });
});
