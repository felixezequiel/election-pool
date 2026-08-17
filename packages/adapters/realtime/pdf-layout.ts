/**
 * Extração de texto do PDF do REAL TIME BIG DATA **preservando a geometria**.
 *
 * POR QUE NÃO REUSAMOS `cnt-mda/pdf.ts`. Aquele helper faz
 * `extractText(pdf, { mergePages: true })`, que devolve o texto na ORDEM DO
 * FLUXO do PDF e sem coordenadas. Nos documentos reais deste instituto (6
 * rodadas capturadas, ver `__fixtures__/README.md`) isso produz DOIS defeitos
 * graves, verificados um a um contra as coordenadas reais:
 *
 * 1. **Troca de candidatos no 2º turno.** Na página de 2º turno os nomes saem no
 *    fluxo como `LULA (PT)` depois `FLÁVIO BOLSONARO (PL)`, mas os VALORES saem
 *    na ordem inversa da tela. Em `BR-06833/2026` (Mato Grosso) o fluxo dá
 *    `51%` e depois `37%`, enquanto na página o `37%` está à ESQUERDA (x=511,3,
 *    do lado do Lula) e o `51%` à DIREITA (x=745,1, do lado do Flávio). Um
 *    parser de ordem-de-fluxo atribuiria 51% ao Lula — exatamente o "pior bug do
 *    sistema" (docs/04 §4.1) e sem nenhum sintoma: a soma continua 100 e todas
 *    as validações passam. `BR-05205/2026` (Bahia) tem o mesmo layout com o
 *    resultado invertido (Lula 59%, Flávio 30%), então o erro seria em uma
 *    direção num documento e na outra no outro — nem um viés constante que
 *    alguém notaria.
 * 2. **Perda e colagem de valores.** No fluxo, o último valor vem grudado no
 *    texto seguinte (`"3%EM OUTUBRO TEREMOS..."`) e uma linha de valor legítima
 *    aparece grudada na prosa da nota de rodapé
 *    (`"Outros 1% / HERTZ DIAS (PSTU) ..."`), o que fura qualquer regex ancorada
 *    no fim da linha e faria o `Outros` desaparecer em silêncio (R4).
 *
 * O QUE FAZEMOS. Lemos os itens de texto com coordenadas (`getTextContent`) e
 * reconstruímos linhas por GEOMETRIA:
 *
 * - **Dedupe de camada duplicada.** O documento é montado numa ferramenta de
 *   design que desenha cada texto duas vezes na MESMA coordenada (efeito de
 *   contorno). Dois itens com a mesma string na mesma coordenada são o mesmo
 *   glifo desenhado duas vezes, nunca dois dados distintos — dois dados
 *   diferentes não podem ocupar o mesmo ponto. Isso elimina de uma vez todo o
 *   `"ESPONTÂNEA PRESIDENTEESPONTÂNEA PRESIDENTE"`.
 * - **Faixas horizontais.** Itens com baseline dentro de `Y_BAND_TOLERANCE_PT`
 *   formam uma linha; dentro dela ordenamos por `x` crescente (esquerda→direita,
 *   a ordem que o leitor humano vê).
 * - **Junção de palavras.** Cada palavra é um item separado no PDF, então itens
 *   de texto vizinhos com vão menor que `WORD_GAP_TOLERANCE_PT` voltam a ser uma
 *   frase. Os dois nomes do confronto de 2º turno ficam 406,8 pt distantes e por
 *   isso permanecem separados — que é o que o pareamento posicional exige.
 * - **Pareamento rótulo→valor.** Num gráfico de barras horizontais o rótulo da
 *   categoria fica à esquerda e o rótulo de valor no fim da barra, na MESMA
 *   faixa. Então um token de valor é emitido junto do TRECHO DE TEXTO
 *   imediatamente à sua esquerda, virando uma linha `"<rótulo> <valor>%"` — o
 *   formato que o parser de linhas consome. Trechos sem par saem cada um em sua
 *   própria linha (prosa, eixo, nomes do 2º turno): nada é descartado aqui, a
 *   decisão do que é dado é do parser.
 *
 * Sem headless browser (CLAUDE.md), só `unpdf` (pdf.js serverless) — o mesmo
 * motor do cnt-mda. Falha de extração LANÇA (R4).
 */

import { getDocumentProxy } from 'unpdf';
import { ParseError } from '../poll-source-adapter.js';
import { PDF_PAGE_SEPARATOR, WORD_GAP_TOLERANCE_PT, Y_BAND_TOLERANCE_PT } from './constants.js';

/** Um item de texto posicionado, já reduzido ao que nos interessa. */
interface PositionedItem {
  readonly x: number;
  readonly y: number;
  /** Largura do trecho desenhado, em pontos — usada para medir o vão até o próximo. */
  readonly width: number;
  readonly str: string;
}

/**
 * Token de valor: um percentual SOZINHO no item (`43%`, `7,5%`). O `%` no fim é
 * obrigatório justamente para que prosa terminada em número (`"... ATINGIRAM
 * 1%."`, com ponto) não seja confundida com dado.
 */
