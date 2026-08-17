---
id: T-20
title: Adapter de colheita do Datafolha (site do próprio instituto, HTML)
status: done
depends_on: [T-01, T-06, T-07]
owns:
  [
    packages/adapters/datafolha/constants.ts,
    packages/adapters/datafolha/parse.ts,
    packages/adapters/datafolha/datafolha-adapter.ts,
    packages/adapters/datafolha/datafolha-adapter.spec.ts,
    packages/adapters/datafolha/datafolha.live.spec.ts,
    packages/adapters/datafolha/__fixtures__/**,
  ]
spec: docs/04-INGESTION-SPEC.md §1/§3/§4/§5/§6, docs/08-LEGAL-ETHICS.md §2, docs/OPEN-QUESTIONS.md Q-09
---

# T-20 — Adapter Datafolha

Fonte investigada ANTES de escrever parser (a ordem que Q-09 ensinou a inverter).
Escopo de arquivos: `packages/adapters/datafolha/**`. `packages/contracts` está
CONGELADO e foi apenas lido; `base/`, `apps/**` e os diretórios dos adapters irmãos
não foram tocados.

## O que a fonte primária publica (captura real de 2026-08-17, 6 páginas)

`docs/04` §3 dava o Datafolha como "sem publicação própria acessível… atrás de
paywall". **Está desatualizado**: o site do instituto publica a rodada inteira, sem
paywall, em `datafolha.folha.uol.com.br/eleicoes/<ano>/<mes>/<slug>.shtml`, com
índice navegável em `/eleicoes/` e `/eleicoes/<ano>/`. Nível 2 da hierarquia; não é
preciso descer para imprensa (nível 4).

- **O registro TSE está na publicação** (o dado decisivo desta task): 4 das 6
  rodadas capturadas o trazem no corpo — `BR-01166/2026`, `BR-06481/2026` (×2),
  `BR-07601/2026`. Duas não trazem, e nessas o V6 recusa, corretamente.
- **Não há tabela, `data-*` nem JSON-LD.** Os percentuais estão em prosa editorial.
- O único material estruturado é o PDF "RELATÓRIO COMPLETO", hospedado em
  `media.folha.uol.com.br`, cujo `robots.txt` é `User-agent: * / Disallow: /`.
  Por `docs/04` §6 está fora de alcance — e o `HttpClient` compartilhado recusa
  sozinho (`RobotsDisallowedError`), o que há teste provando.

## Entregável

- `constants.ts` — URLs verificadas, seletor do corpo, âncoras/exclusões de
  parágrafo e as duas janelas em caracteres, cada valor com a origem comentada
  (não vão para `contracts/constants.ts`: são detalhe de UMA fonte).
- `parse.ts` — extrai por gramática ANCORADA, com uma invariante dura: **todo
  percentual de um parágrafo de cenário tem de ser atribuível** (candidato nomeado,
  brancos/nulos, indecisos, parêntese de comparação, ou limiar declarado). Sobrou
  número sem dono ⇒ LANÇA. Rótulo de cenário é texto NOSSO (R3).
- `datafolha-adapter.ts` — `DatafolhaAdapter extends BaseAdapter`, `id` e
  `instituteId` = `datafolha`; `discover` aponta o índice do ANO da rodada e nunca
  o host proibido; `documentToText` reduz ao `[itemprop="articleBody"]` (o que
  também dá dente ao V6).
- `datafolha-adapter.spec.ts` — 14 testes: caminho felizes nominal (1º turno
  estimulado, espontâneo, dois 2º turnos), recorte REAL da rodada presidencial,
  V6 de outra rodada, alias desconhecido, valor ilegível, corpo ausente, armadilha
  de rejeição/segmento, armadilha de valor da rodada anterior, robots real.
- `datafolha.live.spec.ts` — canário opt-in (`DATAFOLHA_LIVE=1`) contra o site de
  hoje. Rodado nesta task: índice OK, publicação com corpo parseável, registro
  `BR-07601/2026` encontrado, parse recusando pelo motivo documentado, e o host do
  PDF ainda proibido.

## Limite conhecido, deliberado

Nas rodadas **presidenciais** — a única corrida ativa (`presidencia-2026`) — o
Datafolha escreve o valor dos dois primeiros colocados atrelado a uma DESCRIÇÃO e
não a um nome ("o atual presidente tem 40%…, contra 32% do presidenciável do PL").
Atribuir exigiria assumir quem é a descrição: chute proibido (`docs/04` §4.1) e,
pior, chute que o V6 não pega, porque o `tse_id` está certo. **O adapter recusa o
documento e o registro vai para quarentena.** Consequência honesta: hoje ele não
publica número da corrida presidencial. Nas rodadas estaduais, cuja redação é
nominal, o mesmo parser extrai o cenário inteiro (verificado contra a captura de
governo de SP: 46/30/5/4/4 + 8 + 3 = 100).

## Verificação

- `npx tsc --noEmit -p packages/adapters/tsconfig.json` — limpo (inclusive o
  `TS2345` que o registro do T-23 apontou em `datafolha-adapter.spec.ts:152`).
- `npx vitest run --root packages/adapters` — 442 passando, 0 falhando.
- `eslint` e `prettier --check` limpos no diretório.
