/**
 * `javax.faces.ViewState` do PesqEle (JSF/MyFaces + PrimeFaces 8).
 *
 * O ViewState muda a CADA resposta, INCLUSIVE nas parciais AJAX. Reenviar o
 * antigo derruba a sessão e o sintoma é uma página vazia — indistinguível de
 * "não há resultado" (armadilha registrada em T-15). Por isso há duas leituras:
 * do HTML completo (`<input name="javax.faces.ViewState">`) e da resposta parcial
 * (`<update id="...:javax.faces.ViewState:1">`), e ambas falham alto (R4).
 *
 * ARMADILHA (Q-09): `formAviso` existe OCULTO em TODA página do PesqEle e é o
 * modal "Sessão Expirada!" — não um aviso legal a aceitar, e muito menos prova de
 * que a sessão expirou. Detectar expiração pela presença dele dá falso positivo em
 * toda requisição. Expiração de verdade chega como `<error-name>` de
 * `ViewExpiredException` na resposta parcial.
 */

import { parse as parseHtml } from 'node-html-parser';
import type { PartialResponse } from './partial-response.js';
import { FIELD } from './constants.js';

export class ViewStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewStateError';
  }
}

/** ViewState de uma página HTML completa. Ausente ⇒ LANÇA. */
export const extractViewStateFromHtml = (html: string): string => {
  const input = parseHtml(html).querySelector(`input[name="${FIELD.viewState}"]`);
  const value = input?.getAttribute('value');
  if (value === undefined || value.length === 0) {
    throw new ViewStateError(`${FIELD.viewState} ausente no HTML do PesqEle`);
  }
  return value;
};

/**
 * ViewState de uma resposta parcial. O id do `<update>` é gerado pelo MyFaces
 * (`j_id__v_0:javax.faces.ViewState:1`) e não é estável entre builds — casamos
 * pelo SUFIXO `javax.faces.ViewState`, que é o nome canônico do campo.
 */
export const extractViewStateFromPartial = (partial: PartialResponse): string => {
  for (const [id, content] of partial.updates) {
    if (!id.includes(FIELD.viewState)) continue;
    const value = content.trim();
    if (value.length === 0) {
      throw new ViewStateError('<update> do ViewState veio vazio na resposta do PesqEle');
    }
    return value;
  }
  throw new ViewStateError(
    `Nenhum <update> de ${FIELD.viewState} na resposta parcial (ids: ${[...partial.updates.keys()].join(', ')})`,
  );
};

/** Assinatura de ViewState/sessão expirados que o JSF devolve numa parcial. */
export const isSessionExpired = (partial: PartialResponse): boolean =>
  partial.errorName !== null && partial.errorName.includes('ViewExpiredException');
