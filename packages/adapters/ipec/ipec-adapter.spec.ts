/**
 * Specs do adapter Ipec, contra a CAMADA DE TEXTO REAL de dois releases do
 * próprio instituto (`__fixtures__/README.md` documenta origem, checksums e como
 * recapturar). Nenhum teste aqui prova que "o parser lê a nossa fixture": as
 * fixtures são o documento do Ipec, e os casos de falha são MUTAÇÕES MÍNIMAS e
 * visíveis dessas fixtures. É a inversão de ordem que a Q-09 pediu.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawDocument } from '@election-pool/contracts/domain';
import { ParseError, UnknownCandidateError } from '../poll-source-adapter.js';
import { makeTempStorage, makeRawFromBytes, makeReg, seedResolver } from '../base/test-support.js';
import { resolverFromMap } from '../base/candidate-resolver.js';
import { documentContainsTseId } from '../base/tse-id.js';
import { seedCandidateAliases } from '../base/test-support.js';
import { validateParsedPoll } from '../validation/validate-parsed-poll.js';
import { IpecAdapter } from './ipec-adapter.js';
import { parseIpecReleaseText } from './parse.js';
import { makeIpecReleasePdf } from './__fixtures__/make-pdf.js';

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, '__fixtures__', name), 'utf8');

/** Release nacional, 1º turno, duas colunas de rodada. `BR-01979/2022`. */
const RELEASE_BR = fixture('release-br-01979-2022.txt');
/** Release estadual do Amazonas, 2º turno, governador + presidente. `BR-08161/2022`. */
const RELEASE_AM = fixture('release-br-08161-2022-am.txt');

const TSE_BR = 'BR-01979/2022';
const TSE_AM = 'BR-08161/2022';

/**
 * Resolver dos testes. O seed real (T-02) é de 2026 e não tem os nomes de 2022
 * que aparecem nas capturas, então o mapa do seed é ESTENDIDO com os aliases
 * daquele ciclo. Estender aqui (e não em `base/test-support.ts`, que é de outro
 * dono) mantém o seed compartilhado intacto.
 *
 * `Jair Bolsonaro` é deixado DE FORA de propósito num segundo resolver, para que
 * o teste de quarentena use dado real + seed real em vez de um nome inventado.
 */
const aliases2022 = new Map<string, string>([
  ...seedCandidateAliases,
  ['Jair Bolsonaro', 'jair-bolsonaro'],
  ['Constituinte Eymael', 'eymael'],
  ['Felipe d’Avila', 'felipe-davila'],
  ['Léo Péricles', 'leo-pericles'],
  ['Pablo Marçal', 'pablo-marcal'],
  ['Sofia Manzano', 'sofia-manzano'],
  ['Soraya Thronicke', 'soraya-thronicke'],
  ['Vera', 'vera'],
  ['Roberto Jefferson', 'roberto-jefferson'],
]);
const resolver2022 = resolverFromMap(aliases2022);

const { storage } = makeTempStorage();
const adapter = new IpecAdapter({ resolveCandidate: resolver2022, storage });

/** Embala o texto da fixture num PDF real e devolve o `RawDocument`. */
const rawFor = (
  text: string,
  url = 'https://www.ipec-inteligencia.com.br/Repository/Files/1090/release.pdf',
): Promise<RawDocument> =>
  makeRawFromBytes(storage, makeIpecReleasePdf(text), 'application/pdf', url);

