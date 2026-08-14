---
id: T-09
title: Backtest 2022
status: done
depends_on: [T-04]
owns: [packages/model/__fixtures__/2022.json, packages/model/backtest.ts, docs/BACKTEST-RESULTS.md]
spec: docs/07-QUALITY-GATES.md §4
---

# T-09 — Backtest

O gate que decide se o projeto tem fundamento. Se falhar, nada é publicado.

## Entregável

- Fixture `2022.json` com as pesquisas presidenciais nacionais de 2022, cada uma
  com `tse_id`, instituto, datas de campo, `n` e valores. Montada a partir do
  PesqEle histórico e das publicações dos institutos
- `backtest.ts`: roda o modelo com `reference_date` fixa, converte para votos
  válidos, compara com resultado oficial
- Comparações obrigatórias (quatro):
  - 1º turno, corte `2022-10-01`: Lula 48,4% · Bolsonaro 43,2%
  - 2º turno, corte `2022-10-29`: Lula 50,9% · Bolsonaro 49,1%
- `pnpm model:backtest` imprime tabela com estimativa, IC 90%, oficial e veredito
- Escreve `docs/BACKTEST-RESULTS.md` com data, `model_version`, `git_sha` e as
  quatro linhas. **Resultados reprovados também são gravados**

## Aceite

- [ ] Fixture tem ≥ 25 pesquisas cobrindo agosto a outubro de 2022
- [ ] Teste: nenhuma pesquisa da fixture tem `field_end` posterior ao corte usado.
      Vazamento de dado futuro invalida o backtest inteiro
- [ ] Backtest roda em CI como parte de `pnpm verify`
- [ ] Saída inclui a **largura** do IC, não só passou/falhou (`docs/07` §4.3)
- [ ] `docs/BACKTEST-RESULTS.md` é gerado, não escrito à mão

## Armadilhas

- Se passar com IC estreito (< 4 p.p.), suspeite de vazamento antes de comemorar
- Não ajuste prior para fazer o backtest passar. Isso é R1 e é a forma mais
  sedutora de arruinar o projeto
