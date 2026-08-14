---
id: T-03
title: Filtro de Kalman e suavização RTS
status: done
depends_on: [T-01]
owns: [packages/model/kalman.ts, packages/model/linalg.ts, packages/model/__tests__/kalman.spec.ts]
spec: docs/01-METHODOLOGY.md §2, §4
---

# T-03 — Série latente

Biblioteca pura. **Não importa nada de `apps/`, não toca rede nem banco.**

## Entregável

Filtro de Kalman + suavizador RTS implementando `docs/01` §2:

- Estado: um `μ` por candidato. Processo: passeio aleatório, `σ_process` de
  `constants.ts`
- Observação: `y_it` com variância `deff · σ_sampling² + σ_house_extra²` (§4.2),
  ponderada por recência `exp(-Δdias/τ)` (§4.4)
- `σ_sampling` calculado com o `p` da estimativa corrente, não do valor observado
- Saída: `{ date, candidateId, mean, lo90, hi90 }[]`
- Datas sem observação são interpoladas pelo processo — a banda **alarga** nesses
  dias. Isso é o comportamento correto e precisa aparecer no gráfico

Álgebra linear própria em `linalg.ts` (matrizes pequenas, 2–10 dimensões). Sem
dependência externa.

## Aceite

- [ ] Teste com dados sintéticos: `μ` conhecido + ruído gaussiano ⇒ recuperado
      dentro de 0,5 p.p.
- [ ] Teste: janela sem observação por 14 dias ⇒ largura do IC cresce
      monotonicamente
- [ ] Teste: observação com `n` maior puxa mais a estimativa que uma com `n` menor
- [ ] Teste de determinismo: duas execuções, saída idêntica byte a byte
- [ ] Nunca produz `NaN`, `Infinity` nem variância negativa — teste de fuzz com
      1.000 entradas aleatórias, incluindo degeneradas
- [ ] `test:arch` passa: nenhum import de fora de `packages/`

## Armadilhas

- Ordem de iteração determinística: sempre ordene por `(date, instituteId, candidateId)`
  antes de processar. `Map`/`Object` não garantem ordem estável entre runs
- Se a covariância perder simetria por erro numérico, force `(P + Pᵀ)/2` a cada passo
