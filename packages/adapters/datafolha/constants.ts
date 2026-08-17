/**
 * Constantes da fonte REAL do Datafolha, capturadas ao vivo em 2026-08-17 (URLs,
 * hashes SHA-256 e comando de recaptura em `__fixtures__/README.md`).
 *
 * Ficam aqui, e não em `packages/contracts/src/constants.ts`, porque descrevem UMA
 * fonte externa (host, caminho, seletor de HTML, marcadores de frase) e não
 * contrato compartilhado — mexer em contracts invalidaria o trabalho de outros
 * agentes (CLAUDE.md). Cada valor traz a origem no comentário.
 *
 * Contexto que justifica cada escolha (ver relatório da T-20):
 * - O Datafolha TEM publicação própria (nível 2 de docs/04 §1). Não precisamos de
 *   imprensa (nível 4): `datafolha.folha.uol.com.br/eleicoes/<ano>/<mes>/<slug>.shtml`
 *   traz a rodada inteira, sem paywall, e traz o registro TSE no corpo.
 * - O "RELATÓRIO COMPLETO" (o único material com tabelas) mora em outro host, cujo
 *   `robots.txt` proíbe TODO agente. Por docs/04 §6 ele está fora de alcance.
 */

export const DATAFOLHA_ADAPTER_ID = 'datafolha';
export const DATAFOLHA_INSTITUTE_ID = 'datafolha';

/** Site do PRÓPRIO instituto (docs/04 §1, nível 2), o mesmo de `seed-data.ts`. */
export const DATAFOLHA_ORIGIN = 'https://datafolha.folha.uol.com.br';

/** Índice da seção de eleições. Verificado: HTTP 200, lista de rodadas navegável. */
export const DATAFOLHA_ELECTIONS_INDEX = `${DATAFOLHA_ORIGIN}/eleicoes/`;

/**
 * Índice do ano. As rodadas ficam em `/eleicoes/<ano>/<mes>/<slug>.shtml`, e
 * `/eleicoes/<ano>/` lista as do ano — é por onde o harvest acha a rodada nova.
 */
export const datafolhaYearIndex = (year: number): string =>
  `${DATAFOLHA_ORIGIN}/eleicoes/${String(year)}/`;

/**
 * Host do PDF "RELATÓRIO COMPLETO" linkado em toda publicação. O `robots.txt`
 * desse host é `User-agent: * / Disallow: /` (captura real em
 * `__fixtures__/robots-media-folha.txt`). docs/04 §6 é não-negociável: nunca
 * buscamos daqui. O `HttpClient` compartilhado recusaria de qualquer forma
 * (`RobotsDisallowedError`) — a constante existe para a decisão ficar explícita e
 * testável, não para ser usada como URL.
 */
export const DATAFOLHA_REPORT_HOST_DISALLOWED = 'media.folha.uol.com.br';

/**
 * Corpo da publicação. Verificado idêntico nas 6 páginas capturadas
 * (`<div class="c-news__body" data-news-content-text itemprop="articleBody">`).
 * Usamos o `itemprop` (schema.org) e não a classe do tema, que é volátil.
 *
 * Restringir o texto ao corpo também FORTALECE o V6: o registro TSE precisa estar
 * na própria publicação, não num teaser de "veja também" no rodapé da página.
 */
export const ARTICLE_BODY_SELECTOR = '[itemprop="articleBody"]';

/**
 * Marcadores de parágrafo, todos colhidos das capturas reais. O Datafolha não
 * publica tabela nem `data-*`: o número vive em prosa editorial, e o único
 * ancoradouro é a frase que abre o parágrafo.
 *
 * Regra de leitura do parser (ver `parse.ts`): parágrafo sem ÂNCORA é ignorado;
 * parágrafo com âncora tem de ter TODO percentual atribuível, senão LANÇA (R4).
 * Assim, mudança de redação produz falha alta ("nenhum cenário" ou "percentual não
 * atribuível") e nunca um número atribuído ao candidato errado.
 */
export const SCENARIO_ANCHORS = {
  /** 2º turno. Checado ANTES do 1º turno: o parágrafo às vezes diz "cenário" também. */
  t2: ['segundo turno', '2o turno', 'se enfrentam', 'diante de'],
  /** 1º turno espontâneo ("pesquisa espontânea", "pergunta espontânea"). */
  t1Espontaneo: ['espontane'],
  /** 1º turno estimulado: o parágrafo que abre o cenário testado. */
  t1Estimulado: ['cenario'],
} as const;

