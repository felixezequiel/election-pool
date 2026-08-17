---
id: T-18
title: Transferência de votos e séries de branco/nulo e não-sabe (MODEL_VERSION 2.0.0)
status: done
depends_on: [T-03, T-04, T-09]
owns:
  [
    packages/model/transitions.ts,
    packages/model/kalman.ts,
    packages/model/index.ts,
    packages/model/backtest.ts,
    packages/model/__tests__/transitions.spec.ts,
    packages/model/__tests__/electorate.spec.ts,
    packages/model/__tests__/isolation.spec.ts,
    packages/model/__fixtures__/pre-v2-latent.json,
  ]
spec: docs/OPEN-QUESTIONS.md Q-10, docs/01-METHODOLOGY.md §2/§4/§10, docs/07-QUALITY-GATES.md §3/§4
---

# T-18 — Transferência de votos (v2.0.0)

Implementa a decisão registrada na **Q-10**, com a objeção técnica dela à vista:
transferência de voto **não é identificável a partir de pesquisa agregada**. O
recurso existe porque o dono do projeto decidiu que existisse; as sete condições
da Q-10 são o que separa isto de charlatanice, e todas foram implementadas.

## Entregável

- **Séries de branco/nulo e não-sabe** como estados de primeira classe
  (`runElectorateKalman` em `kalman.ts`): mesmo suavizador, mesma variância
  amostral (§4.2), mesma ponderação por recência (§4.4), mesma banda de 90%.
  Ponto sem medida na vizinhança sai `null` — nunca 0 (R4).
- **`packages/model/transitions.ts`**: estimador puro e determinístico. Entre dois
  nós, resolve o polítopo de transporte (`F ≥ 0`, linhas somam a massa de origem,
  colunas reproduzem as marginais de `t+1`) escolhendo o ponto mais próximo em KL
  do prior de permanência `TRANSITION_STICKINESS_PRIOR` — que é exatamente o ponto
  fixo do IPF/RAS. Banda por bootstrap com PRNG semeado.
- **`ModelInput.electorateObservations`** (obrigatório) e
  **`ModelOutput.latent.electorate` / `ModelOutput.transitions`** preenchidos.
- **Backtest de transferência** 1º ⇒ 2º turno em `backtest.ts`, com a urna como
  ponto de checagem, gravado em `docs/BACKTEST-RESULTS.md`.

## As sete condições da Q-10

| # | Condição | Onde |
|---|----------|------|
| 1 | `MODEL_VERSION` 2.0.0, branco/nulo e não-sabe rastreados | `constants.ts` (já vinha), `kalman.ts` |
| 2 | Prior explícito, versionado e publicado | `transitions.prior` (`method`, `stickiness`, `note` com o deslocamento medido em p.p.) |
| 3 | Banda sempre publicada; fluxo cruzando zero vem `notIdentifiable` | `buildFlows` em `transitions.ts` |
| 4 | UI rotula como estimativa de modelo | **fora do escopo desta task** — a nota publicada dá o texto; a UI é de outro agente |
| 5 | Linha nova em docs/01 §10 | já estava escrita antes desta task |
| 6 | Backtest de transferência com a urna | `checkTransition` em `backtest.ts` |
| 7 | Fluxo não realimenta μ_t nem h_i | `__tests__/isolation.spec.ts`, contra baseline congelado |

## Aceite

- [x] Série de branco/nulo e não-sabe com banda, `null` sem medida
- [x] Transferência determinística (dois runs, mesmo JSON)
- [x] Fluxo com banda cruzando zero sai `notIdentifiable: true`, publicado
- [x] Menos de `TRANSITION_MIN_STEPS` passos ⇒ `transitions: null`
- [x] μ_t e house effects idênticos ao baseline pré-2.0.0 (`__fixtures__/pre-v2-latent.json`)
- [x] Backtest de transferência roda; veredito em `docs/BACKTEST-RESULTS.md`
- [x] `test` (99) e `typecheck` verdes; lint e prettier limpos

## Armadilhas encontradas

- **O prior de permanência não é ponto fixo.** "Cada estado perde 15%
  uniformemente" move massa líquida do estado grande para os pequenos, então as
  colunas do prior não fecham nem quando a composição está parada. O IPF conserta
  isso subindo a permanência do maior. Não é bug — é o prior sendo corrigido pela
  restrição marginal — mas quem esperar `F = F⁰` numa série imóvel vai se
  surpreender (há teste fixando o comportamento).
- **A banda cobre a incerteza do DADO, não a do prior.** Com bandas latentes
  estreitas (o problema da Q-07), um fluxo cruzado de ~2 p.p. que é quase todo
  prior sai com banda inteiramente acima de zero e, portanto, **sem** o rótulo
  `notIdentifiable`. O rótulo protege contra ruído amostral, não contra a
  suposição. Quem lê precisa da nota do prior — e a UI, da condição 4.
- **Normalização de massa.** As duas composições são postas na mesma massa total
  (a média das duas) para o polítopo existir. A variação do resíduo não rastreado
  fica diluída nos fluxos entre rastreados. Está declarado no código e é
  limitação, não ajuste.
