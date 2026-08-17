import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { makeTempStorage, makeRawFromBytes, makeReg, seedResolver } from '../base/test-support.js';
import { RobotsCache } from '../robots.js';
import { DatafolhaAdapter } from './datafolha-adapter.js';
import { DATAFOLHA_ORIGIN, DATAFOLHA_REPORT_HOST_DISALLOWED } from './constants.js';

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const { storage } = makeTempStorage();
const adapter = new DatafolhaAdapter({ resolveCandidate: seedResolver, storage });

const rawFor = (name: string): Promise<RawDocument> =>
  makeRawFromBytes(
    storage,
    fixture(name),
    'text/html',
    'https://datafolha.folha.uol.com.br/eleicoes/2026/08/rodada.shtml',
  );

describe('DatafolhaAdapter.parse — rodada com valor atrelado a NOME', () => {
  let round: RawDocument;
  beforeAll(async () => {
    round = await rawFor('round-nominal.html');
  });

  it('extrai 1º turno estimulado, espontâneo e os dois cenários de 2º turno', async () => {
    const parsed = await adapter.parse(round, makeReg({ tseId: 'BR-06591/2026' }));
    expect(parsed.tseId).toBe('BR-06591/2026');
    expect(parsed.scenarios.map((s) => s.kind)).toEqual([
      't1_estimulado',
      't1_espontaneo',
      't2',
      't2',
    ]);

    const t1 = parsed.scenarios.find((s) => s.kind === 't1_estimulado');
    expect(t1?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 40 },
      { candidateAlias: 'Tarcísio', valuePct: 32 },
      { candidateAlias: 'Ciro', valuePct: 6 },
      { candidateAlias: 'Simone Tebet', valuePct: 5 },
      { candidateAlias: 'Romeu Zema', valuePct: 4 },
    ]);
    expect(t1?.blankNullPct).toBe(8);
    expect(t1?.undecidedPct).toBe(4);
    // Rótulo é NOSSO (R3): nenhuma prosa da fonte vira campo servível.
    expect(t1?.label).toBe('1º turno estimulado');
  });

  it('separa espontâneo de estimulado e deixa brancos/nulos AUSENTE como undefined', async () => {
    const parsed = await adapter.parse(round, makeReg({ tseId: 'BR-06591/2026' }));
    const espontaneo = parsed.scenarios.find((s) => s.kind === 't1_espontaneo');
    expect(espontaneo?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 31 },
      { candidateAlias: 'Tarcísio', valuePct: 18 },
      { candidateAlias: 'Romeu Zema', valuePct: 3 },
    ]);
    // A publicação não divulga brancos/nulos no espontâneo ⇒ undefined, nunca 0.
    expect(espontaneo?.blankNullPct).toBeUndefined();
    expect(espontaneo?.undecidedPct).toBe(38);
  });

  it('monta o par de 2º turno e não injeta zero para quem não está no cenário', async () => {
    const parsed = await adapter.parse(round, makeReg({ tseId: 'BR-06591/2026' }));
    const runoffs = parsed.scenarios.filter((s) => s.kind === 't2');
    expect(runoffs[0]?.t2Pair).toEqual(['Lula', 'Tarcísio']);
    expect(runoffs[0]?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 48 },
      { candidateAlias: 'Tarcísio', valuePct: 43 },
    ]);
    expect(runoffs[0]?.blankNullPct).toBe(8);
    expect(runoffs[0]?.undecidedPct).toBe(1);
    // Segundo par: Ciro entra aqui e Tarcísio sai — nenhum dos dois vira 0 no outro.
    expect(runoffs[1]?.t2Pair).toEqual(['Lula', 'Ciro']);
    expect(runoffs[1]?.values.some((v) => v.candidateAlias === 'Tarcísio')).toBe(false);
    expect(runoffs[0]?.values.some((v) => v.candidateAlias === 'Ciro')).toBe(false);
    // Rótulos distintos por par (evita colisão de (tse_id, kind, label), Q-06).
    expect(runoffs.map((s) => s.label)).toEqual([
      '2º turno — Lula x Tarcísio',
      '2º turno — Lula x Ciro',
    ]);
  });
});

describe('DatafolhaAdapter.parse — recorte REAL da rodada presidencial BR-01166/2026', () => {
  it('confirma o registro TSE (V6) e RECUSA porque o valor do líder não tem nome', async () => {
    // Trechos byte a byte da captura de 2026-08-17 (ver __fixtures__/README.md).
    // É a prova, dentro do repo, de que a recusa vem do TEXTO REAL da fonte e não
    // de uma estrutura suposta — a lição de Q-09.
    const raw = await rawFor('round-real-recorte.html');
    const reg = makeReg({ instituteId: 'datafolha', tseId: 'BR-01166/2026' });
    await expect(adapter.parse(raw, reg)).rejects.toThrow(/Percentual sem candidato nomeado/);
    // O motivo é o valor sem nome, NÃO falta de registro: com o tse_id de outra
    // rodada, o mesmo documento é recusado antes, pelo V6.
    await expect(
      adapter.parse(raw, makeReg({ instituteId: 'datafolha', tseId: 'BR-07777/2026' })),
    ).rejects.toThrow(/não contém o tse_id do registro/);
  });
});

