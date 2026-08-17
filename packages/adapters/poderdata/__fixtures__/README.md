# Fixtures do PoderData — CAPTURAS REAIS

**Data da captura: 2026-08-17.** Quatro rodadas presidenciais nacionais de 2026,
baixadas dos relatórios técnicos em PDF publicados pelo próprio PoderData.

Estas fixtures existem no formato descrito abaixo por causa da lição da
`docs/OPEN-QUESTIONS.md` **Q-09**: _fixture sintética de fonte externa não é
evidência de integração_. Nenhuma linha aqui foi inventada — cada linha mantida é
byte a byte a linha da extração de texto do PDF real, na ordem real.

## 1. Por que a fonte é o PDF, e não a página do Poder360

O PoderData é o instituto do Poder360, então o mesmo domínio hospeda o release e o
jornalismo. A separação, verificada nas páginas reais na data da captura:

| Objeto                                                                                    | O que é                                                                                                                                                       | Uso que fazemos                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `static.poder360.com.br/.../Relatorio-PoderData-Eleitoral-*.pdf`                          | Relatório técnico assinado por "PoderData Pesquisas, Jornalismo e Comunicação LTDA", com `Ficha técnica`, `Registro TSE` e as tabelas de resultado            | **É a divulgação do próprio instituto** — nível 2 de `docs/04` §1. É daqui que sai TODO número                       |
| `poder360.com.br/poderdata/leia-os-resultados-da-pesquisa-poderdata-aya-para-presidente/` | Post de WordPress: tem `<h1>`, `article:published_time`, autoria (`/author/ligia-saba/`) e parágrafos descrevendo os resultados. Lista os PDFs de cada rodada | **É matéria.** Usado APENAS como índice de `href` (docs/08 §2.1: "Referência à fonte é sempre link, nunca conteúdo") |
| `poder360.com.br/poderdata/poderdata-aya-1o-turno-lula-40-flavio-36-...`                  | Matéria assinada (repórter, contexto político, análise de recortes)                                                                                           | **Não é fonte de dado.** Nunca lida                                                                                  |
| `poder360.com.br/poderdata-institucional/`                                                | Página institucional; lista os relatórios das 96 rodadas nacionais desde 2020                                                                                 | Índice de `href` de reserva                                                                                          |

O critério prático: **se a página tem autoria e parágrafo, é matéria.** As duas
páginas HTML do Poder360 que consultamos têm — inclusive a mais sóbria, cujo título
é literalmente "Leia os resultados". Por isso nenhum número vem de HTML. O que
vem de HTML é uma lista de URLs de PDF, e nada mais. Isso é o que também mantém
satisfeita a proibição de "scraping de portal de notícia" do `CLAUDE.md`: não
lemos a matéria, lemos o release do instituto.

## 2. Registro TSE — SIM, está no documento

Decisivo para o adapter funcionar, porque o `BaseAdapter` aplica o V6 e RECUSA
documento que não contenha o `tse_id` do registro. Nos quatro relatórios o número
aparece **na capa** (`Registro TSE` / `BR-NNNNN/2026`), **na ficha técnica** e no
**rodapé de todas as páginas de conteúdo**:

| Fixture                       | Registro TSE    | Campo          | URL de origem                                                                                        |
| ----------------------------- | --------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `BR-04882-2026-28mai2026.txt` | `BR-04882/2026` | 25–28/mai/2026 | `https://static.poder360.com.br/2026/05/Relatorio-PoderData-Eleitoral-29mai26-final.pdf`             |
| `BR-05722-2026-24jun2026.txt` | `BR-05722/2026` | 21–24/jun/2026 | `https://static.poder360.com.br/uploads/2026/06/Relatorio-PoderData-Eleitoral-21-24-jun26-final.pdf` |
| `BR-00059-2026-15jul2026.txt` | `BR-00059/2026` | 12–15/jul/2026 | `https://static.poder360.com.br/uploads/2026/07/Relatorio-PoderData-Eleitoral-16jul26-final.pdf`     |
| `BR-07845-2026-29jul2026.txt` | `BR-07845/2026` | 26–29/jul/2026 | `https://static.poder360.com.br/uploads/2026/07/Relatorio-PoderData-Eleitoral-29jul26-3.pdf`         |

Observação de grafia: no relatório de maio o rodapé sai da extração como
`BR -04882/2026` (com espaço). O `base/tse-id.ts` tolera o separador, e a capa traz
a forma canônica de qualquer modo.

## 3. Por que o arquivo é texto redigido, e não o PDF

