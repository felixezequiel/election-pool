# Resultados do backtest 2022

> ARQUIVO GERADO por `pnpm --filter @election-pool/model model:backtest`.
> NÃO editar à mão (docs/07 §4.4). Resultados reprovados também são gravados.

- **Data do run:** 2026-08-14T20:26:33.452Z
- **model_version:** 1.0.0
- **git_sha:** UNAVAILABLE

> `git_sha` indisponível no ambiente de execução (não é um repositório git); placeholder registrado conforme docs/07 §4.4 exige registrar mesmo assim.

## As quatro comparações (docs/07 §4.2)

Estimativa e IC 90% em VOTOS VÁLIDOS (docs/01 §4.1/§4.3). Largura em p.p.
Aprovação = o resultado da urna cai dentro do IC 90%.

| Turno | Papel | Estimativa | IC 90% | Largura | Urna | Veredito |
|-------|-------|-----------|--------|---------|------|----------|
| 1º | r1-winner | 49.7% | [48.7; 50.8] | 2.09 | 48.4% | FAIL |
| 1º | r1-runner-up | 38.3% | [37.2; 39.3] | 2.06 | 43.2% | FAIL |
| 2º | r1-winner | 51.5% | [50.5; 52.5] | 2.01 | 50.9% | PASS |
| 2º | r1-runner-up | 48.5% | [47.5; 49.5] | 2.01 | 49.1% | PASS |

**Veredito geral: REPROVOU (2/4).**

## Leitura honesta (docs/07 §4.3)

O modelo v1 usa restrição de soma-zero (docs/01 §1.1) e **não tem mecanismo para corrigir viés comum a todos os institutos**. No 1º turno de 2022 esse viés existiu e foi grande: as pesquisas subestimaram o vice na urna em vários pontos. Portanto:

- Um "PASSOU" aqui **não** significa que o modelo previu o desvio — significa, quase sempre, que a banda ficou larga o bastante para conter o erro. Largura honesta é o produto, e deve ser comunicada como tal na UI.
- Um "PASSOU" com IC estreito (< 4 p.p. de largura) é SUSPEITO de vazamento de dado futuro na fixture, não de genialidade do modelo.

> ALERTA: ao menos uma comparação passou com IC < 4 p.p. Revisar a fixture quanto a vazamento de dado futuro.

## Proveniência

Fixture: `packages/model/__fixtures__/2022.json` — pesquisas presidenciais nacionais de 2022 reconstruídas do registro público (PesqEle + divulgações dos institutos), em intenção BRUTA. Nenhum valor foi ajustado para o backtest passar (CLAUDE.md R1). Corte do 1º turno: 2022-10-01. Corte do 2º turno: 2022-10-29. Nenhuma pesquisa com `field_end` posterior ao corte entra no run (sem vazamento).