/**
 * Parágrafos que NUNCA são fonte de intenção de voto, mesmo contendo âncora e
 * percentuais. Sem esta lista, o cruzamento por segmento ("entre mulheres, 52% a
 * 37%") e a série de REJEIÇÃO ("não votariam de jeito nenhum") entrariam como
 * cenário — o pior erro possível, porque rejeição usa a MESMA forma de superfície
 * (`Nome (48%)`) que a intenção de voto.
 */
export const EXCLUDED_PARAGRAPH_MARKERS = [
  // Série de rejeição (é outra pergunta; não é intenção de voto).
  'rejeit',
  'nao votariam de jeito nenhum',
  // Cruzamentos por segmento (sexo, renda, escolaridade, religiao, regiao...).
  'analise por segmentos',
  'por sua vez',
  'vantagem mais ampla',
  'fica a frente',
  'mais alta entre',
  'mais altas entre',
  'mais baixa entre',
  'mais baixas entre',
  'no grupo de eleitores',
  'no segmento de',
  'essa taxa',
  'esse indice',
  'entre os que',
  'entre homens',
  'entre as mulheres',
  'entre mulheres',
  // Comparação com rodada anterior (parágrafo inteiro sobre o passado).
  'na pesquisa anterior',
  'no levantamento anterior',
  'o levantamento da',
  'em levantamento realizado',
  // Ficha técnica (amostra, margem, registro TSE).
  'a pesquisa esta registrada',
  'margem de erro',
  // Outras perguntas do questionário que citam "2º turno" e não são cenário de
  // intenção de voto (ex.: arrependimento sobre o 2º turno de 2022).
  'arrepend',
] as const;

/**
 * Palavras que marcam um parêntese de COMPARAÇÃO — o número lá dentro é de outra
 * rodada, não desta ("(tinha 2%)", "(eram 4%)", "(mesmo índice anterior)").
 * Confundir isso é publicar a rodada passada como se fosse a atual.
 */
export const COMPARISON_MARKERS = [
  'tinha',
  'tinham',
  'era',
  'eram',
  'mesmo indice',
  'mesmo resultado',
  'anterior',
  'nao participou',
  'crescimento',
  'cresceu',
  'caiu',
] as const;

/**
 * Conectores que ligam um NOME ao percentual dele, na redação do Datafolha.
 * Usados nos dois sentidos: `Nome, com 30%` e `ante 42% de Nome`.
 */
export const VALUE_CONNECTORS = [
  'com',
  // "e Flávio Bolsonaro, por 17%" — na enumeração o Datafolha troca `com` por `por`.
  'por',
  'tem',
  'teria',
  'lidera com',
  'aparece com',
  'aparece a',
  'e citado por',
  'soma',
  'somam',
] as const;

/**
 * Janela (em caracteres) entre o percentual e a expressão de brancos/nulos ou
 * indecisos dentro da MESMA oração. 45 vem da frase mais longa observada nas
 * capturas ("Há 11% que optariam pelo voto em branco ou nulo" = 37 caracteres
 * entre o número e a expressão); 45 dá margem sem atravessar a oração seguinte.
 */
export const CUE_WINDOW_CHARS = 45;

/**
 * Janela ANTES de um parêntese com número, para reconhecer comparação cujo
 * marcador ficou fora do parêntese ("…em patamar similar ao levantamento anterior
 * (37%)"). 60 vem da maior oração desse tipo observada (45 caracteres) com margem;
 * a janela nunca atravessa `.`, `)` nem outro `%`, então não colhe marcador de
 * outra oração — o que impediria confundir o valor ATUAL de um candidato com o da
 * rodada passada.
 */
export const COMPARISON_LOOKBEHIND_CHARS = 60;

/**
 * Verbos da declaração de "abaixo do limiar" ("outros que NÃO ATINGIRAM 1%",
 * "Renan Hallais foi citado, mas NÃO ALCANÇOU 1% das menções"). O número ali é um
 * LIMIAR, não o valor de ninguém: os candidatos citados assim simplesmente não
 * entram no cenário (ausência ≠ zero, docs/04 §4.1). Reconhecer a frase evita
 * recusar o documento por um número que a própria fonte declara não atribuído.
 */
export const BELOW_THRESHOLD_VERBS = [
  'atingiram',
  'atingiu',
  'alcancaram',
  'alcancou',
  'pontuaram',
  'pontuou',
  'chegaram a',
  'chegou a',
] as const;

/** Tokens que a fonte usaria para um valor ILEGÍVEL/suprimido. Nunca viram 0 (R4). */
export const ILLEGIBLE_VALUE_TOKENS = ['-', '--', '—', 'xx', 'nd', 'n/d', 'n/a', '*'] as const;
