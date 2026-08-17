/**
 * Classificação dos RÓTULOS que o release do Paraná Pesquisas realmente usa.
 *
 * Por que não reusar `base/scenario-lines.ts` inteiro: as listas de lá não cobrem
 * a grafia desta fonte. Confrontado com as capturas REAIS de 2026-08-17
 * (`__fixtures__/`), `base/scenario-lines.categorizeLine` classificaria
 * `'Nenhum/ Branco/ Nulo'`, `'Ninguém/ Branco/ Nulo'` e `'Não sabe/ não opinou'`
 * como CANDIDATO — porque normaliza espaços mas não normaliza o espaço em volta
 * da barra, e as listas de lá têm `'branco/nulo'`/`'nao sabe'`, não estas formas.
 * O efeito seria três "candidatos" fantasmas por cenário e `UnknownCandidateError`
 * eterno. `base/` é de outro dono (não editável nesta task), então a lista da
 * fonte mora aqui, ao lado da fixture que a justifica. Continuamos usando o
 * helper ÚNICO de número (`parsePtBrPercent`, docs/04 §4.1) — a lógica numérica
 * não é replicada.
 *
 * Todos os rótulos abaixo foram COPIADOS das capturas reais; nenhum foi suposto.
 * Nenhum nome de candidato aparece neste arquivo (R2): a classificação é por
 * CATEGORIA, e tudo que não é categoria conhecida é candidato — cuja resolução
 * alias→id é do `BaseAdapter`, contra o cadastro, nunca inferida aqui.
 */

/**
 * Normalização agressiva: sem acento, minúsculo, espaço colapsado e espaço em
 * volta de `/` removido. `'Não sabe/ não opinou'` ⇒ `'nao sabe/nao opinou'`.
 */
export const normalizeLabel = (label: string): string =>
  label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Brancos/nulos. As duas primeiras formas são as REAIS: o release usa
 * `'Ninguém/ Branco/ Nulo'` na pergunta espontânea e `'Nenhum/ Branco/ Nulo'` na
 * estimulada. As demais são as variações mínimas da mesma família.
 */
const BLANK_NULL_LABELS: readonly string[] = [
  'ninguem/branco/nulo',
  'nenhum/branco/nulo',
  'ninguem/branco/nulo/nenhum',
  'branco/nulo',
  'nenhum',
  'ninguem',
];

/**
 * Indecisos / não-resposta. `'Não sabe/ não opinou'` é a forma real nas páginas
 * de gráfico; `'Não sabe/ Não opinou'` (com maiúscula) aparece nas tabelas
 * comparativas — a normalização junta as duas.
 */
const UNDECIDED_LABELS: readonly string[] = [
  'nao sabe/nao opinou',
  'nao sabe/nao respondeu',
  'nao sabe',
  'nao opinou',
  'indeciso',
  'indecisos',
];

/**
 * Agregado de "outros nomes". O release publica `'Outros nomes citados'` na
 * pergunta espontânea. NÃO é candidato e NÃO tem campo em `ParsedPoll`
 * (`packages/contracts`: um cenário só tem `values` + `blankNullPct` +
 * `undecidedPct`). Descartamos EXPLICITAMENTE, e o descarte está aqui — nomeado,
 * testado e documentado — em vez de virar um candidato fantasma em quarentena
 * permanente. Não é "ausência = zero": o valor não é atribuído a ninguém, apenas
 * fica fora do cenário. Efeito medido nas duas fixtures: a soma V1 cai de 100,1
 * para 99,1 (fev) e de 100,0 para 99,2 (mar) — dentro da faixa 97–103 (docs/04 §5).
 */
const OTHERS_LABELS: readonly string[] = ['outros nomes citados', 'outros', 'outros citados'];

/**
 * Rótulos de RECORTE demográfico. Presença de qualquer um deles numa página
 * significa que a página é um cruzamento (sexo/idade/escolaridade/região/renda),
 * NÃO o resultado canônico do cenário. Copiados das páginas 10, 11, 13 e 14 das
 * capturas reais. Ingerir um cruzamento como se fosse o cenário publicaria o
 * número de um subgrupo como se fosse o total — erro grave e silencioso.
 */
const SEGMENT_LABELS: readonly string[] = [
  'total',
  'masculino',
  'feminino',
  'pea',
  'nao pea',
  'ensino fundamental',
  'ensino medio',
  'ensino superior',
  'ate ensino medio',
  'norte + centro-oeste',
  'nordeste',
  'sudeste',
  'sul',
  'sim',
  'nao',
];

/** Prefixo de rótulo de faixa etária ('De 16 a 24 anos', '60 anos ou mais'). */
const AGE_BRACKET =
  /^(de\s+\d+\s+a\s+\d+\s+anos|entre\s+\d+\s+e\s+\d+\s+anos|\d+\s+anos\s+ou\s+mais)$/;

export type ParanaLabelKind = 'candidate' | 'blankNull' | 'undecided' | 'others' | 'segment';

/**
 * Classifica um rótulo. Ordem importa: categorias conhecidas primeiro, recorte
 * demográfico depois, e só então "candidato". Nunca devolve `null`/default.
 */
export const classifyLabel = (label: string): ParanaLabelKind => {
  const n = normalizeLabel(label);
  if (BLANK_NULL_LABELS.includes(n)) return 'blankNull';
  if (UNDECIDED_LABELS.includes(n)) return 'undecided';
  if (OTHERS_LABELS.includes(n)) return 'others';
  if (SEGMENT_LABELS.includes(n) || AGE_BRACKET.test(n)) return 'segment';
  return 'candidate';
};

/** `true` se o rótulo é recorte demográfico (usado na triagem de página). */
export const isSegmentLabel = (label: string): boolean => classifyLabel(label) === 'segment';
