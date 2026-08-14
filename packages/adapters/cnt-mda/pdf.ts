/**
 * Extração de TEXTO de PDF via `unpdf` (docs/04 §3, cnt-mda lê PDF). O `unpdf`
 * embute uma build serverless do pdf.js — sem dependência nativa e SEM headless
 * browser (CLAUDE.md "O que não fazer"; docs/04 §6). Extraímos só texto; nunca
 * renderizamos nem republicamos o PDF (R3).
 *
 * Devolve o texto com as páginas concatenadas, uma linha por item de layout —
 * suficiente para o parser de linhas (`base/scenario-lines`). Falha de extração
 * LANÇA (R4): nunca devolvemos string vazia silenciosa como se fosse "PDF sem
 * dados".
 */

import { extractText, getDocumentProxy } from 'unpdf';
import { ParseError } from '../poll-source-adapter.js';

export const extractPdfText = async (bytes: Uint8Array): Promise<string> => {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new ParseError('PDF sem texto extraível (varredura de imagem? não suportado na v1)');
    }
    return text;
  } catch (err) {
    if (err instanceof ParseError) throw err;
    throw new ParseError('Falha ao extrair texto do PDF', err);
  }
};
