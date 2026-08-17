/**
 * Inspeção de imagem sem dependência externa.
 *
 * POR QUE não confiamos no `Content-Type`: a resposta real do TSE em 2026-08-16
 * veio com `Content-Type: image/png` e `Content-Disposition: filename=... .jpg`
 * carregando bytes que começam com `FF D8 FF` — ou seja, um JPEG anunciado como
 * PNG e nomeado como JPG. Três fontes, duas erradas. A única verdade sobre o
 * formato de um arquivo são os seus próprios bytes, então é o que lemos.
 *
 * POR QUE não re-codificamos: re-encodar exigiria `sharp`/`imagemagick` (binário
 * nativo, dependência pesada para um pipeline que roda em container enxuto) e a
 * foto oficial já chega pronta para a web (6.6 KB, 161x225 na captura real).
 * "Normalizar" aqui significa então: provar o formato, medir as dimensões, impor
 * limites de sanidade e dar ao arquivo a extensão que corresponde aos bytes.
 * Recusa é sempre preferível a gravar lixo no diretório público (R4).
 */

import {
  MAX_PHOTO_BYTES,
  MIN_PHOTO_BYTES,
  MAX_PHOTO_DIMENSION_PX,
  MIN_PHOTO_DIMENSION_PX,
} from './constants.js';

/**
 * Formatos aceitos. Lista fechada e ordenada — a migration deriva o CHECK de
 * `candidates.photo_format` daqui, para que banco e código não divirjam (mesmo
 * padrão dos enums de `contracts` nas migrations de T-02).
 */
export const PHOTO_FORMATS = ['jpeg', 'png'] as const;
export type PhotoFormat = (typeof PHOTO_FORMATS)[number];

/** Extensão de arquivo por formato. `jpeg` vira `.jpg` por convenção web. */
export const PHOTO_EXTENSION: Readonly<Record<PhotoFormat, string>> = {
  jpeg: 'jpg',
  png: 'png',
};

export interface InspectedImage {
  format: PhotoFormat;
  widthPx: number;
  heightPx: number;
  byteLength: number;
}

export class InvalidPhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPhotoError';
  }
}

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const startsWith = (bytes: Uint8Array, magic: Uint8Array): boolean => {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
};

const readUInt16BE = (bytes: Uint8Array, offset: number): number => {
  const hi = bytes[offset];
  const lo = bytes[offset + 1];
  if (hi === undefined || lo === undefined) {
    throw new InvalidPhotoError(`Imagem truncada: faltam bytes no offset ${offset}`);
  }
  return (hi << 8) | lo;
};

const readUInt32BE = (bytes: Uint8Array, offset: number): number => {
  return readUInt16BE(bytes, offset) * 0x10000 + readUInt16BE(bytes, offset + 2);
};

/** PNG: largura/altura são os dois uint32 do chunk IHDR, em offset fixo. */
const readPngSize = (bytes: Uint8Array): { widthPx: number; heightPx: number } => ({
  widthPx: readUInt32BE(bytes, 16),
  heightPx: readUInt32BE(bytes, 20),
});

/**
 * JPEG: percorre os segmentos até o SOF (Start Of Frame). Só os SOF carregam a
 * dimensão; SOF4/SOF8/SOF12 (0xC4/0xC8/0xCC) são tabelas, não frames, e ficam de
 * fora. Sem SOF ⇒ não é JPEG utilizável ⇒ lança.
 */
const readJpegSize = (bytes: Uint8Array): { widthPx: number; heightPx: number } => {
  let offset = 2; // pula o SOI (FF D8)
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      // Layout do SOF: FF Cx | len(2) | precision(1) | height(2) | width(2)
      return {
        heightPx: readUInt16BE(bytes, offset + 5),
        widthPx: readUInt16BE(bytes, offset + 7),
      };
    }
    const segmentLength = readUInt16BE(bytes, offset + 2);
    if (segmentLength < 2) {
      throw new InvalidPhotoError('JPEG malformado: segmento com tamanho inválido');
    }
    offset += 2 + segmentLength;
  }
  throw new InvalidPhotoError('JPEG sem marcador SOF: não foi possível medir a imagem');
};

/**
 * Prova o formato pelos bytes, mede e valida contra os limites de sanidade.
 * LANÇA `InvalidPhotoError` em qualquer desvio — nunca devolve resultado parcial
 * nem "melhor esforço".
 */
export const inspectPhoto = (bytes: Uint8Array): InspectedImage => {
  if (bytes.length < MIN_PHOTO_BYTES) {
    throw new InvalidPhotoError(
      `Foto com ${bytes.length} bytes: abaixo do mínimo de ${MIN_PHOTO_BYTES}`,
    );
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new InvalidPhotoError(
      `Foto com ${bytes.length} bytes: acima do máximo de ${MAX_PHOTO_BYTES}`,
    );
  }

  let format: PhotoFormat;
  let size: { widthPx: number; heightPx: number };
  if (startsWith(bytes, PNG_MAGIC)) {
    format = 'png';
    size = readPngSize(bytes);
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    format = 'jpeg';
    size = readJpegSize(bytes);
  } else {
    // Resposta de erro em HTML, PDF, SVG, qualquer coisa: recusa.
    const head = [...bytes.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    throw new InvalidPhotoError(`Bytes não são JPEG nem PNG (primeiros bytes: ${head})`);
  }

  for (const [label, value] of [
    ['largura', size.widthPx],
    ['altura', size.heightPx],
  ] as const) {
    if (value < MIN_PHOTO_DIMENSION_PX || value > MAX_PHOTO_DIMENSION_PX) {
      throw new InvalidPhotoError(
        `Foto com ${label} de ${value}px fora da faixa aceita ` +
          `(${MIN_PHOTO_DIMENSION_PX}..${MAX_PHOTO_DIMENSION_PX}px)`,
      );
    }
  }

  return { format, widthPx: size.widthPx, heightPx: size.heightPx, byteLength: bytes.length };
};
