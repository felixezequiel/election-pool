---
id: T-19
title: UI da MODEL_VERSION 2.0.0 — fotos, séries do eleitorado, painel de transferência
status: done
depends_on: [T-11, T-12, T-17, T-18]
owns: [apps/web/**]
spec: docs/05-DESIGN-SYSTEM.md, docs/06-FRONTEND-SPEC.md §2–§8, docs/OPEN-QUESTIONS.md Q-10
---

# T-19 — UI da v2

Liga na página os três campos novos do `data.json` versão `'2'`: foto de
candidato, séries de branco/nulo e não-sabe, e transferência de votos. Escopo de
arquivos: `apps/web/**`. `packages/contracts` está CONGELADO e foi apenas lido.

## Entregável

- `CandidatePhoto.astro` — foto local quando `photoPath` existe, monograma sobre a
  cor do `colorSlot` quando é `null`. Recusa URL absoluta lançando (docs/08 §2).
  Usada no herói, no readout da série latente, na lista de pesquisas e em `/dados`.
- `ElectorateSeriesChart.astro` + `lib/electorate-geometry.ts` — branco/nulo e
  não-sabe no mesmo eixo do tempo da série de candidatos, com identidade visual
  neutra (grafite/tinta, hachura própria, traço tracejado). Ponto `null` quebra a
  série em segmentos: sem interpolação, sem zero, com o vão marcado na linha de
  cobertura no topo do gráfico.
- `TransitionPanel.astro` + `lib/transition-geometry.ts` — uma FAIXA por relação
  origem→destino, escala real, zero marcado e enfatizado. Lista visível com a
  banda inteira de cada fluxo, permanência à parte, tabela com todos os passos.
- `TransitionSection.astro` — aviso de "estimativa de modelo, não medida" com peso
  de manchete ANTES do painel, prior publicado (peso + nota que carrega a medição
  da participação do prior), estado vazio explicado quando `transitions: null`.
- `scripts/gen-sample-data.mjs` regenerado para o schema `'2'` (nomes fictícios
  mantidos), incluindo `electorate` com buracos e `transitions` com fluxos
  `notIdentifiable`.

## Decisões

**O painel de transferência NÃO é um Sankey.** A primeira versão era: nós dos dois
lados, fitas curvas desenhadas com `d3-shape`. Foi descartada quando chegou a
medição de T-18 — o ajuste ao dado desloca ~7 de ~91 p.p. de massa por passo, ou
seja ~92% do número publicado é o prior de permanência. Fita grossa e limpa entre
dois nós comunica trajetória medida, que é exatamente o que não existe. O painel
passou a usar a linguagem que o site já reserva para estimativa incerta (o dot
plot de house effect): faixa por relação, zero marcado. "Cruza zero" virou coisa
que se vê, não selo em que se acredita.

**`notIdentifiable` não é usado como sinal de confiança.** T-18 mediu: só 34 de 272
fluxos de 2022 ficaram marcados, e o rótulo captura ruído amostral, não a
dependência do prior. Por isso o contraste visual entre marcados e não marcados é
pequeno de propósito, o rótulo dos não marcados diz "distinguível de zero" (e não
"confiável"), e há uma frase explícita dizendo que relação sem selo não é relação
medida.

**Séries do eleitorado em gráfico separado, na mesma seção.** Misturadas às faixas
coloridas dos candidatos entrariam na leitura como "mais um concorrente" — e o
não-sabe costuma ser maior que o terceiro colocado. Ficam logo abaixo, com o
`xDomain` da série de 1º turno imposto e as MESMAS margens laterais, para que a
mesma coluna vertical seja a mesma data nos dois gráficos.

**Segmentação em vez de interpolação.** `null` não vira `0` nem some: a série é
quebrada em trechos contíguos, e trecho de um ponto só ganha marca própria (barra
vertical da banda + ponto), para não desaparecer por ser fim de série depois de um
buraco.

## Aceite

- [x] `pnpm --filter @election-pool/web typecheck` — 44 arquivos, 0 erros, 0
      avisos (1 hint pré-existente em `Num.astro`, não introduzido aqui)
- [x] `pnpm --filter @election-pool/web build` — 3 páginas, sem warning
- [x] `pnpm --filter @election-pool/web lint` — 31 `.astro`, nenhum dígito solto
- [x] `transitions: null` renderiza estado vazio explicado (verificado com build
      sobre amostra modificada)
- [x] Sem série latente, `NoDataNotice` continua sendo o miolo da página
      (verificado do mesmo jeito)
- [x] Ponto `null` não vira zero nem é interpolado (verificado no SVG gerado:
      segmentos separados, `single` no ponto isolado)
- [x] Fluxo `notIdentifiable` desenhado, com a faixa atravessando o zero
      (verificado no SVG: 4 de 7 relações cruzam a linha do zero)
- [ ] Verificação VISUAL em 375/768/1440 — não feita: não há browser nesta
      sessão. Só o CSS foi conferido (ver pendências)

## Pendências / armadilhas para o próximo

1. **Nenhum breakpoint foi visto com olho humano.** As media queries existem
   (375: listas de fluxo e de candidato empilham; 640: herói e readouts empilham;
   768: `.flow-item` vira duas colunas) e os dois painéis largos rolam no próprio
   eixo (`overflow-x: auto`, `min-width` no `<svg>`), mas ninguém abriu a página.
2. **Texto de SVG em telas estreitas.** O gráfico do eleitorado NÃO rola: ele
   escala junto com a série latente para manter o eixo do tempo em registro. Em
   375px os rótulos de 11px ficam com ~4px efetivos — ilegíveis, como já acontece
   com o `LatentBandChart`. Toda a informação está repetida em HTML real (readout,
   legenda, tabela), mas se isso incomodar, a saída é uma variante de mobile com
   viewBox menor, não largar o alinhamento.
3. **Muitos fluxos.** O painel desenha TODOS os fluxos cruzados do passo mais
   recente (7 na amostra). Com K estados são até K²−K linhas: com K=10 seriam 90
   faixas empilhadas. Não foi imposto teto porque cortar por magnitude esconderia
   justamente os `notIdentifiable`, que a Q-10 proíbe esconder. Se virar problema
   real, a decisão (agrupar? paginar por origem?) é de produto.
4. **Colisão de arquivo com T-17.** As duas "fotos de amostra" que eu havia criado
   em `apps/web/public/candidatos/` foram apagadas no meio desta task quando T-17
   escreveu ali as fotos reais (`lula.jpg`, `flavio-bolsonaro.jpg`, `zema.jpg`).
   Foram recriadas com nome próprio (`amostra-andrade.svg`, `amostra-barros.svg`) e
   convivem com as reais. São desenhos abstratos NOSSOS, não retrato de pessoa: a
   amostra não pode conter presidenciável real.
5. **Constantes de layout** (largura de coluna de rótulo, altura de linha, piso de
   espessura, folga do eixo) ficaram como `const` nomeadas nos módulos de
   geometria, com comentário, seguindo o precedente de `latent-geometry.ts`. Não
   são parâmetro de modelo e `contracts` está congelado.
