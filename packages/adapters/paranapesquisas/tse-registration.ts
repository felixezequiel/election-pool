/**
 * Leitura do número de registro TSE no release do Paraná Pesquisas — e a razão
 * pela qual este arquivo existe.
 *
 * O `BaseAdapter` já aplica V6 (docs/04 §4.1): o documento PRECISA conter o
 * `tse_id` do registro, em qualquer lugar do texto. Isso é necessário e não é
 * suficiente PARA ESTA FONTE, e a captura real prova:
 *
 *   O release de fevereiro/2026 (`BR-07974/2026`) traz páginas COMPARATIVAS com a
 *   série histórica, e nelas está escrito, em cabeçalho de coluna,
 *   `Janeiro 2026 BR-08254/2026` — o `tse_id` de OUTRA rodada, a de janeiro.
 *
 * Consequência: rodar o parser deste PDF contra o registro de janeiro passaria em
 * V6 e atribuiria os números de fevereiro à rodada de janeiro. É exatamente "o
 * pior bug do sistema" que V6 existe para impedir, entrando pela porta que V6 não
 * cobre. Por isso o parser exige mais: o `tse_id` do registro tem de aparecer na
 * SENTENÇA DE REGISTRO — a frase que a Res.-TSE 23.600/2019 obriga o instituto a
 * estampar na divulgação, repetida no rodapé de todo slide:
 *
 *   "De acordo com a Resolução-TSE n.º 23.600/2019, essa pesquisa está registrada
 *    no Tribunal Superior Eleitoral sob o n.º BR-07974/2026 para o cargo de
 *    Presidente."
 *
 * Essa frase é a declaração de identidade do documento; um cabeçalho de coluna
 * comparativa não é. Falha ⇒ LANÇA (R4). Nunca "melhor esforço".
 */

import { ParseError } from '../poll-source-adapter.js';

/**
 * Colapsa espaço/quebra de linha. O texto vem de PDF: a sentença de registro
 * chega quebrada em quatro linhas, e sem isso nenhum regex de frase casa.
 */
export const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ');

/**
 * `BR-NNNNN/AAAA` tolerando a grafia do PDF: prefixo `BR` seguido de hífen ASCII,
 * hífen unicode, espaço, ou nada (na captura de março o `BR-` fica numa linha e o
 * `00873/2026` na seguinte). Sem `(?![0-9])` no fim de propósito: na mesma captura
 * o número da página cola no ano (`BR-00873/20262`) e um lookahead estrito
 * perderia o registro. O ano tem exatamente 4 dígitos, então a captura é a mesma.
 */
const TSE_ID_ANYWHERE = /BR[\s‐-―-]*(\d{1,6})\s*\/\s*(\d{4})/g;

/** Sentença de registro exigida pela Res.-TSE 23.600/2019, já sem quebras. */
const REGISTRATION_SENTENCE =
  /registrada\s+no\s+Tribunal\s+Superior\s+Eleitoral\s+sob\s+o\s+n\.?\s*[ºo°]?\s*BR[\s‐-―-]*(\d{1,6})\s*\/\s*(\d{4})/gi;

const canonical = (sequence: string, year: string): string => `BR-${sequence}/${year}`;

/**
 * Todos os `tse_id` que aparecem no texto, em ordem de ocorrência, na forma
 * canônica. Usado para ler o cabeçalho de coluna das páginas comparativas.
 */
export const findTseIds = (text: string): string[] => {
  const found: string[] = [];
  for (const m of collapseWhitespace(text).matchAll(TSE_ID_ANYWHERE)) {
    const [, sequence, year] = m;
    if (sequence === undefined || year === undefined) continue;
    found.push(canonical(sequence, year));
  }
  return found;
};

/**
 * Os `tse_id` declarados na SENTENÇA DE REGISTRO do documento (podem repetir: a
 * frase está no rodapé de cada página). Devolve o conjunto, sem ordem.
 */
export const findRegisteredTseIds = (text: string): Set<string> => {
  const found = new Set<string>();
  for (const m of collapseWhitespace(text).matchAll(REGISTRATION_SENTENCE)) {
    const [, sequence, year] = m;
    if (sequence === undefined || year === undefined) continue;
    found.add(canonical(sequence, year));
  }
  return found;
};

/**
 * Remove as sentenças de registro do texto. Necessário para ler o cabeçalho de
 * coluna de uma tabela comparativa: sem isso o `tse_id` do rodapé se confundiria
 * com o `tse_id` de coluna, e a identificação de "qual coluna é a rodada
 * corrente" viraria coincidência.
 */
export const stripRegistrationSentences = (text: string): string =>
  collapseWhitespace(text).replace(REGISTRATION_SENTENCE, ' ');

/**
 * Confirma que o documento DECLARA-SE registrado sob `tseId`. LANÇA se:
 * - não houver sentença de registro nenhuma (documento sem a declaração legal:
 *   não é release de pesquisa registrada, ou a estrutura mudou); ou
 * - a sentença declarar outro `tse_id` (é outra rodada; ver o cabeçalho deste
 *   arquivo para o caso real que motiva a checagem).
 */
export const confirmRegisteredTseId = (documentText: string, tseId: string): void => {
  const declared = findRegisteredTseIds(documentText);
  if (declared.size === 0) {
    throw new ParseError(
      `Documento sem a sentença de registro da Res.-TSE 23.600/2019 ("registrada no ` +
        `Tribunal Superior Eleitoral sob o n.º ..."). Sem ela não há como afirmar que os ` +
        `números são da rodada ${tseId} — recusando (R4, R6).`,
    );
  }
  if (!declared.has(tseId)) {
    throw new ParseError(
      `Documento declara-se registrado sob ${[...declared].join(', ')}, não sob ${tseId}. ` +
        `É outra rodada: recusando para não atribuir números à rodada errada (docs/04 §4.1). ` +
        `Atenção: o ${tseId} pode aparecer em cabeçalho de coluna COMPARATIVA deste mesmo ` +
        `documento — o que satisfaz V6 e mesmo assim está errado.`,
    );
  }
};