describe('DatafolhaAdapter.parse — recusas (R4: falha alta, nunca silenciosa)', () => {
  it('LANÇA quando o valor do líder está atrelado a uma DESCRIÇÃO e não a um nome', async () => {
    // É a forma real das rodadas presidenciais do Datafolha ("o atual presidente
    // tem 40% …, contra 32% do …"). Atribuir exigiria adivinhar quem é a descrição.
    const raw = await rawFor('round-anaforico.html');
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }))).rejects.toBeInstanceOf(
      ParseError,
    );
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }))).rejects.toThrow(
      /Percentual sem candidato nomeado/,
    );
  });

  it('LANÇA (V6) quando a publicação é de OUTRA rodada', async () => {
    const raw = await rawFor('round-outro-registro.html');
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }))).rejects.toBeInstanceOf(
      ParseError,
    );
  });

  it('LANÇA UnknownCandidateError (quarentena) para alias não cadastrado', async () => {
    const raw = await rawFor('round-candidato-desconhecido.html');
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }))).rejects.toBeInstanceOf(
      UnknownCandidateError,
    );
  });

  it('LANÇA em valor ilegível — nunca vira 0', async () => {
    const raw = await rawFor('round-valor-ilegivel.html');
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }))).rejects.toThrow(
      /Valor ilegível/,
    );
  });

  it('LANÇA quando o HTML não tem o corpo da publicação (estrutura mudou)', async () => {
    const raw = await makeRawFromBytes(
      storage,
      '<html><body><p>Lula, com 40%</p></body></html>',
      'text/html',
    );
    await expect(adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }))).rejects.toBeInstanceOf(
      ParseError,
    );
  });
});

describe('DatafolhaAdapter.parse — armadilhas da prosa da fonte', () => {
  it('não confunde a série de REJEIÇÃO nem o cruzamento por segmento com intenção de voto', async () => {
    const raw = await rawFor('round-rejeicao-e-segmento.html');
    const parsed = await adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }));
    expect(parsed.scenarios).toHaveLength(1);
    const values = parsed.scenarios[0]?.values ?? [];
    expect(values).toEqual([
      { candidateAlias: 'Lula', valuePct: 40 },
      { candidateAlias: 'Tarcísio', valuePct: 32 },
      { candidateAlias: 'Ciro', valuePct: 6 },
      { candidateAlias: 'Simone Tebet', valuePct: 5 },
      { candidateAlias: 'Romeu Zema', valuePct: 4 },
    ]);
    // Nenhum número de rejeição (46, 48, 13, 12, 11) nem de segmento (45, 30, 19).
    const extracted = new Set<number>(values.map((v) => v.valuePct));
    for (const rejected of [46, 48, 13, 12, 11, 45, 30, 19]) {
      expect(extracted.has(rejected)).toBe(false);
    }
  });

  it('ignora o valor da rodada ANTERIOR entre parênteses e mantém o atual', async () => {
    const raw = await rawFor('round-valores-anteriores.html');
    const parsed = await adapter.parse(raw, makeReg({ tseId: 'BR-06591/2026' }));
    const t1 = parsed.scenarios[0];
    expect(t1?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 40 },
      { candidateAlias: 'Tarcísio', valuePct: 32 },
      { candidateAlias: 'Ciro', valuePct: 6 },
      { candidateAlias: 'Romeu Zema', valuePct: 5 },
    ]);
    // 38, 7 e 12 são da rodada anterior; 13 é o branco/nulo ATUAL.
    expect(t1?.blankNullPct).toBe(13);
    expect(t1?.undecidedPct).toBe(4);
  });
});

describe('DatafolhaAdapter — descoberta e etiqueta de rede', () => {
  it('canHandle casa pelo instituteId do registro', () => {
    expect(adapter.canHandle(makeReg({ instituteId: 'datafolha' }))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
  });

  it('aponta o índice do ANO da rodada no site do próprio instituto', async () => {
    const candidates = await adapter.discover(
      makeReg({ instituteId: 'datafolha', fieldStart: '2026-08-05', fieldEnd: '2026-08-06' }),
    );
    expect(candidates.map((c) => c.url)).toEqual([
      'https://datafolha.folha.uol.com.br/eleicoes/2026/',
      'https://datafolha.folha.uol.com.br/eleicoes/',
    ]);
    // Nunca o PDF do relatório: aquele host proíbe todo agente no robots.txt.
    expect(candidates.every((c) => !c.url.includes(DATAFOLHA_REPORT_HOST_DISALLOWED))).toBe(true);
  });

  it('robots.txt REAL: /eleicoes é permitido no site do instituto e o host do PDF é proibido', async () => {
    // Fixtures capturadas ao vivo (ver __fixtures__/README.md). Este teste é o que
    // impede alguém de "resolver" a falta de tabela buscando o PDF proibido.
    const bodies: Record<string, string> = {
      [`${DATAFOLHA_ORIGIN}/robots.txt`]: fixture('robots-datafolha.txt'),
      [`https://${DATAFOLHA_REPORT_HOST_DISALLOWED}/robots.txt`]: fixture('robots-media-folha.txt'),
    };
    const robots = new RobotsCache((url) => {
      const body = bodies[url];
      if (body === undefined) throw new Error(`robots.txt não previsto no teste: ${url}`);
      return Promise.resolve({ status: 200, body });
    });

    await expect(robots.isAllowed(`${DATAFOLHA_ORIGIN}/eleicoes/2026/`)).resolves.toBe(true);
    await expect(
      robots.isAllowed(`${DATAFOLHA_ORIGIN}/eleicoes/2026/08/rodada.shtml`),
    ).resolves.toBe(true);
    await expect(robots.isAllowed(`${DATAFOLHA_ORIGIN}/home/algo`)).resolves.toBe(false);
    await expect(
      robots.isAllowed(`https://${DATAFOLHA_REPORT_HOST_DISALLOWED}/datafolha/2026/07/rel.pdf`),
    ).resolves.toBe(false);
  });
});