describe('IpecAdapter.parse — release nacional real (BR-01979/2022)', () => {
  let raw: RawDocument;
  beforeAll(async () => {
    raw = await rawFor(RELEASE_BR);
  });

  it('extrai 1º turno espontâneo por candidato, com tse_id confirmado (V6)', async () => {
    const parsed = await adapter.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' }));
    expect(parsed.tseId).toBe(TSE_BR);

    const t1 = parsed.scenarios.find((s) => s.kind === 't1_espontaneo');
    // Valores da coluna ATUAL (29/08), não da anterior (15/08). O alias é só o
    // nome — o "– 13 – PT" do documento é número de urna e partido.
    expect(t1?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 40 },
      { candidateAlias: 'Jair Bolsonaro', valuePct: 31 },
      { candidateAlias: 'Ciro Gomes', valuePct: 4 },
      { candidateAlias: 'Constituinte Eymael', valuePct: 0 },
      { candidateAlias: 'Felipe d’Avila', valuePct: 0 },
      { candidateAlias: 'Léo Péricles', valuePct: 0 },
      { candidateAlias: 'Pablo Marçal', valuePct: 0 },
      { candidateAlias: 'Simone Tebet', valuePct: 2 },
      { candidateAlias: 'Sofia Manzano', valuePct: 0 },
      { candidateAlias: 'Soraya Thronicke', valuePct: 0 },
    ]);
    expect(t1?.blankNullPct).toBe(9);
    expect(t1?.undecidedPct).toBe(14);
  });

  it('extrai o 2º turno com o par de candidatos (V3)', async () => {
    const parsed = await adapter.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' }));
    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    expect(t2?.t2Pair).toEqual(['Lula', 'Jair Bolsonaro']);
    expect(t2?.values).toEqual([
      { candidateAlias: 'Lula', valuePct: 50 },
      { candidateAlias: 'Jair Bolsonaro', valuePct: 37 },
    ]);
    expect(t2?.blankNullPct).toBe(9);
    expect(t2?.undecidedPct).toBe(4);
  });

  it('lê a coluna da rodada ATUAL, nunca a da rodada anterior', async () => {
    const parsed = await adapter.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' }));
    const t2 = parsed.scenarios.find((s) => s.kind === 't2');
    const lula = t2?.values.find((v) => v.candidateAlias === 'Lula');
    // No documento: "Lula – 13 – PT 51% 50%" (15/08 = 51, 29/08 = 50).
    expect(lula?.valuePct).toBe(50);
    expect(lula?.valuePct).not.toBe(51);
  });

  it('"*" (não foi citado) e "-" (não testado) NÃO viram zero — ausência ≠ zero', async () => {
    const parsed = await adapter.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' }));
    const t1 = parsed.scenarios.find((s) => s.kind === 't1_espontaneo');
    // "Vera – 16 – PSTU 0% *" e "Roberto Jefferson – 14 – PTB - *": ambos estão
    // no documento, ambos SEM valor na rodada atual. Não entram no cenário.
    expect(t1?.values.some((v) => v.candidateAlias === 'Vera')).toBe(false);
    expect(t1?.values.some((v) => v.candidateAlias === 'Roberto Jefferson')).toBe(false);
    // E não entraram como 0 disfarçado:
    expect(t1?.values.filter((v) => v.valuePct === 0).map((v) => v.candidateAlias)).not.toContain(
      'Vera',
    );
  });

  it('NÃO emite 1º turno estimulado: no release real ele é gráfico, sem texto', async () => {
    const parsed = await adapter.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' }));
    // Limitação central do adapter, documentada em IPEC_ESTIMULADO_NOTE. Se um dia
    // o Ipec passar a publicar a tabela estimulada em texto, este teste quebra —
    // e quebrar é o aviso de que há dado novo a colher.
    expect(parsed.scenarios.map((s) => s.kind)).toEqual(['t2', 't1_espontaneo']);
  });

  it('ignora as tabelas que não são intenção de voto (rejeição soma > 100%)', async () => {
    const parsed = await adapter.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' }));
    // O documento tem "Rejeição", "Expectativa de vitória", "Avaliação" e
    // "Aprovação". Nenhuma abre cenário: só 2 cenários no total.
    expect(parsed.scenarios).toHaveLength(2);
    // E nenhum rótulo dessas tabelas virou candidato.
    const todosAliases = parsed.scenarios.flatMap((s) => s.values.map((v) => v.candidateAlias));
    expect(todosAliases).not.toContain('Aprova');
    expect(todosAliases).not.toContain('Ótima / boa');
    expect(todosAliases).not.toContain('Poderia votar em todos');
  });

  it('os cenários extraídos passam a validação bloqueante (V1–V7)', async () => {
    const parsed = await adapter.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' }));
    // Prova de que os números batem como distribuição, não só como parsing:
    // soma 97–103 (V1), ninguém acima de 70% (V2), 2º turno com 2 (V3),
    // 2 ≤ n ≤ 20 candidatos (V7). Lança se qualquer regra falhar.
    expect(() => validateParsedPoll({ parsed, expectedTseId: TSE_BR })).not.toThrow();
  });
});

