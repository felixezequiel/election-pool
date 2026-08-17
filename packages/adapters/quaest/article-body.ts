/**
 * HTML de um post da Quaest → BLOCOS de texto do corpo do artigo.
 *
 * O `BaseAdapter` chama `documentToText` e depois passa o TEXTO para o V6 e para
 * a extração. Por isso a redução de HTML acontece aqui e devolve um bloco por
 * LINHA: o parser precisa saber onde um parágrafo termina, porque o escopo de um
 * cenário é o parágrafo (ver `parse.ts`). Perder a fronteira de bloco seria
 * perder a única barreira contra misturar o número nacional com o de recorte.
 *
 * Só extraímos texto para tirar NÚMEROS (R3, docs/08 §2): o HTML bruto vai para
 * `raw_documents` como prova de proveniência e nunca é servido.
 *
 * Estrutura casada aqui é a REAL, verificada nas duas capturas de
 * `__fixtures__/` (Elementor + blocos do editor do WordPress). Ausência do
 * contêiner é mudança de estrutura e LANÇA (R4) — nunca devolve string vazia,
 * que faria o V6 recusar por um motivo errado.
 */

import { parse as parseHtml } from 'node-html-parser';
import { ParseError } from '../poll-source-adapter.js';
import { QUAEST_ARTICLE_BLOCK_SELECTOR, QUAEST_ARTICLE_BODY_SELECTOR } from './constants.js';

/** Blocos (parágrafos, títulos, itens de lista) do corpo do artigo, na ordem. */
export const quaestArticleBlocks = (html: string): string[] => {
  const root = parseHtml(html);
  const containers = root.querySelectorAll(QUAEST_ARTICLE_BODY_SELECTOR);
  if (containers.length === 0) {
    throw new ParseError(
      `Post da Quaest sem o corpo do artigo (${QUAEST_ARTICLE_BODY_SELECTOR}) — ` +
        `estrutura do site mudou. Recusando em vez de ler a página inteira.`,
    );
  }
  const blocks: string[] = [];
  for (const container of containers) {
    for (const element of container.querySelectorAll(QUAEST_ARTICLE_BLOCK_SELECTOR)) {
      const text = element.text.replace(/\s+/g, ' ').trim();
      if (text.length > 0) blocks.push(text);
    }
  }
  if (blocks.length === 0) {
    throw new ParseError('Corpo do artigo da Quaest sem nenhum bloco de texto');
  }
  return blocks;
};

/**
 * Texto do corpo do artigo, um bloco por linha. É o que o `BaseAdapter` usa para
 * confirmar o `tse_id` (V6) — o número de registro vem no parágrafo de
 * "Metodologia" — e o que `parseQuaestRoundText` reparte de volta em blocos.
 */
export const quaestArticleText = (html: string): string => quaestArticleBlocks(html).join('\n');
