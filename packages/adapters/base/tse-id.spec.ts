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
