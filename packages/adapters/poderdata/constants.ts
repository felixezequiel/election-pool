/**
 * Constantes do adapter PoderData. Ficam AQUI (e não em
 * `packages/contracts/constants.ts`) porque descrevem a FONTE, não o modelo: são
 * URLs, rótulos que o instituto imprime no relatório e uma tolerância derivada de
 * uma inconsistência observada no PDF real. Nada disto é parâmetro metodológico.
 * Toda constante abaixo tem a origem escrita — nenhum número mágico (CLAUDE.md).
 *
 * ---------------------------------------------------------------------------
 * POR QUE O PDF E NÃO O HTML — a distinção "divulgação" x "matéria"
 * ---------------------------------------------------------------------------
 * O PoderData é o instituto do Poder360, então o mesmo domínio hospeda as duas
 * coisas. A separação que aplicamos, verificada nas páginas reais em 2026-08-17:
 *
 * - `poder360.com.br/poderdata/<slug>` é POST DE WORDPRESS: tem `<h1>`,
 *   `article:published_time`, assinatura de repórter (`/author/...`) e parágrafos
 *   de análise/contexto político. É MATÉRIA. Mesmo a página "Leia os resultados
 *   da pesquisa PoderData/Aya para presidente", que é a mais sóbria do conjunto,
 *   tem autoria e prosa. Não extraímos NENHUM número de HTML do Poder360.
 * - `static.poder360.com.br/.../Relatorio-PoderData-Eleitoral-*.pdf` é o
 *   RELATÓRIO TÉCNICO assinado por "PoderData Pesquisas, Jornalismo e
 *   Comunicação LTDA", com "Ficha técnica", "Registro TSE" e as tabelas de
 *   resultado. É a divulgação do PRÓPRIO INSTITUTO — nível 2 da hierarquia de
 *   docs/04 §1 ("Site do próprio instituto"), não o nível 4 (imprensa).
 *
 * Consequência operacional (docs/08 §2.1: "Referência à fonte é sempre link,
 * nunca conteúdo"): o HTML é usado APENAS como índice de URLs de PDF. Nenhum
 * texto, título ou trecho do post entra no nosso dado. Isso também é o que mantém
 * a proibição de "scraping de portal de notícia" (CLAUDE.md) satisfeita: não
 * lemos a matéria, lemos o release do instituto.
 */

export const PODERDATA_ADAPTER_ID = 'poderdata';
export const PODERDATA_INSTITUTE_ID = 'poderdata';

/**
 * Índices (apenas LINKS) onde as URLs dos relatórios em PDF são listadas, na
 * ordem em que tentamos. Verificados em 2026-08-17:
 *
 * 1. Página da série presidencial 2026 — lista os PDFs do mais novo para o mais
 *    antigo (4 rodadas na data da captura).
 * 2. Página institucional do PoderData — lista os relatórios de todas as 96
 *    rodadas nacionais desde 2020, do mais antigo para o mais novo. Serve de
 *    reserva se o slug da página da série mudar (é um post, logo volátil).
 *
 * Nenhuma das duas é lida como CONTEÚDO: só extraímos `href` de PDF.
 */
export const PODERDATA_DISCLOSURE_INDEX_URLS = [
  'https://www.poder360.com.br/poderdata/leia-os-resultados-da-pesquisa-poderdata-aya-para-presidente/',
  'https://www.poder360.com.br/poderdata-institucional/',
] as const;

/**
 * Nome de arquivo dos relatórios ELEITORAIS. A página institucional também
 * hospeda relatórios não-eleitorais (ex.: `relatorio-poderdata-93-1jun2026.pptx.pdf`),
 * que não têm cenário de intenção de voto — o filtro pelo infixo "Eleitoral"
 * evita baixá-los. Observado nos 4 relatórios reais de 2026.
 */
