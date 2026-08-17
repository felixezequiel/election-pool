import { describe, it, expect } from 'vitest';
import {
  dataLocalDe,
  diasDaFatia,
  fatiarJanela,
  paraDataPtBr,
  rotuloDaFatia,
  subdividirFatia,
  PesqEleJanelaError,
} from './janela.js';
import { JANELA_DIAS, FATIA_DIAS } from './constants.js';

/**
 * O que estes testes protegem é a PARTIÇÃO: se as fatias tiverem vão entre elas,
 * um dia de registros desaparece da varredura sem que ninguém perceba — o mesmo
 * tipo de perda silenciosa que T-28 conserta. Por isso as asserções são sobre
 * cobertura e contiguidade, não sobre formato.
 */
describe('janela — fatiamento por data de registro', () => {
  it('cobre a janela inteira sem vão e sem sobreposição', () => {
    const fatias = fatiarJanela({ fim: '2026-08-17', dias: 30, largura: 3 });

    expect(fatias).toHaveLength(10);
    expect(fatias[0]).toEqual({ inicio: '2026-07-19', fim: '2026-07-21' });
    expect(fatias[9]).toEqual({ inicio: '2026-08-15', fim: '2026-08-17' });

    // Contiguidade: o início de cada fatia é o dia seguinte ao fim da anterior.
    const dias = fatias.reduce((soma, f) => soma + diasDaFatia(f), 0);
    expect(dias).toBe(30);
    for (let i = 1; i < fatias.length; i++) {
      const anterior = new Date(`${fatias[i - 1]!.fim}T00:00:00Z`).getTime();
      const atual = new Date(`${fatias[i]!.inicio}T00:00:00Z`).getTime();
      expect(atual - anterior).toBe(86_400_000);
    }
  });

  it('vai do mais ANTIGO para o mais recente (o antigo é o que está expirando)', () => {
    const fatias = fatiarJanela({ fim: '2026-08-17', dias: 30, largura: 3 });

    expect(fatias[0]!.inicio < fatias[9]!.inicio).toBe(true);
  });

  it('a última fatia encurta em vez de passar do fim da janela', () => {
    const fatias = fatiarJanela({ fim: '2026-08-17', dias: 7, largura: 3 });

    expect(fatias).toEqual([
      { inicio: '2026-08-11', fim: '2026-08-13' },
      { inicio: '2026-08-14', fim: '2026-08-16' },
      { inicio: '2026-08-17', fim: '2026-08-17' },
    ]);
  });

  it('atravessa virada de mês e de ano sem perder dia', () => {
    const fatias = fatiarJanela({ fim: '2027-01-02', dias: 5, largura: 2 });

    expect(fatias).toEqual([
      { inicio: '2026-12-29', fim: '2026-12-30' },
      { inicio: '2026-12-31', fim: '2027-01-01' },
      { inicio: '2027-01-02', fim: '2027-01-02' },
    ]);
  });

  it('o default de produção são 10 fatias para a janela de 30 dias', () => {
    const fatias = fatiarJanela({ fim: '2026-08-17', dias: JANELA_DIAS, largura: FATIA_DIAS });

    expect(fatias).toHaveLength(Math.ceil(JANELA_DIAS / FATIA_DIAS));
  });

  it('janela ou largura inválida LANÇA (nunca varre "zero dia" em silêncio)', () => {
    expect(() => fatiarJanela({ fim: '2026-08-17', dias: 0, largura: 3 })).toThrow(
      PesqEleJanelaError,
    );
    expect(() => fatiarJanela({ fim: '2026-08-17', dias: 30, largura: 0 })).toThrow(
      PesqEleJanelaError,
    );
    expect(() => fatiarJanela({ fim: '17/08/2026', dias: 30, largura: 3 })).toThrow(/AAAA-MM-DD/);
  });
});

describe('janela — subdivisão de fatia (o passo antes de desistir)', () => {
  it('divide em duas metades contíguas que somam a fatia original', () => {
    const metades = subdividirFatia({ inicio: '2026-08-01', fim: '2026-08-03' });

    expect(metades).toEqual([
      { inicio: '2026-08-01', fim: '2026-08-01' },
      { inicio: '2026-08-02', fim: '2026-08-03' },
    ]);
  });

  it('subdivide de 3 dias até chegar a fatias de 1 dia', () => {
    const [a, b] = subdividirFatia({ inicio: '2026-08-01', fim: '2026-08-03' })!;

    expect(subdividirFatia(a)).toBeNull(); // 1 dia: não há mais o que estreitar
    expect(subdividirFatia(b)).toEqual([
      { inicio: '2026-08-02', fim: '2026-08-02' },
      { inicio: '2026-08-03', fim: '2026-08-03' },
    ]);
  });

  it('fatia de um único dia devolve null (o chamador tem de ALERTAR, não insistir)', () => {
    expect(subdividirFatia({ inicio: '2026-08-10', fim: '2026-08-10' })).toBeNull();
  });

  it('fatia invertida LANÇA', () => {
    expect(() => diasDaFatia({ inicio: '2026-08-10', fim: '2026-08-01' })).toThrow(/invertida/);
  });
});

describe('janela — datas em America/Sao_Paulo e formato do PesqEle', () => {
  it('usa a data LOCAL, não a UTC, na virada do dia', () => {
    // 02:30 UTC de 18/08 ainda é 23:30 de 17/08 em Brasília: varrer até 18/08
    // deixaria a janela um dia à frente do que o TSE mostra.
    expect(dataLocalDe(new Date('2026-08-18T02:30:00Z'))).toBe('2026-08-17');
    expect(dataLocalDe(new Date('2026-08-18T03:30:00Z'))).toBe('2026-08-18');
  });

  it('formata a data como o calendário do PesqEle exige', () => {
    expect(paraDataPtBr('2026-08-05')).toBe('05/08/2026');
    expect(rotuloDaFatia({ inicio: '2026-08-05', fim: '2026-08-07' })).toBe(
      '05/08/2026–07/08/2026',
    );
  });

  it('data fora do formato LANÇA em vez de virar "NaN/NaN/NaN"', () => {
    expect(() => paraDataPtBr('05/08/2026')).toThrow(PesqEleJanelaError);
  });
});
