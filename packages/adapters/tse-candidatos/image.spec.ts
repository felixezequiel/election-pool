/**
 * `image.ts` decide o formato pelos BYTES, nunca pelo `Content-Type` (o TSE real
 * anunciou `image/png` para um JPEG). Os fixtures aqui são sintéticos de
 * propósito — ver `__fixtures__/README.md`.
 */

import { describe, it, expect } from 'vitest';
import { inspectPhoto, InvalidPhotoError, PHOTO_EXTENSION } from './image.js';
import { MIN_PHOTO_BYTES, MAX_PHOTO_BYTES } from './constants.js';

/** Preenche o resto do arquivo para passar do piso de bytes. */
const pad = (head: number[], total = MIN_PHOTO_BYTES + 64): Uint8Array => {
  const out = new Uint8Array(total);
  out.set(head, 0);
  return out;
};

/** JPEG mínimo: SOI + APP0 curto + SOF0 com altura/largura. */
const makeJpeg = (widthPx: number, heightPx: number): Uint8Array =>
  pad([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00, // APP0 de 4 bytes
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08, // SOF0, len 17, precision 8
    (heightPx >> 8) & 0xff,
    heightPx & 0xff,
    (widthPx >> 8) & 0xff,
    widthPx & 0xff,
  ]);

/** PNG mínimo: magic + IHDR com largura/altura nos offsets 16 e 20. */
const makePng = (widthPx: number, heightPx: number): Uint8Array =>
  pad([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // magic
    0x00,
    0x00,
    0x00,
    0x0d,
    0x49,
    0x48,
    0x44,
    0x52, // len + 'IHDR'
    0x00,
    0x00,
    (widthPx >> 8) & 0xff,
    widthPx & 0xff,
    0x00,
    0x00,
    (heightPx >> 8) & 0xff,
    heightPx & 0xff,
  ]);

describe('inspectPhoto — caminho feliz', () => {
  it('mede um JPEG nas dimensões da foto oficial real (161x225)', () => {
    const result = inspectPhoto(makeJpeg(161, 225));
    expect(result.format).toBe('jpeg');
    expect(result.widthPx).toBe(161);
    expect(result.heightPx).toBe(225);
    expect(PHOTO_EXTENSION[result.format]).toBe('jpg');
  });

  it('mede um PNG', () => {
    const result = inspectPhoto(makePng(200, 300));
    expect(result.format).toBe('png');
    expect(result.widthPx).toBe(200);
    expect(result.heightPx).toBe(300);
    expect(PHOTO_EXTENSION[result.format]).toBe('png');
  });
});

describe('inspectPhoto — recusa em vez de gravar lixo (R4)', () => {
  it('recusa HTML travestido de imagem', () => {
    const html = new TextEncoder().encode(
      '<!DOCTYPE html><html><body>erro</body></html>'.repeat(20),
    );
    expect(() => inspectPhoto(html)).toThrow(InvalidPhotoError);
  });

  it('recusa corpo pequeno demais (resposta truncada)', () => {
    expect(() => inspectPhoto(new Uint8Array(10))).toThrow(/abaixo do mínimo/);
  });

  it('recusa corpo grande demais', () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    big.set([0xff, 0xd8, 0xff], 0);
    expect(() => inspectPhoto(big)).toThrow(/acima do máximo/);
  });

  it('recusa dimensão fora da faixa (thumbnail inútil)', () => {
    expect(() => inspectPhoto(makeJpeg(10, 10))).toThrow(/fora da faixa aceita/);
  });

  it('recusa dimensão fora da faixa (imagem gigante)', () => {
    expect(() => inspectPhoto(makePng(9000, 9000))).toThrow(/fora da faixa aceita/);
  });

  it('recusa JPEG sem SOF (não dá para medir)', () => {
    const semSof = pad([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    // O padding é 0x00, então o scan não encontra outro marcador válido.
    expect(() => inspectPhoto(semSof)).toThrow(InvalidPhotoError);
  });
});
