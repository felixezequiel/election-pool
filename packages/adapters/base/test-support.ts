/**
 * Apoio a testes dos adapters (não é código de produção; só é importado por specs).
 * Monta um `RawDocument` de contrato apontando para um blob temporário em disco, e
 * um resolver de candidato estático espelhando o seed manual (T-02), para exercitar
 * `parse` sem banco nem rede. Grava o blob pelo MESMO caminho de produção
 * (`RawStorage.store`) — o teste de reparse depende disso.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pollRegistrationSchema, rawDocumentSchema } from '@election-pool/contracts/domain';
import type { PollRegistration, RawDocument } from '@election-pool/contracts/domain';
import { RawStorage } from './raw-storage.js';
import { resolverFromMap } from './candidate-resolver.js';
import type { CandidateAliasResolver } from './candidate-resolver.js';

/** Aliases de candidato do seed manual (T-02 `seed-data.ts`), como mapa em memória. */
export const seedCandidateAliases = new Map<string, string>([
  ['Lula', 'lula'],
  ['Luiz Inácio Lula da Silva', 'lula'],
  ['Tarcísio', 'tarcisio'],
  ['Tarcísio de Freitas', 'tarcisio'],
  ['Ratinho Junior', 'ratinho-junior'],
  ['Ratinho Jr.', 'ratinho-junior'],
  ['Flávio Bolsonaro', 'flavio-bolsonaro'],
  ['Ciro Gomes', 'ciro-gomes'],
  ['Ciro', 'ciro-gomes'],
  ['Simone Tebet', 'simone-tebet'],
  ['Tebet', 'simone-tebet'],
  ['Romeu Zema', 'zema'],
  ['Zema', 'zema'],
]);

export const seedResolver: CandidateAliasResolver = resolverFromMap(seedCandidateAliases);

/** `RawStorage` isolado num diretório temporário do SO (nunca escreve em /var). */
export const makeTempStorage = (): { storage: RawStorage; dir: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'ep-raw-'));
  return { storage: new RawStorage(dir), dir };
};

/**
 * Grava `body` no blob (via `RawStorage.store`, o caminho de produção) e devolve o
 * `RawDocument` de contrato correspondente.
 */
export const makeRawFromBytes = async (
  storage: RawStorage,
  body: Uint8Array | string,
  contentType: string,
  url = 'https://example.test/doc',
): Promise<RawDocument> => {
  const { contentHash, storagePath } = await storage.store(body, contentType);
  return rawDocumentSchema.parse({
    id: randomUUID(),
    url,
    fetchedAt: '2026-08-14T12:00:00-03:00',
    httpStatus: 200,
    contentType,
    contentHash,
    storagePath,
    etag: null,
    lastModified: null,
  });
};

/**
 * Um `PollRegistration` mínimo e válido para testes de parse. Aceita overrides
 * com valores CRUS (strings/números) e os brande via `pollRegistrationSchema` —
 * assim os specs não precisam construir tipos branded na mão.
 */
export interface RegOverrides {
  tseId?: string;
  raceId?: string;
  instituteId?: string | null;
  instituteRawName?: string;
  contractorName?: string;
  disclosureStatus?: 'pending' | 'disclosed' | 'presumed_undisclosed';
  fieldStart?: string;
  fieldEnd?: string;
}

export const makeReg = (overrides: RegOverrides = {}): PollRegistration =>
  pollRegistrationSchema.parse({
    tseId: 'BR-06591/2026',
    raceId: 'presidencia-2026',
    instituteId: 'nexus',
    instituteRawName: 'Nexus',
    contractorName: 'Contratante Fixture',
    contractorType: 'veiculo',
    registeredAt: '2026-08-01T10:00:00-03:00',
    fieldStart: '2026-08-05',
    fieldEnd: '2026-08-08',
    sampleSize: 2000,
    marginOfError: 2.2,
    confidenceLevel: 95,
    costBrl: 100000,
    firstSeenAt: '2026-08-10T10:00:00-03:00',
    sourceExpiredAt: null,
    disclosureStatus: 'pending',
    ...overrides,
  });
