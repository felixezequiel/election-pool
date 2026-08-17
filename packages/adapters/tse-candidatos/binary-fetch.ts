/**
 * Adaptação binária do `HttpClient` compartilhado.
 *
 * O PROBLEMA: `HttpClient` (docs/04 §6) é quem sabe respeitar robots.txt, o rate
 * limit de 1 req/10s por host, o conditional GET, o timeout e os retries. Não
 * queremos — nem podemos — reimplementar nada disso só porque agora baixamos uma
 * imagem. Mas o contrato dele devolve `body: string`, via `Response.text()`, e
 * `text()` decodifica como UTF-8: passar bytes de JPEG por ali destrói a imagem
 * (todo byte inválido vira U+FFFD).
 *
 * A SOLUÇÃO: um `FetchLike` que lê `arrayBuffer()` e devolve o conteúdo em
 * BASE64 no lugar de `text()`. Base64 é transporte, não interpretação — sobrevive
 * intacto ao caminho de string do `HttpClient` e é decodificado de volta a bytes
 * pelo chamador. JSON também trafega em base64 e é decodificado como UTF-8: um
 * único caminho, sem ramo condicional escondido no meio do parser.
 *
 * A EXCEÇÃO: `robots.txt`. Quem consome esse corpo é o próprio `HttpClient`, que
 * espera texto puro para parsear as regras. Se o entregássemos em base64, o
 * parser não acharia nenhuma diretiva e concluiria "pode tudo" — ou seja,
 * passaríamos por cima do robots.txt sem ninguém perceber. Silêncio desse tipo é
 * exatamente o que R4 proíbe, então o path `/robots.txt` sai como texto.
 */

import type { FetchLike } from '../http-client.js';

/** Sufixo de path cujo corpo o próprio `HttpClient` parseia como texto. */
const ROBOTS_PATH = '/robots.txt';

const isRobotsUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname === ROBOTS_PATH;
  } catch {
    return false;
  }
};

/** Assinatura mínima do `fetch` global que este wrapper consome. */
export type RawFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect: 'follow';
    signal: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: Headers;
  url: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}>;

/**
 * Envolve um `fetch` para que o corpo chegue ao `HttpClient` em base64.
 * Injetável: em produção recebe o `fetch` global; no teste, um duplo.
 */
export const createBase64Fetch = (rawFetch: RawFetch): FetchLike => {
  return async (url, init) => {
    const res = await rawFetch(url, init);
    return {
      status: res.status,
      headers: res.headers,
      url: res.url,
      text: async (): Promise<string> => {
        if (isRobotsUrl(url)) return res.text();
        const buffer = await res.arrayBuffer();
        return Buffer.from(buffer).toString('base64');
      },
    };
  };
};

/** Decodifica um corpo base64 do `HttpClient` de volta para bytes. */
export const decodeBase64Body = (body: string): Uint8Array =>
  new Uint8Array(Buffer.from(body, 'base64'));

/** Decodifica um corpo base64 do `HttpClient` como texto UTF-8. */
export const decodeBase64Text = (body: string): string =>
  Buffer.from(body, 'base64').toString('utf8');
