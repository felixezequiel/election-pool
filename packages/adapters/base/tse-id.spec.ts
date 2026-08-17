import { describe, it, expect } from 'vitest';
import { confirmTseId, documentContainsTseId } from './tse-id.js';
import { ParseError } from '../poll-source-adapter.js';

describe('confirmação de tse_id (V6)', () => {
  const tseId = 'BR-06591/2026';

  it('confirma a grafia canônica no texto', () => {
    expect(documentContainsTseId('Registro TSE: BR-06591/2026', tseId)).toBe(true);
    expect(confirmTseId('foo BR-06591/2026 bar', tseId)).toBe(tseId);
  });

  it('confirma tolerando "BR" ausente e separadores variados', () => {
    expect(documentContainsTseId('Registro nº 06591/2026', tseId)).toBe(true);
    expect(documentContainsTseId('BR 06591 / 2026', tseId)).toBe(true);
    expect(documentContainsTseId('BR‑06591/2026', tseId)).toBe(true); // hífen unicode
  });

  it('NÃO confunde uma sequência parcial (591 vs 06591)', () => {
    expect(documentContainsTseId('registro 591/2026', tseId)).toBe(false);
    expect(documentContainsTseId('registro 106591/2026', tseId)).toBe(false);
  });

  it('NÃO confirma se só o ano bate (é outra rodada)', () => {
    expect(documentContainsTseId('pesquisa de 2026, registro BR-00001/2026', tseId)).toBe(false);
  });

  it('LANÇA quando o documento não contém o tse_id do registro (V6)', () => {
    expect(() => confirmTseId('documento de outra rodada BR-07777/2026', tseId)).toThrow(
      ParseError,
    );
  });
});

describe('V6 não confirma por protocolo de OUTRA unidade federativa', () => {
  /**
   * Achado do adapter do Datafolha: aquele instituto publica o protocolo nacional
   * e o do TRE na MESMA frase. Antes do conserto, o prefixo era opcional e a
   * sequência nua casava — então uma pesquisa estadual confirmava o V6 de um
   * registro nacional de sequência coincidente. É o pior bug do sistema entrando
   * pela porta da defesa contra ele.
   */
  it('PE-04519/2026 no documento NÃO confirma o registro BR-04519/2026', () => {
    const doc = 'A pesquisa está registrada sob o protocolo PE-04519/2026 no TRE-PE.';
    expect(documentContainsTseId(doc, 'BR-04519/2026')).toBe(false);
  });

  it('a frase do Datafolha com os DOIS protocolos confirma só o nacional', () => {
    const doc = 'Registrada no TSE sob BR-07601/2026 e no TRE-PE sob PE-04519/2026.';
    expect(documentContainsTseId(doc, 'BR-07601/2026')).toBe(true);
    expect(documentContainsTseId(doc, 'BR-04519/2026')).toBe(false);
  });

  it('sequência nua (grafia do TSE) continua confirmando', () => {
    expect(documentContainsTseId('Registro nº 06591/2026 no TSE.', 'BR-06591/2026')).toBe(true);
  });

  it('duas letras seguidas de ESPAÇO não bloqueiam a sequência nua', () => {
    expect(documentContainsTseId('Protocolo TSE 06591/2026.', 'BR-06591/2026')).toBe(true);
  });
});
