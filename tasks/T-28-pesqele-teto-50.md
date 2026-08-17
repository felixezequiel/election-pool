---
id: T-28
title: PesqEle trunca a listagem em 50 registros — varredura fatiada por data e alerta de truncagem
status: done
depends_on: [T-15]
owns: [packages/adapters/pesqele/**, apps/api/src/jobs/discovery.job.ts]
spec: docs/04-INGESTION-SPEC.md §2, docs/OPEN-QUESTIONS.md Q-09, Q-11
---

# T-28 — O teto de 50 registros do PesqEle

## O bug: sucesso silencioso, um nível acima da Q-09

O `DiscoveryJob` fazia UMA consulta da janela de 30 dias na tela
`listar30dias.xhtml` e colhia o que voltasse. O que voltava eram sempre 50
registros — e 50 não era o total, era o **teto do servidor**. Medições ao vivo em
2026-08-17 (eleição 2026 / abrangência BRASIL, contando por data de registro):

| consulta | "Total de registros" |
|---|---|
| `listar30dias.xhtml` (o que o job usava) | **50** |
| `listar.xhtml`, período 01/01/2026–31/12/2026 | **50** |
| `listar.xhtml`, período 19/07/2026–17/08/2026 (a janela de 30 dias) | **50** |
| `listar.xhtml`, período 10/08/2026–12/08/2026 | 13 |
| as dez fatias de 3 dias da janela de 30 dias, somadas | **131** |

Um ano inteiro não pode ter o mesmo total que 30 dias. Abaixo do teto o total é
real (13 para 3 dias; e as três fatias de um dia desses 13 dão 6 + 6 + 1 = 13).
Conclusão: a varredura via **62% dos registros da janela** e não emitia alerta
nenhum. Como o PesqEle expira o registro 30 dias depois do registro, o que passava
do teto era dado **perdido para sempre**. Evidência concreta apontada pela Q-11: a
pesquisa `BR-06596/2026` (Palver) não aparecia nos 50 colhidos.

O TSE, aliás, **declara o teto** — mas só na tela de busca por período:
"O resultado da consulta está limitado a 50 registros. Utilize os filtros para
pesquisar." A tela de 30 dias aplica o mesmo corte **sem dizer**.

## O que foi feito

1. **Troca de tela.** O `discover` passou a usar `/app/pesquisa/listar.xhtml`
   (busca com período livre) em vez de `listar30dias.xhtml`. Mesmo protocolo AJAX
   PrimeFaces, mesma DataTable, mesmo `detalhar` ⇒ `redirect` ⇒ `GET`. É a única
   tela que aceita período e a única que declara o teto.
2. **Varredura fatiada.** A janela de `JANELA_DIAS` (30, exigência de produto,
   docs/04 §2) é varrida em fatias de `FATIA_DIAS` (3), da mais ANTIGA para a mais
   recente — o registro antigo é o que está a ponto de expirar. A partição é exata:
   fatias fechadas nas duas pontas, contíguas, sem vão e sem sobreposição
   (`janela.ts`, puro e testado sem rede). A união é por `tse_id` e a repetição é
   inofensiva porque o upsert do job é idempotente.
3. **Detecção de truncagem, barulhenta.** Se o total de uma fatia bate no teto, a
   fatia é **subdividida** e as metades varridas no lugar dela. Se nem a fatia de um
   único dia escapar do teto, sai `DiscoveryAlert` de `truncation_suspected` e a
   contagem do job registra a suspeita — e o que é visível continua sendo colhido,
   declarado como PISO. O teto usado é o **declarado pela resposta**; se ele mudar
   ou desaparecer, sai `limit_mismatch` (uma vez por varredura, não uma por fatia).
4. **Mapa de colunas pelo cabeçalho.** A tabela de `listar.xhtml` tem "Eleição" onde
   a de 30 dias tem "Cargos". O mapa posicional fixo faria o nome do instituto virar
   "Eleições Gerais 2026" em silêncio; agora o índice de cada coluna vem do `<th>`
   (`parseColunas`), e coluna obrigatória ausente LANÇA.
5. **Campos de data resolvidos por rótulo.** Os inputs de período são
   `formPesquisa:j_id_2n_input`/`j_id_2p_input` — ids gerados pelo JSF. São
   resolvidos a partir do rótulo "Período de registro" (`periodo-inputs.ts`), e a
   ausência LANÇA: um POST sem período volta truncado em 50 com cara de acerto.
6. **Bug de paginação achado no caminho.** A DataTable **guarda a página corrente
   entre buscas**: depois de paginar numa fatia, a busca da fatia seguinte volta em
   `page:1`. O código antigo (`for pagina = 1`) pularia a página 0 em silêncio. O
   cliente agora varre todas as páginas do paginador e só aproveita a que a busca
   trouxe. A fixture `11-busca-periodo-no-teto` congela esse comportamento.
7. **Contagem verificável no resultado do job.** `DiscoveryResult.sweep` traz
   janela, fatias, fatias no teto, truncagens suspeitas, linhas lidas, `tse_id`
   distintos e teto declarado; o log escreve tudo numa linha e usa `console.warn`
   com "PERDA POSSÍVEL" quando `truncadas > 0`.

## Resultado ao vivo (2026-08-17)

Três execuções de `pnpm ingest:discover`, na ordem:

| run | contexto | resultado | duração |
|---|---|---|---|
| 1 | banco vazio (cold start) | `seen=131 upserted=130 expired=0 alerts=83` | **46m34s** |
| 2 | 11 registros inéditos | `seen=131 upserted=11 expired=0 alerts=6` | 6m52s |
| 3 | nada inédito (idempotência) | `seen=131 upserted=0 expired=0 alerts=0` | **3m13s** |

Sweep idêntico nas três: `fatias=10 linhas=131 distintos=131 no_teto=0 truncadas=0
teto_declarado=50`. `linhas == distintos` é a prova de que a partição por data não
sobrepõe nem repete. Estado final do banco: **131 linhas, 131 `tse_id` distintos,
zero duplicata, zero expirado**, e `first_seen_at` intocado pelo run 3.

**131 contra os 50 de antes.** E o registro concreto que a Q-11 apontou como ausente
voltou: `BR-06596/2026` (Palver, n=5.000, campo 03–09/08/2026) está no banco. Ele
estava na janela de 30 dias o tempo todo — só não estava nos 50 que o servidor
devolvia.

Os 83 alertas do run 1 são todos `unknown_institute` (nenhum `unmapped_race`,
`truncation_suspected` ou `limit_mismatch`): institutos que antes ficavam atrás do
teto agora aparecem e precisam de alias. 48 dos 131 registros resolvem
`institute_id`.

## Custo de rede (docs/04 §6, 1 req/10s)

Varredura da janela de 30 dias: 1 GET inicial + 10 buscas + ~10 paginações = **21
requisições, 3m13s medidos**, contra ~6 requisições (~1 min) da consulta única que
perdia 62% dos registros. Fatia mais estreita quase não mudaria o custo: o
dominante é o total de páginas (131 registros / 10 por página ≈ 13 requisições de
qualquer forma). O detalhe continua sendo buscado só para `tse_id` inédito (Q-09),
então em regime permanente o ciclo é o das 21 requisições — mas o **cold start com
banco vazio levou 46m34s**, porque 130 registros inéditos × 2 requisições de detalhe.

## Fixtures novas (capturas reais de 2026-08-17)

`08-listar-periodo-page.html`, `09-busca-periodo-partial-response.xml`,
`10-paginacao-periodo-pagina2-partial-response.xml`,
`11-busca-periodo-no-teto-partial-response.xml` (a prova do teto, e da página
guardada), `12-detalhe-BR-09275-2026.html`, `13-detalhe-pagina2-BR-01495-2026.html`.
Ver `__fixtures__/README.md` para o que cada uma prova e o que foi redigido (R3).

## Aceite

- [x] Teste com fixture provando que fatia no teto dispara alerta de truncagem
- [x] Teste provando que a subdivisão acontece antes de desistir
- [x] Teste provando que a página 0 não é pulada quando a busca volta em `page:1`
- [x] Execução ao vivo devolvendo mais de 50 registros distintos
- [x] Segunda execução ao vivo idempotente (`first_seen_at` intocado)
- [x] Os testes de integração do discovery seguem verdes
- [x] `typecheck` limpo, sem `any` e sem `@ts-ignore`

## Armadilhas para quem mexer aqui depois

- **Fatia larga é tentadora e é o bug de volta.** Perto do pleito o volume sobe; se
  uma fatia de 3 dias começar a bater no teto com frequência, a subdivisão resolve
  sozinha, mas vale baixar `FATIA_DIAS` e refazer a conta que está no comentário.
- **`total === teto` NUNCA é "o total é esse mesmo".** É suspeita até prova em
  contrário, e a prova é subdividir.
- **Nada de filtrar por empresa para escapar do teto sem medir.** O formulário tem
  `formPesquisa:empresas_input`, e a tentação é varrer por instituto. São 2.254
  empresas: a 1 req/10s isso é mais de 6 horas por ciclo. A fatia de data é mais
  barata; o filtro de empresa só se algum dia UM DIA inteiro estourar o teto.
- **Não volte para `listar30dias.xhtml`.** Ela não tem período (não dá para fatiar)
  e não declara o teto (não dá para detectar truncagem).
