# Metodologia

> Este documento é a fonte de verdade do projeto. Contradição com qualquer outro
> arquivo resolve a favor deste. Mudanças aqui exigem incrementar `MODEL_VERSION`
> e registrar em `docs/CHANGELOG-MODEL.md` **antes** de rodar o modelo novamente.

`MODEL_VERSION = 1.0.0`

---

## 1. O problema de identificação

Modelamos cada observação como:

```
y_it = μ_t + h_i + ε_it
```

- `y_it` — percentual medido pelo instituto `i` no tempo `t` (data mediana do campo)
- `μ_t` — apoio latente verdadeiro no tempo `t`
- `h_i` — house effect do instituto `i` (viés sistemático, constante dentro do ciclo)
- `ε_it` — erro amostral, `~ N(0, σ_i²)`

**Este sistema é subidentificado.** Somar uma constante `c` a todo `μ_t` e subtrair
`c` de todo `h_i` produz exatamente os mesmos `y_it`. É preciso impor uma restrição,
e a escolha da restrição é uma decisão metodológica com consequência — não um
detalhe de implementação.

### 1.1 Restrição adotada

Adotamos **soma ponderada dos house effects igual a zero**:

```
Σ_i (w_i · h_i) = 0,  onde w_i = número de pesquisas do instituto i na janela
```

Ponderamos pelo volume para que um instituto que publicou 12 rodadas não seja
âncora com o mesmo peso de um que publicou 1.

**O que isso significa e o que não significa.** Isso define `μ_t` como "o consenso
dos institutos, limpo da composição desigual de quem publicou em cada semana".
Não significa que `μ_t` seja não-enviesado em relação à urna. Se todos os institutos
errarem na mesma direção — como ocorreu no 1º turno de 2022 — `μ_t` erra junto e o
modelo não tem como saber.

Esta limitação deve aparecer na UI, literalmente, no bloco de metodologia. Não é
letra miúda.

### 1.2 Por que não ancoramos em resultados eleitorais

Ancorar `h_i` no erro histórico contra as urnas (2018, 2022, 2024) mediria viés
*absoluto* e seria melhor. Não fazemos isso na v1 por três razões:

1. Institutos mudaram metodologia depois de 2022 justamente por causa do erro. Um
   `h_i` de 2022 pode ser um péssimo prior para 2026.
2. O erro de 2022 foi assimétrico entre candidatos, não uniforme por instituto.
   Modelar isso exigiria `h_ij` (instituto × candidato) e a amostra de eleições é
   pequena demais para identificá-lo.
3. Corrigir direcionalmente com base no último ciclo é o modo de falha clássico de
   agregadores. É "lutar a guerra passada".

O erro histórico **é calculado e exibido** como contexto descritivo (§7), e é usado
para o backtest (§8), mas **não entra no prior de `h_i` na v1.0.0**.

---

## 2. Série latente

`μ_t` segue um passeio aleatório gaussiano de tempo discreto, passo diário:

```
μ_t ~ N(μ_{t-1}, σ_process²)
```

`σ_process = 0.25` p.p./dia.

Origem do número: opinião eleitoral agregada raramente se move mais que ~2 p.p. por
semana fora de choque; `0.25 · √7 ≈ 0.66` p.p. de desvio semanal permite ~2 p.p. em
3 desvios. Este é um parâmetro **de prior, não ajustado aos dados** — se mexer nele,
é mudança de modelo (R1 em `CLAUDE.md`).

Estimação: **filtro de Kalman com suavização RTS** (forward filter, backward smooth).
Implementação em `packages/model/kalman.ts`, pura, sem I/O.

Estado multivariado: um `μ_t` por candidato rastreado. Tratamos os candidatos como
independentes no processo, mas **a soma é restringida na saída** (§4.3). Correlação
completa entre candidatos fica como melhoria futura (`docs/OPEN-QUESTIONS.md`).

---

## 3. Cenário canônico

Uma pesquisa publica múltiplos cenários estimulados. Precisamos de uma regra
determinística, senão comparamos coisas diferentes.

