# Resultados do backtest 2022

> ARQUIVO GERADO por `pnpm --filter @election-pool/model model:backtest`.
> NÃO editar à mão (docs/07 §4.4). Resultados reprovados também são gravados.

- **Data do run:** 2026-08-19T19:03:14.797Z
- **model_version:** 0.0.5
- **git_sha:** f074574

## As quatro comparações (docs/07 §4.2)

Estimativa e IC 90% em VOTOS VÁLIDOS (docs/01 §4.1/§4.3). Largura em p.p.
Aprovação = o resultado da urna cai dentro do IC 90%.

| Turno | Papel | Estimativa | IC 90% | Largura | Urna | Veredito |
|-------|-------|-----------|--------|---------|------|----------|
| 1º | r1-winner | 49.7% | [44.3; 55.2] | 10.97 | 48.4% | PASS |
| 1º | r1-runner-up | 38.3% | [32.8; 43.7] | 10.96 | 43.2% | PASS |
| 2º | r1-winner | 51.5% | [46.2; 56.8] | 10.58 | 50.9% | PASS |
| 2º | r1-runner-up | 48.5% | [43.2; 53.8] | 10.58 | 49.1% | PASS |

## Transferência 1º ⇒ 2º turno (Q-10 condição 6)

As TAXAS saem só de pesquisa (composição latente de 1º turno no corte ⇒ composição de 2º turno no corte, pelo mesmo estimador que roda em produção). O ponto de checagem sai só da URNA, que o modelo nunca vê. Compara-se uma RAZÃO — a fração da massa liberada pelos eliminados que foi para o primeiro finalista — porque razão sobrevive à diferença de base entre intenção bruta e votos válidos.

- Eliminados: cand-03, cand-04
- Finalistas: cand-01, cand-02
- Fluxo estimado dos eliminados: 4.28 p.p. para cand-01, 6.78 p.p. para cand-02

| Grandeza | Modelo | Banda 90% | Urna | Veredito |
|----------|--------|-----------|------|----------|
| fração da massa liberada para cand-01 | 38.7% | [2.4; 87.7] | 29.8% | PASS |

> Ao menos um dos fluxos comparados vem marcado como **não distinguível de zero** (banda cruzando zero ou abaixo do piso de visibilidade). Ele é publicado assim mesmo (Q-10 condição 3) e entra nesta conta com o rótulo à vista.

Leitura honesta. O prior de permanência (stickiness 0.85) responde por parte deste número: transferência não é identificável a partir de agregado (Q-10), e a banda acima é aritmética de intervalo sobre as bandas dos fluxos, portanto MAIS LARGA que um bootstrap conjunto. Consequência: um FAIL aqui é sinal forte; um PASS é evidência fraca. A comparação ainda supõe que o bolo de votos válidos é o mesmo nos dois turnos e que não houve troca direta entre os finalistas — suposições que o dado agregado não pode verificar. Se reprovou, o veredito fica publicado como reprovado: o prior NÃO é ajustado para passar (R1).

**Veredito geral: PASSOU (4/4, transferência PASS).**

## Leitura honesta (docs/07 §4.3)

O modelo v1 usa restrição de soma-zero (docs/01 §1.1) e **não tem mecanismo para corrigir viés comum a todos os institutos**. No 1º turno de 2022 esse viés existiu e foi grande: as pesquisas subestimaram o vice na urna em vários pontos. Portanto:

- Um "PASSOU" aqui **não** significa que o modelo previu o desvio — significa, quase sempre, que a banda ficou larga o bastante para conter o erro. Largura honesta é o produto, e deve ser comunicada como tal na UI.
- Um "PASSOU" com IC estreito (< 4 p.p. de largura) é SUSPEITO de vazamento de dado futuro na fixture, não de genialidade do modelo.

## Proveniência

Fixture: `packages/model/__fixtures__/2022.json` — pesquisas presidenciais nacionais de 2022 reconstruídas do registro público (PesqEle + divulgações dos institutos), em intenção BRUTA. Nenhum valor foi ajustado para o backtest passar (CLAUDE.md R1). Corte do 1º turno: 2022-10-01. Corte do 2º turno: 2022-10-29. Nenhuma pesquisa com `field_end` posterior ao corte entra no run (sem vazamento).

Limite conhecido desta fixture: ela NÃO traz branco/nulo nem não-sabe (as divulgações reconstruídas não os publicam em campo estruturado), então o backtest roda com `electorateObservations` vazio e **não exercita a série de eleitorado** nem os estados de branco/nulo e não-sabe dentro da transferência. Array vazio significa "ninguém declarou a grandeza" — não zero (R4).
