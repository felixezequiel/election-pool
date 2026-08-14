import { describe, it, expect } from 'vitest';
import { AdapterRegistry } from './registry.js';
import { NexusAdapter } from '../nexus/nexus-adapter.js';
import { CntMdaAdapter } from '../cnt-mda/cnt-mda-adapter.js';
import { makeReg, seedResolver } from './test-support.js';

const nexus = new NexusAdapter({ resolveCandidate: seedResolver });
const cntMda = new CntMdaAdapter({ resolveCandidate: seedResolver });

describe('AdapterRegistry', () => {
  const registry = new AdapterRegistry([nexus, cntMda]);

  it('resolve o adapter pelo instituteId do registro', () => {
    expect(registry.resolve(makeReg({ instituteId: 'nexus' }))?.id).toBe('nexus');
    expect(registry.resolve(makeReg({ instituteId: 'mda' }))?.id).toBe('cnt-mda');
  });

  it('devolve null para registro sem adapter conhecido', () => {
    expect(registry.resolve(makeReg({ instituteId: 'quaest' }))).toBeNull();
    expect(registry.resolve(makeReg({ instituteId: null }))).toBeNull();
  });

  it('busca por id', () => {
    expect(registry.byId('nexus')).toBe(nexus);
    expect(registry.byId('inexistente')).toBeNull();
  });

  it('LANÇA no boot com ids duplicados (erro de configuração)', () => {
    expect(() => new AdapterRegistry([nexus, nexus])).toThrow(/duplicado/);
  });
});