describe('IpecAdapter.parse — casos de borda e falhas duras', () => {
  it('LANÇA (V6) quando o release é de OUTRA rodada', async () => {
    // Mutação mínima e visível: o número do registro no documento real passa a ser
    // outro. É o pior bug do sistema (atribuir números da rodada errada).
    const outraRodada = RELEASE_BR.replace('01979/2022', '07777/2022');
    const raw = await rawFor(outraRodada);
    await expect(
      adapter.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' })),
    ).rejects.toBeInstanceOf(ParseError);
  });

  it('LANÇA UnknownCandidateError (quarentena) para alias fora do seed', async () => {
    // Dado REAL + seed REAL: o seed de 2026 não tem "Jair Bolsonaro", que está no
    // release de 2022. Nada inventado — e o adapter recusa em vez de auto-criar.
    const adapterSeed = new IpecAdapter({ resolveCandidate: seedResolver, storage });
    const raw = await rawFor(RELEASE_BR);
    await expect(
      adapterSeed.parse(raw, makeReg({ tseId: TSE_BR, instituteId: 'ipec' })),
    ).rejects.toBeInstanceOf(UnknownCandidateError);
  });

  it('LANÇA quando um valor está ilegível — nunca vira 0 (R4)', async () => {
    // "Jair Bolsonaro – 22 – PL 30% 31%" → valor da rodada atual corrompido.
    const ilegivel = RELEASE_BR.replace(
      'Jair Bolsonaro – 22 – PL 30% 31%',
      'Jair Bolsonaro – 22 – PL 30% 3X%',
    );
    expect(ilegivel).not.toBe(RELEASE_BR); // a mutação de fato aconteceu
    await expect(
      adapter.parse(await rawFor(ilegivel), makeReg({ tseId: TSE_BR, instituteId: 'ipec' })),
    ).rejects.toThrow(/ilegível/i);
  });

  it('LANÇA quando a contagem de colunas não bate — não adivinha a rodada atual', async () => {
    // Uma coluna a mais numa linha: qual é a atual? Recusar é a única resposta
    // honesta, porque escolher errado importa a rodada passada em silêncio.
    const colunaExtra = RELEASE_BR.replace(
      'Ciro Gomes – 12 – PDT 3% 4%',
      'Ciro Gomes – 12 – PDT 3% 4% 5%',
    );
    await expect(
      adapter.parse(await rawFor(colunaExtra), makeReg({ tseId: TSE_BR, instituteId: 'ipec' })),
    ).rejects.toThrow(/coluna/i);
  });

  it('percentual em prosa NÃO é colhido como resultado', () => {
    // Prosa de nossa autoria (R3), com percentuais no meio, injetada dentro do
    // documento real: nenhum deles pode aparecer nos cenários.
    const comProsa = RELEASE_BR.replace(
      'OUTRAS INFORMAÇÕES DA PESQUISA - PRESIDENTE',
      'Nota de teste: um candidato hipotético teria 88% entre eleitores de 25 a 34 anos.\n' +
        'OUTRAS INFORMAÇÕES DA PESQUISA - PRESIDENTE',
    );
    const scenarios = parseIpecReleaseText(comProsa);
    const valores = scenarios.flatMap((s) => s.values.map((v) => v.valuePct));
    expect(valores).not.toContain(88);
  });

  it('release estadual de 2º turno: recusa em vez de misturar cargos ou rotular errado', () => {
    // O release do Amazonas real tem governador (fora de escopo) e um voto
    // espontâneo de 2º turno (que SCENARIO_KIND não representa). Resultado
    // honesto: nada extraível, dito alto — nunca um cenário com kind errado.
    expect(() => parseIpecReleaseText(RELEASE_AM)).toThrow(ParseError);
    expect(() => parseIpecReleaseText(RELEASE_AM)).toThrow(/não tem kind em SCENARIO_KIND/);
  });

  it('não importa a tabela do GOVERNADOR de um release estadual', () => {
    try {
      parseIpecReleaseText(RELEASE_AM);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      // Wilson Lima e Eduardo Braga (governador) nunca chegam a ser candidatos.
      expect(String(err)).not.toContain('Wilson Lima');
    }
  });

  it('confirma V6 num release com registro DUPLO (TRE + TSE) e espaço após o hífen', () => {
    // Linha real do release do Amazonas: "... sob o protocolo Nº AM- 03931/2022 e
    // no Tribunal Superior Eleitoral sob o protocolo Nº BR-08161/2022." São dois
    // números; o nosso é o do TSE, e o do TRE vem com ESPAÇO depois do hífen.
    expect(documentContainsTseId(RELEASE_AM, TSE_AM)).toBe(true);
    expect(RELEASE_AM).toContain('AM- 03931/2022');
    // E um registro que não está no documento não é confirmado.
    expect(documentContainsTseId(RELEASE_AM, 'BR-01979/2022')).toBe(false);
  });

  it('confirma V6 com o registro quebrado entre linhas, como no PDF real', () => {
    // No documento: "... sob o protocolo Nº BR-" / "01979/2022." — o número é
    // partido pela quebra de linha. A confirmação tolera o separador.
    expect(() => parseIpecReleaseText(RELEASE_BR)).not.toThrow();
    expect(RELEASE_BR).toContain('BR-\n01979/2022.');
  });

  it('LANÇA se o cabeçalho de turno desaparecer (estrutura mudou)', () => {
    const semTurno = RELEASE_BR.replace('Brasil – 1º Turno – 2ª Rodada', 'Brasil');
    expect(() => parseIpecReleaseText(semTurno)).toThrow(/turno/i);
  });

  it('LANÇA se a tabela não vier seguida do cabeçalho de datas', () => {
    const semDatas = RELEASE_BR.replace(
      'Simulações de Segundo Turno\n15/08 29/08',
      'Simulações de Segundo Turno',
    );
    expect(() => parseIpecReleaseText(semDatas)).toThrow(/cabeçalho de datas/i);
  });
});

