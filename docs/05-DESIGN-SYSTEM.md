# Design system

## 1. Direção: instrumento vivo

Este site é um **instrumento de medição** — mas moderno, escuro e vivo. A honestidade
sobre incerteza continua sendo a tese (a banda domina, todo número traz sua régua),
agora expressa numa interface contemporânea: movimento como camada de primeira classe,
transições em tudo, números que animam ao entrar e ao atualizar, profundidade por luz,
gradiente e sombra. Rigor de laboratório com acabamento de produto de 2026 — não folha
de papel milimetrado.

### 1.1 A regra que não muda: a incerteza é dominante

> **A banda de incerteza é o elemento visualmente dominante. A linha central é
> secundária.**

Todo agregador faz o contrário: linha grossa, banda pálida. Aqui a banda é preenchida
de forma generosa (com gradiente e glow no tema escuro) e a linha central é discreta.
**Nenhum número de destaque aparece sem sua régua de incerteza ao lado, na mesma
escala — nem mesmo os números animados.** Animar é apresentação; a banda continua
obrigatória. Isso é `docs/00` O3 e a tese do projeto. Não inverta essa hierarquia
"para melhorar a legibilidade".

### 1.2 Tema: escuro por padrão

O tema **escuro é o padrão**. É o ambiente natural para leitura de dado denso e séries
temporais, e é onde o glow das bandas e o brilho dos acentos funcionam. O tema claro
existe como alternativa acessível, via `ThemeToggle` e `prefers-color-scheme: light`.

O fundo **não** é papel milimetrado. É uma **grade sutil moderna**: linhas finíssimas,
de baixíssima opacidade, que dão referência espacial sem virar textura retrô. No escuro
ela é quase imperceptível e aparece um pouco mais forte só sob os gráficos, reforçando
que ali é a área de plotagem.

## 2. Cor

Dark-first. As variáveis abaixo são o **padrão**; `[data-theme="light"]` sobrescreve.

```css
/* Escuro — padrão */
:root {
  --bg:            #0B0D11;
  --bg-elevated:   #14181F;
  --surface:       rgba(255, 255, 255, 0.045);
  --surface-2:     rgba(255, 255, 255, 0.07);
  --grid:          rgba(255, 255, 255, 0.035);  /* grade sutil, substitui o milimetrado */
  --border:        rgba(255, 255, 255, 0.09);
  --border-strong: rgba(255, 255, 255, 0.18);
  --ink:           #F3F5F8;
  --ink-2:         #A6ADBA;
  --ink-3:         #656C79;
  --accent:        #6E9BFF;                      /* único acento de interface */
  --accent-2:      #9B7BFF;
  --glow:          rgba(110, 155, 255, 0.30);    /* brilho de foco/hover */
}

/* Claro — alternativa */
[data-theme="light"] {
  --bg:            #FBFBFD;
  --bg-elevated:   #FFFFFF;
  --surface:       rgba(12, 14, 20, 0.028);
  --surface-2:     rgba(12, 14, 20, 0.05);
  --grid:          rgba(12, 14, 20, 0.04);
  --border:        rgba(12, 14, 20, 0.10);
  --border-strong: rgba(12, 14, 20, 0.20);
  --ink:           #12141A;
  --ink-2:         #565C67;
  --ink-3:         #8A909B;
  --accent:        #2F5BD8;
  --accent-2:      #6B45C4;
  --glow:          rgba(47, 91, 216, 0.18);
}
```

Gradiente, glow e sombra suave **são permitidos** e fazem parte da profundidade do tema
escuro — desde que não derrubem o contraste de texto abaixo do piso de acessibilidade
(§7). Elevação pode usar sombra e blur de fundo, não só régua de 1px.

### 2.1 Espectro de candidatos

Valores otimizados para o fundo escuro (padrão); o tema claro escurece cada um ~12% de
luminosidade. Valores nas duas variantes em `packages/contracts/palette.ts`.

```css
--c1: #4F93D9;  /* azul       */
--c2: #E8703F;  /* laranja    */
--c3: #3F9E6E;  /* verde      */
--c4: #9B7BEE;  /* violeta    */
--c5: #D0A93B;  /* ocre       */
--c6: #E15C82;  /* carmim     */
--c7: #3FB6C9;  /* ciano      */
--c8: #8791A0;  /* grafite — reservado para "Demais" */
```

