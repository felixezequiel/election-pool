/**
 * Confirmação de identidade por `tse_id` (docs/04 §4.1, V6). É a regra que impede
 * o pior bug do sistema: atribuir os números de uma rodada ao registro errado.
 *
 * O documento (HTML já reduzido a texto, ou texto de PDF) PRECISA conter o
 * `tse_id` do registro. Se não contiver, é outro levantamento e o adapter LANÇA
 * `ParseError`. Nunca há "melhor esforço" aqui.
 *
 * O TSE grafa o `tse_id` de várias formas ("BR-06591/2026", "BR‑06591/2026" com
 * hífen não-ASCII, "Registro nº BR 06591/2026", "06591/2026"). Confirmamos pela
 * sequência canônica (dígitos + ano), tolerando o separador. NUNCA extraímos um
 * `tse_id` do texto para usar como verdade — só confirmamos que o do registro
 * está presente. A verdade é sempre `reg.tseId`.
 */

import { ParseError } from '../poll-source-adapter.js';

/** Extrai a sequência e o ano de um `tse_id` canônico ('BR-06591/2026'). */
const parseTseId = (tseId: string): { sequence: string; year: string } => {
  const m = /^BR-(\d+)\/(\d{4})$/.exec(tseId.trim());
  if (m === null) {
    throw new ParseError(`tse_id do registro em formato inesperado: "${tseId}"`);
  }
  const [, sequence, year] = m;
  // O regex garante ambos os grupos; a narrow abaixo satisfaz o compilador sem
  // fallback silencioso de dado.
  if (sequence === undefined || year === undefined) {
    throw new ParseError(`tse_id do registro em formato inesperado: "${tseId}"`);
  }
  return { sequence, year };
};

/**
 * `true` se o texto do documento contém o `tse_id` do registro, tolerando a
 * grafia (com/sem prefixo "BR", separador `-`/espaço/hífen unicode). O casamento
 * exige a sequência E o ano juntos — só o ano, ou só a sequência, não confirma.
 */
export const documentContainsTseId = (documentText: string, tseId: string): boolean => {
  const { sequence, year } = parseTseId(tseId);
  // Separador entre "BR", a sequência e o ano: hífen ASCII, hífens unicode,
  // espaço, ou nada. A sequência tem de casar exata (ancorada por não-dígito nas
  // bordas) para não confundir '591' com '06591'.
  const sep = '[\\s\\u2010-\\u2015-]*';
  const pattern = new RegExp(`(?:BR${sep})?(?<![0-9])${sequence}${sep}/${sep}${year}(?![0-9])`);
  return pattern.test(documentText);
};

/**
 * Confirma a identidade (V6) ou LANÇA. Devolve o `tse_id` do registro (a verdade),
 * para o chamador usar no `ParsedPoll` — nunca um valor "extraído" do documento.
 */
export const confirmTseId = (documentText: string, tseId: string): string => {
  if (!documentContainsTseId(documentText, tseId)) {
    throw new ParseError(
      `Documento não contém o tse_id do registro (${tseId}) — é outra rodada. ` +
        `Recusando para não atribuir números da rodada errada (V6, docs/04 §4.1).`,
    );
  }
  return tseId;
};