describe('IpecAdapter — identidade, descoberta e formato de documento', () => {
  it('id e instituteId batem com o registro do instituto', () => {
    expect(adapter.id).toBe('ipec');
    expect(adapter.instituteId).toBe('ipec');
  });

  it('canHandle casa pelo instituteId do registro', () => {
    expect(adapter.canHandle(makeReg({ instituteId: 'ipec' }))).toBe(true);
    expect(adapter.canHandle(makeReg({ instituteId: 'nexus' }))).toBe(false);
  });

  it('discover aponta o índice JSON e a página de pesquisas, com o bloqueio declarado', async () => {
    const candidates = await adapter.discover(makeReg({ instituteId: 'ipec' }));
    expect(candidates.map((c) => c.url)).toEqual([
      'https://ipec-inteligencia.com.br/api/arquivo/ListAtivos/',
      'https://www.ipec-inteligencia.com.br/pesquisas/',
    ]);
    // Quem consumir o candidato precisa saber que a coleta live está bloqueada.
    for (const candidate of candidates) {
      expect(candidate.reason).toMatch(/403/);
    }
  });

  it('LANÇA se o documento não for PDF (o HTML de /pesquisas/ é só a casca da SPA)', async () => {
    const html = await makeRawFromBytes(
      storage,
      '<html><body><div ng-app="IpecApp"></div></body></html>',
      'text/html',
      'https://www.ipec-inteligencia.com.br/pesquisas/',
    );
    await expect(
      adapter.parse(html, makeReg({ tseId: TSE_BR, instituteId: 'ipec' })),
    ).rejects.toThrow(/não é PDF/);
  });
});