export const PODERDATA_REPORT_URL_PATTERN = /relatorio-poderdata-eleitoral[^"'\s]*\.pdf$/i;

/**
 * Rodapé impresso em TODA página de conteúdo do relatório, logo antes do título
 * da seção. É o nosso delimitador de página no texto extraído do PDF (o `unpdf`
 * concatena as páginas e perde a fronteira; esta linha a devolve). Observado nas
 * 4 rodadas reais.
 */
export const PAGE_FOOTER_ANCHOR = 'www.poder360.com.br/poderdata';

/**
 * Títulos de seção que carregam intenção de voto. É uma ALLOWLIST deliberada: o
 * relatório tem muitas outras seções com percentuais (`Perfil da amostra`,
 * `2ª alternativa – eleitores de Lula`, `Motivo de voto`, `Potencial de voto`,
 * `Avaliação do presidente Lula`, `Aprovação do governo`, temas do mês) e
 * nenhuma delas é intenção de voto. Uma denylist deixaria uma seção nova entrar
 * silenciosamente como se fosse cenário — exatamente o que R4 proíbe.
 *
 * Não existe seção de voto ESPONTÂNEO nas 4 rodadas reais: a pesquisa é IVR com
 * lista lida ao entrevistado. `t1_espontaneo` fica legitimamente AUSENTE (e
 * ausência não é zero).
 */
export const SECTION_TITLE_T1 = 'Intenção de voto no 1º turno';
export const SECTION_TITLE_T2 = 'Intenção de voto no 2º turno';

/**
 * Mínimo de colunas de percentual numa linha de cruzamento para que a ÚLTIMA
 * possa ser lida como "Total". Com 1 coluna não há como distinguir recorte de
 * total, e chutar seria o erro que R4 proíbe. Os cruzamentos reais têm de 3
 * (Sexo: Masculino/Feminino/Total) a 9 (Religião) colunas.
 */
export const MIN_CROSSTAB_COLUMNS = 2;

/**
 * Máximo de caracteres de um RÓTULO — de categoria de gráfico ou de linha de
 * tabela. Serve para separar rótulo de PROSA quando os dois aparecem como linhas
 * de texto puro no mesmo lugar do documento (é o caso do gráfico de barras, onde o
 * enunciado da pergunta fica logo acima dos valores).
 *
 * Origem: nas 4 rodadas reais o rótulo mais longo é `Rejeição aos outros
 * candidatos` (30 caracteres) e, nos gráficos de intenção de voto, `Flávio
 * Bolsonaro` (16). Já o enunciado mais CURTO é `dos candidatos que vou falar em
 * ordem alfabética você votaria?` (61). 40 fica com folga dos dois lados.
 */
export const MAX_CHART_LABEL_CHARS = 40;

/**
 * Tolerância, em pontos percentuais, entre duas apresentações do MESMO marginal
 * dentro do mesmo relatório. Vale nos dois lugares onde a fonte se repete:
 * cruzamento contra cruzamento, e gráfico contra cruzamento.
 *
 * Origem do 1 — medida nas 4 rodadas reais (7 cruzamentos × ~9 rótulos × 4
 * relatórios, ~250 células). Divergências encontradas: DUAS, ambas de 1 p.p. e
 * ambas no relatório `BR-05722/2026` (campo 21–24/jun/2026), no mesmo rótulo:
 *
 * - o cruzamento "Aprovação de Lula" traz `Joaquim Barbosa ... 3%` enquanto os
 *   outros seis cruzamentos trazem `2%`;
 * - o rótulo do gráfico da seção traz `3`, também contra os `2%` dos seis.
 *
 * Nos outros três relatórios a concordância é total. A causa é declarada pelo
 * próprio relatório ("os resultados da pesquisa foram arredondados... é possível
 * que o somatório seja diferente de 100"): o instituto arredonda cada
 * apresentação de forma independente.
 *
 * O 1 é, portanto, a discrepância de arredondamento OBSERVADA na fonte — não uma
 * folga para acomodar erro de parser. Acima de 1 p.p. concluímos que a leitura
 * desalinhou e LANÇAMOS.
 */
export const ROUNDING_TOLERANCE_PP = 1;

/**
 * Abreviações de mês aceitas nas legendas de onda do gráfico. O relatório real
 * mistura pt-BR (`mai/26`, `29/jul`) e inglês (`29-Jul`, `29-May` — vêm do eixo
 * de um gráfico do Excel em locale inglês, visto no relatório `BR-07845/2026`).
 * Não há colisão entre as duas grafias, então um mapa único resolve.
 */
export const MONTH_ABBREVIATIONS: ReadonlyMap<string, number> = new Map([
  ['jan', 1],
  ['fev', 2],
  ['feb', 2],
  ['mar', 3],
  ['abr', 4],
  ['apr', 4],
  ['mai', 5],
  ['may', 5],
  ['jun', 6],
  ['jul', 7],
  ['ago', 8],
  ['aug', 8],
  ['set', 9],
  ['sep', 9],
  ['out', 10],
  ['oct', 10],
  ['nov', 11],
  ['dez', 12],
  ['dec', 12],
]);
