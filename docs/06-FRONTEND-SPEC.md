# Frontend

## 1. Stack

Astro com `output: 'static'`, **tema escuro por padrão**. A base é HTML estático
renderizado no build; JavaScript entra como camada de animação e interação — não é
"zero JS", é JS a serviço da experiência, dentro do orçamento de §7.

| Ilha | Diretiva | Motivo |
|---|---|---|
| `LatentBandChart` | `client:load` | Animação de entrada, scrub, tooltip, teclado |
| `HouseEffectPlot` | `client:visible` | Animação de entrada, tooltip |
| `NextUpdateCountdown` | `client:load` | Contagem regressiva ao vivo (§9) |
| `AnimatedNum` | `client:visible` | Números que animam ao entrar e ao atualizar |
| `ThemeToggle` | `client:idle` | Alterna tema; o padrão é escuro |

Progressive enhancement continua valendo: os SVGs de gráfico são **renderizados no
build**, com os mesmos componentes que a ilha hidrata — o gráfico aparece completo e
correto antes de qualquer JS. Se o JS falhar, o site continua legível, apenas sem as
animações. A animação é enriquecimento, nunca pré-requisito para ler o dado.

Entrada de dados: `data.json` importado em build time. Sem fetch em runtime.

## 2. Estrutura da página

Página única, `/`. Rotas adicionais: `/metodologia`, `/dados`.

```
┌ 01 CABEÇALHO ─────────────────────────────────────────────┐
│  election-pool                      metodologia · dados   │
└───────────────────────────────────────────────────────────┘
┌ 02 TESE (hero) ───────────────────────────────────────────┐
│  display-xl. Não é um número — é uma frase sobre          │
│  incerteza. Ver §4.                                        │
│  Abaixo: as duas leituras principais, cada uma com sua     │
│  UncertaintyRule em escala real, lado a lado.              │
└───────────────────────────────────────────────────────────┘
┌ 03 SÉRIE LATENTE (bleed, 12 col) ─────────────────────────┐
│  LatentBandChart — 1º turno, últimos 90 dias.             │
│  Bandas dominantes, pontos das pesquisas por trás.        │
└───────────────────────────────────────────────────────────┘
┌ 04 SEGUNDO TURNO ─────────────────────────────────────────┐
│  Um LatentBandChart por par testado. Grade 2 col ≥1024px. │
└───────────────────────────────────────────────────────────┘
┌ 05 HOUSE EFFECT ──────────────────────────────────────────┐
│  A seção que justifica o projeto. HouseEffectPlot +       │
│  parágrafo explicando o que o número significa E o que    │
│  ele não significa (restrição soma-zero).                 │
└───────────────────────────────────────────────────────────┘
┌ 06 DIAGNÓSTICOS ──────────────────────────────────────────┐
│  Taxa de gaveta (instituto e contratante) · herding.      │
│  Cada um com explicação inocente ao lado. Ver §5.         │
└───────────────────────────────────────────────────────────┘
┌ 07 AS PESQUISAS ──────────────────────────────────────────┐
│  PollStrip de todas as pesquisas da janela. tse_id sempre │
│  visível, link para a fonte.                              │
└───────────────────────────────────────────────────────────┘
┌ 08 O QUE ESTE MODELO NÃO FAZ ─────────────────────────────┐
│  docs/01 §10, na íntegra. Não resumir.                    │
└───────────────────────────────────────────────────────────┘
┌ 09 OUTRAS DISPUTAS (CTA) ─────────────────────────────────┐
│  Ver §6.                                                   │
└───────────────────────────────────────────────────────────┘
┌ 10 RODAPÉ ────────────────────────────────────────────────┐
│  Gerado em · model_version · git_sha · licenças · fontes  │
└───────────────────────────────────────────────────────────┘
```

## 3. Regras de renderização

- Todo número passa por `<Num>` (`docs/05` §3.1)
- Todo número de destaque tem `UncertaintyRule` adjacente. Sem exceção
- Toda pesquisa citada mostra `tse_id`
- Nenhum texto de terceiros é exibido; só números, metadata e **link** para a fonte
- Datas em `DD/MM` no corpo, ISO completo em `<time datetime>`
- Percentuais com 1 casa decimal, separador decimal vírgula
- `generatedAt` visível no cabeçalho, não só no rodapé. Staleness é informação
- Próxima atualização exibida como contagem regressiva ao vivo `HH:MM:SS` (§9)

## 4. Copy do hero

O herói **não** é "Lula 40,8%". Um número grande sozinho é exatamente o gênero que
este projeto critica. O herói é a tese.

```
eyebrow   PRESIDÊNCIA · 2026 · ATUALIZADO EM 14/08 ÀS 15H

display   O que as pesquisas medem,
          e o quanto elas discordam.

corpo     Reunimos todas as pesquisas nacionais registradas no TSE, estimamos
          uma série de apoio ao longo do tempo e — a parte que ninguém publica —
          o quanto cada instituto se afasta do consenso, de forma sistemática.
          Nenhum número aqui aparece sem a faixa de incerteza que o acompanha.

          [dois blocos: candidato, valor em data-xl que **anima** ao entrar,
           UncertaintyRule em escala real — o número anima, a régua permanece]

nota      Isto não é uma previsão de resultado. É uma leitura de agora, com o
          erro que ela carrega.
```

Diretrizes de escrita (valem para todo o site):

