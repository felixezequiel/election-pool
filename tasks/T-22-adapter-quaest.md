---
id: T-22
title: Adapter de colheita da Genial/Quaest (quaest.com.br)
status: done # com uma ressalva grande sobre fragilidade — ver "Veredito"
depends_on: [T-01, T-06]
owns: [packages/adapters/quaest/**]
spec: docs/04-INGESTION-SPEC.md §1/§3/§4/§5/§6, docs/08-LEGAL-ETHICS.md §2, docs/OPEN-QUESTIONS.md Q-09
---

# T-22 — Adapter Quaest

`docs/04` §3 lista `quaest` como a fonte 3 e a descreve como "Site Quaest / Genial
— HTML + PDF". Investigada ao vivo em **2026-08-17**, a descrição se confirma pela
metade: o PDF existe e é inútil; o HTML existe e é prosa.

A ordem da task foi invertida em relação ao que produziu a **Q-09**: investigar a
fonte primeiro, congelar a captura, escrever o parser depois. Nada aqui foi escrito
contra estrutura suposta.

## O que a fonte publica, e onde

`genial-quaest.com.br` **não existe** (domínio sem registro em DNS). O site da
Genial Investimentos não respondeu; a landing page do contratante
(`lp.genialinvestimentos.com.br/pesquisas-genial-quaest/`, nível 3 de `docs/04`
§1) espelha os MESMOS PDFs, sem acrescentar dado nem registro TSE. Logo, a fonte
de primeira mão é `quaest.com.br` — WordPress, nível 2.

| Superfície | Percentual? | Registro TSE? |
|---|---|---|
| PDF de rodada (anexo de `/relatorios/<slug>/`) | **Não** — gráficos 100% rasterizados | **Não** |
| Post de blog do instituto (`quaest.com.br/<slug>/`) | Sim, **em prosa** | **Sim**, no parágrafo "Metodologia" |
| Índices HTML (`/relatorios/`, `/relatorios-quaest/`, `/blog/`) | Vazios no HTML (JetEngine monta por JS) | — |

`robots.txt` proíbe só `/wp-admin/` (exceto `admin-ajax.php`). Descoberta vai pelo
WP REST (`/wp-json/wp/v2/…`), que é JSON estático — nenhum headless browser
(CLAUDE.md).

## `discover` faz rede — o único do projeto, e por quê

Na primeira versão o `discover` devolvia as URLs INTERMEDIÁRIAS da caminhada
(sitemap, `wp-json`) como `SourceCandidate`. Está errado: o `HarvestJob` trata cada
candidata como um DOCUMENTO a buscar, salvar em `raw_documents` e mandar ao
`parse` — ele não segue cadeia. O sintoma no job real foi
`parse_error … content-type inesperado ("text/xml…") em …/post-sitemap.xml`.

Corrigido: `discover` devolve só URL de **post final**. Não foi possível derivá-la
sem rede, como faz o `nexus`, porque **o slug do post é um título editorial** —
`…/recuperacao-de-flavio-bolsonaro/`, `…/saldo-de-aprovacao-de-lula/`,
`…/lula-abre-vantagem-sobre-flavio-bolsonaro/`. Não há data, número de rodada nem
qualquer campo do `PollRegistration` no slug; derivá-lo seria adivinhar URL, que é
a versão de rede do erro da Q-09 (requisições que só dão 404 e cobertura zero).

O que É derivável é a **janela**: o post sai poucos dias depois do fim do campo (2
dias nas duas capturas). Então a caminhada é **uma** requisição ao WP REST com
`after`/`before` em torno de `reg.fieldEnd`, e devolvemos as URLs dos posts dessa
janela. Quem separa o post certo do vizinho é o **V6** — é para isso que ele
existe. Janela vazia ⇒ `[]` ("ainda não divulgou" é fato). Requisição que falha ⇒
**lança** (devolver `[]` aí seria o zero silencioso da Q-09). O `HttpClient` é o
SINGLETON do processo (robots + 1 req/10 s por host), injetável para teste.

Medido ao vivo para a rodada de agosto (campo 31/07–03/08 ⇒ janela
`after=2026-08-02`, `before=2026-08-17`): **2 candidatas**, ambas URL de post, uma
delas a certa.

## Veredito

**O PDF de rodada — a divulgação canônica — é imprestável para extração.** Medido
no relatório de 14/08/2026 (197 páginas, 52,9 MB): a camada de texto inteira tem
**1 caractere `%`**, **0 números pt-BR** e **0 ocorrências de registro TSE**. Só
títulos e enunciados de pergunta são texto; todo gráfico é imagem. As páginas 1–5,
onde a ficha técnica e o registro apareceriam, têm `textItems: 0` — imagem inteira.
Confirmado em **4 PDFs de 2 hosts entre jan/2025 e ago/2026**: não é regressão, é o
formato do instituto. Sem OCR (que a v1 não tem), o V6 recusa o PDF corretamente.

**O número de registro no TSE EXISTE — no post de blog.** "…encontra-se registrado
no Tribunal Superior Eleitoral (TSE) sob o protocolo BR-06591/2026." É a única
superfície que traz o registro **e** os percentuais em texto, e é fonte primária
(site do próprio instituto). Por isso o adapter funciona.

**A ressalva:** o post é redação editorial e a redação muda a cada rodada. As duas
capturas congeladas provam: o post de 2026-08-05 é lido inteiro; o de 2026-07-15 é
recusado nos três cenários, porque lá o nome vem depois do percentual ("frente a
28% de Flávio Bolsonaro") e a decomposição publicada é incompleta (2º turno soma
82 — o instituto não publicou o resíduo). **Cobertura, portanto, é parcial por
construção: rodada sem post de blog, ou com redação diferente, não entra.** A
recusa é alta e explicada; nenhuma rodada entra pela metade.

## As quatro guardas do parser

O risco central não é falhar — é acertar o parágrafo errado. O mesmo post mistura,
nas mesmas construções de frase: número nacional desta rodada, número da rodada
ANTERIOR, número de SUBGRUPO e números de OUTRAS perguntas. Um erro desses **o V6
não pega**, porque o `tse_id` correto está no mesmo documento. Daí:

- **G1 — escopo de parágrafo.** Só o bloco ancorado pela frase de abertura daquele
  cenário é lido. Percentual de outro parágrafo nunca entra.
- **G2 — colapso de tendência.** "de A% … para B%" → B, antes de qualquer leitura.
  Sem isso, "de 28% em julho para 30% em agosto" entregaria 28: o número da rodada
  passada sob o `tse_id` desta.
- **G3 — rótulo estrito por janela de oração.** O dono do número tem de ser nome
  próprio dentro da oração que fecha no `%`. Percentual sem dono, ou marcador de
  subgrupo/outra pergunta na janela ⇒ cenário RECUSADO (não "pulado").
- **G4 — aritmética.** Soma em [V1_SUM_MIN, V1_SUM_MAX] e contagem conforme V3/V7.
  Leitura errada quase sempre estoura a soma.

Mais: duas leituras válidas para o mesmo `kind` ⇒ ambiguidade ⇒ lança. Cenário
anunciado no post mas não extraível ⇒ lança (nunca some em silêncio). Cenário não
anunciado ⇒ ausente, e ausência **não** é zero.

## O que ficou entregue

```
packages/adapters/quaest/
  constants.ts                 âncoras, guardas, janela e URLs — cada uma com a frase da captura que a justifica
  article-body.ts              HTML → blocos do corpo do artigo (seletor Elementor real)
  parse.ts                     as quatro guardas; texto → RawScenario[]
  quaest-adapter.ts            QuaestAdapter extends BaseAdapter (id/instituteId = 'quaest'); discover com rede
  parse.spec.ts                20 testes sobre as capturas reais
  quaest-adapter.spec.ts       14 testes de ponta a ponta (5 deles sobre o discover)
  quaest.live.spec.ts          canário ao vivo, opt-in (QUAEST_LIVE=1)
  __fixtures__/                2 posts reais + camada de texto e medição do PDF + WP REST
  __fixtures__/README.md       URL, data, sha256 do PDF, redação aplicada, como recapturar
```

34 testes offline verdes; `typecheck` do pacote limpo; `eslint`/`prettier` limpos. O
canário ao vivo foi **executado** e passou (3 testes, 52 s, 8 requisições sob o rate
limit real), incluindo a asserção de que o `discover` devolve URL de post final e
alcança o post da rodada corrente.

## Pendências para outros donos

1. **`seed-data.ts` (T-02) precisa dos aliases da rodada real:** `Luiz Inácio Lula
   da Silva`, `Lula`, `Flávio Bolsonaro`, `Flávio`, `Ronaldo Caiado`, `Renan
   Santos`, `Romeu Zema`. Sem eles, toda rodada da Quaest cai em quarentena com
   `UnknownCandidateError` — que é o comportamento correto, mas rende zero dado.
2. **`base/tse-id.ts` tem um falso-negativo de V6 por zero à esquerda.** O post de
   julho grafa `BR-7181/2026`; `tseIdSchema` exige 5 dígitos, logo o registro
   canônico é `BR-07181/2026`, e o casamento de sequência exata não reconhece a
   grafia do instituto. Continua aberto depois da correção do prefixo `BR` (que
   fechou o buraco do `PE-04519/2026`). Há teste marcando a armadilha
   (`quaest-adapter.spec.ts`). Decisão de quem é dono de `base/`.
3. **`HarvestJob.attempt` não protege o `await adapter.discover(reg)`.** Como este
   é o único `discover` que faz rede, ele é o único que pode lançar ali — e sem
   `try/catch` uma falha de transporte aborta o ciclo INTEIRO, para todos os
   institutos. Lançar é o certo (R4: não sei as candidatas, e `[]` pareceria "nada
   publicado"), mas o contêiner do erro é do job: um `try/catch` empurrando
   `robots_or_http_error`, como já existe em volta do `http.request`, resolve.
4. **OCR.** É o único caminho para o PDF de rodada, e a decisão não é minha. Sem
   OCR a Quaest depende do post de blog, cuja cobertura é parcial.
