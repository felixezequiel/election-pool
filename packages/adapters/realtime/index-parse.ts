/**
 * Leitura do ÍNDICE de divulgação (`/pesquisas/`) do REAL TIME BIG DATA.
 *
 * O QUE A FONTE FAZ (verificado no HTML real capturado em 2026-08-17): a página
 * é um WordPress/Elementor que lista as rodadas e, em cada item, dois links para
 * o MESMO PDF (um botão e o título). Não existe página por rodada, não existe
 * URL construível: o **nome do arquivo carrega o número de registro TSE**, e é
 * essa a única chave estável entre o índice e um `PollRegistration`.
 *
 * Exemplos reais (a grafia do separador varia — por isso não construímos a URL,
 * lemos o índice):
 *
 *   Mato-Grosso-BR-06833-2026-Ago26.pdf          BR-06833/2026  (presidencial)
 *   Bahia-BR-05205_2026_Ago26.pdf                BR-05205/2026  (presidencial)
 *   Para-BR-096502026_Ago26.pdf                  BR-09650/2026  (sem separador!)
 *   Mato-Grosso-MT-04560-2026-Ago26-1.pdf        MT-04560/2026  (estadual)
 *
 * Consequência de produto: as rodadas PRESIDENCIAIS têm registro `BR-…` (cargo
 * de presidente é registrado no TSE) e as estaduais têm registro `UF-…`. Um
 * arquivo cujo nome carrega OUTRO registro é outra pesquisa e é descartado antes
 * de gastar requisição — o que também impede levar uma pesquisa de governador
 * para um registro presidencial.
 *
 * R3/docs/08: daqui saem apenas URLs. Nenhum título, nenhuma prosa do site é
 * lida, guardada ou repassada; o `reason` do `SourceCandidate` é texto NOSSO.
 */

import { parse as parseHtml } from 'node-html-parser';
import { ParseError } from '../poll-source-adapter.js';

/**
 * Um número de registro no nome do arquivo: duas letras maiúsculas de
 * circunscrição, a sequência e o ano, com separador opcional (`-`, `_`, espaço,
 * ou nenhum). Deliberadamente tolerante ao separador e nada mais.
 */
const REGISTRATION_IN_FILENAME = /[A-Z]{2}[-_\s]*\d{4,6}[-_\s]*\d{4}/;

const basenameOf = (url: string): string => {
  const withoutQuery = url.split(/[?#]/)[0] ?? url;
  return withoutQuery.split('/').pop() ?? withoutQuery;
};

/** Quebra `BR-06833/2026` em prefixo, sequência e ano. Formato inválido LANÇA. */
const splitTseId = (tseId: string): { prefix: string; sequence: string; year: string } => {
  const match = /^([A-Z]{2})-(\d+)\/(\d{4})$/.exec(tseId.trim());
  const prefix = match?.[1];
  const sequence = match?.[2];
  const year = match?.[3];
  if (prefix === undefined || sequence === undefined || year === undefined) {
    throw new ParseError(`tse_id em formato inesperado: "${tseId}"`);
  }
  return { prefix, sequence, year };
};

/** `true` se o nome do arquivo carrega EXATAMENTE este registro. */
export const filenameMatchesTseId = (url: string, tseId: string): boolean => {
  const { prefix, sequence, year } = splitTseId(tseId);
  const pattern = new RegExp(`${prefix}[-_\\s]*${sequence}[-_\\s]*/?[-_\\s]*${year}`);
  return pattern.test(basenameOf(url));
};

/**
 * Todas as URLs de PDF do índice, sem repetição e na ordem de aparição (a fonte
 * lista da rodada mais recente para a mais antiga).
 */
export const parseIndexPdfUrls = (html: string): string[] => {
  const root = parseHtml(html);
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const anchor of root.querySelectorAll('a')) {
    const href = anchor.getAttribute('href');
    if (href === undefined || href === null) continue;
    const trimmed = href.trim();
    if (!/\.pdf$/i.test(basenameOf(trimmed))) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    urls.push(trimmed);
  }
  return urls;
};

export interface RealTimeSourceUrl {
  readonly url: string;
  /** `true` quando o nome do arquivo confirma o registro (caminho normal). */
  readonly registrationInFilename: boolean;
}

/**
 * Seleciona, entre as URLs do índice, as que podem ser a rodada deste registro:
 *
 * 1. nome do arquivo carrega EXATAMENTE este `tse_id` — o caminho normal;
 * 2. nome do arquivo NÃO carrega registro algum — candidata plausível, e a
 *    confirmação V6 do `BaseAdapter` decide ao ler o PDF;
 * 3. nome do arquivo carrega OUTRO registro — descartada aqui (é outra pesquisa;
 *    não gastamos requisição nem arriscamos o pior bug).
 *
 * Índice sem NENHUM PDF ⇒ LANÇA (a estrutura da página mudou; devolver lista
 * vazia faria o registro derivar para `presumed_undisclosed` sem ninguém saber —
 * R4). Índice com PDFs mas nenhum plausível ⇒ lista vazia, que é a resposta
 * honesta: esta rodada ainda não está publicada.
 */
export const selectSourceUrls = (
  urls: readonly string[],
  tseId: string,
): readonly RealTimeSourceUrl[] => {
  if (urls.length === 0) {
    throw new ParseError(
      'Índice /pesquisas/ do REAL TIME BIG DATA sem nenhum link de PDF ' +
        '(estrutura da página mudou?)',
    );
  }
  const exact: RealTimeSourceUrl[] = [];
  const withoutRegistration: RealTimeSourceUrl[] = [];
  for (const url of urls) {
    if (filenameMatchesTseId(url, tseId)) {
      exact.push({ url, registrationInFilename: true });
      continue;
    }
    if (!REGISTRATION_IN_FILENAME.test(basenameOf(url))) {
      withoutRegistration.push({ url, registrationInFilename: false });
    }
  }
  return [...exact, ...withoutRegistration];
};
