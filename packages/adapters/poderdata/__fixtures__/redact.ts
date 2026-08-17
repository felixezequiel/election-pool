/**
 * Redação das fixtures do PoderData (R3 / docs/08 §2.1).
 *
 * O PROBLEMA. A lição da Q-09 é que fixture sintética não prova integração: a
 * fixture tem de ser CAPTURA REAL. Mas o relatório do PoderData é obra protegida
 * ("Todos os direitos reservados. Proibida a reprodução sem citar a fonte") e este
 * repositório é público (docs/08 §4.3), então commitar o PDF — ou o texto integral
 * extraído dele — seria republicar texto de terceiro, que o R3 proíbe.
 *
 * A SOLUÇÃO. A fixture é o texto real com a PROSA REMOVIDA: sobram os FATOS
 * (rótulos, números, o registro TSE) e as âncoras de estrutura (o rodapé que
 * delimita a página e o título de cada seção). Toda linha mantida é BYTE A BYTE a
 * linha da extração real, na ordem real — é isso que faz a fixture continuar sendo
 * evidência de estrutura. O que sai é o que o parser tem de ignorar de qualquer
 * forma: a ficha metodológica, o enunciado das perguntas, o aviso de copyright e a
 * frase de rodapé.
 *
 * O filtro é ALLOWLIST e deliberadamente burro — ele não sabe nada sobre o parser.
 * Guarda uma linha se, e só se:
 *
 *  1. é o rodapé de página (`www.poder360.com.br/poderdata`);
 *  2. é a linha IMEDIATAMENTE seguinte a esse rodapé — o título da seção. Mantida
 *     sempre, qualquer que seja a seção, porque é ela que delimita a página; se
 *     caísse, a estrutura da fixture deixaria de ser a estrutura real;
 *  3. é `Registro TSE` ou um número de registro (a capa — o que o V6 confere);
 *  4. é uma linha de legenda de onda (`mai/26`, `29-Jul`, `29/jul`);
 *  5. é uma linha só de números na escala de percentual (0–100);
 *  6. é uma linha `rótulo curto + números na escala de percentual`;
 *  7. é uma linha de TEXTO CURTO dentro de uma página de intenção de voto — e só
 *     lá. É o que preserva os rótulos de categoria do gráfico de barras, onde o
 *     rótulo vem numa linha separada do valor (`Flávio Bolsonaro`, `Branco/Nulo`,
 *     `Não sabe`). Sem esta regra o dialeto de barras deixaria de existir na
 *     fixture, e o parser passaria a ser testado contra uma estrutura que a fonte
 *     não tem — de novo o erro da Q-09.
 *
 * As regras 5 e 6 exigem a escala 0–100, o que descarta anos e contagens (`2026`,
 * `2.400`) e portanto as linhas da ficha técnica que trazem número. A regra 7 tem
 * limite de tamanho e proíbe pontuação final, o que descarta os ENUNCIADOS das
 * perguntas (os mais curtos das 4 rodadas têm 61 caracteres e terminam em "?").
 *
 * Consequência a declarar: nas páginas que NÃO são intenção de voto, os rótulos de
 * categoria caem junto com a prosa. Essas páginas continuam na fixture com seus
 * números e seu título — o bastante para provar que o parser as IGNORA — mas não
 * são byte-a-byte a página real. As páginas de intenção de voto, que são as que o
 * parser lê, são.
 *
 * `redactPoderDataText` é o ÚNICO caminho de geração das fixtures, e a spec ao
 * vivo (`poderdata.live.spec.ts`) refaz a captura e confere que ela ainda produz
 * exatamente o arquivo commitado.
 */

import {
  MAX_CHART_LABEL_CHARS,
  PAGE_FOOTER_ANCHOR,
  SECTION_TITLE_T1,
  SECTION_TITLE_T2,
} from '../constants.js';

/** Um token na escala de percentual do projeto (0–100), decimal pt-BR, `%` opcional. */
const PERCENT_TOKEN = /^-?\d{1,3}(?:,\d+)?%?$/;
const PERCENT_SCALE_MAX = 100;

/** Rótulo/legenda de onda, nas três grafias reais. */
const WAVE_TOKEN = /^(?:\d{1,2}[-/][A-Za-zçÇ]{3}|[A-Za-zçÇ]{3}\/\d{2})$/;

/**
 * `Registro TSE` e o número na capa. Aceita a grafia com espaço depois do "BR"
 * (`BR -04882/2026`), que é como o PDF de maio de 2026 sai da extração.
 */
const TSE_LINE = /^(?:Registro TSE:?|BR\s*[-‐-―]?\s*\d{4,6}\s*\/\s*\d{4})$/;

const tokensOf = (line: string): string[] => line.split(/\s+/).filter((t) => t.length > 0);

const isPercentToken = (token: string): boolean => {
  if (!PERCENT_TOKEN.test(token)) return false;
  const value = Number(token.replace(/%$/, '').replace(',', '.'));
  return Number.isFinite(value) && Math.abs(value) <= PERCENT_SCALE_MAX;
};

const isWaveLine = (tokens: readonly string[]): boolean =>
  tokens.length > 0 && tokens.every((t) => WAVE_TOKEN.test(t));

const isDataLine = (tokens: readonly string[]): boolean => {
  let cut = tokens.length;
  while (cut > 0) {
    const token = tokens[cut - 1];
    if (token === undefined || !isPercentToken(token)) break;
    cut -= 1;
  }
  if (cut === tokens.length) return false; // não termina em número
  if (cut === 0) return true; // linha só de números
  return tokens.slice(0, cut).join(' ').length <= MAX_CHART_LABEL_CHARS;
};

/** Rótulo de categoria de gráfico: texto curto, sem pontuação de frase no fim. */
const isShortLabelLine = (line: string): boolean =>
  line.length <= MAX_CHART_LABEL_CHARS && !/[.?!:]$/.test(line);

const VOTE_INTENTION_TITLES: ReadonlySet<string> = new Set([SECTION_TITLE_T1, SECTION_TITLE_T2]);

/**
 * Aplica a redação ao texto integral extraído do PDF. Devolve o texto da fixture:
 * as mesmas linhas reais, na mesma ordem, sem a prosa.
 */
export const redactPoderDataText = (fullText: string): string => {
  const lines = fullText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const kept: string[] = [];
  let previousWasFooter = false;
  let currentTitle = '';
  for (const line of lines) {
    const isFooter = line === PAGE_FOOTER_ANCHOR;
    if (previousWasFooter) currentTitle = line;
    const keep =
      isFooter ||
      previousWasFooter ||
      TSE_LINE.test(line) ||
      isWaveLine(tokensOf(line)) ||
      isDataLine(tokensOf(line)) ||
      (VOTE_INTENTION_TITLES.has(currentTitle) && isShortLabelLine(line));
    if (keep) kept.push(line);
    previousWasFooter = isFooter;
  }
  return `${kept.join('\n')}\n`;
};
