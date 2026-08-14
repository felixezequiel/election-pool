# Fixtures do cnt-mda — PDFs SINTETIZADOS (gerados em código)

As fixtures PDF do cnt-mda são **geradas em código** por `make-pdf.ts`
(determinístico), não checadas como binário. São **SINTETIZADAS** (R3, docs/08:
não é cópia do relatório da CNT/MDA): contêm apenas cabeçalhos de cenário e linhas
"<rótulo> <número>" com valores inventados — o suficiente para exercitar a
extração de texto (`unpdf`, sem headless), a confirmação de `tse_id` (V6) e o
parser de linhas.

`make-pdf.ts` exporta `makeCntMdaPdf(lines)` e três conjuntos de linhas:

- `CNT_MDA_ROUND_LINES` — rodada válida (`BR-09912/2026`), 1º turno estimulado +
  2º turno; "Ciro" só no 1º turno (exercita "ausente ≠ zero").
- `CNT_MDA_WRONG_TSE_LINES` — outro `tse_id` no texto: prova V6 (parser lança).
- `CNT_MDA_UNKNOWN_LINES` — alias não cadastrado: prova `UnknownCandidateError`.

Manter em código (e não como binário) mantém as fixtures reproduzíveis, lintáveis
e livres de blob opaco no repo.
