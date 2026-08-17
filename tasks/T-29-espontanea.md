---
id: T-29
title: Seção da pergunta espontânea — quanto do eleitorado não tem candidato, e por que a estimulada esconde isso
status: done
depends_on: [T-12, T-19]
owns: [apps/web/**]
spec: docs/OPEN-QUESTIONS.md Q-14, docs/05-DESIGN-SYSTEM.md, docs/06-FRONTEND-SPEC.md §2–§8
---

# T-29 — Pergunta espontânea

Liga na página o campo `spontaneous` do `data.json` (schema `'2'`), que era
colhido, validado e persistido desde a correção da Q-14 e não aparecia em lugar
nenhum. É a medida mais honesta de "quanto do eleitorado ainda não tem
candidato" — e, medida em paralelo com a estimulada, é a informação mais
reveladora que o site publica hoje.

## O fato que a seção comunica

Institutos fazem a pergunta de intenção de voto de duas formas na MESMA
pesquisa, mesmo campo, mesma amostra:

| | citaram alguém | branco/nulo | não citaram nome |
|---|---|---|---|
| espontânea (pergunta aberta) | 51 | 12 | **37** |
| estimulada (lista de nomes) | 93 | 4 | 3 |

Medição real: `BR-06833/2026`, Real Time Big Data. A lista de nomes ancora a
resposta — quem não pensou no assunto reconhece um nome e escolhe —, então o
"não sabe" da estimulada cai para poucos pontos. A estimulada é a que a imprensa
publica. Por construção, ela esconde que mais de um terço do eleitorado ainda
não tem candidato próprio.

## Entregável

- `apps/web/src/components/sections/SpontaneousSection.astro` — a seção,
  montada em `index.astro` **imediatamente depois** da série latente (é ali que
  o leitor acabou de ver o não-sabe pequeno da estimulada).
- `apps/web/src/components/charts/SpontaneousContrast.astro` — as duas barras do
  eleitorado, uma por forma de pergunta, com "sem candidato" ancorado em zero
  nas duas.
- `apps/web/src/components/charts/SpontaneousSeriesChart.astro` — a série no
  tempo, reusando `buildElectorateGeometry` (a lógica de buraco é a mesma).
- `apps/web/src/components/charts/lib/contrast-geometry.ts` — geometria pura das
  barras (D3 só para `scaleLinear`).
- `apps/web/src/data/chart-inputs.ts` — `spontaneous` e `electorateLatest` na
  costura de dados; o `null` de cada ponto atravessa intacto.
- `apps/web/scripts/gen-sample-data.mjs` + `src/data/sample-data.json`
  regenerados com `spontaneous` (sem isso o build reprova na validação Zod).

## Ordem da seção, e por que é essa

1. **O número grande com a banda** — quanto do eleitorado não tem candidato
   hoje, ao lado do não-sabe da estimulada, as duas réguas na MESMA escala.
2. **A explicação, em prosa, antes de qualquer gráfico.** Sem ela, "37%" parece
   contradizer os "3% de indecisos" que o leitor viu no jornal, e a conclusão
   natural é que um dos dois números está errado. Nenhum está: são perguntas
   diferentes. Se o leitor só ler um parágrafo desta seção, tem de ser esse.
3. **As duas barras** do eleitorado inteiro — a prosa arma a leitura, o desenho
   a confirma.
4. **A série no tempo** — responde à pergunta seguinte: cresce ou encolhe?
5. **Proveniência à vista** — `pollCount` e `instituteCount` junto da afirmação,
   não em nota de rodapé. Afirmação forte diz sobre quantas pesquisas se
   sustenta.

## Decisões que não são estéticas

- **`named` não tem a autoridade das pontas medidas.** É complemento aritmético
  para 100, com banda somada de forma conservadora. Aparece como segmento
  apagado, sem hachura, com contorno tracejado, rotulado `aritmética`, e **sem**
  `<UncertaintyRule>` — no lugar da régua vai a frase que diz o que ele é. O
  mesmo tratamento é dado ao complemento da estimulada, calculado aqui.
- **A banda só é desenhada no segmento ancorado em zero.** A banda de um
  segmento empilhado teria a posição contaminada pela incerteza dos anteriores;
  desenhá-la afirmaria precisão que a soma não tem. As outras medidas levam a
  régua no readout em HTML, na mesma escala 0–100 da barra.
- **Ponto `null` interrompe a linha.** Nunca interpolado, nunca zero — zero aqui
  afirmaria que todo mundo tem candidato. Grandeza sem medida na barra deixa o
  trecho **vazado** e rotulado "sem medida"; a barra não fecha 100 à força.
- **Identidade visual própria.** O acento de interface marca a grandeza "sem
  candidato" nas duas formas de pergunta (é a mesma ideia medida de dois jeitos);
  branco/nulo herda o grafite que já usa no gráfico do eleitorado. Nenhuma cor
  do espectro de candidatos: não são candidatura.
- **Componente de série próprio, geometria compartilhada.** O gráfico do
  eleitorado (estimulada) e este (espontânea) precisam ser distinguíveis à
  primeira vista, senão o leitor conclui que o site publica dois valores
  contraditórios para a mesma grandeza. A lógica load-bearing (segmentos,
  vãos, ponto isolado) é reusada de `electorate-geometry.ts`.
- **Estado vazio explicado.** `spontaneous === null` diz que nenhum instituto
  publicou o cenário e por que isso é comum; série toda `null` tem frase
  própria. Nenhum eixo vazio, nenhuma seção que desaparece sem explicação.

## Gates

- `pnpm --filter @election-pool/web typecheck` → 0 erros, 0 warnings
  (1 hint pré-existente em `Num.astro`), sem `@ts-ignore`.
- `pnpm --filter @election-pool/web lint` → OK, nenhum dígito solto.
- `pnpm --filter @election-pool/web build` → 3 páginas, sem warning.
- Caminhos de borda verificados construindo variantes da amostra:
  `spontaneous: null`, série inteira `null`, e ponta faltando na data do
  retrato (barra com vão vazado em vez de zero).
