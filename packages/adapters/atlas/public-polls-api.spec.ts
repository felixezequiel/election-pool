/**
 * Testes da fronteira da API pública da AtlasIntel. Toda entrada é a CAPTURA REAL
 * de 2026-08-17 (`__fixtures__/`, com só a prosa redigida). Não existe aqui
 * nenhuma estrutura inventada por nós: é isso que separa este spec do erro do
 * Q-09, onde a fixture falava a mesma língua inventada que o parser.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ParseError } from '../poll-source-adapter.js';
import {
  buildReportUrl,
  parsePublicPollsFeed,
  pollPageUrl,
  publicPollsUrl,
  selectNationalReleases,
} from './public-polls-api.js';
import type { PublicPollsEntry } from './public-polls-api.js';
import { REPORT_CDN_CUTOFF_DATE } from './constants.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const EXCLUSIVE = fixture('01-public-polls-exclusive-polls.json');
const GENERAL = fixture('02-public-polls-general-release-polls.json');
const URL_EXCLUSIVE = publicPollsUrl('exclusive-polls');

/** Rodada nacional mais recente da captura: id 589, campo 22–27/07/2026. */
const RODADA_JULHO_FIELD_END = '2026-07-27';
const RODADA_JUNHO_FIELD_END = '2026-06-30';

describe('feed público da AtlasIntel (captura real)', () => {
  it('parseia a resposta real e acha a rodada nacional presidencial', () => {
    const feed = parsePublicPollsFeed(EXCLUSIVE, URL_EXCLUSIVE);
    expect(feed.data).toHaveLength(20);

    const nacionais = feed.data.filter((e) => e.title === 'Brazil: National');
    expect(nacionais.map((e) => e.date)).toEqual(['2026-07-29', '2026-07-01', '2026-04-28']);
    expect(nacionais[0]?.id).toBe(589);
    expect(nacionais[0]?.slug).toBe('brazil-national-2026-07-29');
    expect(nacionais[0]?.file).toBe('498dd172-4381-4192-977c-c4af9787434f.pdf');
  });

  it('NÃO carrega a prosa do instituto para dentro dos nossos objetos (R3)', () => {
    const feed = parsePublicPollsFeed(EXCLUSIVE, URL_EXCLUSIVE);
    // O feed real tem `description`; o schema não a declara, então o Zod a
    // descarta. Nenhum campo nosso guarda parágrafo de terceiro.
    for (const entry of feed.data) {
      expect(Object.keys(entry)).not.toContain('description');
      expect(Object.keys(entry)).not.toContain('thumbnail');
    }
  });

  it('ACHADO CENTRAL: o feed real não traz nenhum número de registro TSE', () => {
    // Se trouxesse, o V6 teria como confirmar identidade a partir de uma
    // superfície buscável e o adapter funcionaria. Não traz — nem aqui, nem na
    // categoria geral. É o motivo pelo qual `parse` recusa.
    expect(/BR-?\d{4,6}\s*\/\s*\d{4}/.test(EXCLUSIVE)).toBe(false);
    expect(/BR-?\d{4,6}\s*\/\s*\d{4}/.test(GENERAL)).toBe(false);
  });

  it('a categoria do menu principal NÃO tem a rodada nacional de 2026', () => {
    // Prova por que `discover` consulta `exclusive-polls`: quem olhasse a
    // categoria "General Release Polls" concluiria que a Atlas não publica
    // rodada nacional presidencial.
    const feed = parsePublicPollsFeed(GENERAL, publicPollsUrl('general-release-polls'));
    expect(feed.data.length).toBeGreaterThan(0);
    expect(feed.data.some((e) => e.title === 'Brazil: National')).toBe(false);
    expect(selectNationalReleases(feed.data, RODADA_JULHO_FIELD_END)).toEqual([]);
  });
});

describe('selectNationalReleases (janela de publicação)', () => {
  const entries = parsePublicPollsFeed(EXCLUSIVE, URL_EXCLUSIVE).data;

  it('casa exatamente a rodada cujo campo fechou antes da publicação', () => {
    const found = selectNationalReleases(entries, RODADA_JULHO_FIELD_END);
    expect(found.map((e) => e.id)).toEqual([589]);
  });

  it('não alcança a rodada seguinte (cadência mensal > janela de 14 dias)', () => {
    const found = selectNationalReleases(entries, RODADA_JUNHO_FIELD_END);
    expect(found.map((e) => e.id)).toEqual([576]);
  });

  it('ignora as rodadas ESTADUAIS, que não servem à corrida nacional', () => {
    // A captura tem Ceará (2026-08-12), Acre (08-03), Rio Grande do Norte
    // (07-22) — todas `br`, todas na janela de alguma rodada, nenhuma nacional.
    const found = selectNationalReleases(entries, '2026-08-01');
    expect(found).toEqual([]);
  });

  it('devolve vazio quando a Atlas ainda não publicou nada para a rodada', () => {
    expect(selectNationalReleases(entries, '2026-08-15')).toEqual([]);
  });
});

