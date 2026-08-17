import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolvePeriodoInputs, PesqElePeriodoError } from './periodo-inputs.js';

/**
 * A fixture é a captura REAL de `/app/pesquisa/listar.xhtml` (2026-08-17). O que
 * está sendo protegido aqui é o pior cenário desta task: se os ids `j_id_*` mudarem
 * e nós continuarmos mandando os antigos, o POST vai SEM período — e busca sem
 * período volta com 50 registros e cara de sucesso. Por isso a resolução é por
 * rótulo e a ausência LANÇA.
 */
const pagina = (): string =>
  readFileSync(
    fileURLToPath(new URL('./__fixtures__/08-listar-periodo-page.html', import.meta.url)),
    'utf8',
  );

describe('periodo-inputs — resolução por rótulo', () => {
  it('acha os dois campos de data da captura real, na ordem início/fim', () => {
    expect(resolvePeriodoInputs(pagina())).toEqual({
      inicio: 'formPesquisa:j_id_2n_input',
      fim: 'formPesquisa:j_id_2p_input',
    });
  });

  it('LANÇA quando o rótulo do período desaparece (nunca cai num id fixo)', () => {
    const mutado = pagina().replace(/Per&#237;odo de registro/g, 'Intervalo qualquer');

    expect(() => resolvePeriodoInputs(mutado)).toThrow(PesqElePeriodoError);
    expect(() => resolvePeriodoInputs(mutado)).toThrow(/Período de registro/);
  });

  it('LANÇA quando sobra só um campo de data (não chuta qual é o início)', () => {
    const mutado = pagina().replace(/<span id="formPesquisa:j_id_2p"[\s\S]*?<\/span>/, '');

    expect(() => resolvePeriodoInputs(mutado)).toThrow(/Esperava 2 campos de data/);
  });

  it('LANÇA quando aparece um terceiro campo ao lado do rótulo', () => {
    const mutado = pagina().replace(
      '<input id="formPesquisa:j_id_2p_input" name="formPesquisa:j_id_2p_input"',
      '<input name="formPesquisa:campoNovo" /><input id="formPesquisa:j_id_2p_input" name="formPesquisa:j_id_2p_input"',
    );

    expect(() => resolvePeriodoInputs(mutado)).toThrow(/achei 3/);
  });
});
