/**
 * Fatiamento da janela de descoberta em intervalos de DATA DE REGISTRO.
 *
 * Por que existe: o PesqEle corta toda listagem em 50 registros (Q-11 e
 * `LIMITE_RESULTADO_DECLARADO`). Uma consulta única da janela de 30 dias volta
 * "50" tanto quando há 50 quanto quando há 131 — e é a segunda hipótese que se
 * confirmou ao vivo. A saída é consultar a janela em fatias estreitas o bastante
 * para nenhuma bater no teto e unir os resultados por `tse_id` (o upsert do
 * DiscoveryJob é idempotente, então repetição é segura; omissão não é).
 *
 * Módulo PURO, sem I/O: recebe um instante e devolve intervalos de data. Fica
 * separado do cliente porque a aritmética de borda (fatia inclusiva nos dois
 * extremos, sem vão e sem sobreposição) é o que garante que nenhum dia fique de
 * fora, e isso precisa ser testável sem rede.
 *
 * Verificado ao vivo em 2026-08-17: a fatia 10–12/08 devolve 13 registros e as
 * três fatias de um dia (10, 11, 12) devolvem 6 + 6 + 1 = 13. Ou seja, o filtro
 * do PesqEle é inclusivo nas duas pontas e a partição por data é exata.
 */

import { SAO_PAULO_OFFSET } from './constants.js';

export class PesqEleJanelaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PesqEleJanelaError';
  }
}

/** Intervalo fechado de datas de registro, em ISO `AAAA-MM-DD`. */
export interface FatiaPeriodo {
  readonly inicio: string;
  readonly fim: string;
}

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_POR_DIA = 86_400_000;

/** Minutos do offset de São Paulo, lidos da constante (nunca um `3` solto). */
const offsetMinutos = (): number => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(SAO_PAULO_OFFSET);
  if (m === null) {
    throw new PesqEleJanelaError(`SAO_PAULO_OFFSET fora do formato ±HH:MM: "${SAO_PAULO_OFFSET}"`);
  }
  const [, sinal, hh, mm] = m;
  const magnitude = Number(hh) * 60 + Number(mm);
  return sinal === '-' ? -magnitude : magnitude;
};

/** Dia como número de dias desde a época, em UTC (aritmética sem fuso). */
const paraDiaEpoch = (iso: string): number => {
  const m = DATA_ISO.exec(iso);
  if (m === null) {
    throw new PesqEleJanelaError(`Data fora do formato AAAA-MM-DD: "${iso}"`);
  }
  const [, ano, mes, dia] = m;
  return Date.UTC(Number(ano), Number(mes) - 1, Number(dia)) / MS_POR_DIA;
};

const paraIso = (diaEpoch: number): string =>
  new Date(diaEpoch * MS_POR_DIA).toISOString().slice(0, 10);

/**
 * Data de "hoje" em `America/Sao_Paulo` (CLAUDE.md: nunca `Date` nu na lógica de
 * negócio). O PesqEle é um sistema brasileiro e filtra por data local; usar a data
 * UTC faria a janela pular ou repetir um dia entre 21h e 00h de Brasília.
 */
export const dataLocalDe = (instante: Date): string =>
  new Date(instante.getTime() + offsetMinutos() * 60_000).toISOString().slice(0, 10);

/** Quantidade de dias da fatia, contando as duas pontas (a fatia é fechada). */
export const diasDaFatia = (fatia: FatiaPeriodo): number => {
  const dias = paraDiaEpoch(fatia.fim) - paraDiaEpoch(fatia.inicio) + 1;
  if (dias <= 0) {
    throw new PesqEleJanelaError(`Fatia invertida: ${fatia.inicio} .. ${fatia.fim}`);
  }
  return dias;
};

/**
 * Fatia a janela `[fim - (dias - 1), fim]` em pedaços de `largura` dias.
 *
 * A ordem é do MAIS ANTIGO para o mais recente de propósito: é o registro antigo
 * que está a ponto de cair da janela de 30 dias e desaparecer da origem, então é
 * ele que precisa ser colhido primeiro se o ciclo for interrompido no meio.
 *
 * A última fatia pode ser mais estreita que `largura` — o que importa é cobrir a
 * janela inteira sem vão nem sobreposição.
 */
export const fatiarJanela = (params: {
  fim: string;
  dias: number;
  largura: number;
}): FatiaPeriodo[] => {
  const { fim, dias, largura } = params;
  if (!Number.isInteger(dias) || dias <= 0) {
    throw new PesqEleJanelaError(`Janela em dias inválida: ${dias}`);
  }
  if (!Number.isInteger(largura) || largura <= 0) {
    throw new PesqEleJanelaError(`Largura de fatia inválida: ${largura}`);
  }

  const diaFim = paraDiaEpoch(fim);
  const diaInicio = diaFim - (dias - 1);
  const fatias: FatiaPeriodo[] = [];
  for (let dia = diaInicio; dia <= diaFim; dia += largura) {
    fatias.push({ inicio: paraIso(dia), fim: paraIso(Math.min(dia + largura - 1, diaFim)) });
  }
  return fatias;
};

/**
 * Divide a fatia em duas metades contíguas. Devolve `null` quando a fatia já é de
 * um único dia: aí não há mais como estreitar por data, e o chamador precisa
 * ALERTAR em vez de fingir que colheu tudo (R4).
 */
export const subdividirFatia = (fatia: FatiaPeriodo): [FatiaPeriodo, FatiaPeriodo] | null => {
  const dias = diasDaFatia(fatia);
  if (dias < 2) return null;
  const inicio = paraDiaEpoch(fatia.inicio);
  const meio = inicio + Math.floor(dias / 2) - 1;
  return [
    { inicio: fatia.inicio, fim: paraIso(meio) },
    { inicio: paraIso(meio + 1), fim: fatia.fim },
  ];
};

/** `AAAA-MM-DD` → `DD/MM/AAAA`, o formato que o calendário do PesqEle aceita. */
export const paraDataPtBr = (iso: string): string => {
  const m = DATA_ISO.exec(iso);
  if (m === null) {
    throw new PesqEleJanelaError(`Data fora do formato AAAA-MM-DD: "${iso}"`);
  }
  const [, ano, mes, dia] = m;
  return `${dia}/${mes}/${ano}`;
};

/** Rótulo curto da fatia, para log e mensagem de alerta. */
export const rotuloDaFatia = (fatia: FatiaPeriodo): string =>
  `${paraDataPtBr(fatia.inicio)}–${paraDataPtBr(fatia.fim)}`;
