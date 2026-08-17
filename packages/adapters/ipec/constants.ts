/**
 * Constantes do adapter Ipec. TODAS têm origem documentada, e a origem é sempre
 * uma CAPTURA REAL da fonte — não uma suposição sobre como o Ipec "deve"
 * publicar. Essa disciplina é a lição da Q-09 (`docs/OPEN-QUESTIONS.md`): um
 * adapter escrito contra estrutura suposta passa nos testes e traz zero dado.
 *
 * Nota de processo: o "Definition of done" do `CLAUDE.md` manda constantes para
 * `packages/contracts/constants.ts`. Esse pacote está CONGELADO para esta task
 * (mexer nele invalidaria o trabalho de sete agentes irmãos), então as
 * constantes específicas da fonte moram aqui, no diretório do adapter — que é
 * também onde elas pertencem conceitualmente: são fatos sobre o Ipec, não
 * parâmetros do modelo. Registrado no relatório da task.
 */

/** Id do adapter no `AdapterRegistry` (dono: orquestrador). */
export const IPEC_ADAPTER_ID = 'ipec';

/**
 * Id do instituto no seed (`apps/api/src/db/seed-data.ts` linha 38, `id: 'ipec'`).
 * Precisa casar exatamente, senão `canHandle` nunca casa e o adapter fica órfão.
 */
export const IPEC_INSTITUTE_ID = 'ipec';

/**
 * Domínio real do Ipec, verificado em 2026-08-17.
 *
 * ATENÇÃO — o seed (`seed-data.ts` linha 43) traz `https://www.ipec.com.br`, que
 * NÃO RESOLVE (DNS `ENOTFOUND`, tanto em `ipec.com.br` quanto em
 * `www.ipec.com.br`). O domínio verdadeiro do instituto é
 * `ipec-inteligencia.com.br` (razão social "Inteligência em Pesquisa e
 * Consultoria Estratégica"). O seed é de outro dono; a divergência está no
 * relatório da task para correção por quem o mantém.
 */
export const IPEC_SITE_URL = 'https://www.ipec-inteligencia.com.br';

/**
 * Página de divulgação de pesquisas (nível 2 da hierarquia, docs/04 §1: site do
 * próprio instituto). Verificada como rota existente do site — é uma SPA
 * AngularJS, então a página em si não traz os dados: ela chama a API abaixo.
 */
export const IPEC_PESQUISAS_URL = `${IPEC_SITE_URL}/pesquisas/`;

/**
 * Índice de publicações em JSON. Descoberto lendo o JS real do site (não é
 * suposição): `dist/js/app/app.js` define
 * `baseUrlApi = "https://ipec-inteligencia.com.br/api"` e
 * `dist/js/service/pesquisa-service.js` define
 * `ListPesquisa = $http.get(baseUrlApi + '/api/arquivo/ListAtivos/', {params:{pageNumber, idArquivo, nome}})`.
 * A resposta tem a forma `{ Retorno: [...], Total, TotalPaginas }` (lida em
 * `dist/js/controller/pesquisa-controller.js`).
 *
 * NÃO modelamos essa resposta em Zod ainda: nunca conseguimos uma resposta real
 * (ver `IPEC_ACCESS_NOTE`), e schema contra corpo suposto é exatamente o erro da
 * Q-09. Fica como URL candidata para o HarvestJob, nada mais.
 */
export const IPEC_LIST_API_URL = 'https://ipec-inteligencia.com.br/api/arquivo/ListAtivos/';

/**
 * Onde os PDFs de release moram, verificado em capturas reais:
 * `/Repository/Files/<id>/<nome>.pdf`
 * (ex.: `/Repository/Files/1090/221426-2_ELEIÇÕES_2022_BR - release_v1.pdf`).
 */
export const IPEC_REPOSITORY_PREFIX = `${IPEC_SITE_URL}/Repository/Files/`;

/**
 * Estado de acesso à fonte, verificado em 2026-08-17. Fica em constante porque o
 * `discover` a usa como `reason` — quem ler o candidato precisa saber que a
 * coleta live está bloqueada, e por quê.
 *
 * O host inteiro (site, `/robots.txt` e a API) responde **HTTP 403 com
 * `Cf-Mitigated: challenge`** — desafio gerenciado do Cloudflare, que exige
 * executar JavaScript para ser resolvido. A v1 não usa headless browser
 * (`CLAUDE.md` "o que não fazer"; docs/04 §6), logo NÃO existe caminho educado
 * de coleta live hoje. Não é bloqueio do nosso User-Agent: a única captura de
 * 2026 do Internet Archive para o domínio também é 403, isto é, o rastreador do
 * archive.org tampouco entra.
 *
 * Consequência operacional (docs/04 §6): duas respostas 403 desabilitam a fonte
 * automaticamente e geram alerta. Isso é o comportamento CORRETO aqui — não
 * insistimos.
 */
export const IPEC_ACCESS_NOTE =
  'Host responde 403 (Cloudflare managed challenge) a cliente sem JavaScript; ' +
  'sem headless na v1, a coleta live está bloqueada (docs/04 §6: não insistir)';

