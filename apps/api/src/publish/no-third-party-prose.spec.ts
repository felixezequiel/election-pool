import { describe, it, expect } from 'vitest';
import type { PublicData } from '@election-pool/contracts/public-data';
import { findThirdPartyProse, __test } from './no-third-party-prose.js';

/**
 * `no-third-party-prose` (docs/08 §2.1, R3): nenhum campo de string do data.json
 * fora da allowlist pode passar de 200 chars — é a via por onde prosa de terceiros
 * (título, resumo, trecho) vazaria para o artefato público.
 */

const baseData = (): PublicData =>
  ({
    schemaVersion: '1',
    generatedAt: '2026-08-14T15:00:00-03:00',
    nextUpdateAt: '2026-08-14T17:00:00-03:00',
    updateIntervalMinutes: 120,
    modelVersion: '1.0.0',
    gitSha: 'abc',
    race: { id: 'presidencia-2026', displayName: 'Presidência da República 2026' },
    candidates: [],
    institutes: [],
    latent: { firstRound: [], runoffs: [] },
    polls: [],
    houseEffects: [],
    diagnostics: { gaveta: [], herding: [] },
    historicalError: [],
    otherRaces: [],
    methodologyNotes: [],
  }) as unknown as PublicData;

describe('findThirdPartyProse', () => {
  it('accepts a clean data.json (only numbers, ids, short names, links)', () => {
    expect(findThirdPartyProse(baseData())).toEqual([]);
  });

  it('accepts a long methodologyNotes entry (our text, allowlisted)', () => {
    const data = baseData();
    (data as { methodologyNotes: string[] }).methodologyNotes = ['a'.repeat(300)];
    expect(findThirdPartyProse(data)).toEqual([]);
  });

  it('accepts a long displayName (a proper name, allowlisted) and long sourceUrl (a link)', () => {
    const data = baseData();
    data.race.displayName = 'X'.repeat(250);
    (data as unknown as { polls: { sourceUrl: string }[] }).polls = [
      { sourceUrl: 'https://example.org/' + 'a'.repeat(300) } as never,
    ];
    expect(findThirdPartyProse(data)).toEqual([]);
  });

  it('flags a long string in a non-allowlisted field (would be third-party prose)', () => {
    const data = baseData();
    // contractorName é fato curto normalmente; um valor gigante seria suspeito.
    (data as unknown as { polls: { contractorName: string; tseId: string }[] }).polls = [
      { contractorName: 'z'.repeat(201), tseId: 'BR-06591/2026' } as never,
    ];
    const violations = findThirdPartyProse(data);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.path).toContain('contractorName');
    expect(violations[0]!.length).toBe(201);
  });

  it('accepts a long transitions.prior.note (our note, allowlisted by exact path)', () => {
    // A nota do prior é prosa NOSSA obrigatória (Q-10) e passa de 200 chars por
    // natureza. Allowlistada pelo caminho exato, não pelo nome do campo.
    const data = baseData();
    (data as unknown as { transitions: { prior: { note: string } } }).transitions = {
      prior: { note: 'Estimativa de modelo sob suposição, não medida. '.repeat(20) },
    } as never;
    expect(findThirdPartyProse(data)).toEqual([]);
  });

  it('does NOT allowlist the name `note` — a note at another path is still flagged', () => {
    // Prova que a allowlist é por CAMINHO, não por nome: o mesmo `note`, fora de
    // `transitions.prior`, continua reprovando (senão prosa de terceiro vazaria).
    const data = baseData();
    (data as unknown as { polls: { note: string }[] }).polls = [
      { note: 'z'.repeat(201) } as never,
    ];
    const violations = findThirdPartyProse(data);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.path).toContain('note');
  });

  it('exposes the exact allowlisted path (documented contract)', () => {
    expect(__test.ALLOWLISTED_PATHS.has('transitions.prior.note')).toBe(true);
  });

  it('threshold is exactly 200 chars', () => {
    expect(__test.MAX_FIELD_CHARS).toBe(200);
    const data = baseData();
    (data as unknown as { polls: { note: string }[] }).polls = [
      { note: 'q'.repeat(200) } as never, // exatamente 200 ⇒ ok
    ];
    expect(findThirdPartyProse(data)).toEqual([]);
    (data as unknown as { polls: { note: string }[] }).polls = [
      { note: 'q'.repeat(201) } as never, // 201 ⇒ viola
    ];
    expect(findThirdPartyProse(data)).toHaveLength(1);
  });
});
