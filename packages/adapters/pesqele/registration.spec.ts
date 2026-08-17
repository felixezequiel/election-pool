import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseColunas,
  parseLimiteDeclarado,
  parseLinhasLista,
  parsePaginador,
  parseTabelaResultado,
  parseDetalhe,
  toRawRegistration,
  PesqEleParseError,
  __test,
} from './registration.js';
import { parsePartialResponse, requireUpdate } from './partial-response.js';
import { FIELD, LIMITE_RESULTADO_DECLARADO } from './constants.js';

/**
 * Todas as fixtures são CAPTURAS REAIS do PesqEle (2026-08-16) — ver
 * `__fixtures__/README.md`. Os casos de borda são MUTAÇÕES dessas capturas
 * (apagar uma célula, tirar uma coluna), nunca HTML inventado: fixture sintética
 * de fonte externa não prova integração nenhuma (Q-09).
 */
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./__fixtures__/${name}`, import.meta.url)), 'utf8');

const tabelaDaBusca = (): string =>
  requireUpdate(parsePartialResponse(fixture('02-busca-partial-response.xml')), FIELD.form);

/** Mapa de colunas da tela de 30 dias, lido do cabeçalho da própria captura. */
const colunas30Dias = () => parseColunas(tabelaDaBusca());

/** Tabela da busca por PERÍODO (`listar.xhtml`), captura de 2026-08-17. */
const tabelaDoPeriodo = (): string =>
  requireUpdate(parsePartialResponse(fixture('09-busca-periodo-partial-response.xml')), FIELD.form);

describe('lista — parse posicional das 6 colunas reais', () => {
  it('extrai as 10 linhas da página 1 com o tse_id certo', () => {
    const { linhas, paginador } = parseTabelaResultado(tabelaDaBusca());

    expect(linhas).toHaveLength(10);
    expect(paginador).toEqual({ totalRecords: 50, rowsPerPage: 10, page: 0 });
    expect(linhas.map((l) => l.tseId)).toEqual([
      'BR-06783/2026',
      'BR-08765/2026',
      'BR-08448/2026',
      'BR-05672/2026',
      'BR-07185/2026',
      'BR-02094/2026',
      'BR-04006/2026',
      'BR-04396/2026',
      'BR-00109/2026',
      'BR-04496/2026',
    ]);
  });

  it('extrai os 6 campos da primeira linha (incluindo o data-ri do detalhar)', () => {
    const [primeira] = parseTabelaResultado(tabelaDaBusca()).linhas;

    expect(primeira).toEqual({
      rowIndex: 0,
      tseId: 'BR-06783/2026',
      instituteName:
        'INSTITUTO OPNUS DE PESQUISA, CONSULTORIA E INTELIGENCIA DE DADOS LTDA / INSTITUTO OPNUS',
      raceLabel: 'Presidente',
      // A tela de 30 dias não tem coluna "Eleição": null, nunca o valor de outra coluna.
      eleicaoLabel: null,
      registeredAt: '2026-08-16T00:00:00-03:00',
      abrangenciaLabel: 'BRASIL',
    });
  });

  it('lê o fragmento só-de-linhas da paginação, com data-ri global', () => {
    const partial = parsePartialResponse(fixture('03-paginacao-pagina2-partial-response.xml'));
    const linhas = parseLinhasLista(requireUpdate(partial, FIELD.tabela), colunas30Dias());

    expect(linhas).toHaveLength(10);
    expect(linhas[0]?.rowIndex).toBe(10); // índice GLOBAL, não o da página
    expect(linhas[0]?.tseId).toBe('BR-09479/2026');
    expect(linhas[9]?.rowIndex).toBe(19);
  });

  it('busca vazia: paginador com totalRecords = 0 e nenhuma linha', () => {
    const partial = parsePartialResponse(fixture('07-busca-vazia-partial-response.xml'));
    const tabela = parseTabelaResultado(requireUpdate(partial, FIELD.form));

    expect(tabela.paginador.totalRecords).toBe(0);
    expect(tabela.linhas).toHaveLength(0);
  });
});

describe('lista — falha alta (R4)', () => {
  it('LANÇA quando um campo obrigatório da linha está vazio (não vira 0 nem string vazia)', () => {
    // Mutação da captura real: a célula de abrangência da linha 0 fica vazia.
    const mutado = tabelaDaBusca().replace(
      '<td role="gridcell">BRASIL</td>',
      '<td role="gridcell"></td>',
    );

    expect(() => parseLinhasLista(mutado, colunas30Dias())).toThrow(PesqEleParseError);
    expect(() => parseLinhasLista(mutado, colunas30Dias())).toThrow(/abrang/i);
  });

  it('LANÇA quando a empresa contratada está vazia', () => {
    const mutado = tabelaDaBusca().replace(
      '<td role="gridcell">INSTITUTO OPNUS DE PESQUISA, CONSULTORIA E INTELIGENCIA DE DADOS LTDA / INSTITUTO OPNUS</td>',
      '<td role="gridcell">   </td>',
    );

    expect(() => parseLinhasLista(mutado, colunas30Dias())).toThrow(/empresa contratada/);
  });

  it('LANÇA quando a tabela ganha/perde coluna (o parse é posicional)', () => {
    const mutado = tabelaDaBusca().replace(
      '<td role="gridcell">BR-06783/2026</td>',
      '<td role="gridcell">BR-06783/2026</td><td role="gridcell">coluna nova</td>',
    );

    expect(() => parseLinhasLista(mutado, colunas30Dias())).toThrow(/colunas; esperado 6/);
  });

  it('LANÇA quando o tse_id não tem o formato canônico', () => {
    const mutado = tabelaDaBusca().replace('BR-06783/2026', 'BR-6783/2026');

    expect(() => parseLinhasLista(mutado, colunas30Dias())).toThrow(/tse_id inválido/);
  });

  it('LANÇA quando o config do paginador some (não assume 1 página)', () => {
    const mutado = tabelaDaBusca().replace('rows:10,rowCount:50,page:0', 'paginator:false');

    expect(() => parsePaginador(mutado)).toThrow(/paginador/i);
  });

  it('LANÇA quando o número de linhas não bate com o paginador', () => {
    const mutado = tabelaDaBusca().replace('rowCount:50', 'rowCount:3');

    expect(() => parseTabelaResultado(mutado)).toThrow(/o paginador diz/);
  });
});

describe('lista — busca por período (listar.xhtml) tem OUTRAS colunas', () => {
  it('mapeia as colunas pelo cabeçalho: "Eleição" no lugar de "Cargos"', () => {
    const periodo = parseColunas(tabelaDoPeriodo());
    const trintaDias = colunas30Dias();

    expect(periodo).toEqual({
      tseId: 0,
      eleicao: 1,
      empresa: 2,
      dataRegistro: 3,
      abrangencia: 4,
      cargos: null,
      total: 6,
    });
    // A MESMA posição (índice 1) é "Empresa" numa tela e "Eleição" na outra: é
    // exatamente por isso que o mapa fixo trocava os campos em silêncio.
    expect(trintaDias.empresa).toBe(1);
    expect(periodo.eleicao).toBe(1);
    expect(trintaDias.cargos).toBe(2);
    expect(periodo.empresa).toBe(2);
  });

  it('extrai o instituto certo (e não o rótulo da eleição) na busca por período', () => {
    const { linhas, paginador } = parseTabelaResultado(tabelaDoPeriodo());

    expect(paginador).toEqual({ totalRecords: 13, rowsPerPage: 10, page: 0 });
    expect(linhas[0]).toEqual({
      rowIndex: 0,
      tseId: 'BR-09275/2026',
      instituteName: 'REAL TIME MIDIA LTDA / REAL TIME BIG DATA',
      raceLabel: null, // esta tela não tem coluna de cargo — o detalhe tem
      eleicaoLabel: 'Eleições Gerais 2026',
      registeredAt: '2026-08-12T00:00:00-03:00',
      abrangenciaLabel: 'BRASIL',
    });
  });

  it('lê o TETO que o PesqEle declara na própria página', () => {
    expect(parseLimiteDeclarado(tabelaDoPeriodo())).toBe(LIMITE_RESULTADO_DECLARADO);
  });

  it('a captura da janela de 30 dias inteira volta NO TETO (a prova do bug)', () => {
    const tabela = parseTabelaResultado(
      requireUpdate(
        parsePartialResponse(fixture('11-busca-periodo-no-teto-partial-response.xml')),
        FIELD.form,
      ),
    );

    expect(tabela.paginador.totalRecords).toBe(50);
    expect(tabela.limiteDeclarado).toBe(50);
    // E a mesma captura prova que a DataTable NÃO volta na página 0 depois de
    // paginar: aqui ela voltou na página 1, com o data-ri global 10..19.
    expect(tabela.paginador.page).toBe(1);
    expect(tabela.linhas[0]?.rowIndex).toBe(10);
  });

  it('teto não declarado é null (não vira 0 nem um chute)', () => {
    const semAviso = tabelaDoPeriodo().replace(/limitado a 50 registros/, 'sem aviso nenhum');

    expect(parseLimiteDeclarado(semAviso)).toBeNull();
  });

  it('LANÇA se o cabeçalho perder uma coluna obrigatória (nunca deduz por posição)', () => {
    const mutado = tabelaDoPeriodo().replace(
      '<span class="ui-column-title">Abrang&#234;ncia</span>',
      '<span class="ui-column-title">Outra coisa</span>',
    );

    expect(() => parseColunas(mutado)).toThrow(/Abrangência/);
  });

  it('LANÇA se o cabeçalho da tabela desaparecer inteiro', () => {
    const mutado = tabelaDoPeriodo().replace(/ui-column-title/g, 'ui-column-sumiu');

    expect(() => parseColunas(mutado)).toThrow(/Cabeçalho da tabela/);
  });
});

describe('detalhe — parse por rótulo da tela real', () => {
  const detalhe = () => parseDetalhe(fixture('05-detalhe-BR-06783-2026.html'));

  it('extrai entrevistados, datas de campo, CNPJ, contratante e valor', () => {
    const d = detalhe();

    expect(d.tseId).toBe('BR-06783/2026');
    expect(d.sampleSize).toBe(1200);
    expect(d.fieldStart).toBe('2026-08-17');
    expect(d.fieldEnd).toBe('2026-08-21');
    expect(d.instituteCnpj).toBe('09409427000112');
    expect(d.instituteName).toBe(
      'INSTITUTO OPNUS DE PESQUISA, CONSULTORIA E INTELIGENCIA DE DADOS LTDA / INSTITUTO OPNUS',
    );
    expect(d.costBrl).toBe(148800);
    expect(d.eleicaoLabel).toBe('Eleições Gerais 2026');
    expect(d.raceLabel).toBe('Presidente');
    expect(d.registeredAt).toBe('2026-08-16T00:00:00-03:00');
    expect(d.contratantes).toEqual([
      {
        name: 'ALVES QUATRO ASSESSORIA DE COMUNICACAO LTDA / ALVES QUATRO',
        cpfCnpj: '11523951000161',
      },
    ]);
  });

  it('NÃO extrai margem de erro nem nível de confiança da prosa (R3): ambos null', () => {
    const linha = parseTabelaResultado(tabelaDaBusca()).linhas[0]!;
    const raw = toRawRegistration(linha, detalhe());

    expect(raw.marginOfError).toBeNull();
    expect(raw.confidenceLevel).toBeNull();
  });

  it('monta o RawRegistration juntando lista e detalhe', () => {
    const linha = parseTabelaResultado(tabelaDaBusca()).linhas[0]!;
    const raw = toRawRegistration(linha, detalhe());

    expect(raw).toEqual({
      tseId: 'BR-06783/2026',
      instituteName:
        'INSTITUTO OPNUS DE PESQUISA, CONSULTORIA E INTELIGENCIA DE DADOS LTDA / INSTITUTO OPNUS',
      contractorName: 'ALVES QUATRO ASSESSORIA DE COMUNICACAO LTDA / ALVES QUATRO',
      contractorCnpj: '11523951000161',
      raceLabel: 'Presidente',
      registeredAt: '2026-08-16T00:00:00-03:00',
      fieldStart: '2026-08-17',
      fieldEnd: '2026-08-21',
      sampleSize: 1200,
      marginOfError: null,
      confidenceLevel: null,
      costBrl: 148800,
    });
  });

  it('lê os DOIS contratantes de um registro com contratação conjunta', () => {
    const d = parseDetalhe(fixture('06-detalhe-multi-contratante-BR-07185-2026.html'));

    expect(d.tseId).toBe('BR-07185/2026');
    expect(d.sampleSize).toBe(1610);
    expect(d.contratantes).toEqual([
      { name: 'EMPRESA FOLHA DA MANHA S.A.', cpfCnpj: '60579703000148' },
      {
        name: 'GLOBO COMUNICACAO E PARTICIPACOES S/A / TV/REDE/GLOBO.COM/CANAIS GLOBO/GLOBOPLAY/ELETROMIDIA',
        cpfCnpj: '27865757000102',
      },
    ]);
  });

  it('com mais de um contratante, o CNPJ fica null (não chuta o primeiro)', () => {
    const d = parseDetalhe(fixture('06-detalhe-multi-contratante-BR-07185-2026.html'));
    const linha = parseTabelaResultado(tabelaDaBusca()).linhas.find((l) => l.tseId === d.tseId)!;
    const raw = toRawRegistration(linha, d);

    expect(raw.contractorCnpj).toBeNull();
    expect(raw.contractorName).toBe(
      'EMPRESA FOLHA DA MANHA S.A. + GLOBO COMUNICACAO E PARTICIPACOES S/A / TV/REDE/GLOBO.COM/CANAIS GLOBO/GLOBOPLAY/ELETROMIDIA',
    );
  });

  it('não guarda a "Origem do Recurso" (texto livre do contratante, R3)', () => {
    const d = parseDetalhe(fixture('05-detalhe-BR-06783-2026.html'));

    for (const c of d.contratantes) {
      expect(c.name).not.toMatch(/Origem do Recurso/i);
      expect(c.name).not.toMatch(/Recursos pr/i);
    }
  });
});

describe('detalhe — falha alta (R4)', () => {
  it('LANÇA quando o rótulo de entrevistados some', () => {
    const mutado = fixture('05-detalhe-BR-06783-2026.html').replace(
      'Entrevistados:',
      'Numero de pessoas:',
    );

    expect(() => parseDetalhe(mutado)).toThrow(/Entrevistados/);
  });

  it('LANÇA quando entrevistados vem vazio (nunca vira 0)', () => {
    const mutado = fixture('05-detalhe-BR-06783-2026.html').replace(
      '<span id="form:lblEntrevistados">1200</span>',
      '<span id="form:lblEntrevistados"></span>',
    );

    expect(() => parseDetalhe(mutado)).toThrow(PesqEleParseError);
  });

  it('LANÇA quando não há contratante identificável (nunca vira string vazia)', () => {
    const mutado = fixture('05-detalhe-BR-06783-2026.html').replace(
      'CPF/CNPJ: 11523951000161 - ALVES QUATRO ASSESSORIA DE COMUNICACAO LTDA / ALVES QUATRO',
      '',
    );

    expect(() => parseDetalhe(mutado)).toThrow(/contratante/i);
  });

  it('LANÇA quando o detalhe é de outro registro (identidade, docs/04 §4.1)', () => {
    const linha = parseTabelaResultado(tabelaDaBusca()).linhas[0]!;
    const outro = parseDetalhe(fixture('06-detalhe-multi-contratante-BR-07185-2026.html'));

    expect(() => toRawRegistration(linha, outro)).toThrow(/fora de sincronia/);
  });
});

describe('helpers de data e valor', () => {
  it('converte DD/MM/AAAA para AAAA-MM-DD', () => {
    expect(__test.toIsoDate('05/08/2026')).toBe('2026-08-05');
  });

  it('rejeita data malformada (nunca inventa)', () => {
    expect(() => __test.toIsoDate('2026-08-05')).toThrow(PesqEleParseError);
  });

  it('data de registro vira meia-noite de São Paulo, com offset explícito', () => {
    expect(__test.toIsoDateTime('16/08/2026')).toBe('2026-08-16T00:00:00-03:00');
  });

  it('lê o valor em reais com NBSP e separador de milhar pt-BR', () => {
    expect(__test.parseValorBrl('R$ 148.800,00')).toBe(148800);
  });

  it('valor ausente é null (o campo existe e está vazio), não 0', () => {
    expect(__test.parseValorBrl('  ')).toBeNull();
  });
});