O relatório é obra protegida ("Todos os direitos reservados. Proibida a reprodução
sem citar a fonte") e este repositório é público (`docs/08` §4.3). Commitar o PDF —
ou o texto integral extraído dele — seria republicar texto de terceiro, o que o R3
proíbe. Então:

- **fica** o que é FATO (rótulos, números, o registro TSE) e as âncoras de
  estrutura (o rodapé `www.poder360.com.br/poderdata` que delimita a página e o
  título de cada seção);
- **sai** a prosa: ficha metodológica, enunciado das perguntas, aviso de copyright,
  a frase de rodapé.

O filtro é uma allowlist deliberadamente burra em `redact.ts`, com as sete regras
documentadas lá. Ele não sabe nada sobre o parser.

**Limite a declarar:** nas páginas que NÃO são intenção de voto, os rótulos de
categoria caem junto com a prosa (elas ficam com números e título — o bastante para
provar que o parser as ignora). As páginas de intenção de voto, que são as que o
parser lê, ficam byte a byte iguais à extração real.

E a fixture, por ser foto, não prova que a fonte de HOJE ainda tem essa estrutura.
Quem prova isso é `poderdata.live.spec.ts` (§5).

## 4. Estrutura real que estas fixtures preservam

O que se aprende lendo as quatro, e que o parser depende:

- Cada página de conteúdo termina no rodapé `www.poder360.com.br/poderdata`, e a
  linha seguinte é o título da seção. É o delimitador de página (o `unpdf`
  concatena as páginas e perde a fronteira).
- **1º turno**: uma página de gráfico + **sete páginas de cruzamento** (Sexo,
  Idade, Instrução, Região, Renda, Religião, Aprovação), cada uma com a coluna
  `Total` e a linha de fechamento `Total 100% ...`. O adapter lê o 1º turno DOS
  CRUZAMENTOS; o gráfico serve de conferência.
- **2º turno**: só gráfico, um por par. Maio traz **cinco** pares; julho, **quatro**.
- **Não existe cenário espontâneo** em nenhuma das quatro rodadas (a pesquisa é IVR
  com lista lida ao entrevistado). `t1_espontaneo` fica legitimamente ausente.
- Dois dialetos de gráfico coexistem na série: `bars` (maio, junho, 16/jul — valores
  e rótulos em linhas separadas) e `series` (29/jul — gráfico de linhas com tabela
  de dados, rótulo e valores na mesma linha).
- `Joaquim Barbosa` está no cenário de maio e junho e sai em julho — é o caso real
  de "candidato ausente não vira zero" e o alias real usado para exercitar
  `UnknownCandidateError`.
- **Divergência real de 1 p.p.**: em `BR-05722/2026`, seis cruzamentos trazem
  `Joaquim Barbosa 2%` e o sétimo (`Aprovação de Lula`) traz `3%`; o rótulo do
  gráfico também traz `3`. É arredondamento independente, declarado pelo próprio
  relatório. Em ~250 células das quatro rodadas, essa é a ÚNICA divergência.

## 5. Como recapturar

Não existe script solto: a recaptura é o mesmo caminho do teste ao vivo.

```
# Confere que a fonte de hoje ainda parseia E que as fixtures continuam fiéis
PODERDATA_LIVE=1 pnpm --filter @election-pool/adapters test poderdata.live

# Reescreve as fixtures a partir da captura de hoje
PODERDATA_CAPTURE=1 pnpm --filter @election-pool/adapters test poderdata.live
```

As URLs, o `tse_id` e o fim de campo de cada rodada estão fixados em
`poderdata.live.spec.ts` (`CAPTURED`) — é a procedência em forma executável.
Ambos os modos usam o `HttpClient` compartilhado (robots.txt + 1 req/10s por host),
sequencialmente, e levam ~30 s.

Depois de recapturar, **revise o diff**. Mudança de estrutura é evento esperado
(`docs/04` §2), mas tem de ser vista por um humano, não absorvida em silêncio.

## 6. Os outros arquivos

- `indice-serie-2026-links.html` / `indice-institucional-links.html` — âncoras
  REAIS (só os `href` de PDF, verbatim) das duas páginas de índice. Nenhum texto do
  post. O institucional inclui de propósito um relatório NÃO eleitoral
  (`relatorio-poderdata-93-1jun2026.pptx.pdf`) e um de 2020, para exercitar o
  filtro de nome de arquivo, e está na ordem do documento (mais antigo primeiro),
  que é o inverso da outra página — é o que a ordenação por ano/mês da URL resolve.
- `make-pdf.ts` — embala linhas num PDF mínimo PAGINADO, para as specs do adapter
  exercitarem o caminho real de extração de PDF sobre o texto real. Pagina porque um
  gerador de página única faz o pdf.js descartar tudo que cai fora da `MediaBox` —
  na prática só as ~57 primeiras das ~500 linhas sobrevivem, e o teste passaria a
  rodar sobre um pedaço do documento sem ninguém notar.
- `redact.ts` — o filtro de redação descrito em §3.
