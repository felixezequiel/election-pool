---
id: T-11
title: Componentes de gráfico em SVG
status: done
depends_on: [T-10]
owns: [apps/web/src/components/charts/**]
spec: docs/05-DESIGN-SYSTEM.md §5, §6
---

# T-11 — Gráficos

**Nenhuma biblioteca de gráfico pronta.** D3 só para `scaleTime`, `scaleLinear`,
`line`, `area`, `axis*`. O SVG é nosso.

Regra que governa tudo: **a banda de incerteza é dominante, a linha central é
secundária.** Banda preenchida a 22%, linha a 1,5px e 60% de opacidade. Se parecer
estranho, está certo — `docs/00` O3.

## Entregável

- `LatentBandChart` — série `μ_t` com banda 90%, pontos das pesquisas individuais
  a 40% de opacidade, raio 3px. Tooltip com instituto, contratante, `tse_id`, `n`,
  datas e valores. Navegável por teclado com setas
- `UncertaintyRule` — **a régua**. Barra horizontal com a banda em escala real e
  marca central. Acompanha todo número de destaque
- `HouseEffectPlot` — dot plot com IC 90% por instituto, zero enfatizado.
  `estimable: false` aparece esmaecido com `—`
- `PollStrip` — uma linha por pesquisa, SVG alinhado à grade, `tse_id` em mono
- `DiagnosticGauge` — valor sempre acompanhado do `n`, no mesmo tamanho de tipo
- Hachuras `<pattern>` por `color_slot`, 4 variantes rotacionadas
- Orquestração de load de `docs/05` §6: bandas crescem **antes** das linhas
- **Scrub**: cursor vertical na série; valores da data animam em `<AnimatedNum>`
- **Transição de atualização**: quando um novo run publica, banda e números interpolam
  do valor antigo ao novo, sem "pulo"

Todos renderizam idêntico no servidor e no cliente. O SVG do build é completo;
a hidratação só adiciona interação.

## Aceite

- [ ] Cada gráfico tem `role="img"`, `<title>` e `<desc>` com leitura em prosa útil
- [ ] Cada gráfico tem `<details>` com tabela HTML real, presente no DOM, fechada
- [ ] Sem JS: gráficos aparecem completos e corretos
- [ ] `prefers-reduced-motion: reduce`: estado final imediato, nada quebra
- [ ] Em P&B as séries continuam distinguíveis pela hachura
- [ ] Teclado navega entre pontos; foco visível; `Escape` fecha tooltip
- [ ] Números animam (entrada e atualização) sem reflow; sob `prefers-reduced-motion`
      aparecem no valor final
- [ ] Scrub e tooltip funcionam por mouse e por teclado; foco visível
- [ ] Zoom/pan/brush ficam fora da v1 (decisão de UX, `docs/05` §5.1)

## Armadilhas

- Não inverta a hierarquia banda/linha "para melhorar a legibilidade"
- Cor segue a entidade, nunca a posição. Reordenar não repinta
