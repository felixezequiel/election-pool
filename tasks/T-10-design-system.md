---
id: T-10
title: Design system — tokens, tipografia, movimento, dark-first
status: done
depends_on: [T-01]
owns: [apps/web/src/styles/**, apps/web/src/components/Num.astro, apps/web/src/components/Substrate.astro]
spec: docs/05-DESIGN-SYSTEM.md
---

# T-10 — Design system

Antes de escrever CSS, leia `docs/05` inteiro. A direção é **instrumento vivo**:
moderno, escuro por padrão, com movimento como camada de primeira classe — mas a
incerteza continua dominante e todo número traz sua régua.

## Entregável

- `tokens.css`: variáveis de `docs/05` §2 com **escuro como padrão** (`:root`), claro
  via `[data-theme="light"]` e `prefers-color-scheme: light`. Inclui os tokens de
  movimento de `docs/05` §6 (durações e easings)
- Carregamento de fontes: Bricolage Grotesque, Source Serif 4, IBM Plex Mono.
  Subset latin + latin-ext, `font-display: swap`, preload das duas primeiras
- Escala tipográfica de §3.2 como classes utilitárias. Peso alto permitido em display
- **`<Substrate>`**: a **grade sutil moderna** de página inteira (não papel milimetrado).
  Linhas finíssimas de baixíssima opacidade (`--grid`), um pouco mais visíveis sob os
  gráficos, alinhada ao ritmo vertical de 8px do conteúdo
- **`<Num>`**: envolve todo numeral em IBM Plex Mono com
  `font-variant-numeric: tabular-nums lining-nums`
- **`<AnimatedNum>`**: variante que interpola o valor ao entrar e ao atualizar, sem
  reflow. Sob `prefers-reduced-motion`, mostra o valor final direto
- Regra de lint proibindo dígito solto em texto JSX/Astro fora de `<Num>`
- Grade de 12 colunas, `max-width: 1200px`, utilitário de sangria para gráficos

## Aceite

- [ ] Contraste AA em todo texto, AAA no corpo, nos dois temas — verificado, não presumido
- [ ] Foco de teclado visível em todo elemento interativo. Nenhum `outline: none`
- [ ] A grade permanece contínua e alinhada ao rolar; não "salta" entre seções
- [ ] Em 375px a grade não vira ruído visual: densidade fina some abaixo de 480px
- [ ] Lint de `<Num>` pega `<p>São 40 pesquisas</p>` e aceita `<p>São <Num>40</Num> pesquisas</p>`
- [ ] Nenhum anti-padrão de `docs/05` §8 presente
- [ ] Tema padrão é escuro; alternância para claro sem flash
- [ ] Tokens de movimento aplicados; `prefers-reduced-motion` zera transições

## Armadilhas

- A grade é **substrato**, nunca acento. Nenhum botão, link ou destaque compete com ela
- Gradiente, sombra e radius são permitidos — mas não podem derrubar o contraste de
  texto abaixo do piso de acessibilidade (`docs/05` §7)
- Animar número nunca dispensa a `UncertaintyRule` ao lado (`docs/05` §1.1)