- Voz ativa, frases curtas, sem jargão sem definição
- Nunca "revela", "aponta", "cravou", "dispara", "encosta". Vocabulário de jornal
  político é proibido
- Nunca adjetivar candidato ou instituto. `divergente` é descrição de propriedade
  mensurável e é o limite
- Estado vazio (sem pesquisa na janela) é convite, não desculpa:
  "Nenhuma pesquisa nacional com campo encerrado nos últimos 45 dias. A última foi
  em DD/MM." — nunca "Ops, nada aqui!"

## 5. Seção de diagnósticos — regra especial

Esta é a seção com maior potencial de dano. Requisitos rígidos:

- Cada indicador aparece **junto** com sua explicação inocente, no mesmo bloco
  visual, no mesmo tamanho de tipo. Não em tooltip, não em nota de rodapé.
- Taxa de gaveta: exibir sempre "X de Y registradas" ao lado da razão. Uma taxa de
  100% sobre 1 registro não pode parecer igual a 60% sobre 20.
- Herding: exibir sempre o `n` da janela e uma linha dizendo que com `n` pequeno o
  teste tem pouca potência.
- Vocabulário proibido em toda a seção: "comprada", "fraude", "manipulada",
  "suspeita", "encomendada" no sentido pejorativo.
- Vocabulário aprovado: "registrada e não divulgada", "dispersão abaixo do
  esperado", "consistentemente acima/abaixo do consenso".

## 6. CTA de outras disputas (§7 do PRD)

```
eyebrow   PRÓXIMAS ANÁLISES

display-l A mesma metodologia,
          em breve, para outras disputas.

corpo     O modelo não sabe que corrida está medindo. Ele só precisa de vários
          institutos medindo a mesma coisa ao longo do tempo. Isso vale para
          governo estadual, Senado e aprovação presidencial — e é o que vem
          a seguir.

lista     Governos estaduais    planejado
          Senado                planejado
          Aprovação presidencial planejado
```

- Renderizado a partir de `data.otherRaces`, nunca hardcoded em JSX
- Item `planejado`: rótulo em `label` mono, cor `--ink-3`, sem link, `aria-disabled`
- **Sem campo de e-mail, sem "avise-me", sem botão.** Não coletamos dado de ninguém,
  e dizer isso é mais forte que um formulário
- Visualmente: bloco em `--surface` sobre a grade, régua superior de 1px, ocupando
  8 colunas. Deve ser claramente menos denso que as seções de dado — é uma pausa

## 7. Desempenho

| Métrica | Meta |
|---|---|
| JS enviado (comprimido) | < 120 KB |
| LCP em 4G simulado | < 1,8s |
| CLS | < 0,02 |
| Fontes | 3 famílias, subset latin + latin-ext, preload das 2 primeiras |
| `data.json` | < 500 KB; se passar, paginar as pesquisas antigas para `/dados` |

Nenhum script de terceiros. Nenhum analytics na v1. Se depois for necessário,
algo self-hosted e sem cookie.

## 8. Auditoria visual (gate de M3)

Antes de declarar a UI pronta, verificar item a item:

- [ ] Em 375px, 768px e 1440px, nos temas claro e escuro
- [ ] Navegação completa por teclado, foco sempre visível
- [ ] Com JS desativado: a página é legível e os gráficos aparecem
- [ ] `prefers-reduced-motion: reduce`: nada anima, nada quebra
- [ ] Impressa em P&B: séries ainda distinguíveis (hachura, `docs/05` §2.1)
- [ ] Nenhum número de destaque sem `UncertaintyRule`
- [ ] Nenhum dígito fora de `<Num>`
- [ ] Nenhum anti-padrão de `docs/05` §8
- [ ] Toda pesquisa exibida mostra `tse_id`
- [ ] Leitor de tela: cada gráfico tem `<desc>` que faz sentido lido em voz alta
- [ ] Números que animam usam `tabular-nums` e não causam reflow (CLS < 0,02)
- [ ] `NextUpdateCountdown` conta certo, faz rollover ao zerar e mostra valor estático
      sob `prefers-reduced-motion`
- [ ] Tema padrão é escuro no primeiro carregamento, sem flash de tema claro

## 9. Contagem regressiva — próxima atualização

O pipeline roda a cada 2 horas (`docs/02` §3). O `data.json` carrega `nextUpdateAt`
(ISO com offset `-03:00`) e `updateIntervalMinutes`. O componente `NextUpdateCountdown`:

- Mostra **`Próxima atualização em HH:MM:SS`**, tiquetaqueando a cada segundo, com o
  tempo em `<Num>` monoespaçado (`tabular-nums`, sem reflow).
- Fica no cabeçalho, ao lado de `generatedAt`. Discreto — não compete com o dado.
- **Rollover:** se o contador zera e a página não foi recarregada (um build novo pode
  demorar, ou um run pode não publicar por reprovar nos gates), soma
  `updateIntervalMinutes` e passa para o próximo horário; enquanto isso mostra
  "verificando…".
- **Honestidade:** a copy deixa claro que é quando o sistema **recheca as fontes** — nem
  toda checagem traz número novo (só publica quando passa nos gates e há pesquisa nova,
  `docs/07` §6). Nunca prometer "número novo às HH:MM".
- `prefers-reduced-motion` / sem JS: mostra o horário-alvo estático
  ("Próxima atualização prevista para DD/MM às HH:MM"), sem tiquetaque.
