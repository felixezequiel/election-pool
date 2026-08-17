/**
 * Resolução dos DOIS campos de data da busca por período (`listar.xhtml`) A PARTIR
 * DO RÓTULO, exatamente como `select-options.ts` faz com o id da eleição.
 *
 * Motivo (mesma lição da Q-09): os ids reais são `formPesquisa:j_id_2n_input` e
 * `formPesquisa:j_id_2p_input`, ou seja, gerados pelo JSF a partir da posição do
 * componente na árvore. Qualquer campo novo no formulário renumera todos. Se
 * hardcodássemos os ids e eles mudassem, o POST iria SEM período — e busca sem
 * período volta truncada em 50 registros com cara de sucesso, que é precisamente o
 * bug que T-28 conserta. Aqui, rótulo ausente ou estrutura diferente LANÇA (R4).
 *
 * Estrutura capturada ao vivo em 2026-08-17:
 *
 *   <td><label ...>Período de registro: </label></td>
 *   <td><span class="ui-calendar"><input name="…j_id_2n_input" …/></span>
 *       à <span class="ui-calendar"><input name="…j_id_2p_input" …/></span></td>
 */

import { parse as parseHtml } from 'node-html-parser';
import { PERIODO_REGISTRO_LABEL } from './constants.js';
import { normalizeLabel } from './texto.js';

export class PesqElePeriodoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PesqElePeriodoError';
  }
}

/** Nomes (atributo `name`) dos inputs de início e fim do período de registro. */
export interface PeriodoInputs {
  inicio: string;
  fim: string;
}

export const resolvePeriodoInputs = (html: string): PeriodoInputs => {
  const root = parseHtml(html);
  const alvo = normalizeLabel(PERIODO_REGISTRO_LABEL);

  for (const label of root.querySelectorAll('label')) {
    if (normalizeLabel(label.text) !== alvo) continue;

    const celulaRotulo = label.closest('td');
    const celulaCampos = celulaRotulo?.nextElementSibling;
    if (celulaCampos === undefined || celulaCampos === null) {
      throw new PesqElePeriodoError(
        `Rótulo "${PERIODO_REGISTRO_LABEL}" sem célula de campos ao lado (estrutura mudou?)`,
      );
    }

    const nomes = celulaCampos
      .querySelectorAll('input')
      .map((input) => input.getAttribute('name'))
      .filter((name): name is string => name !== undefined && name.length > 0);

    // Dois campos, nem um nem três: um só significaria que o formulário deixou de
    // ter período de/até, e chutar qual é qual mandaria a data errada em silêncio.
    if (nomes.length !== 2) {
      throw new PesqElePeriodoError(
        `Esperava 2 campos de data ao lado de "${PERIODO_REGISTRO_LABEL}", achei ${nomes.length}: ${nomes.join(', ')}`,
      );
    }
    const [inicio, fim] = nomes;
    if (inicio === undefined || fim === undefined) {
      throw new PesqElePeriodoError(`Campos de data de "${PERIODO_REGISTRO_LABEL}" sem "name"`);
    }
    return { inicio, fim };
  }

  throw new PesqElePeriodoError(
    `Rótulo "${PERIODO_REGISTRO_LABEL}" ausente na página de busca por período do PesqEle`,
  );
};
