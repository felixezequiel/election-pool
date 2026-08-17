---
id: T-25
title: Adapter de colheita do REAL TIME BIG DATA (PDF por rodada, site do instituto)
status: done
depends_on: [T-01, T-06]
owns: [packages/adapters/realtime/**]
spec: docs/04-INGESTION-SPEC.md §1 §3 §4 §5 §6, docs/08-LEGAL-ETHICS.md §2, docs/OPEN-QUESTIONS.md Q-09
---

# T-25 — adapter `realtime`

Instituto: **REAL TIME BIG DATA** (razão social no TSE: `REAL TIME MIDIA LTDA /
REAL TIME BIG DATA`), já cadastrado no seed como `realtime`.

## O que a fonte publica, e onde

Fonte de **nível 2** (`docs/04` §1): site do próprio instituto. Nenhum portal de
notícia foi consultado.

`https://realtimebigdata.com.br/pesquisas/` é um índice WordPress/Elementor que
linka **um PDF por rodada**. Não há página por rodada nem URL construível: o nome
do arquivo carrega o número de registro TSE, com a grafia do separador variando
entre rodadas (`BR-06833-2026`, `BR-05205_2026`, `BR-096502026`). `robots.txt`
permite tudo (`Disallow:` vazio).

No momento da captura (2026-08-17) havia 12 rodadas: **6 presidenciais** (registro
`BR-…`, porque o cargo de presidente é registrado no TSE) e 6 estaduais (registro
`UF-…`), sendo as duas do mesmo estado publicadas no MESMO dia. Por isso a seleção
é pelo número de registro e nunca por estado, data ou posição na lista.

**O número de registro está DENTRO do PDF**, na capa, em texto extraível:
`PESQUISA REGISTRADA: BR-NNNNN/2026` + `DIVULGAÇÃO: DD/MM/AAAA`. Sem isso o
`BaseAdapter` recusaria todo documento por V6 e este adapter não teria como
existir. A capa também traz `n`, universo, margem de erro, nível de confiança e
datas de campo.

Cada PDF é um deck de 17 páginas com estrutura estável nas 6 rodadas: capa,
metodologia, perfil da amostra, **espontânea presidente**, **estimulada
presidente** (+ recortes de gênero/idade/renda), **2º turno (`CENÁRIO 01`)**,
rejeição múltipla e aprovação. O título de cada seção fica **sozinho numa página
divisória** e o gráfico vem na página seguinte — é essa posição que o parser usa
como âncora.

## A descoberta que justificou investigar antes de escrever o parser (Q-09)

A ordem de fluxo do texto do PDF **inverte os valores do 2º turno** em relação à
posição na página. Em `BR-06833/2026` o fluxo emite `51%` e depois `37%`, mas na
página o `37%` está do lado esquerdo (x=511,3, onde está o primeiro nome) e o
`51%` do lado direito (x=745,1, onde está o segundo). Um parser de ordem de fluxo
— inclusive o `cnt-mda/pdf.ts`, que usa `mergePages` sem coordenadas — atribuiria
os dois candidatos trocados.

E o erro seria **invisível**: a soma continua 100, V1–V7 passam, e o sinal do erro
muda de documento para documento (em `BR-05205/2026` lidera o finalista da
esquerda; em `BR-06833/2026` e `BR-01784/2026`, o da direita), então nem um viés
constante que alguém notasse. É literalmente o "pior bug do sistema" de `docs/04`
§4.1, e só apareceu porque as coordenadas do PDF real foram medidas antes de
escrever qualquer regex.

Daí `realtime/pdf-layout.ts`: extração POSICIONADA, com dedupe da camada de texto
duplicada (o deck desenha cada texto duas vezes na mesma coordenada), faixas
horizontais por baseline, junção de palavras por vão medido, e pareamento
rótulo→valor dentro da faixa. O pareamento do confronto é por `x`
(esquerda→direita), nunca por ordem de fluxo.

## Entregue

```
packages/adapters/realtime/
  constants.ts                  URL do índice, tolerâncias geométricas (origem medida)
  raw-body.ts                   blob → bytes de PDF / texto HTML, aceitando base64
  pdf-layout.ts                 PDF → texto normalizado por layout (páginas por \f)
  labels.ts                     grafias de branco/nulo e não-sabe DESTA fonte
  index-parse.ts                índice → URLs de PDF; seleção pelo registro
  parse.ts                      texto → cenários, ancorado nas páginas divisórias
  realtime-adapter.ts           RealTimeAdapter extends BaseAdapter
  *.spec.ts                     51 testes
  realtime-adapter.live.spec.ts canário ao vivo, opt-in (REALTIME_LIVE=1)
  __fixtures__/                 capturas REAIS + README de proveniência
```

Cenários extraídos: `t1_espontaneo`, `t1_estimulado`, `t2` (com `t2Pair`),
`blankNullPct` e `undecidedPct` sempre que a fonte publica — e `undefined` quando
não publica. Rejeição e aprovação são ignoradas de propósito (não são intenção de
voto). Os recortes de gênero/idade/renda também: são o mesmo cenário estimulado
quebrado por demografia e, além de não caberem em `ParsedPoll`, neles o número de
rótulos e de valores DIVERGE (a fonte omite a barra de quem ficou em 0), então o
pareamento seria ambíguo — ler isso seria inventar dado.

## Pendências que NÃO são desta task

### 1. `apps/api/src/db/seed-data.ts` precisa das grafias desta fonte

O mesmo documento imprime o mesmo nome de três formas: `Lula` (espontânea, pergunta
aberta), `Lula (PT)` (estimulada) e `LULA (PT)` (confronto). O resolver casa alias
EXATO por decisão de projeto (normalização é manual, nunca fuzzy), e o parser
deliberadamente NÃO normaliza — tirar o partido ou baixar a caixa seria mover uma
decisão de identidade para dentro do código.

A lista verbatim está em `packages/adapters/realtime/__fixtures__/aliases.ts`.
Faltam no seed, para `lula`/`flavio-bolsonaro`/`zema`: `Lula (PT)`, `LULA (PT)`,
`Flávio Bolsonaro (PL)`, `FLÁVIO BOLSONARO (PL)`, `Romeu Zema (Novo)`. E faltam
como CANDIDATOS novos: `Renan Santos` (+ `Renan Santos (Missão)`), `Ronaldo Caiado`
(+ `Ronaldo Caiado (PSD)`), `Jair Bolsonaro`, `Escritor Augusto Cury (Avante)`,
`Cabo Daciolo (Mobiliza)`. Enquanto não entrarem, toda rodada deste instituto vai
para quarentena com `UnknownCandidateError` — que é o comportamento CORRETO
(`docs/04` §4.1), mas rende zero dado.

### 2. `Outros` precisa de decisão

A fonte publica uma barra `Outros` (1–3 p.p.) com o agregado dos candidatos que não
mostra individualmente. `ParsedPoll` não tem campo para agregado. O parser emite
`Outros` como alias, porque descartá-lo no parser seria perder dado publicado em
silêncio (R4) e mapeá-lo a um candidato seria criar uma pessoa que não existe.

Quem é dono do cadastro decide: (a) mapear para um id agregado (a paleta já reserva
o slot 8 para "Demais", `contracts/palette.ts`); (b) alargar `ParsedPoll` com
`othersPct` — mexe em contrato congelado, então vira Q-nova; (c) manter sem alias e
aceitar que estas rodadas ficam em quarentena. Sem (a) ou (b), o item 1 acima não
basta para destravar a colheita.

### 3. O `HttpClient` compartilhado corrompe PDF

`HttpClient` devolve `body: string` via `Response.text()`, que destrói binário
(todo byte inválido em UTF-8 vira U+FFFD). O `HarvestJob` monta o cliente com o
`fetch` global cru, então **todo adapter de PDF é afetado** — este e o `cnt-mda`.
A solução já existe no repo: `tse-candidatos/binary-fetch.ts`
(`createBase64Fetch`), que faz o corpo trafegar em base64.

O que fiz dentro do meu escopo: `realtime/raw-body.ts` aceita as DUAS formas de
corpo e, quando nenhuma serve, LANÇA com a causa provável escrita no erro — nunca
finge que leu um PDF. O teste ao vivo passa porque usa `createBase64Fetch`. Quem é
dono de `apps/api` decide se o cliente compartilhado passa a ser montado assim (o
que muda o significado de `body` para todos os adapters) ou se o `HarvestJob` ganha
um caminho binário.

### 4. Anomalia real: a espontânea de `BR-01784/2026` soma 110

Medido nas coordenadas do PDF (8 rótulos, 8 barras, cada rótulo com o valor da sua
barra): a espontânea de Mato Grosso do Sul publicada pelo instituto soma 110 p.p.
O parser extrai como está; quem bloqueia é V1 (`97 ≤ soma ≤ 103`). Não é bug de
extração e não foi ajustado (R1/R4). Há fixture dedicada a isso.

### 5. Abrangência: são pesquisas ESTADUAIS com pergunta presidencial

As 6 rodadas presidenciais têm registro `BR-…` e universo de UM estado
(`UNIVERSO: ELEITORES DO ESTADO DO MATO GROSSO`, 1.600 entrevistas). Não são
amostras nacionais. O modelo (`docs/01`) trata observações de intenção de voto
presidencial; se ele pressupõe abrangência nacional, essas observações precisam de
tratamento — não é decisão de adapter, e não há campo de abrangência em
`ParsedPoll`. O `PollRegistration` do PesqEle é quem carrega a abrangência.
Sinalizo porque é a diferença mais importante entre este instituto e nexus/CNT.