const VALUE_TOKEN = /^\d{1,3}(?:,\d+)?%$/;

/** Forma mínima de um item de texto do pdf.js (`TextItem`). */
const asPositionedItem = (item: unknown): PositionedItem | null => {
  if (typeof item !== 'object' || item === null) return null;
  const candidate = item as { str?: unknown; width?: unknown; transform?: unknown };
  if (typeof candidate.str !== 'string') return null;
  if (!Array.isArray(candidate.transform)) return null;
  // A matriz de transformação do pdf.js é `[a, b, c, d, e, f]`; `e`/`f` são a
  // translação, ou seja a posição da baseline do trecho.
  const transform = candidate.transform as readonly unknown[];
  const x = transform[4];
  const y = transform[5];
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  const str = candidate.str.trim();
  if (str.length === 0) return null;
  const width = typeof candidate.width === 'number' ? candidate.width : 0;
  return { x, y, width, str };
};

/** Remove a camada de contorno: mesmo texto na mesma coordenada = mesmo glifo. */
const dedupeOverdraw = (items: readonly PositionedItem[]): PositionedItem[] => {
  const seen = new Set<string>();
  const out: PositionedItem[] = [];
  for (const item of items) {
    const key = `${item.x.toFixed(1)}|${item.y.toFixed(1)}|${item.str}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

/**
 * Agrupa em faixas horizontais. Ordena por `y` DECRESCENTE (topo→base, pois em
 * PDF o eixo y cresce para cima) e abre uma faixa nova quando a distância ao
 * início da faixa corrente passa da tolerância. Comparador total e determinístico
 * (a tolerância é aplicada no agrupamento, nunca dentro do `sort`).
 */
const groupIntoBands = (items: readonly PositionedItem[]): PositionedItem[][] => {
  const sorted = [...items].sort((a, b) => (a.y === b.y ? a.x - b.x : b.y - a.y));
  const bands: PositionedItem[][] = [];
  let current: PositionedItem[] | null = null;
  let bandY = 0;
  for (const item of sorted) {
    if (current === null || bandY - item.y > Y_BAND_TOLERANCE_PT) {
      current = [item];
      bands.push(current);
      bandY = item.y;
    } else {
      current.push(item);
    }
  }
  return bands.map((band) => [...band].sort((a, b) => a.x - b.x));
};

/**
 * Emite as linhas de uma faixa. Itens de texto vizinhos viram um TRECHO só
 * (palavras da mesma frase); cada token de valor sai junto do trecho
 * imediatamente à sua esquerda (o rótulo da barra); os trechos sem valor saem
 * isolados, na ordem em que aparecem. Nada é descartado.
 */
const bandToLines = (band: readonly PositionedItem[]): string[] => {
  const lines: string[] = [];
  const runs: string[] = [];
  let previousText: PositionedItem | null = null;

  for (const item of band) {
    if (VALUE_TOKEN.test(item.str)) {
      const label = runs.pop();
      // Trechos anteriores ao rótulo mais próximo não são o par da barra: saem
      // como linhas próprias (prosa à esquerda do gráfico), sem sumir.
      for (const orphan of runs) lines.push(orphan);
      runs.length = 0;
      previousText = null;
      lines.push(label === undefined ? item.str : `${label} ${item.str}`);
      continue;
    }
    const last = runs.length === 0 ? undefined : runs[runs.length - 1];
    const gap =
      previousText === null
        ? Number.POSITIVE_INFINITY
        : item.x - (previousText.x + previousText.width);
    if (last !== undefined && gap <= WORD_GAP_TOLERANCE_PT) {
      runs[runs.length - 1] = `${last} ${item.str}`;
    } else {
      runs.push(item.str);
    }
    previousText = item;
  }

  for (const orphan of runs) lines.push(orphan);
  return lines;
};

/**
 * PDF (bytes) → texto normalizado por layout, uma linha por item/par e páginas
 * separadas por `PDF_PAGE_SEPARATOR`. LANÇA se o documento não tiver nenhum
 * texto extraível (PDF de imagem escaneada não é suportado na v1).
 */
export const pdfToLayoutText = async (bytes: Uint8Array): Promise<string> => {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(bytes);
    pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items: PositionedItem[] = [];
      for (const raw of content.items) {
        const item = asPositionedItem(raw);
        if (item !== null) items.push(item);
      }
      const lines = groupIntoBands(dedupeOverdraw(items)).flatMap(bandToLines);
      pages.push(lines.join('\n'));
    }
  } catch (err) {
    if (err instanceof ParseError) throw err;
    throw new ParseError('Falha ao extrair texto posicionado do PDF do REAL TIME BIG DATA', err);
  }

  if (pages.every((page) => page.trim().length === 0)) {
    throw new ParseError(
      'PDF do REAL TIME BIG DATA sem texto extraível (varredura de imagem? não suportado na v1)',
    );
  }
  return pages.join(PDF_PAGE_SEPARATOR);
};
