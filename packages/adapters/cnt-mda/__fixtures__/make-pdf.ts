/**
 * Gerador DETERMINÍSTICO das fixtures PDF do cnt-mda (SINTETIZADAS — R3, docs/08:
 * não é cópia do relatório da CNT/MDA; só esqueleto de cabeçalhos de cenário e
 * linhas "<rótulo> <número>" com valores inventados). Fica em `.ts`, dentro do
 * projeto, para lintar/typar junto do resto — evita um script `.mjs` solto e
 * mantém as fixtures reproduzíveis a partir do código.
 *
 * Escreve um PDF 1.4 mínimo de UMA página com `/WinAnsiEncoding` e bytes latin1,
 * para que acentos (Tarcísio, Não sabe) sobrevivam à extração de texto do
 * `unpdf` — como num PDF real bem codificado. Sem headless, sem lib pesada.
 */

const escapePdfText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const byteLen = (s: string): number => Buffer.byteLength(s, 'latin1');

/** Constrói os bytes de um PDF de uma página a partir de linhas de texto. */
export const makeCntMdaPdf = (lines: readonly string[]): Uint8Array => {
  const parts = ['BT', '/F1 11 Tf', '14 TL', '1 0 0 1 40 790 Tm'];
  lines.forEach((line, i) => {
    if (i === 0) parts.push(`(${escapePdfText(line)}) Tj`);
    else parts.push('T*', `(${escapePdfText(line)}) Tj`);
  });
  parts.push('ET');
  const content = parts.join('\n');

  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';
  objs[4] = `<< /Length ${String(byteLen(content))} >>\nstream\n${content}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = byteLen(pdf);
    pdf += `${String(i)} 0 obj\n${objs[i] ?? ''}\nendobj\n`;
  }
  const xrefOffset = byteLen(pdf);
  pdf += `xref\n0 ${String(objs.length)}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) {
    pdf += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(objs.length)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
};

// Rodada válida: registro TSE presente; 1º turno estimulado + 2º turno.
// "Ciro" aparece só no 1º turno (exercita "ausente != zero").
export const CNT_MDA_ROUND_LINES: readonly string[] = [
  'CNT/MDA - Pesquisa Nacional de Opinião Pública',
  'Registro TSE: BR-09912/2026',
  'Data de campo: 05 a 08 de agosto de 2026',
  'Amostra: 2002 entrevistas',
  'Cenário 1 - Estimulado (Primeiro Turno)',
  'Lula 38,8',
  'Tarcísio 29,1',
  'Ciro 7,4',
  'Tebet 5,2',
  'Branco/Nulo 12,0',
  'Não sabe 7,5',
  'Cenário 2 - Segundo Turno',
  'Lula 47,3',
  'Tarcísio 42,1',
  'Branco/Nulo 6,6',
  'Não sabe 4,0',
];

// Mesma estrutura, mas OUTRO tse_id no texto: prova V6 (parser lança).
export const CNT_MDA_WRONG_TSE_LINES: readonly string[] = [
  'CNT/MDA - Pesquisa Nacional de Opinião Pública',
  'Registro TSE: BR-07777/2026',
  'Cenário 1 - Estimulado (Primeiro Turno)',
  'Lula 38,8',
  'Tarcísio 29,1',
  'Branco/Nulo 12,0',
  'Não sabe 7,5',
];

// Inclui um alias não cadastrado: prova UnknownCandidateError + quarentena.
export const CNT_MDA_UNKNOWN_LINES: readonly string[] = [
  'CNT/MDA - Pesquisa Nacional de Opinião Pública',
  'Registro TSE: BR-09912/2026',
  'Cenário 1 - Estimulado (Primeiro Turno)',
  'Lula 38,8',
  'Candidato Fantasma 4,2',
  'Branco/Nulo 12,0',
  'Não sabe 7,5',
];
