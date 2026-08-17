---
id: T-23
title: Adapter de colheita do Ipec (Inteligência em Pesquisa e Consultoria)
status: done
depends_on: [T-01, T-06]
owns: [packages/adapters/ipec/**]
spec: docs/04-INGESTION-SPEC.md §1 §3 §4 §5 §6, docs/08-LEGAL-ETHICS.md §2, docs/OPEN-QUESTIONS.md Q-09 Q-12
---

# T-23 — Adapter Ipec

Adapter de nível 2 (site do próprio instituto, docs/04 §1) para o Ipec. Escrito na
ordem que a **Q-09** exige: investigar a fonte real, congelar captura, parser
depois. A investigação mudou o desenho três vezes — e é o principal produto desta
task.

## O que a fonte é, de verdade

| Item | Suposição de partida | O que é |
|---|---|---|
| Domínio | `ipec.com.br` (está no seed) | **não resolve**; o real é `ipec-inteligencia.com.br` |
| Índice de rodadas | página HTML | SPA AngularJS; o índice vem de `GET /api/arquivo/ListAtivos/` (JSON `{Retorno,Total,TotalPaginas}`) |
| Documento | HTML ou PDF | PDF em `/Repository/Files/<id>/<nome>.pdf`, em dois tipos |
| Registro TSE | ? | **SIM, no release** — "sob o protocolo Nº BR-01979/2022" |

Os dois tipos de PDF, e por que a diferença decide tudo:

- **release** (`… - release.pdf`, 4–6 páginas) — **tem** o registro TSE. É o que o
  adapter consome.
- **relatório de tabelas** (`…_Relatorio_de_tabelas_Imprensa.pdf`, 50+ páginas de
  cross-tabs) — **não tem** registro nenhum (verificado: zero ocorrência de
  `BR-NNNNN/AAAA` no PDF inteiro). O V6 do `BaseAdapter` o recusa, corretamente.

## A parede: 403 do Cloudflare

O host todo (site, `/robots.txt`, API) responde **403 `Cf-Mitigated: challenge`**,
desafio que exige JavaScript. Sem headless na v1, **não há colheita live**. Não é
o nosso User-Agent: a única captura de 2026 do Internet Archive também é 403.
Registrado em **Q-12**, com opções e recomendação. O `parse` funciona hoje via
`ingest:reparse` sobre qualquer release que chegue ao blob.

`ipec/ipec.live.spec.ts` (opt-in `IPEC_LIVE=1`, fora do `pnpm verify`) é um
**canário** no padrão de T-26: afirma o bloqueio. Quando o acesso liberar, ele
falha — e a falha é o aviso.

## O que o parser extrai (e o que não extrai)

Extrai, escopado ao cargo **presidente**:

- **2º turno** (`Simulações de Segundo Turno`) → `t2` + `t2Pair`
- **1º turno espontâneo** (`Intenção de voto espontânea`) → `t1_espontaneo`
- brancos/nulos e não-sabe quando publicados

**NÃO extrai o 1º turno estimulado** — que é o número principal do agregador. Nos
releases reais ele é publicado como **gráfico**, sem camada de texto: a linha
`Pergunta: … (Estimulada - %)` é seguida direto por `DESTAQUES POR SEGMENTOS`
(confirmado extraindo página por página com o mesmo `unpdf` do adapter). Os
números existem só na **prosa**, misturados a percentuais de segmento ("73% entre
quem avalia como ruim") e a faixas de margem ("pode ter entre 42% e 46%"). Um
regex sobre prosa daria topline errado com cara de acerto: preferimos não ter o
dado a ter o dado errado (R4). Há teste que fixa essa ausência — se o Ipec passar
a publicar a tabela em texto, o teste quebra e avisa.

## As armadilhas do formato (todas reais, todas testadas)

1. **Duas colunas de rodada.** `Lula – 13 – PT 51% 50%` sob o cabeçalho
   `15/08 29/08`: anterior e atual. A atual é a **última**. Ler a primeira
   importaria a rodada passada sob o `tse_id` desta — e o **V6 não pegaria**, por
   ser o mesmo documento. O parser lê o número de colunas do cabeçalho e exige que
   cada linha case; divergência **lança**.
2. **Tabelas que não são intenção de voto** no mesmo PDF: `Rejeição` (soma > 100%),
   `Expectativa de vitória`, `Potencial de voto`, `Avaliação`, `Aprovação`.
   Reconhecimento por **allowlist de título**.
3. **Dois cargos no mesmo PDF** (release estadual: governador + presidente).
   Escopo por seção; só cabeçalho em caixa alta e linha `Pergunta:` mudam o cargo,
   para que um marcador de análise não vire o escopo.
4. **`*` e `-` não são zero.** `*` = "Não foi citado", `-` = "não foi testado".
   Candidato com marcador **não entra** (ausência ≠ zero). `0%` entra como 0.
5. **Registro TSE partido pela quebra de linha** (`… Nº BR-` / `01979/2022.`) e com
   **espaço depois do hífen** no TRE (`AM- 03931/2022`). O `documentContainsTseId`
   do `BaseAdapter` tolera — verificado contra os dois textos reais.
6. **Rótulos na grafia do Ipec** — `Branco ou nulo` e
   `Não sabem ou preferem não opinar` **não estão** nas listas de
   `base/scenario-lines.ts`. Sem classificá-los localmente, toda pesquisa do Ipec
   cairia em quarentena.
7. **Título truncado** no PDF real (`… dos nomes dos candidatos`, sem fechar o
   parêntese) ⇒ casamento por substring, nunca exato.

## Fixtures

Duas capturas **reais**, com README de proveniência (URL, data, checksum SHA-256
do PDF original, comando de recaptura):

- `release-br-01979-2022.txt` — nacional, 1º turno, **duas** colunas
- `release-br-08161-2022-am.txt` — Amazonas, 2º turno, governador + presidente, **uma** coluna

É a **camada de texto real** do PDF, com os parágrafos narrativos elididos (R3,
docs/08 §2 — prosa de terceiro não pode morar num repo público; números e rótulos
de tabela são fato e ficam). Nenhuma linha que o parser lê foi alterada.
`make-pdf.ts` reembala o texto num PDF real (WinAnsi, multipágina) para o teste
atravessar `extractPdfText` de verdade — necessário porque as linhas reais têm
EN DASH e apóstrofo curvo, que o empacotador latin1 do cnt-mda corromperia.

## Resultado

23 testes (22 + 1 canário opt-in). `typecheck`, `eslint` e `prettier` limpos no
diretório. Suíte do pacote: 268 passam, nada quebrado.

## Pendências (não são desta task)

- **Q-12** decide o acesso (v1.1 / headless / manual / pedir ao Ipec).
- **`seed-data.ts` linha 43** tem `siteUrl: 'https://www.ipec.com.br'`, que não
  resolve. Dono: orquestrador. O correto é `https://www.ipec-inteligencia.com.br`.
- **`quaest/quaest-adapter.ts:108`** tem o mesmo erro de `contentType` possivelmente
  nulo que eu corrigi no meu (`TS18047`); hoje é o único erro de `typecheck` do
  pacote. Dono: T-2x quaest.
- **`Outros`** não tem campo no `ParsedPoll` (nota em Q-12).
- **`extractPdfText` e o gerador de PDF de fixture** seguem duplicados/alojados em
  `cnt-mda/` e agora em três adapters — candidatos a subir para `base/`, como
  T-26 já anotou.
