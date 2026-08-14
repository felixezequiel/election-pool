/**
 * Extração e detecção de `javax.faces.ViewState` do PesqEle (docs/04 §2). O
 * PesqEle é JSF/MyFaces: cada resposta HTML carrega um `ViewState` que precisa
 * ser reenviado no POST seguinte. O ViewState EXPIRA — a resposta de sessão
 * inválida traz um HTML de erro do JSF (`ViewExpiredException`) e/ou não traz o
 * campo esperado. Detectamos isso para reestabelecer sem entrar em loop.
 *
 * O id do campo observado no PesqEle real é `j_id__v_0:javax.faces.ViewState:1`,
 * mas o `name` é sempre `javax.faces.ViewState`. Casamos pelo `name` (estável).
 */

import { parse as parseHtml } from 'node-html-parser';

export class ViewStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ViewStateError';
  }
}

/**
 * Extrai o valor de `javax.faces.ViewState`. Lança `ViewStateError` se o campo
 * não existir (documento não é uma página JSF válida ou a sessão expirou). Falha
 * alta (R4): nunca devolve string vazia silenciosa.
 */
export const extractViewState = (html: string): string => {
  const root = parseHtml(html);
  const input = root.querySelector('input[name="javax.faces.ViewState"]');
  const value = input?.getAttribute('value');
  if (value === undefined || value === null || value.length === 0) {
    throw new ViewStateError('javax.faces.ViewState ausente na resposta do PesqEle');
  }
  return value;
};

/** `true` se há um `javax.faces.ViewState` no HTML (sem lançar). */
export const hasViewState = (html: string): boolean => {
  const root = parseHtml(html);
  const input = root.querySelector('input[name="javax.faces.ViewState"]');
  const value = input?.getAttribute('value');
  return value !== undefined && value !== null && value.length > 0;
};

/**
 * Assinaturas de sessão/ViewState expirados no MyFaces. Se a resposta bater
 * numa destas, reestabelecemos a sessão (novo GET) UMA vez — sem loop.
 */
const SESSION_EXPIRED_MARKERS = [
  'viewexpiredexception',
  'view could not be restored',
  'a view expirou',
  'sessão expirou',
  'sessao expirou',
  'session expired',
];

export const isSessionExpired = (html: string): boolean => {
  const lower = html.toLowerCase();
  if (SESSION_EXPIRED_MARKERS.some((m) => lower.includes(m))) {
    return true;
  }
  // Sem ViewState numa resposta que deveria tê-lo também indica sessão perdida.
  return !hasViewState(html);
};
