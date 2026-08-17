/**
 * Fixtures PDF SINTÉTICAS do palver — leia o `README.md` deste diretório antes de
 * usá-las, e sobretudo antes de concluir qualquer coisa a partir delas.
 *
 * **Estes conjuntos de linhas não existem na fonte.** O relatório real da Palver
 * tem as páginas de resultado RASTERIZADAS: nenhum percentual está na camada de
 * texto do PDF. O que está aqui é o documento que a Palver publicaria *se* os
 * resultados tivessem texto. Serve para exercitar o parser, o V6, a quarentena de
 * alias e "ausência ≠ zero" — e **não** serve como evidência de que o adapter
 * colhe a Palver de hoje. Essa evidência é `relatorio-onda-01.textlayer.txt`
 * (REAL), e ela diz que o parser recusa (Q-09).
 *
 * Tudo que é ESTRUTURA aqui é copiado verbatim da captura real: a moldura de
 * página (`RESULTADOS` + número + banner), o sumário com a letra ANTES do título,
 * as divisórias com a letra COLADA no fim, o registro grafado `BR -06596/2026`
 * (com espaço depois do `BR`, como o PDF real devolve) e as linhas de tabela em
 * formato `<rótulo> <número>` que ficam FORA das seções de voto. Só as linhas de
 * valor dentro das seções são inventadas.
 *
 * O gerador de PDF é cópia local do de `cnt-mda/__fixtures__/make-pdf.ts`
 * (PDF 1.4 mínimo, `/WinAnsiEncoding`, bytes latin1, sem headless), de propósito:
 * depender do diretório de fixture de outro adapter acopla dois donos diferentes.
 * Ver README §4.
 */

const escapePdfText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

const byteLen = (s: string): number => Buffer.byteLength(s, 'latin1');

/** Constrói os bytes de um PDF de uma página a partir de linhas de texto. */
export const makePalverPdf = (lines: readonly string[]): Uint8Array => {
  const parts = ['BT', '/F1 11 Tf', '14 TL', '1 0 0 1 40 790 Tm'];
  lines.forEach((line, i) => {
    if (i === 0) parts.push(`(${escapePdfText(line)}) Tj`);
    else parts.push('T*', `(${escapePdfText(line)}) Tj`);
  });
  parts.push('ET');
  const content = parts.join('\n');

  const objs: string[] = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objs[3] =
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
    '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>';
  objs[4] = `<< /Length ${String(byteLen(content))} >>\nstream\n${content}\nendstream`;
  objs[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = byteLen(pdf);
    pdf += `${String(i)} 0 obj\n${objs[i] ?? ''}\nendobj\n`;
  }
  const xrefOffset = byteLen(pdf);
  pdf += `xref\n0 ${String(objs.length)}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) {
    pdf += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${String(objs.length)} /Root 1 0 R >>\nstartxref\n${String(xrefOffset)}\n%%EOF`;
  return new Uint8Array(Buffer.from(pdf, 'latin1'));
};

/** Registro real da onda 1, grafado como o PDF da Palver devolve (com espaço). */
export const PALVER_TSE_ID = 'BR-06596/2026';

/**
 * Preâmbulo VERBATIM da captura real: capa, sumário (letra ANTES do título) e as
 * páginas de metodologia/amostra, com as duas linhas em formato `<rótulo>
 * <número>` que ficam fora de seção de voto. Nada daqui deve produzir cenário nem
 * valor: é o teste negativo embutido em todo conjunto.
 */
export const PALVER_PREAMBULO_LINES: readonly string[] = [
  'PESQUISA PALVER AGOSTO/2026',
  'SUMÁRIO',
  '2',
  '05 Resultados',
  'A 1º Turno (Espontânea)',
  'B 1º Turno (Estimulada)',
  'C 2º Turno ( Estimulada)',
  'D Reconhecimento e Rejeição',
  'METODOLOGIA',
  'REGISTRO NO TSE:',
  'BR -06596/2026',
  'PERFIL AMOSTRAL',
  '16',
  '5.000 BR -06596/2026 4,31 95%',
  '1.151 26,1 4,31 Nenhum',
  'PESQUISA PALVER | AGOSTO/2026',
];

