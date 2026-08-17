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
  const tail = `${sep}/${sep}${year}(?![0-9])`;

  /**
   * BURACO CORRIGIDO (achado pelo adapter do Datafolha): o prefixo era OPCIONAL e
   * o lookbehind só barrava dígito, então um documento contendo `PE-04519/2026`
   * confirmava um registro `BR-04519/2026`. Não é hipótese: o Datafolha publica o
   * protocolo nacional e o do TRE na MESMA frase ("BR-07601/2026 … PE-04519/2026"),
   * então uma pesquisa de Pernambuco podia validar o V6 de um registro nacional
   * cuja sequência coincidisse — e o V6 é justamente a defesa contra atribuir
   * números à rodada errada.
   *
   * Agora há duas formas aceitas, e nenhuma delas casa um prefixo de UF:
   *  1. `BR` explícito antes da sequência — sempre aceito;
   *  2. sequência "nua" (`06591/2026`, como o TSE às vezes grafa), aceita apenas
   *     quando NÃO vem precedida de duas letras + hífen, que é exatamente a forma
   *     de um protocolo de UF (`PE-`, `SP-`). Duas letras seguidas de ESPAÇO não
   *     disparam a exclusão, para "registro 06591/2026" continuar valendo.
   */
  const ufPrefix = '(?<![A-Za-z]{2}[-\\u2010-\\u2015])';
  const withBr = new RegExp(`BR${sep}(?<![0-9])${sequence}${tail}`);
  const bare = new RegExp(`${ufPrefix}(?<![0-9])${sequence}${tail}`);
  return withBr.test(documentText) || bare.test(documentText);
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
