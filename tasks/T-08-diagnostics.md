---
id: T-08
title: Diagnósticos — gaveta, herding, divergência
status: done
depends_on: [T-04]
owns: [packages/model/diagnostics.ts, packages/model/__tests__/diagnostics.spec.ts]
spec: docs/01-METHODOLOGY.md §6
---

# T-08 — Diagnósticos

**Nenhum destes indicadores altera o agregado.** São diagnóstico publicado, não
correção aplicada. Se você se pegar usando um deles para ponderar, pare.

## Entregável

- **Taxa de gaveta** (§6.1): por instituto e por contratante. Só conta registros
  cuja janela de divulgação já passou (registro + 5 + 15 dias). Saída inclui
  numerador e denominador, sempre
- **Teste de herding** (§6.2): janelas de 7 dias com ≥ 4 pesquisas do mesmo
  cenário. `ratio = s²_observado / s²_esperado`. Sinaliza abaixo de
  `HERDING_RATIO_THRESHOLD`. Saída inclui o `n` da janela, sempre
- **Divergência persistente** (§6.3): `|h_i| > 3` p.p. **e** IC 90% não cruza zero

## Aceite

- [ ] Teste: instituto com 1 registro e 0 divulgações ⇒ taxa 1,0 com
      `registered: 1`. A UI precisa poder distinguir isso de 0,6 sobre 20
- [ ] Teste: janela com 3 pesquisas não produz resultado de herding
- [ ] Teste: dados sintéticos com dispersão idêntica à teórica ⇒ `ratio ≈ 1`
- [ ] Teste: instituto com `estimable: false` nunca é marcado divergente
- [ ] Teste: nenhum output de diagnóstico entra em `ModelOutput.latent` ou
      `ModelOutput.houseEffects` — separação estrutural, verificada por tipo

## Armadilhas

- Nomes de campo e mensagens seguem o vocabulário de `docs/08` §5. Nada de
  `suspicious`, `fraud`, `bought` no código