/** Moldura de uma página de resultado, verbatim da captura real. */
const moldura = (pagina: number): readonly string[] => [
  'RESULTADOS',
  String(pagina),
  'PESQUISA PALVER | AGOSTO/2026',
];

/**
 * Onda completa e bem-comportada: as três seções de voto rendem valores, e depois
 * vem a seção de REJEIÇÃO com percentuais por candidato que **não** podem entrar
 * no agregado. "Ciro Gomes" só aparece no 1º turno estimulado, exercitando
 * "ausência ≠ zero".
 */
export const PALVER_ONDA_LINES: readonly string[] = [
  ...PALVER_PREAMBULO_LINES,
  '1º Turno (Espontânea)A',
  ...moldura(19),
  'Lula 31,0',
  'Flávio Bolsonaro 27,0',
  'Branco/Nulo 9,0',
  'Não sabe 33,0',
  '1º Turno (Estimulada)B',
  ...moldura(22),
  'Lula 44,0',
  'Flávio Bolsonaro 40,0',
  'Ciro Gomes 5,0',
  'Branco/Nulo 7,0',
  'Não sabe 4,0',
  '2º Turno (Estimulada)C',
  ...moldura(27),
  'Lula 46,0',
  'Flávio Bolsonaro 46,0',
  'Branco/Nulo 5,0',
  'Não sabe 3,0',
  // Divisória de seção que NÃO é intenção de voto, quebrada em duas linhas como
  // no PDF real. Fecha o 2º turno; os percentuais abaixo são REJEIÇÃO e têm de
  // ficar fora do agregado.
  'Reconhecimento e',
  'RejeiçãoD',
  ...moldura(40),
  'Lula 52,0',
  'Flávio Bolsonaro 48,0',
  'Ciro Gomes 39,0',
];

/**
 * Seção de 1º turno estimulado sem linha de branco/nulo nem de não-sabe: prova que
 * grandeza ausente vira `undefined`, nunca `0` (R4).
 */
export const PALVER_SEM_AGREGADOS_LINES: readonly string[] = [
  ...PALVER_PREAMBULO_LINES,
  '1º Turno (Estimulada)B',
  ...moldura(22),
  'Lula 44,0',
  'Flávio Bolsonaro 40,0',
];

/** Outro `tse_id` no texto: prova V6 (o parser recusa a rodada errada). */
export const PALVER_WRONG_TSE_LINES: readonly string[] = [
  'PESQUISA PALVER AGOSTO/2026',
  'REGISTRO NO TSE:',
  'BR -07777/2026',
  '1º Turno (Estimulada)B',
  ...moldura(22),
  'Lula 44,0',
  'Flávio Bolsonaro 40,0',
];

/** Alias não cadastrado: prova `UnknownCandidateError` (quarentena manual). */
export const PALVER_UNKNOWN_LINES: readonly string[] = [
  ...PALVER_PREAMBULO_LINES,
  '1º Turno (Estimulada)B',
  ...moldura(22),
  'Lula 44,0',
  'Candidato Fantasma 4,2',
];

/**
 * Seção de 2º turno com QUATRO candidatos — o formato do relatório real, que
 * publica vários pareamentos na mesma seção sem delimitador na camada de texto. O
 * parser tem de RECUSAR em vez de adivinhar onde um par termina.
 */
export const PALVER_T2_MULTI_PAIR_LINES: readonly string[] = [
  ...PALVER_PREAMBULO_LINES,
  '2º Turno (Estimulada)C',
  ...moldura(27),
  'Lula 46,0',
  'Flávio Bolsonaro 46,0',
  ...moldura(28),
  'Lula 48,0',
  'Tarcísio 42,0',
];

/**
 * Documento da Palver sem nenhuma seção de intenção de voto (só rejeição e
 * aprovação): estrutura mudou, ou não é o relatório da rodada. Tem de LANÇAR, não
 * devolver vazio.
 */
export const PALVER_NO_SECTION_LINES: readonly string[] = [
  ...PALVER_PREAMBULO_LINES,
  'Reconhecimento e',
  'RejeiçãoD',
  ...moldura(40),
  'Lula 52,0',
  'Flávio Bolsonaro 48,0',
];
