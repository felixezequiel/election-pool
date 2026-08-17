/**
 * Normalização do CORPO BRUTO lido do blob (`RawStorage`) para o formato que o
 * parser precisa.
 *
 * POR QUE ISTO EXISTE. O `HttpClient` compartilhado (docs/04 §6) devolve
 * `body: string` via `Response.text()`. Existem HOJE dois transportes em uso no
 * repo para esse mesmo campo:
 *
 * 1. texto puro — o `fetch` global cru, usado pelo HarvestJob;
 * 2. BASE64 — `tse-candidatos/binary-fetch.ts` (`createBase64Fetch`) envolve o
 *    `fetch` justamente porque `text()` sobre bytes binários destrói o conteúdo
 *    (todo byte inválido em UTF-8 vira U+FFFD).
 *
 * O adapter não escolhe como o orquestrador montou o cliente compartilhado, e um
 * PDF que chega pelo transporte (1) fica CORROMPIDO. Então detectamos a forma do
 * corpo e, se nenhuma servir, LANÇAMOS com a causa provável no texto do erro
 * (R4: falha alta, nunca silenciosa) — o adapter nunca finge que leu um PDF.
 *
 * Detecção, não heurística frouxa: base64 é um alfabeto fechado, e um PDF/HTML
 * real contém bytes fora dele (`%`, `<`, `\n` de conteúdo binário), então
 * "o corpo inteiro cabe no alfabeto base64" é um teste seguro.
 */

import { ParseError } from '../poll-source-adapter.js';
import { PDF_SIGNATURE } from './constants.js';

/** Alfabeto base64 + espaços em branco (quebras de linha de transporte). */
const BASE64_ONLY = /^[A-Za-z0-9+/\s]+={0,2}\s*$/;

const startsWithPdfSignature = (bytes: Uint8Array): boolean => {
  const head = Buffer.from(bytes.subarray(0, PDF_SIGNATURE.length)).toString('latin1');
  return head === PDF_SIGNATURE;
};

/**
 * Devolve os BYTES do PDF a partir do blob gravado. Aceita o PDF gravado direto e
 * o PDF que trafegou em base64. Qualquer outra coisa LANÇA.
 */
export const asPdfBytes = (stored: Uint8Array): Uint8Array => {
  if (startsWithPdfSignature(stored)) return stored;

  const asText = Buffer.from(stored).toString('utf8');
  if (BASE64_ONLY.test(asText)) {
    const decoded = new Uint8Array(Buffer.from(asText, 'base64'));
    if (startsWithPdfSignature(decoded)) return decoded;
  }

  throw new ParseError(
    'Corpo bruto não é um PDF (nem direto, nem em base64). Causa provável: o ' +
      'HttpClient compartilhado foi montado sem `createBase64Fetch`, e ' +
      '`Response.text()` sobre bytes binários corrompe o PDF (docs/04 §6). ' +
      'Nada é extraído deste documento.',
  );
};

/**
 * Devolve o TEXTO (HTML) a partir de um corpo do `HttpClient`. Mesmo raciocínio:
 * se o cliente compartilhado estiver em modo base64, o HTML chega codificado.
 * Corpo vazio LANÇA — nunca tratamos "nada" como "página sem pesquisas".
 */
export const asHtmlText = (body: string): string => {
  if (body.trim().length === 0) {
    throw new ParseError('Índice do REAL TIME BIG DATA voltou com corpo vazio');
  }
  if (BASE64_ONLY.test(body)) {
    return Buffer.from(body, 'base64').toString('utf8');
  }
  return body;
};
