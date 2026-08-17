/**
 * Gerador DETERMINÍSTICO de PDFs de teste com texto POSICIONADO.
 *
 * POR QUE ELE EXISTE, e por que não é a fixture de dado. As fixtures de DADO
 * deste adapter são REAIS (`*.layout.txt`, ver `README.md`). Mas o repositório
 * não pode conter o PDF do instituto: docs/08 §2 diz que gráfico/imagem de
 * terceiro nunca é copiado, e o arquivo original tem 2,5 MB do design deles. Só
 * que o passo PDF→texto é justamente onde mora o risco (a ordem de fluxo do PDF
 * inverte os valores do 2º turno), e ele precisa ser exercitado no CI sem rede.
 *
 * A saída: um PDF mínimo cuja GEOMETRIA reproduz a do documento real
 * (coordenadas transcritas do original, ver `pdf-layout.ts`), incluindo as duas
 * armadilhas medidas:
 *
 *  - cada texto é desenhado DUAS vezes na mesma coordenada (a camada de contorno
 *    da ferramenta de design), para exercitar o dedupe;
 *  - no confronto de 2º turno os valores são escritos na ORDEM DE FLUXO INVERSA
 *    à posição na página, para exercitar o pareamento por `x`.
 *
 * Isto NÃO é uma cópia do documento do instituto: é um esqueleto de coordenadas.
 * Fica em `.ts` (e não como binário no repo) para ser lintado e reproduzível,
 * mesmo padrão de `cnt-mda/__fixtures__/make-pdf.ts`.
 */

export interface PdfTextItem {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  /** Corpo da fonte em pt. Default 12. */
  readonly size?: number;
}

const escapePdfText = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const byteLen = (value: string): number => Buffer.byteLength(value, 'latin1');

/** Content stream de uma página: cada item posicionado por `Tm`, desenhado 2x. */
const pageContent = (items: readonly PdfTextItem[]): string => {
  const parts: string[] = [];
  for (const item of items) {
    const size = item.size ?? 12;
    // Duas passadas idênticas: reproduz a camada duplicada do documento real.
    for (let pass = 0; pass < 2; pass += 1) {
      parts.push(
        'BT',
        `/F1 ${String(size)} Tf`,
        `1 0 0 1 ${String(item.x)} ${String(item.y)} Tm`,
        `(${escapePdfText(item.text)}) Tj`,
        'ET',
      );
    }
  }
  return parts.join('\n');
};

/**
 * Monta um PDF 1.4 de N páginas com `/WinAnsiEncoding` e bytes latin1, para que
 * acentos (ESPONTÂNEA, NÃO SABE) sobrevivam à extração — como num PDF real bem
 * codificado. Sem headless, sem lib pesada.
 */
export const makeRealTimePdf = (pages: ReadonlyArray<readonly PdfTextItem[]>): Uint8Array => {
  const objs: string[] = [];
  const pageObjIds: number[] = [];
  // 1 = Catalog, 2 = Pages, 3 = Font; páginas e conteúdos a partir de 4.
  let nextId = 4;
  const contents: Array<{ id: number; body: string }> = [];
  for (const items of pages) {
    const pageId = nextId;
    const contentId = nextId + 1;
    nextId += 2;
    pageObjIds.push(pageId);
    objs[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1280 800] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${String(contentId)} 0 R >>`;
    contents.push({ id: contentId, body: pageContent(items) });
  }
  for (const content of contents) {
    objs[content.id] =
      `<< /Length ${String(byteLen(content.body))} >>\nstream\n${content.body}\nendstream`;
  }
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] =
    `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${String(id)} 0 R`).join(' ')}] ` +
    `/Count ${String(pageObjIds.length)} >>`;
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < nextId; id += 1) {
    offsets[id] = byteLen(pdf);
    pdf += `${String(id)} 0 obj\n${objs[id] ?? '<< >>'}\nendobj\n`;
  }
  const xrefOffset = byteLen(pdf);
  pdf += `xref\n0 ${String(nextId)}\n0000000000 65535 f \n`;
  for (let id = 1; id < nextId; id += 1) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(nextId)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
};