**Regra:** para cada pesquisa, o cenário canônico de 1º turno é aquele que:

1. Contém o maior número de candidatos com registro de candidatura confirmado no
   TSE (após as convenções) ou pré-candidatura pública (antes);
2. Em caso de empate na regra 1, o que contém o maior número total de nomes;
3. Em caso de empate na regra 2, o primeiro na ordem de publicação do instituto.

A regra aplicada e o motivo ficam gravados em `poll_scenarios.canonical_reason`.
Cenários não-canônicos são armazenados mas **não entram no modelo**.

Cenários de 2º turno são pareados por `(candidato_a, candidato_b)` normalizado em
ordem alfabética, e cada par vira uma série independente.

---

## 4. Tratamento dos números

### 4.1 Escala

Trabalhamos em **intenção bruta** (o número que o instituto publica), não em votos
válidos. Motivo: nem todo instituto publica válidos, e reconstruí-los exige saber
brancos/nulos/indecisos, que nem sempre são divulgados separadamente.

Votos válidos são calculados e exibidos **como derivada**, apenas quando a pesquisa
divulga a decomposição completa, e sempre marcados como tal na UI.

### 4.2 Erro amostral

```
σ_sampling_i = sqrt( p·(1-p) / n_i ) · 100
```

com `p` = estimativa corrente de `μ_t` para o candidato (não o valor observado —
evita heterocedasticidade induzida pelo próprio dado).

Adicionamos variância extra de projeto amostral (*design effect*), porque nenhum
instituto brasileiro usa amostragem aleatória simples:

```
σ_i² = deff · σ_sampling_i²  +  σ_house_extra²
```

- `deff = 1.5` — inflação típica de amostragem por cotas com estratificação.
- `σ_house_extra = 1.0` p.p. — variância residual não capturada por `h_i`.

Ambos são priors fixos, documentados, não ajustados.

### 4.3 Restrição de soma

Depois da suavização, os `μ_t` de todos os candidatos rastreados mais o resíduo
("Demais" + brancos/nulos + indecisos) devem somar 100. Aplicamos normalização
proporcional **apenas sobre os candidatos rastreados**, preservando a fatia de
resíduo estimada pela mediana das pesquisas da janela. Se o desvio pré-normalização
exceder 3 p.p., isso é um sinal de erro de ingestão: **lança e bloqueia publicação**.

### 4.4 Ponderação por recência

Peso de recência aplicado à precisão da observação:

```
w_recency = exp( -Δdias / τ ),  τ = 14 dias
```

`Δdias` = dias entre a data mediana do campo e a data de referência do run.
Observações com `Δdias > 45` são excluídas da janela ativa.

`τ = 14` é um prior. Não ajuste para "melhorar" o gráfico.

---

## 5. Estimação de house effect

`h_i` é estimado conjuntamente com `μ_t` por máxima verossimilhança sobre a janela
completa do ciclo (não só a janela ativa de 45 dias — house effect precisa de
histórico longo para ser identificável).

Prior: `h_i ~ N(0, 2.0²)` p.p. Regularização fraca, que puxa institutos com poucas
observações em direção a zero sem sufocar sinal real de quem tem muitas.

**Requisito mínimo:** instituto com menos de 3 pesquisas no ciclo recebe
`h_i = 0` fixo e é marcado `house_effect_estimable: false`. A UI mostra "—" em vez
de um número, não um zero.

`h_i` é reportado com intervalo de credibilidade de 90%. Um instituto cujo IC
cruza zero não é descrito como enviesado, em nenhum texto da UI.

---

## 6. Detecção de anomalias

Três indicadores, calculados e publicados. **Nenhum deles altera o agregado.** São
diagnóstico, não correção — porque cada um tem explicação inocente plausível.

### 6.1 Taxa de engavetamento

```
gaveta_i = 1 - (pesquisas divulgadas / pesquisas registradas no PesqEle)
```

Contadas apenas pesquisas cuja janela de divulgação já passou (registro + 5 dias
+ carência de 15 dias).