**Três regras não-negociáveis** (metodologia, não estética):

1. **Cores não são partidárias.** Não usamos vermelho para PT nem azul para PL. Cor
   partidária ativa leitura afetiva antes da leitura do dado.
2. **Cor segue a entidade, nunca a posição.** `color_slot` é fixo no cadastro do
   candidato. Filtrar, ordenar ou reordenar **nunca** repinta.
3. **Cor nunca é o único diferenciador.** Toda série tem também um padrão: hachura
   própria por slot (`<pattern>` SVG). Suficiente para daltônicos e impressão P&B.

## 3. Tipografia

Três papéis, três famílias. Todas via `fonts.googleapis.com`, `font-display: swap`,
preload das duas primeiras.

| Papel | Família | Uso |
|---|---|---|
| Display | **Bricolage Grotesque** (variável: `opsz`, `wdth`, `wght`) | Títulos e destaques. **Peso alto e largura variável são bem-vindos** — expressividade faz parte da personalidade moderna |
| Texto | **Source Serif 4** | Corpo, metodologia, notas. A serifa dá o peso editorial que sustenta a credibilidade |
| Dados | **IBM Plex Mono** | **Todo numeral do site**: percentuais, datas, tamanhos de amostra, códigos TSE |

### 3.1 A regra do numeral monoespaçado

Todo número, em qualquer contexto — inclusive no meio de uma frase em prosa — em IBM
Plex Mono com `font-variant-numeric: tabular-nums lining-nums`.

Isso é dispositivo de assinatura, resolve o alinhamento de colunas e, crucialmente,
**permite animar o valor sem reflow**: com largura constante por dígito, um número pode
transicionar de um valor a outro sem empurrar o layout. Componente `<Num>` envolve o
valor; um lint proíbe dígito solto fora dele.

### 3.2 Escala

```
display-xl   clamp(2.75rem, 6.5vw, 5rem)    Bricolage  wght 500–700  ls -0.03em
display-l    clamp(1.9rem, 3.6vw, 2.8rem)   Bricolage  wght 500–650  ls -0.02em
display-m    1.4rem                          Bricolage  wght 550       ls -0.01em
body         1.0625rem / 1.65               Source Serif 4  wght 400
body-s       0.9375rem / 1.6                Source Serif 4  wght 400
label        0.75rem  uppercase ls 0.09em   IBM Plex Mono   wght 500
data-xl      clamp(2.5rem, 6vw, 4rem)       IBM Plex Mono   wght 500
data         1rem                            IBM Plex Mono   wght 400
```

Peso alto em display é permitido para dar presença moderna. Sentence case no corpo;
`label` em caixa alta como eyebrow de seção.

## 4. Layout

Grade de 12 colunas, `max-width: 1200px`, gutter 24px (16px no mobile).

Os gráficos **sangram além do container** de texto: texto ocupa 8 colunas, gráficos
ocupam 12. O dado é o protagonista; o texto é comentário.

Cartões usam `--surface` com `--border` de 1px, sombra suave e, no escuro, leve blur de
fundo — deixam a grade transparecer. Espaçamento vertical em múltiplos de 8px.

Breakpoints: `480 / 768 / 1024 / 1400`.

## 5. Componentes de gráfico

Todos SVG, renderizados por nós. D3 só para `scaleTime`, `scaleLinear`, `line`, `area`
e `axis*`. **Nenhuma biblioteca de gráfico pronta** (`CLAUDE.md`) — mas a animação é
nossa e é bem-vinda.

| Componente | Função |
|---|---|
| `LatentBandChart` | Herói. Série `μ_t` com banda 90%. **Banda dominante** (fill com gradiente/glow), linha discreta. Pontos das pesquisas individuais em opacidade baixa |
| `UncertaintyRule` | **A régua.** Barra horizontal com a banda de credibilidade em escala real, marca central. Aparece sob todo número de destaque, inclusive os animados |
| `HouseEffectPlot` | Dot plot com IC 90% por instituto, eixo centrado em zero enfatizado. `estimable: false` aparece esmaecido com "—" |
| `PollStrip` | Uma linha por pesquisa: instituto, datas, `tse_id` em mono, valores. SVG alinhado à grade |
| `DiagnosticGauge` | Taxa de gaveta e razão de herding, sempre com o `n` ao lado, em tipo igual ao do valor |

