---
id: T-24
title: Adapter de colheita do PoderData
status: done
depends_on: [T-01, T-06]
owns: [packages/adapters/poderdata/**]
spec: docs/04-INGESTION-SPEC.md §1/§3/§4/§5/§6, docs/08-LEGAL-ETHICS.md §2, docs/OPEN-QUESTIONS.md Q-09
---

# T-24 — Adapter PoderData

Implementado e verde: **38 testes** (21 de parser + 17 de adapter/discover) mais **2
ao vivo** que batem no poder360.com.br de verdade. `tsc --noEmit` limpo em
`poderdata/**`.

O valor desta task não está só no adapter: está em quatro achados obtidos **antes**
de escrever o parser, na ordem que a Q-09 manda inverter. Leia antes de mexer no
código.

## 1. O número de registro TSE aparece? **SIM — em três lugares**

Era a pergunta que podia encerrar a task (sem `tse_id` o `BaseAdapter` recusa por
V6). Nos quatro relatórios reais o número aparece:

1. na **capa**, em duas linhas (`Registro TSE` / `BR-07845/2026`);
2. na **ficha técnica** (`Registro TSE:` / `BR-07845/2026`);
3. no **rodapé de todas as páginas de conteúdo**, dentro da sentença metodológica
   (`… (margem de erro: 2,0 p.p.). Registro TSE: BR-07845/2026`).

Registros observados: `BR-04882/2026` (campo 25–28/mai), `BR-05722/2026` (21–24/jun),
`BR-00059/2026` (12–15/jul), `BR-07845/2026` (26–29/jul). Todos com 5 dígitos, logo
casam com `tseIdSchema`. Detalhe de grafia: no de maio o rodapé sai da extração como
`BR -04882/2026`, com espaço — o `base/tse-id.ts` já tolera, e a capa traz a forma
canônica.

## 2. A fonte legítima é o PDF do instituto; o HTML do Poder360 é só índice de link

Este era o julgamento que a task pedia, e ele tem resposta limpa. O PoderData é o
instituto do Poder360, então o domínio hospeda as duas coisas — mas os objetos são
distinguíveis:

- `static.poder360.com.br/.../Relatorio-PoderData-Eleitoral-*.pdf` é o **relatório
  técnico assinado por "PoderData Pesquisas, Jornalismo e Comunicação LTDA"**, com
  `Ficha técnica`, `Registro TSE` e as tabelas de resultado. É divulgação do próprio
  instituto — **nível 2** de docs/04 §1, não o nível 4 (imprensa). Todo número sai
  daqui.
- As páginas HTML (`/poderdata/<slug>/`, `/poderdata-institucional/`) são **posts de
  WordPress**: `<h1>`, `article:published_time`, autoria (`/author/ligia-saba/`,
  repórter assinado) e parágrafos. **Inclusive a página "Leia os resultados"**, que é
  a mais sóbria do conjunto — ela também tem autoria e prosa. São usadas **apenas**
  como lista de `href` de PDF (docs/08 §2.1: "Referência à fonte é sempre link, nunca
  conteúdo").

Critério prático, para quem vier depois: **se tem autoria e parágrafo, é matéria.**
Nenhum número do adapter vem de HTML. Isso é também o que mantém satisfeita a
proibição de "scraping de portal de notícia" do CLAUDE.md — não lemos a matéria,
lemos o release.

## 3. O 1º turno vem dos CRUZAMENTOS, nunca do gráfico

O relatório apresenta o 1º turno duas vezes: uma página de gráfico e **sete páginas
de cruzamento** (Sexo, Idade, Instrução, Região, Renda, Religião, Aprovação), cada
uma com coluna `Total` e linha de fechamento `Total 100% …`.

No cruzamento o rótulo e o valor estão na MESMA linha do texto extraído — não há
adivinhação. No gráfico de barras, não: primeiro vêm todos os valores (um por linha,
um bloco por onda), depois todos os rótulos. O casamento é POSICIONAL e um
desalinhamento **trocaria candidatos em silêncio** — o pior tipo de bug (R4). Daí a
regra: cruzamento é a fonte, gráfico é conferência.

E há redundância de graça: os sete cruzamentos publicam o mesmo marginal, então se
conferem entre si.

## 4. Duas divergências REAIS de 1 p.p. na fonte, e a regra que elas geraram

Medido nas quatro rodadas (7 cruzamentos × ~9 rótulos × 4 relatórios, ~250 células).
Divergências: **duas**, ambas de 1 p.p., ambas em `BR-05722/2026` e no mesmo rótulo:

- o cruzamento `Aprovação de Lula` traz `Joaquim Barbosa … 3%`, contra `2%` nos
  outros seis;
- o rótulo do gráfico também traz `3`.

Causa declarada pelo próprio relatório ("os resultados foram arredondados… é possível
que o somatório seja diferente de 100"): cada apresentação é arredondada de forma
independente. Nas outras três rodadas a concordância é total.

Regra implementada, com a origem escrita em `constants.ts`
(`ROUNDING_TOLERANCE_PP = 1`):

- conjunto de rótulos tem de ser **idêntico** em todos os cruzamentos (isso é
  estrutura, não arredondamento) ⇒ divergir aqui LANÇA;
- amplitude dos valores de um rótulo tem de caber em 1 p.p. ⇒ acima LANÇA;
- publica-se o valor da **maioria estrita**. Maioria, e não média, porque o
  instituto publica inteiros e a média inventaria um número que ele nunca imprimiu
  (2,14%). **Empate ⇒ LANÇA** — no empate não escolhemos por conta própria.

Em junho a maioria dá 2%, que é também o valor que fecha a distribuição em 100.

## O que foi entregue

```
packages/adapters/poderdata/
  constants.ts                 URLs de índice, âncoras, tolerância — cada uma com origem
  parse.ts                     parser: páginas → cruzamentos + gráficos → cenários
  poderdata-adapter.ts         PoderDataAdapter extends BaseAdapter (+ extractReportUrls)
  parse.spec.ts                21 testes contra as 4 capturas reais
  poderdata-adapter.spec.ts    17 testes: V6, alias, discover, robots, não-PDF
  poderdata.live.spec.ts       2 testes ao vivo + a ferramenta de recaptura
  __fixtures__/
    README.md                  procedência completa e a justificativa de fonte
    redact.ts                  filtro de redação (R3)
    make-pdf.ts                PDF mínimo PAGINADO para as specs
    BR-04882-2026-28mai2026.txt   captura real (dialeto bars, 1 onda, 5 pares de 2º turno)
    BR-05722-2026-24jun2026.txt   captura real (bars, 2 ondas, a divergência de 1 p.p.)
    BR-00059-2026-15jul2026.txt   captura real (bars, 3 ondas, Joaquim ausente)
    BR-07845-2026-29jul2026.txt   captura real (dialeto series, 4 ondas, 4 pares)
    indice-serie-2026-links.html      âncoras reais (só href)
    indice-institucional-links.html   âncoras reais (só href), ordem inversa
```

Nada fora de `packages/adapters/poderdata/**` foi tocado. Nenhuma alteração em
contracts, model, apps, infra, base, `package.json` (o curinga `"./*"` já resolve os
módulos novos) ou em diretório de outro adapter.

## Cenários e semântica

- `t1_estimulado` — um, rótulo `Intenção de voto no 1º turno` (o rótulo do
  instituto, como docs/03 §2.4 pede).
- `t2` — um por par publicado (5 em maio, 4 em julho). Rótulo NOSSO, composto dos
  aliases (`Intenção de voto no 2º turno: Flávio Bolsonaro x Lula`), para não
  republicar o enunciado (R3) e para dar unicidade a `(tse_id, kind, label)` — sem
  isso os quatro pares colidiriam na UNIQUE de docs/03 §2.4.
- `t1_espontaneo` — **AUSENTE**, e de propósito: não existe seção de voto
  espontâneo em nenhuma das quatro rodadas (a pesquisa é IVR com lista lida ao
  entrevistado). Ausência não é zero.
- `blankNullPct` / `undecidedPct` — preenchidos quando publicados (`Branco/Nulo`,
  `Não sabe` estão em todos os cenários das quatro rodadas), via
  `base/scenario-lines.ts`; ausentes viram `undefined`, nunca 0.

## Salvaguarda de onda — o V6 da série temporal

Cada gráfico do relatório traz a série histórica INTEIRA (até 4 ondas). Pegar a
coluna errada atribuiria os números de outra rodada — a mesma classe de erro que o V6
existe para impedir. Por isso `extractScenarios` recebe `reg.fieldEnd` e o parser
CONFERE que a última legenda de onda é o mês (e, quando a legenda traz dia, o dia) do
fim de campo do registro. Não bate ⇒ LANÇA.

Três grafias reais de legenda são aceitas: `mai/26`, `29-Jul` (eixo de gráfico do
Excel em locale inglês) e `29/jul`.

## Dialeto de barras: aceito só com oráculo

O 2º turno não tem cruzamento — só gráfico. Nas rodadas de maio/junho/16-jul isso
significa leitura POSICIONAL, que poderia trocar Lula com o adversário sem que a soma
mudasse. A salvaguarda: o mesmo decodificador posicional é aplicado ao gráfico do 1º
turno **do mesmo documento** e tem de reproduzir a coluna Total dos cruzamentos,
rótulo a rótulo, dentro da tolerância. Se reproduz, a convenção de ordem está
PROVADA naquele documento e o 2º turno em barras é aceito. Se não há oráculo, ou ele
falha, o 2º turno em barras é **RECUSADO**.

Isso vale para quem for mexer: não relaxe o oráculo. Ele é a única coisa entre a
leitura posicional e um número trocado em silêncio.

## discover — e por que ele LANÇA em vez de devolver vazio

`discover` busca, com o `HttpClient` compartilhado (robots.txt + 1 req/10s por host +
conditional GET + retries), o índice da série 2026 e, se ele não render, a página
institucional. Extrai só `href` que casem `Relatorio-PoderData-Eleitoral*.pdf` —
o filtro pelo infixo "Eleitoral" descarta o relatório não eleitoral que a página
institucional também hospeda. Ordena por ano/mês da URL (as duas páginas listam em
ordens OPOSTAS), o que é só otimização: quem decide qual PDF é da rodada é o V6.

**Nenhum índice com PDF ⇒ LANÇA.** Um `discover` que devolve lista vazia é o
`seen=0, upserted=0, alerts=0` da Q-09: sucesso silencioso com zero dado.

## O teste que a Q-09 pediu

`poderdata.live.spec.ts` (opt-in, fora do `pnpm verify`) baixa os quatro PDFs reais
e roda o parser sobre o texto **INTEGRAL, sem redação nenhuma** — é a prova de
integração de ponta a ponta. Além disso confere que a redação da captura de hoje
reproduz byte a byte a fixture commitada, e que a fixture produz o MESMO resultado
que o documento integral (a redação não mexeu em nenhum número).

```
PODERDATA_LIVE=1    pnpm --filter @election-pool/adapters test poderdata.live   # confere
PODERDATA_CAPTURE=1 pnpm --filter @election-pool/adapters test poderdata.live   # recaptura
```

Rodado em 2026-08-17: verde, ~31 s. **E ele já pagou por si**: pegou um bug que a
fixture escondia — o enunciado da pergunta, que a redação remove, fica logo acima
dos valores no gráfico de barras e derrubava a leitura posicional. Com fixture só,
o adapter teria ficado verde e quebrado no primeiro documento real.

## Constantes novas (todas no meu diretório, com origem comentada)

Ficam em `poderdata/constants.ts` e não em `packages/contracts/constants.ts` porque
descrevem a FONTE, não o modelo — e contracts está congelado.

| Constante | Origem |
|---|---|
| `PODERDATA_DISCLOSURE_INDEX_URLS` | as duas páginas de índice, verificadas em 2026-08-17 |
| `PODERDATA_REPORT_URL_PATTERN` | nome de arquivo dos relatórios eleitorais; o infixo "Eleitoral" separa do relatório não eleitoral que a página institucional hospeda |
| `PAGE_FOOTER_ANCHOR` | rodapé impresso em toda página de conteúdo; é o delimitador de página no texto concatenado |
| `SECTION_TITLE_T1` / `SECTION_TITLE_T2` | títulos exatos das seções; allowlist deliberada (o relatório tem 7+ outras seções com percentual) |
| `MIN_CROSSTAB_COLUMNS = 2` | com 1 coluna não há como distinguir recorte de Total |
| `MAX_CHART_LABEL_CHARS = 40` | rótulo real mais longo: 30; enunciado real mais curto: 61 |
| `ROUNDING_TOLERANCE_PP = 1` | as duas divergências reais medidas (§4) |
| `MONTH_ABBREVIATIONS` | as legendas reais misturam pt-BR e inglês |

## O que NÃO foi feito, e por quê

- **Nada de headless browser**: o índice é HTML servido e o dado é PDF. Não foi
  preciso.
- **Nenhum número de HTML**, nem como fallback. Se o PDF sumir, o adapter recusa; a
  alternativa seria ler a matéria, o que docs/04 §1 classifica como nível 4 e exige
  aprovação explícita em `docs/OPEN-QUESTIONS.md`.
- **Nenhuma soma/normalização**: V1 (soma 97–103), V2, V3, V7 são da camada de
  validação (`packages/adapters/validation/**`), que o HarvestJob roda sobre o
  `ParsedPoll`. O parser não os duplica.
- **Nada em `docs/OPEN-QUESTIONS.md`**: não houve objeção metodológica nem mudança de
  contrato. As duas decisões discutíveis (maioria entre cruzamentos; barras só com
  oráculo) estão documentadas aqui e no código, com a alternativa que foi preterida.

## Pendência externa observada (não é minha)

`npx tsc --noEmit` no pacote reporta **um** erro, em
`datafolha/datafolha-adapter.spec.ts:152` (`number` não atribuível a
`number & BRAND<"Pct">`) — arquivo de um agente irmão. `poderdata/**` está limpo, e
a suíte inteira do pacote passa (442 testes).
