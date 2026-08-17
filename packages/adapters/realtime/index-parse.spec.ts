/**
 * Leitura do índice `/pesquisas/` sobre o HTML REAL capturado em 2026-08-17
 * (`__fixtures__/01-pesquisas-index.html`, excerto verbatim do container da lista).
 *
 * O ponto que estes testes protegem: no índice real convivem rodadas
 * PRESIDENCIAIS (registro `BR-…`) e ESTADUAIS (registro `UF-…`) do mesmo estado,
 * publicadas no mesmo dia. Selecionar pelo estado, pela data ou pela posição
 * levaria uma pesquisa de governador para um registro presidencial. A única
 * chave que não erra é o número de registro no nome do arquivo.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { ParseError } from '../poll-source-adapter.js';
import { filenameMatchesTseId, parseIndexPdfUrls, selectSourceUrls } from './index-parse.js';

const INDEX_HTML = readFileSync(
  join(import.meta.dirname, '__fixtures__', '01-pesquisas-index.html'),
  'utf8',
);

describe('parseIndexPdfUrls sobre o índice real', () => {
  const urls = parseIndexPdfUrls(INDEX_HTML);

  it('acha as 12 rodadas publicadas, sem repetir o link duplicado de cada item', () => {
    // Cada item da lista tem DOIS <a> para o mesmo PDF (o botão e o título).
    expect(urls).toHaveLength(12);
    expect(new Set(urls).size).toBe(12);
  });

  it('devolve apenas URLs absolutas de PDF', () => {
    for (const url of urls) {
      expect(url.startsWith('https://realtimebigdata.com.br/wp-content/uploads/')).toBe(true);
      expect(url.endsWith('.pdf')).toBe(true);
    }
  });
});

describe('filenameMatchesTseId tolera a grafia do separador, que varia por rodada', () => {
  it('casa com hífen: Mato-Grosso-BR-06833-2026-Ago26.pdf', () => {
    expect(
      filenameMatchesTseId(
        'https://x/2026/08/Mato-Grosso-BR-06833-2026-Ago26.pdf',
        'BR-06833/2026',
      ),
    ).toBe(true);
  });

  it('casa com underscore: Bahia-BR-05205_2026_Ago26.pdf', () => {
    expect(
      filenameMatchesTseId('https://x/2026/08/Bahia-BR-05205_2026_Ago26.pdf', 'BR-05205/2026'),
    ).toBe(true);
  });

  it('casa SEM separador entre sequência e ano: Para-BR-096502026_Ago26.pdf', () => {
    expect(
      filenameMatchesTseId('https://x/2026/08/Para-BR-096502026_Ago26.pdf', 'BR-09650/2026'),
    ).toBe(true);
  });

  it('não casa com outro registro do mesmo estado e do mesmo dia', () => {
    expect(
      filenameMatchesTseId(
        'https://x/2026/08/Mato-Grosso-MT-04560-2026-Ago26-1.pdf',
        'BR-06833/2026',
      ),
    ).toBe(false);
  });
});

describe('selectSourceUrls', () => {
  const urls = parseIndexPdfUrls(INDEX_HTML);

  it('devolve exatamente o PDF presidencial da rodada pedida', () => {
    const selected = selectSourceUrls(urls, 'BR-06833/2026');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.url).toContain('Mato-Grosso-BR-06833-2026-Ago26.pdf');
    expect(selected[0]?.registrationInFilename).toBe(true);
  });

  it('não confunde a presidencial com a estadual do mesmo estado e data', () => {
    // O índice real traz Mato Grosso duas vezes: BR-06833 (presidencial) e
    // MT-04560 (estadual), ambas com divulgação 12/08/2026.
    const presidencial = selectSourceUrls(urls, 'BR-06833/2026');
    const estadual = selectSourceUrls(urls, 'MT-04560/2026');
    expect(presidencial[0]?.url).not.toBe(estadual[0]?.url);
    expect(estadual[0]?.url).toContain('MT-04560');
  });

  it('devolve lista vazia quando a rodada ainda não foi publicada', () => {
    // Todos os 12 arquivos do índice carregam registro, e nenhum é este: a
    // resposta honesta é "nada a buscar", não um palpite.
    expect(selectSourceUrls(urls, 'BR-99999/2026')).toHaveLength(0);
  });

  it('aceita como candidato o arquivo SEM registro no nome, deixando a V6 decidir', () => {
    const selected = selectSourceUrls(
      ['https://x/2026/08/pesquisa-presidencial-agosto.pdf'],
      'BR-06833/2026',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.registrationInFilename).toBe(false);
  });

  it('lança quando o índice não tem nenhum PDF (estrutura da página mudou)', () => {
    expect(() => selectSourceUrls([], 'BR-06833/2026')).toThrow(ParseError);
  });

  it('lança quando o tse_id do registro está fora do formato canônico', () => {
    expect(() => selectSourceUrls(urls, '6833/2026')).toThrow(ParseError);
  });
});
