# Fixtures do PesqEle — SINTETIZADAS

Estes HTMLs são **sintetizados** para espelhar a estrutura JSF/MyFaces documentada
em `docs/04-INGESTION-SPEC.md` §2 e observada numa sondagem única de reachability
(um GET em `index.xhtml`): charset ISO-8859-1, `formAviso` de aviso legal na
landing, campo `input[name="javax.faces.ViewState"]` (id MyFaces
`j_id__v_0:javax.faces.ViewState:1`), cookie `JSESSIONID`.

**Não são cópia do conteúdo do TSE.** Não contêm prosa de terceiros — apenas o
esqueleto de formulário/tabela e valores numéricos inventados, o suficiente para
exercitar o parser, a extração/reenvio de ViewState e a paginação. Os `tse_id`
seguem o formato canônico `BR-<5 dígitos>/<ano>` exigido pelos contratos.

Se a estrutura real do PesqEle mudar (evento esperado, docs/04 §2), regenere estas
fixtures a partir de uma nova sondagem e ajuste os seletores no adapter.
