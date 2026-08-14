# Fixtures do nexus — SINTETIZADAS

Estes HTMLs são **sintetizados** para espelhar a estrutura documentada em
`docs/04-INGESTION-SPEC.md` §3 (fonte `nexus`, HTML + PDF). **Não são cópia do
conteúdo do nexus/FSB.** Não contêm prosa de terceiros (R3, docs/08) — apenas o
esqueleto de cenário/tabela com atributos `data-*` sintéticos e valores numéricos
inventados, o suficiente para exercitar o parser, a confirmação de `tse_id` (V6) e
a classificação de brancos-nulos/indecisos.

O `tse_id` segue o formato canônico `BR-<5 dígitos>/<ano>` dos contratos.

Arquivos:

- `round.html` — rodada válida: registro TSE presente, cenário de 1º turno
  estimulado + cenário de 2º turno. Um candidato conhecido (Ciro) aparece só no 1º
  turno, exercitando "candidato ausente não vira zero".
- `wrong-tse-id.html` — mesma estrutura, mas com OUTRO `tse_id` no texto: usado
  para provar que o parser LANÇA (V6) quando o documento é de outra rodada.
- `unknown-candidate.html` — inclui um alias de candidato não cadastrado, para
  provar `UnknownCandidateError` + quarentena.

Se a estrutura real do nexus mudar (evento esperado, docs/04 §2), regenere estas
fixtures e ajuste os seletores no adapter.
