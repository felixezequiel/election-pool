import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  extractViewStateFromHtml,
  extractViewStateFromPartial,
  isSessionExpired,
  ViewStateError,
} from './viewstate.js';
import { parsePartialResponse, PesqElePartialResponseError } from './partial-response.js';
import { FIELD } from './constants.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

describe('ViewState', () => {
  it('lê o ViewState da página de busca (HTML completo)', () => {
    expect(extractViewStateFromHtml(fixture('01-listar30dias-page.html'))).toBe(
      'MmZjNGRjNTEwNjcyZjIzYTAwMDAwMDAx',
    );
  });

  it('lê o ViewState NOVO do <update> da resposta parcial', () => {
    const partial = parsePartialResponse(fixture('02-busca-partial-response.xml'));

    expect([...partial.updates.keys()]).toContain('j_id__v_0:javax.faces.ViewState:1');
    expect(extractViewStateFromPartial(partial)).toBe('MmZjNGRjNTEwNjcyZjIzYTAwMDAwMDAx');
  });

  it('o ViewState da paginação é DIFERENTE do da busca — reusar o antigo derruba a sessão', () => {
    const busca = parsePartialResponse(fixture('02-busca-partial-response.xml'));
    const pagina2 = parsePartialResponse(fixture('03-paginacao-pagina2-partial-response.xml'));

    expect(extractViewStateFromPartial(pagina2)).toBe('ZDUxNzI0ZWFkNWFlNzBlNDAwMDAwMDAx');
    expect(extractViewStateFromPartial(pagina2)).not.toBe(extractViewStateFromPartial(busca));
  });

  it('LANÇA quando o HTML não tem ViewState (nunca devolve string vazia)', () => {
    expect(() => extractViewStateFromHtml('<html><body>nada</body></html>')).toThrow(
      ViewStateError,
    );
  });

  it('LANÇA quando a parcial não traz <update> de ViewState (caso do detalhar)', () => {
    const redirect = parsePartialResponse(fixture('04-detalhar-redirect-partial-response.xml'));

    expect(() => extractViewStateFromPartial(redirect)).toThrow(ViewStateError);
  });
});

describe('detecção de sessão expirada', () => {
  it('resposta normal NÃO é sessão expirada, mesmo com formAviso no HTML', () => {
    // Armadilha do Q-09: `formAviso` (modal "Sessão Expirada!") existe OCULTO em
    // toda página. Usá-lo como sinal daria falso positivo em toda requisição.
    expect(fixture('01-listar30dias-page.html')).toContain('formAviso');
    expect(isSessionExpired(parsePartialResponse(fixture('02-busca-partial-response.xml')))).toBe(
      false,
    );
  });

  it('reconhece ViewExpiredException vindo no <error-name>', () => {
    const xml =
      '<?xml version="1.0" encoding="ISO-8859-1"?><partial-response><error>' +
      '<error-name>class javax.faces.application.ViewExpiredException</error-name>' +
      '<error-message><![CDATA[View não pôde ser restaurada]]></error-message>' +
      '</error></partial-response>';

    expect(isSessionExpired(parsePartialResponse(xml))).toBe(true);
  });
});

describe('partial-response', () => {
  it('lê os <update> por id e o CDATA de cada um', () => {
    const partial = parsePartialResponse(fixture('02-busca-partial-response.xml'));

    expect(partial.redirectUrl).toBeNull();
    expect(partial.errorName).toBeNull();
    expect(partial.updates.get(FIELD.form)).toContain('formPesquisa:tabelaPesquisas');
  });

  it('lê o <redirect> da ação detalhar', () => {
    const partial = parsePartialResponse(fixture('04-detalhar-redirect-partial-response.xml'));

    expect(partial.redirectUrl).toBe('/app/pesquisa/detalhar.xhtml');
    expect(partial.updates.size).toBe(0);
  });

  it('LANÇA quando o corpo não é <partial-response> (não vira lista vazia)', () => {
    expect(() => parsePartialResponse('<html><body>login</body></html>')).toThrow(
      PesqElePartialResponseError,
    );
  });
});
