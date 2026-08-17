---
id: T-26
title: Adapter de colheita do Palver
status: done
depends_on: [T-01, T-06]
owns: [packages/adapters/palver/**]
spec: docs/04-INGESTION-SPEC.md §1/§3/§4/§5/§6, docs/08-LEGAL-ETHICS.md §2, docs/OPEN-QUESTIONS.md Q-09, Q-11
---

# T-26 — Adapter Palver

Implementado. Mas o que esta task entrega de mais valioso são **duas verificações
feitas ANTES do parser**, e o número de registro que elas produziram. Leia esta
seção antes de mexer no adapter.

## 1. É pesquisa REGISTRADA no TSE, não análise de menções — VERIFICADO

Esta era a pergunta que podia encerrar a task, e a resposta é: **é pesquisa de
intenção de voto registrada.** Verificado na metodologia declarada pela própria
Palver (relatório da onda, páginas 12–14 e 16; press release, seção
"Metodologia"), não em cobertura de imprensa.

A Palver tem **dois produtos**, e confundi-los seria o pior erro possível nesta
fonte:

| produto | o que mede | entra no agregado? |
| --- | --- | --- |
| plataforma de escuta social / monitoramento de narrativa (imprensa, rádio, TV, redes, apps de mensagem) | **menções** | **NUNCA** |
| **Pesquisa Palver** | **intenção de voto**, registrada no TSE | sim, quando houver registro no PesqEle |

O que o adapter colhe é só o segundo:

- survey quantitativo online, questionário estruturado, formulário de **link único
  e intransferível** gerado no clique do anúncio;
- amostra **não-probabilística**, recrutamento por **anúncios em redes sociais**
  (30 cotas de veiculação por faixa etária × gênero × região, 75 variações de
  criativo);
- calibração por *raking* (IPF) no pacote `survey` do R, ancorada na PNADc 2024
  (5ª entrevista) e na votação do 2º turno de 2022 do TSE;
- **registro TSE `BR-06596/2026`**, divulgação 2026-08-10, campo 03–07/08/2026;
- n = 5.000; IC 95%; margem máxima ± 3,0 p.p.; n efetivo (Kish) 1.151; efeito dos
  pesos desiguais 4,31; sem aparo; estatístico responsável com CONRE declarado.

**Correção de fato pendente, fora do meu ownership.** O comentário ao lado do
instituto `palver` em `apps/api/src/db/seed-data.ts` diz que "Palver mede por
mensageria (WhatsApp)". A metodologia declarada da PESQUISA não usa mensageria: o
recrutamento é por anúncio em rede social e a coleta é por formulário web. O
WhatsApp aparece no *outro* produto. O valor `painelOnline` do enum continua
correto — só a justificativa escrita está errada. Dono do arquivo: orquestrador.

## 2. O registro NÃO está no PesqEle da nossa janela — VERIFICADO AO VIVO

Confirmei a suspeita do briefing, com sonda ao vivo em 2026-08-17 usando o
`PesqEleClient` (só listagem, sem detalhe): **50 registros nacionais na janela de
30 dias, e `BR-06596/2026` não está entre eles.** A sequência 06596 cai no vão
entre `BR-06267/2026` e `BR-06773/2026`, ou seja é ausência de verdade, não erro
de paginação.

Por docs/08 §1, pesquisa cujo registro não é localizado no PesqEle **não entra no
agregado**. Logo o `DiscoveryJob` não produz hoje nenhum `PollRegistration` com
`institute_id = 'palver'`, e o `HarvestJob` nunca chama este adapter. Ele está de
pé e correto, e sem uso imediato — o que o briefing já previa.

Há uma coincidência que merece olho de quem cuida do PesqEle: o total voltou
**exatamente 50** (5 páginas de 10), o mesmo número da Q-09. Se o PesqEle limita a
listagem a 50, registros além disso são invisíveis para nós e o `DiscoveryJob`
perde dado sem alertar. Registrado em **Q-11**.

## 3. O bloqueio que o método da Q-09 encontrou

Segui a ordem que a Q-09 manda: **capturar o real antes de escrever parser.** Foi
o que salvou esta task.

A fonte primária (nível 2) é `www.palver.com.br`. A página `/survey` é uma SPA sem
número algum no HTML; os documentos vêm de dois endpoints que devolvem PDF:

- `/api/surveys/voting-intention-2026-august/report` — 93 páginas, ~16 MB
- `/api/surveys/voting-intention-2026-august/press-release` — 2 páginas, ~78 KB

Há também o repositório aberto `palverdata/pesquisa-palver`, com o relatório
espelhado em `divulgacao/2026-08-10/` (caminho versionado pela data de divulgação,
tag git por onda). O repositório versiona a **especificação** da onda
(`config.yaml`, `questionario.yaml`, margens) — os resultados são `.gitignore`d de
propósito, então **não há saída legível por máquina ali**.

**E o relatório tem os resultados RASTERIZADOS.** A camada de texto do PDF traz a
moldura de página, o sumário, as divisórias de seção, o registro TSE e a prosa de
metodologia. As 74 páginas de resultado devolvem literalmente
`RESULTADOS` + número da página + banner, e nada mais. Nenhum percentual, nenhum
nome de candidato, nenhum rótulo de branco/nulo.

Tivesse eu escrito o parser primeiro contra uma fixture inventada, ele passaria
nos testes e traria zero dado — a Q-09 de novo, na mesma semana.

## O que ficou implementado

`packages/adapters/palver/`

| arquivo | o que é |
| --- | --- |
| `palver-adapter.ts` | `PalverAdapter extends BaseAdapter`, `id`/`instituteId` = `palver`; `discover` com as 3 URLs reais da fonte primária; `documentToText` por `unpdf` |
| `parse.ts` | parser escrito contra a captura real; seções por `SCENARIO_KIND`; LANÇA com diagnóstico quando a seção é ilegível |
| `__fixtures__/relatorio-onda-01.textlayer.txt` | camada de texto **REAL** do relatório, prosa removida (R3), resto verbatim |
| `__fixtures__/press-release-onda-01.textlayer.txt` | idem, press release |
| `__fixtures__/make-pdf.ts` | fixtures **SINTÉTICAS**, rotuladas como tal |
| `__fixtures__/README.md` | proveniência, receita de recaptura, a conclusão do item 1, e as 6 armadilhas reais |
| `parse.spec.ts` | 13 testes; o primeiro bloco fala da FONTE, não da fixture |
| `palver-adapter.spec.ts` | 8 testes pelo caminho completo (PDF → texto → V6 → cenários) |
| `palver.live.spec.ts` | canário opt-in contra a fonte ao vivo |

**21 testes verdes** (13 + 8), suíte de adapters inteira em **246 verdes**,
typecheck do palver limpo, sem `any` e sem `@ts-ignore`.

Nenhum arquivo fora de `packages/adapters/palver/**` foi tocado, exceto
`tasks/LOG.md`, este arquivo e a Q-11. `packages/adapters/package.json` não
precisou de entrada: o curinga `"./*"` já cobre `palver/*`.

### Armadilhas reais que só a captura revelou (todas viraram regra em `parse.ts`)

1. `RESULTADOS` casa como divisória de seção (`RESULTADO` + `S` colado) e fecharia
   todo cenário na primeira página de resultado. Daí o descarte de linha
   inteiramente em CAIXA ALTA antes de qualquer outra regra.
2. `5.000 BR -06596/2026 4,31 95%` (página "Amostra") tem o formato
   `<rótulo> <número>` de uma linha de valor. Idem duas linhas da página
   "Calibração". Nenhuma está dentro de seção de voto — por isso valor só é
   colhido com seção aberta.
3. O sumário grafa `B 1º Turno (Estimulada)` (letra ANTES); a divisória real grafa
   `1º Turno (Estimulada)B` (letra COLADA no fim). Casar pelo título solto abriria
   cenário no sumário.
4. Depois do 2º turno vêm `Reconhecimento e Rejeição` e `Aprovação e Avaliação do
   Governo`, que também são percentuais **por candidato**. Se a divisória de seção
   não-voto não fechasse o cenário corrente, **rejeição entraria no agregado como
   intenção de voto**. O parser rastreia TODA divisória por isso, e existe teste
   dedicado.
5. O `tse_id` sai do relatório como `BR -06596/2026`, **com espaço depois do `BR`**
   (no press release, sem espaço). O `documentContainsTseId` do `BaseAdapter`
   tolera o separador — confirmado contra os dois textos reais.
6. A divisória `Reconhecimento e Rejeição` sai **quebrada em duas linhas**.

### O que o parser deliberadamente NÃO faz

A seção `2º Turno (Estimulada)` ocupa 12 páginas, isto é **vários pareamentos**, e
a camada de texto não traz delimitador entre eles. Inventar um seria repetir a
Q-09. A seção rende um cenário e o parser **recusa** se ele não vier com
exatamente 2 candidatos (V3), com mensagem explicando o motivo. Resolve-se quando
existir captura com camada de texto nos resultados.

## Quando isto passa a colher de verdade

Três condições, nenhuma nossa:

1. `BR-06596/2026` (ou a onda seguinte) aparecer no PesqEle — ou Q-11 revelar que
   a nossa varredura é que está cega.
2. A Palver publicar resultado em camada de texto, **ou** os **microdados** que ela
   se compromete a liberar depois do 2º turno.
3. Um alias de razão social da Palver no PesqEle entrar em `instituteAliases` (só
   existe a grafia de imprensa `'Palver'`); a razão social exata do PesqEle é
   desconhecida justamente porque o registro não apareceu.

`palver.live.spec.ts` é o vigia da condição 2: ele **falha** no dia em que `parse`
deixar de lançar. Falha ali significa "a colheita virou possível", não regressão.

## Aceite

- [x] Item 1 verificado na metodologia da própria fonte, e é pesquisa registrada
- [x] Item 2 verificado ao vivo: registro fora da janela do PesqEle
- [x] Número de registro TSE localizado: `BR-06596/2026`
- [x] Fonte primária investigada antes do parser; captura real congelada
- [x] Fixtures REAIS separadas das sintéticas, com a distinção documentada
- [x] R4: valor inextraível LANÇA; nenhum `?? 0`, `|| ''` ou default silencioso
- [x] R3: só estrutura e números; prosa removida da fixture; bruto nunca republicado
- [x] Ausência ≠ zero e "nunca parcial", com teste
- [x] Cenários pelos três `SCENARIO_KIND`; branco/nulo e não-sabe ausentes ⇒ `undefined`
- [x] Etiqueta: `HttpClient` do projeto (robots + 1 req/10s), sequencial, sem headless
- [x] TS estrito, sem `any`/`@ts-ignore`; Zod na fronteira; sem barrel