Cortes por `instituto` e por `contratante`. O corte por contratante é o mais
informativo: o mesmo instituto pode ter taxa diferente conforme quem paga.

Explicação inocente a ser exibida junto: pesquisas internas de campanha são
registradas e legitimamente nunca divulgadas.

### 6.2 Teste de herding

Para cada janela de 7 dias com ≥ 4 pesquisas do mesmo cenário:

```
s²_observado  = variância amostral dos y_it entre institutos
s²_esperado   = média dos σ_i² (§4.2)
ratio         = s²_observado / s²_esperado
```

`ratio < 0.5` é sinalizado. Interpretação: dispersão menor que a teoria amostral
prevê sugere que institutos estão se ajustando uns aos outros.

Exibir sempre com o `n` da janela — com 4 pesquisas o teste tem pouquíssima potência.

### 6.3 Divergência persistente

Instituto cujo `|h_i|` excede 3 p.p. **e** cujo IC de 90% não cruza zero é marcado
`divergente`. Rótulo neutro na UI: "consistentemente acima/abaixo do consenso".
Nunca "enviesado", "suspeito" ou "comprado".

---

## 7. Erro histórico (descritivo)

Para cada instituto, calculamos e exibimos o erro da última pesquisa antes de cada
eleição contra o resultado oficial, por candidato, para: 1º e 2º turno de 2018,
2022 e a eleição municipal de 2024 (capitais).

Métrica: erro absoluto médio por candidato, e **erro assinado** por candidato — o
assinado é o que revela assimetria, que foi o padrão de 2022.

Isto é contexto para o leitor. **Não entra no modelo na v1.0.0.**

---

## 8. Backtest 2022 (gate obrigatório)

Reconstruir a série de pesquisas presidenciais de 2022 e rodar o modelo com corte
em `2022-10-01` (véspera do 1º turno).

**Gate:** o resultado oficial do 1º turno de 2022 — Lula 48,4% e Bolsonaro 43,2%
em votos válidos — deve estar dentro do intervalo de credibilidade de 90% da
estimativa do modelo convertida para válidos, **para ambos os candidatos**.

Se falhar: o modelo está errado ou mal calibrado, e isso precisa ser resolvido
antes de qualquer publicação. Registrar o resultado do backtest, passando ou
falhando, em `docs/BACKTEST-RESULTS.md`, com data e `model_version`.

Nota honesta a ser publicada junto: um modelo que só usa a restrição de soma-zero
(§1.1) **não tem como corrigir viés comum a todos os institutos**. Se o backtest de
2022 passar, é provável que seja porque a banda ficou larga o suficiente, não
porque o modelo "acertou". Isso é um resultado válido e deve ser comunicado como
tal — largura honesta é o produto.

---

## 9. Reprodutibilidade

Todo run grava:

```
model_runs(id, model_version, run_at, input_hash, params_json, git_sha)
```

`input_hash` = SHA-256 do conjunto ordenado de `(tse_id, candidato, valor)` usado.
Mesmo `input_hash` + mesmo `model_version` ⇒ mesma saída, bit a bit. O modelo é
determinístico: sem RNG não-semeado, sem ordem de iteração dependente de hash map.

Um teste (`determinism.spec.ts`) roda o modelo duas vezes sobre a mesma entrada e
compara as saídas byte a byte.

---

## 10. O que este modelo não faz

Publicar esta lista na UI, na íntegra:

- Não corrige viés que seja comum a todos os institutos
- Não prevê resultado eleitoral nem probabilidade de vitória
- Não modela correlação entre candidatos além da restrição de soma
- Não distingue mudança real de opinião de mudança de metodologia do instituto
- Não detecta fraude; os indicadores da §6 têm explicações inocentes e são
  publicados como diagnóstico, não acusação
- Não pondera institutos por acurácia histórica na v1
- Não mede transferência de voto: o fluxo entre candidatos é inferido de dado
  agregado, o que não identifica para onde foi o voto de ninguém — o resultado
  depende do prior tanto quanto do dado (MODEL_VERSION 2.0.0, Q-10)
