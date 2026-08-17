/**
 * Constantes do adapter `realtime` (REAL TIME BIG DATA). Ficam aqui, e não em
 * `packages/contracts/constants.ts`, porque descrevem a FONTE (URL, geometria do
 * PDF dela, rótulos que ela imprime) e não o modelo estatístico — o contrato é
 * congelado e nenhum destes números tem significado fora deste diretório.
 *
 * Toda constante abaixo tem a origem MEDIDA em documentos reais capturados em
 * 2026-08-17 (ver `__fixtures__/README.md`), não estimada.
 */

export const REALTIME_ADAPTER_ID = 'realtime';
export const REALTIME_INSTITUTE_ID = 'realtime';

/**
 * Índice de divulgação do próprio instituto (nível 2 da hierarquia de docs/04
 * §1: site do instituto, resultado em primeira mão). É a página que lista as
 * rodadas e linka o PDF de cada uma.
 *
 * Origem: `https://realtimebigdata.com.br/robots.txt` permite tudo
 * (`User-agent: * / Disallow:`) e `sitemap_index.xml` → `page-sitemap.xml`
 * lista `/pesquisas/`. Usamos o host CANÔNICO sem `www`: `www.` responde 301
 * para cá, e pedir o canônico evita um redirect por ciclo (o `siteUrl` do seed
 * usa `www`, o que é só a grafia de marketing).
 */
export const REALTIME_INDEX_URL = 'https://realtimebigdata.com.br/pesquisas/';

/**
 * Separador de página no texto que `pdf-layout.ts` produz. Form feed (U+000C) é
 * a convenção histórica de fim-de-página em texto extraído de PDF, então não
 * colide com nada que apareça no conteúdo. É necessário porque a estrutura do
 * documento é POR PÁGINA (um título de seção sozinho numa página, o gráfico na
 * seguinte) e o `BaseAdapter` só passa adiante uma string.
 */
export const PDF_PAGE_SEPARATOR = '\f';

/**
 * Tolerância vertical, em pontos PostScript, para considerar dois itens de texto
 * como pertencendo à MESMA linha do gráfico.
 *
 * Origem (medida nos 6 PDFs reais): num gráfico de barras horizontais, o rótulo
 * da categoria e o rótulo de valor da mesma barra têm baselines que diferem em
 * ≤ 1,0 pt (ex.: "NS / NR" em y=159,2 e "3%" em y=158,2). O menor passo vertical
 * entre barras DISTINTAS observado é ~17,9 pt. 3,0 pt fica 3x acima do jitter e
 * 6x abaixo do passo — a folga é grande em ambas as direções.
 */
export const Y_BAND_TOLERANCE_PT = 3;

/**
 * Folga horizontal, em pontos PostScript, para juntar dois itens de texto
 * vizinhos como PALAVRAS da mesma frase.
 *
 * O `unpdf`/pdf.js devolve um item por trecho desenhado, e neste deck cada
 * PALAVRA de um título ou enunciado é um item separado. Sem juntar, `CENÁRIO` e
 * `01` sairiam em linhas diferentes e o rótulo do cenário de 2º turno se perderia.
 *
 * Origem (medida nos 6 PDFs reais, com `item.width`): o vão de um ESPAÇO entre
 * palavras do mesmo texto é 5,2 pt, constante — inclusive nos títulos grandes. O
 * vão entre elementos de design DISTINTOS na mesma faixa é de outra ordem: 406,8
 * pt entre os dois nomes do confronto de 2º turno. 20 pt fica ~4x acima do espaço
 * e ~20x abaixo da separação entre elementos.
 *
 * Atenção: este limite NÃO é usado para ligar rótulo a valor. O vão entre o
 * rótulo de uma barra e o número no fim dela varia com o TAMANHO DA BARRA (24,5
 * pt a 691,7 pt no mesmo gráfico) — usar distância ali seria justamente o erro.
 */
export const WORD_GAP_TOLERANCE_PT = 20;

/** Assinatura de arquivo PDF. Corpo que não começa com isto não é PDF (R4). */
export const PDF_SIGNATURE = '%PDF';
