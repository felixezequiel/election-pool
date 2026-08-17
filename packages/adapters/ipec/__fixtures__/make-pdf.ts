/**
 * Empacota as linhas REAIS capturadas do release do Ipec (os `.txt` deste
 * diretório) num PDF, para que o teste exercite o caminho de produção COMPLETO:
 * bytes no blob → `RawStorage.readBytes` → `extractPdfText` (`unpdf`, o mesmo do
 * cnt-mda, sem headless) → parser.
 *
 * Por que existe: o que está congelado como fixture é a CAMADA DE TEXTO real do
 * PDF do Ipec (ver README.md), não o binário original — que é prosa de terceiro e
 * não pode morar no repo (R3, docs/08 §2.1). Sem este empacotador, o teste
 * exercitaria só o parser e deixaria `documentToText` sem cobertura; com ele, o
 * mesmo texto real atravessa a extração de PDF de verdade.
 *
 * Escreve um PDF 1.4 multipágina com `/WinAnsiEncoding`. A tradução para WinAnsi
 * é necessária porque as linhas reais do Ipec usam caracteres FORA de latin1 —
 * o travessão EN DASH de "Lula – 13 – PT" (U+2013) e o apóstrofo curvo de
 * "Felipe d’Avila" (U+2019). Codificá-las como latin1 puro (que é o que o
 * empacotador do cnt-mda faz, porque as fixtures dele não têm esses caracteres)
 * corromperia justamente os separadores que o parser usa para achar o alias.
 */

/**
 * Caracteres que existem em WinAnsi (CP1252) mas NÃO em latin1, na faixa
 * 0x80–0x9F. Só os que aparecem nas capturas reais, mais os vizinhos óbvios de
 * pontuação tipográfica.
 */
const WINANSI_HIGH: ReadonlyMap<string, number> = new Map([
  ['€', 0x80], // €
  ['‚', 0x82], // ‚
  ['ƒ', 0x83], // ƒ
  ['„', 0x84], // „
  ['…', 0x85], // …
  ['†', 0x86], // †
  ['‡', 0x87], // ‡
  ['‰', 0x89], // ‰
  ['‹', 0x8b], // ‹
  ['‘', 0x91], // ‘
  ['’', 0x92], // ’  — "Felipe d’Avila"
  ['“', 0x93], // “
  ['”', 0x94], // ”
  ['•', 0x95], // •
  ['–', 0x96], // –  — separador de "Lula – 13 – PT"
  ['—', 0x97], // —
  ['›', 0x9b], // ›
]);

/** Substituto para o que não existe em WinAnsi (ex.: o marcador `➢` do release). */
const UNMAPPABLE = 0x3f; // '?'

/**
 * Converte uma string para bytes WinAnsi. Caractere sem representação vira `?` —
 * aceitável porque os únicos casos reais são marcadores DECORATIVOS (`➢`), que o
 * parser nunca lê. Nenhum caractere que o parser usa cai neste ramo.
 */
const toWinAnsi = (s: string): Buffer => {
  const bytes = Buffer.alloc(s.length);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === undefined) {
      bytes[i] = UNMAPPABLE;
      continue;
    }
    const high = WINANSI_HIGH.get(ch);
    if (high !== undefined) {
      bytes[i] = high;
      continue;
    }
    const code = ch.codePointAt(0) ?? UNMAPPABLE;
    bytes[i] = code <= 0xff ? code : UNMAPPABLE;
  }
  return bytes;
};

const escapePdfText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** Linhas por página, para o texto não sair da `MediaBox` (leading de 14pt). */
const LINES_PER_PAGE = 52;

/** Monta o content stream de uma página a partir de suas linhas. */
const pageContent = (lines: readonly string[]): string => {
  const parts = ['BT', '/F1 10 Tf', '14 TL', '1 0 0 1 40 800 Tm'];
  lines.forEach((line, i) => {
    if (i > 0) parts.push('T*');
    parts.push(`(${escapePdfText(line)}) Tj`);
  });
  parts.push('ET');
  return parts.join('\n');
};

/**
 * Constrói os bytes de um PDF multipágina a partir do texto de uma fixture.
 * Determinístico: mesma entrada, mesmos bytes.
 */
export const makeIpecReleasePdf = (text: string): Uint8Array => {
  const lines = text.split(/\r?\n/);
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push(['']);

  // Layout dos objetos: 1=Catalog, 2=Pages, 3=Font, depois um par
  // (Page, Contents) por página.
  const firstPageObj = 4;
  const kids = pages.map((_, i) => `${String(firstPageObj + i * 2)} 0 R`).join(' ');

  const objs: (string | { dict: string; stream: Buffer })[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  pages.forEach((pageLines, i) => {
    const pageObj = firstPageObj + i * 2;
    const contentObj = pageObj + 1;
    objs[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentObj)} 0 R >>`;
    const stream = toWinAnsi(pageContent(pageLines));
    objs[contentObj] = { dict: `<< /Length ${String(stream.length)} >>`, stream };
  });

  const chunks: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let offset = chunks[0]?.length ?? 0;
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    const obj = objs[i];
    if (obj === undefined) continue;
    offsets[i] = offset;
    const head = Buffer.from(`${String(i)} 0 obj\n`, 'latin1');
    const body =
      typeof obj === 'string'
        ? Buffer.from(`${obj}\n`, 'latin1')
        : Buffer.concat([
            Buffer.from(`${obj.dict}\nstream\n`, 'latin1'),
            obj.stream,
            Buffer.from('\nendstream\n', 'latin1'),
          ]);
    const tail = Buffer.from('endobj\n', 'latin1');
    chunks.push(head, body, tail);
    offset += head.length + body.length + tail.length;
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${String(objs.length)}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) {
    xref += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  xref +=
    `trailer\n<< /Size ${String(objs.length)} /Root 1 0 R >>\n` +
    `startxref\n${String(xrefOffset)}\n%%EOF`;
  chunks.push(Buffer.from(xref, 'latin1'));

  return new Uint8Array(Buffer.concat(chunks));
};