/** Capa: é onde o registro TSE aparece no documento real (V6 depende disso). */
const capa = (tseId: string): readonly PdfTextItem[] => [
  { x: 81, y: 600, text: 'PESQUISA', size: 20 },
  { x: 174, y: 600, text: 'REGISTRADA:', size: 20 },
  { x: 81, y: 560, text: tseId, size: 20 },
  { x: 81, y: 520, text: 'DIVULGAÇÃO: 12/08/2026', size: 20 },
];

/** Divisória: página com o título da seção sozinho. */
const divisoria = (titulo: string): readonly PdfTextItem[] => [
  { x: 433, y: 448, text: titulo, size: 34 },
];

/**
 * Gráfico de barras. Cada linha tem o rótulo na esquerda e o valor no fim da
 * barra, com passo vertical de 52 pt e baseline do valor 1 pt abaixo do rótulo —
 * exatamente como no documento real. O eixo entra como faixa própria embaixo.
 */
const barras = (rows: ReadonlyArray<readonly [string, number]>): readonly PdfTextItem[] => {
  const items: PdfTextItem[] = [];
  let y = 548;
  for (const [label, pct] of rows) {
    items.push({ x: 260, y, text: label });
    // x do valor cresce com o valor: é a ponta da barra (o vão rótulo→valor
    // varia, e é por isso que o pareamento não pode usar distância).
    items.push({ x: 400 + pct * 8, y: y - 1, text: `${String(pct)}%` });
    y -= 52;
  }
  for (let tick = 0; tick <= 50; tick += 10) {
    items.push({ x: 399 + tick * 15.4, y: 136, text: `${String(tick)}%` });
  }
  return items;
};

/**
 * Confronto de 2º turno com a inversão real: `esquerda` é o finalista da
 * esquerda da página, mas o valor DELE é escrito DEPOIS no fluxo do PDF.
 */
const confronto = (
  esquerda: readonly [string, number],
  direita: readonly [string, number],
  blankNullPct: number,
  undecidedPct: number,
): readonly PdfTextItem[] => [
  { x: 88, y: 701, text: 'CENÁRIO', size: 34 },
  { x: 212, y: 701, text: '01', size: 34 },
  { x: 379, y: 517, text: esquerda[0], size: 16 },
  { x: 859, y: 517, text: direita[0], size: 16 },
  // Ordem de fluxo INVERTIDA em relação à posição (o defeito real).
  { x: 745, y: 395, text: `${String(direita[1])}%`, size: 24 },
  { x: 511, y: 395, text: `${String(esquerda[1])}%`, size: 24 },
  { x: 607, y: 287, text: `NULO/BRANCO: ${String(blankNullPct)}%` },
  { x: 556, y: 251, text: `NÃO SABE / NÃO RESPONDEU: ${String(undecidedPct)}%` },
];

/**
 * Deck sintético completo, com a MESMA sequência de páginas do documento real.
 * Números inventados (não são a pesquisa do instituto) — o dado real está nas
 * fixtures `*.layout.txt`.
 */
export const syntheticRoundPdf = (tseId = 'BR-06833/2026'): Uint8Array =>
  makeRealTimePdf([
    capa(tseId),
    divisoria('ESPONTÂNEA PRESIDENTE'),
    barras([
      ['Lula', 22],
      ['Flávio Bolsonaro', 21],
      ['Jair Bolsonaro', 1],
      ['Nulo/Branco', 12],
      ['NS/NR', 44],
    ]),
    divisoria('ESTIMULADA PRESIDENTE'),
    barras([
      ['Flávio Bolsonaro (PL)', 43],
      ['Lula (PT)', 33],
      ['Romeu Zema (Novo)', 1],
      ['Nulo/Branco', 4],
      ['NS / NR', 19],
    ]),
    divisoria('SEGUNDO TURNO'),
    confronto(['LULA (PT)', 37], ['FLÁVIO BOLSONARO (PL)', 51], 6, 6),
    divisoria('REJEIÇÃO MÚLTIPLA'),
    barras([
      ['Lula (PT)', 55],
      ['Flávio Bolsonaro (PL)', 37],
    ]),
  ]);