### 5.1 Interação e animação

- **Entrada:** bandas crescem a partir da mediana, depois as linhas em fade, depois os
  pontos — a incerteza aparece **antes** da estimativa (a ordem é o argumento).
- **Hover/focus** em ponto de pesquisa: tooltip animado com instituto, contratante,
  `tse_id`, `n`, datas e valores. **Scrub** ao longo da série move um cursor vertical e
  os valores da data animam em `<Num>`. Acessível por teclado (setas navegam pontos).
- **Atualização de dado** (novo run publicado): banda e números transicionam suavemente
  do valor antigo para o novo — sem "pulo".
- **Zoom/pan/brush ficam fora da v1** — não por dogma anti-interação, mas porque numa
  série temporal curta atrapalham mais que ajudam. Reavaliar se houver demanda real.
- Legenda sempre visível, nunca só em hover.

## 6. Movimento

Movimento é **camada de primeira classe**, não enfeite. Guia atenção, expressa mudança
e dá o acabamento moderno — sempre a serviço da leitura, nunca contra ela.

Tokens de movimento:

```
--ease-out:   cubic-bezier(0.22, 0.61, 0.36, 1)
--ease-inout: cubic-bezier(0.65, 0, 0.35, 1)
--dur-fast:   140ms
--dur-base:   260ms
--dur-slow:   560ms
--dur-chart:  700ms
```

Onde há movimento:

1. **Load orquestrado dos gráficos:** eixos e grade instantâneos (são substrato); bandas
   crescem verticalmente (700ms, `--ease-out`, escalonadas 80ms por candidato); linhas
   centrais em fade (300ms); pontos das pesquisas em fade escalonado (400ms).
2. **Números animam ao entrar e ao atualizar** — interpolação de valor em `<Num>`
   (`tabular-nums` evita reflow). Isto **substitui** a antiga proibição de *count-up*:
   número que anima está **certo**, desde que anime até um valor acompanhado da sua
   régua de incerteza.
3. **Contagem regressiva ao vivo** para a próxima atualização — `HH:MM:SS`,
   tiquetaqueando a cada segundo (`NextUpdateCountdown`, ver `docs/06` §9).
4. **Scroll-reveal** suave de seções (fade + leve translate), uma vez cada, sem parallax
   exagerado.
5. **Hover/foco:** 140ms — opacidade, escala e glow.
6. **Transição de tema** claro↔escuro suave.

`prefers-reduced-motion: reduce` ⇒ **estado final imediato, zero transição; contadores e
números mostram o valor estático**. É um caminho de código testado, não degradação — a
acessibilidade é piso, não opcional.

## 7. Acessibilidade (piso, não aspiração)

- Contraste AA em todo texto; AAA no corpo. **Gradiente, glow e sombra nunca podem
  derrubar o contraste abaixo desse piso** — testar, não presumir.
- Foco de teclado visível: contorno de 2px em `--accent`, offset 2px. Nunca `outline: none`.
- Todo SVG de dado tem `role="img"` + `<title>` + `<desc>` com a leitura em prosa.
- Toda visualização tem equivalente textual: `<details>` com tabela HTML real, presente
  no DOM, fechado por padrão.
- Cor nunca sozinha (§2.1 regra 3).
- Todo número animado tem `aria-label`/`aria-live` educado com o valor-alvo, e mostra o
  valor final estático sob `prefers-reduced-motion`.

## 8. Anti-padrões proibidos

Rejeitar em revisão:

- **Número de destaque sem `UncertaintyRule`** (a tese — inegociável)
- Inverter a hierarquia banda/linha "para melhorar a legibilidade"
- Cor partidária, ou cor como **único** diferenciador de série (§2.1)
- Bandeira, silhueta de candidato, urna ou mapa do Brasil estilizado
- Vermelho/verde como **único** sinal de variação — sempre acompanhar de seta e rótulo
  (segurança para daltônicos)
- Movimento que não serve à leitura: parallax pesado, carrossel automático, confete,
  micro-interação gratuita que distrai do dado
- Emoji em conteúdo de dado

> Nota: gradiente, sombra, border-radius e número animado (*count-up*) **deixaram de ser
> proibidos** — passam a fazer parte da linguagem moderna do produto. O que permanece
> inegociável é a honestidade sobre incerteza e a neutralidade partidária.