/**
 * Títulos de tabela que o parser reconhece, extraídos LITERALMENTE das capturas
 * reais. Só o que foi visto entra aqui.
 *
 * - "Simulações de Segundo Turno" — tabela de 2º turno (release nacional
 *   `BR-01979/2022`).
 * - "Intenção de voto espontânea" — tabela de voto espontâneo (aparece nos dois
 *   releases capturados; num deles o título vem TRUNCADO, sem o parêntese de
 *   fechamento, por isso o casamento é por PREFIXO/substring e nunca exato).
 *
 * NÃO existe entrada para o 1º turno ESTIMULADO: nos releases reais esse número
 * — que é justamente o principal do agregador — é publicado como GRÁFICO e não
 * deixa nenhum texto extraível. Ver `IPEC_ESTIMULADO_NOTE`.
 */
export const IPEC_TABLE_TITLE_T2 = 'simulacoes de segundo turno';
export const IPEC_TABLE_TITLE_T2_SINGULAR = 'simulacao de segundo turno';
export const IPEC_TABLE_TITLE_ESPONTANEA = 'intencao de voto espontanea';

/**
 * Por que não há extração de 1º turno estimulado. Verificado nas duas capturas:
 * a linha "Pergunta: Se a eleição para Presidente da República fosse hoje e os
 * candidatos fossem estes ... (Estimulada - %)" é seguida IMEDIATAMENTE por
 * "DESTAQUES POR SEGMENTOS" — o gráfico entre as duas não contribui um único
 * caractere para a camada de texto do PDF (confirmado extraindo página por
 * página com o mesmo `unpdf` que o adapter usa).
 *
 * Os números do estimulado existem só na PROSA do release ("na liderança com os
 * mesmos 44%", "citado por 32% dos eleitores"). NÃO os extraímos: a mesma prosa
 * está cheia de percentuais de SEGMENTO ("73% entre quem avalia como ruim",
 * "54% com renda de até 1 salário mínimo") e de faixas de margem de erro ("pode
 * ter entre 42% e 46%"). Um regex sobre prosa produziria topline errado com
 * aparência de acerto — o oposto de R4. Preferimos não ter o dado a ter o dado
 * errado.
 */
export const IPEC_ESTIMULADO_NOTE =
  '1º turno estimulado é publicado como gráfico (sem camada de texto) nos releases do Ipec; ' +
  'não extraímos da prosa para não inventar topline (R4)';

/**
 * Rótulos de linha que NÃO são candidato, na grafia REAL do Ipec.
 *
 * Necessários porque as listas compartilhadas de `base/scenario-lines.ts` não
 * cobrem a grafia do Ipec: lá existem 'branco/nulo', 'branco e nulo', 'nulo',
 * 'nao sabe', 'nao sabe/nao respondeu' — mas o Ipec escreve **"Branco ou nulo"**
 * e **"Não sabem ou preferem não opinar"**. Sem estes rótulos, os dois viriam
 * classificados como CANDIDATO e o adapter jogaria toda pesquisa do Ipec em
 * quarentena com `UnknownCandidateError`. (Não alteramos `base/` — é de outro
 * dono; o parser do Ipec classifica primeiro e delega o resto ao helper comum.)
 */
export const IPEC_BLANK_NULL_LABELS: readonly string[] = ['branco ou nulo'];
export const IPEC_UNDECIDED_LABELS: readonly string[] = ['nao sabem ou preferem nao opinar'];

/**
 * Rótulos agregadores: são dado publicado, mas não são candidato NEM
 * brancos/nulos NEM indecisos, e o `ParsedPoll` (docs/04 §4) não tem campo para
 * eles. Excluí-los é decisão DECLARADA, não default silencioso: se entrassem
 * como candidato, todo release do Ipec cairia em quarentena; se virassem
 * brancos/nulos, estaríamos inventando semântica.
 *
 * "Outros" vale 0% nas duas capturas reais, e a janela do V1 (97–103, docs/04
 * §5) absorve a diferença quando não valer. Lacuna de contrato registrada no
 * relatório da task.
 */
export const IPEC_AGGREGATE_LABELS: readonly string[] = ['outros'];

/**
 * Palavras de cargo, para escopar a extração ao cargo certo. Um release estadual
 * do Ipec traz governador E presidente no MESMO documento (verificado em
 * `BR-08161/2022`, release do Amazonas: seção
 * "OUTRAS INFORMAÇÕES DA PESQUISA PARA GOVERNADOR" seguida de
 * "INTENÇÃO DE VOTO PARA PRESIDENTE"). Sem escopo de cargo, o adapter
 * misturaria intenção de voto para governador com a de presidente — números da
 * disputa errada, que é a mesma classe de erro que o V6 existe para impedir.
 */
export const IPEC_CARGO_PRESIDENTE = 'presidente';
export const IPEC_CARGO_OUTROS: readonly string[] = [
  'governador',
  'senador',
  'prefeito',
  'deputado',
  'vereador',
];