describe('buildReportUrl (regra real de corte de CDN)', () => {
  const entries = parsePublicPollsFeed(EXCLUSIVE, URL_EXCLUSIVE).data;
  const rodadaJulho = entries.find((e) => e.id === 589);

  it('arquivo anterior ao corte vai para cdn.atlasintel.org', () => {
    expect(rodadaJulho?.file_created_on).toBe('2026-07-29T17:49:13.000Z');
    expect(rodadaJulho === undefined ? '' : buildReportUrl(rodadaJulho)).toBe(
      'https://cdn.atlasintel.org/498dd172-4381-4192-977c-c4af9787434f.pdf',
    );
  });

  it('arquivo NO dia do corte já vai para cdn1.atlasintel.org (borda)', () => {
    // Borda exata: `>=` o corte. Importa porque os dois hosts têm política de
    // robots oposta — é a diferença entre um relatório buscável e um proibido.
    const noCorte: PublicPollsEntry = {
      id: 1,
      status: 'published',
      title: 'Brazil: National',
      slug: 'probe-corte',
      date: REPORT_CDN_CUTOFF_DATE,
      file: 'x.pdf',
      file_created_on: `${REPORT_CDN_CUTOFF_DATE}T00:00:00.000Z`,
      country_code: 'br',
    };
    expect(buildReportUrl(noCorte)).toBe('https://cdn1.atlasintel.org/x.pdf');
    expect(buildReportUrl({ ...noCorte, file_created_on: '2026-08-12T23:59:59.000Z' })).toBe(
      'https://cdn.atlasintel.org/x.pdf',
    );
  });

  it('LANÇA quando file_created_on é ilegível — nunca chuta o host (R4)', () => {
    const ilegivel: PublicPollsEntry = {
      id: 2,
      status: 'published',
      title: 'Brazil: National',
      slug: 'probe-ilegivel',
      date: '2026-07-29',
      file: 'x.pdf',
      file_created_on: 'ontem',
      country_code: 'br',
    };
    expect(() => buildReportUrl(ilegivel)).toThrow(ParseError);
  });
});

describe('parsePublicPollsFeed — falha alta, nunca parcial (R4)', () => {
  it('LANÇA quando o corpo não é JSON', () => {
    expect(() => parsePublicPollsFeed('<html>manutenção</html>', URL_EXCLUSIVE)).toThrow(
      ParseError,
    );
  });

  it('LANÇA quando uma entrada perde o `file` — não devolve o feed sem ela', () => {
    // Feito a partir da captura REAL: removemos o `file` da rodada nacional. Um
    // parser tolerante devolveria 19 entradas e o Q-09 se repetiria em silêncio.
    const mutilado = EXCLUSIVE.replace('"file":"498dd172-4381-4192-977c-c4af9787434f.pdf",', '');
    expect(mutilado).not.toBe(EXCLUSIVE);
    expect(() => parsePublicPollsFeed(mutilado, URL_EXCLUSIVE)).toThrow(ParseError);
  });

  it('LANÇA quando `date` sai do formato AAAA-MM-DD', () => {
    const mutilado = EXCLUSIVE.replace('"date":"2026-07-29"', '"date":"29/07/2026"');
    expect(mutilado).not.toBe(EXCLUSIVE);
    expect(() => parsePublicPollsFeed(mutilado, URL_EXCLUSIVE)).toThrow(ParseError);
  });

  it('LANÇA quando a resposta não tem a chave `data`', () => {
    expect(() => parsePublicPollsFeed('{"items":[]}', URL_EXCLUSIVE)).toThrow(ParseError);
  });
});

describe('URLs', () => {
  it('reproduz a requisição que o próprio site faz', () => {
    expect(URL_EXCLUSIVE).toBe(
      'https://atlasintel.org/api/public-polls/exclusive-polls?limit=20&page=1',
    );
  });

  it('monta a página de detalhe do release', () => {
    expect(pollPageUrl('brazil-national-2026-07-29')).toBe(
      'https://atlasintel.org/poll/brazil-national-2026-07-29',
    );
  });
});
