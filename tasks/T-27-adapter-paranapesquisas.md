---
id: T-27
title: Adapter de colheita do Paraná Pesquisas
status: done
depends_on: [T-01, T-06]
owns: [packages/adapters/paranapesquisas/**]
spec: docs/04-INGESTION-SPEC.md §1/§3/§4/§5/§6, docs/08-LEGAL-ETHICS.md §2, docs/OPEN-QUESTIONS.md Q-09
---

# T-27 — Adapter Paraná Pesquisas

Implementado e verde. O que esta task entrega de mais valioso, além do adapter, são
**três achados obtidos ANTES de escrever o parser** — a ordem que a Q-09 manda
inverter. Leia antes de mexer no código.

## 1. O número de registro TSE aparece? **SIM — em quatro lugares**

Era a pergunta que podia encerrar a task (sem `tse_id` o `BaseAdapter` recusa por
V6). A resposta é sim, e com folga:

1. no **título** do post (`Registro TSE n.º BR-07974/2026`);
2. no **slug** da URL (`…-registro-tse-n-o-br-07974-2026-…`);
3. no **nome do arquivo** do comprovante anexado (`…RegistroTSE_BR-07974.pdf`);
4. na **sentença exigida pela Res.-TSE 23.600/2019**, no rodapé de **todas** as
   páginas do PDF de resultado: *"…essa pesquisa está registrada no Tribunal
   Superior Eleitoral sob o n.º BR-07974/2026 para o cargo de Presidente."*

Só registros de **cargo de Presidente** têm prefixo `BR-`. Pesquisa estadual de
governador/senador recebe o prefixo da UF (`SP-04624/2026`, `RS-09313/2026`) e por
isso **não** casa com `tseIdSchema` dos contracts — fica naturalmente fora do
escopo presidencial, sem código extra.

## 2. V6 sozinho NÃO basta nesta fonte — e o adapter aperta

**Este é o achado a levar para outros adapters.** O release de fevereiro
(`BR-07974/2026`) traz tabelas comparativas com a série histórica, e nelas está
escrito, em cabeçalho de coluna, `Janeiro 2026 BR-08254/2026` — o `tse_id` de
**outra rodada**. `documentContainsTseId(fevereiro, 'BR-08254/2026')` devolve
`true`: V6 passaria e os números de fevereiro seriam atribuídos a janeiro. É
exatamente "o pior bug do sistema" entrando pela porta que V6 não fecha.

O parser exige mais: o `tse_id` do registro tem de aparecer na **sentença de
registro**, não em qualquer lugar do texto (`tse-registration.ts`). Há spec que
prova as duas metades — que V6 aceitaria, e que o adapter recusa.

Quem escreve adapter de fonte que publica **série histórica** tem esse mesmo risco.

## 3. Duas armadilhas de estrutura, ambas capturadas em fixture

**(a) O rótulo do cenário mente.** Em fevereiro o 2º turno é uma página
"ESTIMULADA – 2º Turno". Em **março o instituto rebatizou o 2º turno de "Cenário
2"** — e "Cenário 2" em fevereiro era um 1º turno com 6 candidatos. Classificar por
rótulo publicaria segundo turno como primeiro. O adapter classifica pela
**estrutura**: exatamente 2 candidatos ⇒ `t2`. Há spec dedicada.

**(b) Cruzamento demográfico parece cenário.** Os mesmos cenários vêm repetidos por
sexo/idade/escolaridade/região/Bolsa Família. Uma dessas páginas (março, p. 12) tem
o mesmo formato "um percentual por linha" da página de gráfico. Ingerida, publicaria
o número de um subgrupo como se fosse o total. Descartada por rótulo de recorte
(`labels.ts`), com spec provando que `Masculino`/`Nordeste`/`Total` nunca viram
candidato.

## O que a fonte publica, e por onde entramos

- WordPress. Divulgação na categoria **"Pesquisas"** (`id` 6). A categoria
  "Notícias" (`id` 1) é clipping de imprensa e **nunca** é tocada (nível 4 de
  docs/04 §1).
- **A página do post não tem número nenhum**: zero `<table>`, zero `%`. Todo
  resultado está em **PDF** anexado. `documentToText` recusa content-type não-PDF
  com razão explícita, em vez de "não achei cenário".
- Uma rodada pode gerar **vários posts** (BR-07974/2026 gerou 3) e um post pode
  anexar **vários PDFs** (o de março anexa 4 releases + o comprovante).
- `discover` faz **uma** requisição à WP REST por registro
  (`?categories=6&search=BR-07974`), valida o JSON com Zod, confirma o `tse_id` no
  título de cada post, exclui o comprovante de registro (não tem cenário) e ordena
  o release de intenção de voto primeiro. ~1,9 KB contra ~370 KB da página
  renderizada.

## Entregável

- `paranapesquisas-adapter.ts` — `ParanaPesquisasAdapter extends BaseAdapter`,
  `id`/`instituteId` = `paranapesquisas`.
- `parse.ts` — triagem por página + gráfico + tabela comparativa + invariantes.
- `tse-registration.ts` — a checagem da §2 acima.
- `labels.ts` — categorias na grafia REAL da fonte.
- `discover.ts` — WP REST, Zod na fronteira, `HttpClient` compartilhado.
- `constants.ts` — coordenadas da fonte, cada uma com a captura que a justifica.
- `__fixtures__/` — duas rodadas reais (fev e mar/2026) + resposta real da WP REST
  + README com URL, data, SHA-256 do PDF original e comando de recaptura.

## Cobertura: pode ficar sem uso imediato

O Paraná Pesquisas **não aparece** nos 51 registros presidenciais colhidos do
PesqEle na janela de 30 dias de agosto/2026. A divulgação nacional presidencial mais
recente do site é de **março/2026** (`BR-00873/2026`). O adapter está correto e
testado contra captura real; a fonte é que está em silêncio nesta janela. Isso não
é falha — é a própria "taxa de gaveta" de docs/01 §6, e `discover` devolve lista
vazia sem inventar URL.

## Pendência para o dono de `seed-data.ts` (não é minha)

A captura real traz quatro aliases que **não estão** em
`apps/api/src/db/seed-data.ts`: **Jair Bolsonaro** (citação espontânea), **Renan
Santos**, **Ronaldo Caiado** e **Aldo Rebelo** (todos em cenário estimulado, com
1,1–3,6%). Com o seed de hoje esta rodada iria **inteira para quarentena** por
`UnknownCandidateError` — comportamento correto (docs/04 §4.1: nunca auto-criar),
mas bloqueante. Os specs declaram os quatro num resolver local, com o motivo escrito
ao lado.

## Aceite (rodado, não presumido)

- 42 testes verdes (`npx vitest run paranapesquisas`), 375/375 no pacote inteiro
- `typecheck` limpo nos meus arquivos; `eslint` e `prettier` limpos
- fixture real + README de proveniência; 1º turno por candidato; 2º turno; branco/
  nulo e não-sabe; outra rodada recusada; alias desconhecido em quarentena; valor
  ilegível lança; cruzamento e ausência-≠-zero cobertos
