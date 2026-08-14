/**
 * Armazenamento do corpo bruto em disco, FORA da árvore servida (docs/02 §2, R3).
 * O `raw_documents` no banco guarda só metadados + `storage_path`; o corpo (HTML,
 * PDF) mora aqui. Nunca é servido ao público — é evidência de proveniência.
 *
 * Layout: `<base>/<sha256[0..2]>/<sha256>.<ext>`. O sha256 do corpo é o nome, o
 * que torna o armazenamento idempotente/deduplicado e verificável. O primeiro par
 * de dígitos vira subpasta para não estourar um diretório único.
 *
 * Base configurável por env `RAW_STORAGE_DIR`; default de PRODUÇÃO
 * `/var/lib/election-pool/raw` (docs/02 §2). Os testes injetam um dir local
 * (`.data/raw`) — nunca escrevem em `/var`.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const DEFAULT_RAW_STORAGE_DIR = '/var/lib/election-pool/raw';

const HASH_PREFIX_LEN = 2;

export const sha256Hex = (body: Uint8Array | string): string =>
  createHash('sha256')
    .update(typeof body === 'string' ? Buffer.from(body, 'utf8') : body)
    .digest('hex');

const extForContentType = (contentType: string | null): string => {
  if (contentType === null) return 'bin';
  if (contentType.includes('pdf')) return 'pdf';
  if (contentType.includes('html')) return 'html';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('text')) return 'txt';
  return 'bin';
};

export class RawStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? process.env['RAW_STORAGE_DIR'] ?? DEFAULT_RAW_STORAGE_DIR;
  }

  /** Caminho determinístico do blob para um dado hash + content-type. */
  pathFor(contentHash: string, contentType: string | null): string {
    const ext = extForContentType(contentType);
    return join(this.baseDir, contentHash.slice(0, HASH_PREFIX_LEN), `${contentHash}.${ext}`);
  }

  /**
   * Grava o corpo em disco e devolve `{ contentHash, storagePath }` para o
   * `RawDocument`. Idempotente: mesmo corpo → mesmo caminho (sobrescreve com o
   * conteúdo idêntico). Nunca serializado ao público.
   */
  async store(
    body: Uint8Array | string,
    contentType: string | null,
  ): Promise<{
    contentHash: string;
    storagePath: string;
  }> {
    const contentHash = sha256Hex(body);
    const storagePath = this.pathFor(contentHash, contentType);
    await mkdir(dirname(storagePath), { recursive: true });
    const buffer = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
    await writeFile(storagePath, buffer);
    return { contentHash, storagePath };
  }

  /** Lê o corpo bruto de um caminho previamente gravado (reparse, sem rede). */
  async readBytes(storagePath: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(storagePath));
  }

  async readText(storagePath: string): Promise<string> {
    return readFile(storagePath, 'utf8');
  }
}
