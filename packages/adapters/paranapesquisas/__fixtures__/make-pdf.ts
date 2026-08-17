/**
 * Reembala o TEXTO REAL capturado (`nacional-*.txt`) num PDF, para que os specs
 * exercitem o caminho de produção inteiro: bytes no blob → `extractPdfText`
 * (`unpdf`, o MESMO extrator do cnt-mda) → V6 → parser.
 *
 * Por que existe, em vez de commitar o PDF original: o release do instituto é uma
 * peça gráfica de terceiro (docs/08 §2 — "gráfico/imagem do instituto: nunca
 * copiamos"). Guardamos no repositório apenas o TEXTO extraído, que é fato
 * (números, rótulos e rubricas), e o remontamos em PDF na hora do teste. O
 * conteúdo é real; o invólucro é nosso.
 *
 * Por que não reusar `cnt-mda/__fixtures__/make-pdf.ts`: aquele gerador escreve
 * UMA página, e a captura real tem ~480 linhas (cabem ~55 por página A4 com o
 * leading usado). Este pagina. A estrutura do PDF é a mesma daquele, deliberadamente.
 *
 * Nota sobre paginação: as páginas FÍSICAS deste PDF não coincidem com os slides
 * do original — e isso é irrelevante, porque `extractPdfText` concatena as páginas
 * com `\n` e o parser reparte por SLIDE usando a sentença de registro repetida no
 * rodapé (ver `parse.ts`). O que o parser vê é a mesma sequência de linhas.
 */

/**
 * Pontuação que o PDF precisa em CP1252 (`/WinAnsiEncoding`) e que `latin1` não
 * mapeia sozinha: `Buffer.from(s,'latin1')` guarda o byte BAIXO do code unit, e
 * U+2013 (–) viraria 0x13 (controle). Traduzimos ao code point CP1252 antes.
 * Sem isso os rótulos reais ("ESTIMULADA – Cenário 1") voltariam corrompidos da
 * extração — e a fixture deixaria de ser fiel à captura.
 */
const CP1252_PUNCTUATION = new Map<number, number>([
  [0x2013, 0x96], // – en dash
  [0x2014, 0x97], // — em dash
  [0x2018, 0x91], // ‘
  [0x2019, 0x92], // ’
  [0x201c, 0x93], // “
  [0x201d, 0x94], // ”
  [0x2022, 0x95], // •
  [0x2026, 0x85], // …
]);

const toWinAnsi = (text: string): string =>
  [...text]
    .map((char) => {
      const mapped = CP1252_PUNCTUATION.get(char.codePointAt(0) ?? 0);
      return mapped === undefined ? char : String.fromCharCode(mapped);
    })
    .join('');

const escapePdfText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const byteLen = (s: string): number => Buffer.byteLength(s, 'latin1');

/** Linhas por página física. 842pt de altura, 14pt de leading, topo em 790. */
const LINES_PER_PAGE = 55;

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const contentStream = (lines: readonly string[]): string => {
  const parts = ['BT', '/F1 11 Tf', '14 TL', '1 0 0 1 40 790 Tm'];
  lines.forEach((line, i) => {
    if (i === 0) parts.push(`(${escapePdfText(line)}) Tj`);
    else parts.push('T*', `(${escapePdfText(line)}) Tj`);
  });
  parts.push('ET');
  return parts.join('\n');
};

/**
 * Constrói os bytes de um PDF multipágina a partir das linhas de texto. O texto
 * das linhas é o conteúdo REAL da captura; nada é inventado aqui.
 */
export const makeParanaPesquisasPdf = (text: string): Uint8Array => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => toWinAnsi(l.trim()))
    .filter((l) => l.length > 0);
  const pages = chunk(lines, LINES_PER_PAGE);
  if (pages.length === 0) {
    throw new Error('makeParanaPesquisasPdf: texto vazio — fixture inválida');
  }

  // Layout de objetos: 1 catálogo, 2 páginas, 3 fonte, depois (página, conteúdo)
  // por página física.
  const firstPageObj = 4;
  const kids = pages.map((_, i) => `${String(firstPageObj + i * 2)} 0 R`).join(' ');
  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((pageLines, i) => {
    const pageObj = firstPageObj + i * 2;
    const contentObj = pageObj + 1;
    const content = contentStream(pageLines);
    objs[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentObj)} 0 R >>`;
    objs[contentObj] = `<< /Length ${String(byteLen(content))} >>\nstream\n${content}\nendstream`;
  });

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
