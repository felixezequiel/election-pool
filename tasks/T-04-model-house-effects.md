---
id: T-04
title: Estimação de house effects
status: done
depends_on: [T-03]
owns: [packages/model/house-effects.ts, packages/model/index.ts, packages/model/__tests__/house-effects.spec.ts]
spec: docs/01-METHODOLOGY.md §1, §5
---

# T-04 — House effects

## Entregável

- Estimação conjunta de `h_i` e `μ_t` por máxima verossimilhança sobre o ciclo
  inteiro (não só a janela de 45 dias)
- **Restrição de identificação:** `Σ_i (w_i · h_i) = 0`, com `w_i` = número de
  pesquisas do instituto na janela (`docs/01` §1.1). Implementar como restrição
  explícita e testável, não como efeito colateral
- Prior `h_i ~ N(0, 2.0²)`
- Instituto com `< MIN_POLLS_FOR_HOUSE_EFFECT` recebe `h_i = 0` e
  `estimable: false`
- Saída com IC 90% por `(instituto, candidato)`
- `packages/model/index.ts` expõe `runModel(input): ModelOutput` — a única API
  pública do pacote

## Aceite

- [ ] Teste: dados sintéticos com `h` conhecido por instituto ⇒ recuperado dentro
      de 0,5 p.p., respeitada a restrição
- [ ] Teste: `Σ w_i·h_i` é zero dentro de tolerância de 1e-9
- [ ] Teste: instituto com 2 pesquisas ⇒ `estimable: false` e `effect = 0`
- [ ] Teste: adicionar um instituto novo não muda o `h` dos outros em mais que a
      redistribuição prevista pela restrição
- [ ] `no-directional-bias.spec.ts` passa
- [ ] Determinismo mantido

## Armadilhas

- **R1 e R2 do `CLAUDE.md` valem com força máxima aqui.** Se o `h` de algum
  instituto sair "grande demais para ser verdade", isso é resultado, não bug.
  Investigue a entrada, não o modelo
- Não normalize `h` para caber numa escala bonita de gráfico
