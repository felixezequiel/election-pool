/**
 * Embala linhas de texto num PDF mínimo, PAGINANDO. Existe porque as specs do
 * adapter precisam exercitar o caminho real de extração de PDF (`unpdf`) sobre o
 * TEXTO REAL das capturas — e o relatório real tem ~500 linhas, muito mais do que
 * cabe numa página.
 *
 * Por que paginar importa: um gerador de página única escreve as linhas
 * seguidamente para fora da `MediaBox`, e o pdf.js descarta o que cai fora — na
 * prática só as ~57 primeiras linhas sobrevivem. O teste passaria a rodar sobre um
 * pedaço do documento sem ninguém notar. Preferimos paginar a truncar em silêncio.
 *
 * PDF 1.4, `/WinAnsiEncoding` e bytes latin1, para que os acentos (`Não sabe`,
 * `Flávio`, `1º turno`) sobrevivam à extração como num PDF real bem codificado.
 * Sem headless, sem biblioteca pesada (CLAUDE.md).
 */

/** Linhas por página: 60 × 13pt de entrelinha cabem na altura útil de 842pt. */
const LINES_PER_PAGE = 60;
const LEADING_PT = 13;
const FIRST_BASELINE_Y = 800;
const PAGE_WIDTH_PT = 595;
const PAGE_HEIGHT_PT = 842;
const LEFT_MARGIN_PT = 30;

const escapePdfText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const byteLen = (value: string): number => Buffer.byteLength(value, 'latin1');

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

const contentStreamFor = (lines: readonly string[]): string => {
  const parts = [
    'BT',
    '/F1 10 Tf',
    `${String(LEADING_PT)} TL`,
    `1 0 0 1 ${String(LEFT_MARGIN_PT)} ${String(FIRST_BASELINE_Y)} Tm`,
  ];
  lines.forEach((line, index) => {
    if (index > 0) parts.push('T*');
    parts.push(`(${escapePdfText(line)}) Tj`);
  });
  parts.push('ET');
  return parts.join('\n');
};

/**
 * Constrói os bytes de um PDF com as linhas dadas, quebrando em quantas páginas
 * forem necessárias. Determinístico: mesmas linhas ⇒ mesmos bytes.
 */
export const makePoderDataPdf = (lines: readonly string[]): Uint8Array => {
  const pages = chunk(
    lines.filter((line) => line.length > 0),
    LINES_PER_PAGE,
  );
  const FONT_OBJ = 3;
  const FIRST_PAGE_OBJ = 4;
  const objs: string[] = [];
  const pageRefs: string[] = [];

  pages.forEach((pageLines, index) => {
    const pageObj = FIRST_PAGE_OBJ + index * 2;
    const contentObj = pageObj + 1;
    pageRefs.push(`${String(pageObj)} 0 R`);
    objs[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(PAGE_WIDTH_PT)} ${String(PAGE_HEIGHT_PT)}] ` +
      `/Resources << /Font << /F1 ${String(FONT_OBJ)} 0 R >> >> /Contents ${String(contentObj)} 0 R >>`;
    const content = contentStreamFor(pageLines);
    objs[contentObj] = `<< /Length ${String(byteLen(content))} >>\nstream\n${content}\nendstream`;
  });

  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${String(pages.length)} >>`;
  objs[FONT_OBJ] =
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

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
