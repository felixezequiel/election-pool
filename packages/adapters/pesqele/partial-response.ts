/**
 * Leitura da resposta AJAX do PrimeFaces/JSF (`<partial-response>`).
 *
 * O PesqEle 3.9.2 responde ao botão de busca e à paginação com XML, não com
 * HTML: o pedaço de página re-renderizado vem em CDATA dentro de
 * `<update id="...">`, e o ViewState NOVO vem noutro `<update>` cujo id termina
 * em `javax.faces.ViewState`. A ação `detalhar` responde só com
 * `<redirect url="..."/>`.
 *
 * Foi ignorar isso que fez T-05 procurar `<table>` num corpo que nunca teve uma
 * (Q-09). Aqui a fronteira é validada com Zod e falha alto (R4): corpo que não é
 * `<partial-response>` LANÇA, em vez de virar "nenhum resultado".
 */

import { z } from 'zod';

export class PesqElePartialResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PesqElePartialResponseError';
  }
}

const partialResponseSchema = z.object({
  /** id do `<update>` → conteúdo do CDATA. */
  updates: z.map(z.string(), z.string()),
  /** URL do `<redirect>`, quando a ação navega (caso do `detalhar`). */
  redirectUrl: z.string().nullable(),
  /** `<error-name>` do JSF (ex.: ViewExpiredException), quando houver. */
  errorName: z.string().nullable(),
});

export type PartialResponse = z.infer<typeof partialResponseSchema>;

// O CDATA pode conter '<' e '>' à vontade; o fim é sempre ']]></update>'.
const UPDATE_RE = /<update id="([^"]+)"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/g;
const REDIRECT_RE = /<redirect url="([^"]*)"\s*\/?>/;
const ERROR_NAME_RE = /<error-name>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/error-name>/;

/**
 * Parseia o XML da resposta parcial. LANÇA se o corpo não for um
 * `<partial-response>` — silenciar isso é o que transforma sessão perdida em
 * `seen=0` (Q-09).
 */
export const parsePartialResponse = (xml: string): PartialResponse => {
  if (!xml.includes('<partial-response')) {
    throw new PesqElePartialResponseError(
      'Resposta do PesqEle não é um <partial-response> (sessão perdida ou protocolo mudou)',
    );
  }

  const updates = new Map<string, string>();
  for (const match of xml.matchAll(UPDATE_RE)) {
    const [, id, content] = match;
    if (id === undefined || content === undefined) continue;
    updates.set(id, content);
  }

  return partialResponseSchema.parse({
    updates,
    redirectUrl: REDIRECT_RE.exec(xml)?.[1] ?? null,
    errorName: ERROR_NAME_RE.exec(xml)?.[1]?.trim() ?? null,
  });
};

/**
 * Conteúdo de um `<update>` por id EXATO. Ausente ⇒ LANÇA: o chamador pediu um
 * pedaço específico da página e não recebê-lo é falha, não lista vazia (R4).
 */
export const requireUpdate = (partial: PartialResponse, id: string): string => {
  const content = partial.updates.get(id);
  if (content === undefined) {
    throw new PesqElePartialResponseError(
      `<update id="${id}"> ausente na resposta do PesqEle (ids presentes: ${[...partial.updates.keys()].join(', ')})`,
    );
  }
  return content;
};
