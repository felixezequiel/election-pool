# Fixtures do Paraná Pesquisas — CAPTURA REAL

Estas fixtures são **captura real do site do instituto**, não estrutura suposta.
Foram baixadas antes de uma única linha de parser existir — a ordem que a
`docs/OPEN-QUESTIONS.md` **Q-09** manda inverter.

**Data da captura: 2026-08-17.**
`User-Agent` usado: `election-pool/1.0 (+https://.../metodologia; <contato>)`,
sequencial, um request por vez. `robots.txt` do host conferido antes (só proíbe
`/wp-admin/`; `/wp-json/` e `/pesquisas/` são permitidos).

## O que o Paraná Pesquisas publica, e onde

- O site é **WordPress**. A divulgação de pesquisa vive na categoria
  **"Pesquisas"** (`id` 6, arquivo em `https://paranapesquisas.com.br/pesquisas/`).
  A categoria **"Notícias"** (`id` 1) é clipping de imprensa e **nunca** é usada:
  imprensa é nível 4 de `docs/04` §1.
- O **número de registro TSE está no título do post** e no slug:
  `…-registro-tse-n-o-br-07974-2026-…`. Registros nacionais (cargo de Presidente)
  têm prefixo `BR-`; os estaduais (governador/senador) têm o prefixo da UF
  (`SP-`, `RS-`, `TO-`…) e por isso **não** casam com `tseIdSchema` dos contracts.
- **A página do post não contém número nenhum**: zero `<table>`, zero `%`. Todos
  os resultados estão em **PDF** anexado (bloco `div.wp-block-file`).
- Um post pode anexar **vários** PDFs (um por questionário) e uma rodada pode
  gerar **vários posts** com o mesmo `tse_id`. Um dos anexos é o **comprovante de
  registro** (`…RegistroTSE_BR-07974.pdf`), que não tem resultado nenhum.
- Dentro do PDF, a sentença exigida pela Res.-TSE 23.600/2019 aparece no rodapé de
  **todas** as páginas: *"…essa pesquisa está registrada no Tribunal Superior
  Eleitoral sob o n.º BR-07974/2026 para o cargo de Presidente."*

## Arquivos

### `nacional-fev2026-BR-07974.txt`

Texto extraído do release de **fevereiro/2026**, registro **`BR-07974/2026`**.

- Post: `https://paranapesquisas.com.br/pesquisas/parana-pesquisas-divulga-pesquisa-nacional-registro-tse-n-o-br-07974-2026-situacao-eleitoral-para-o-executivo-federal-em-2026-fevereiro-2026/`
- PDF: `https://paranapesquisas.com.br/wp-content/uploads/2026/02/Nacional_Fev261.pdf`
  (463.725 bytes, 22 páginas)
  SHA-256 do PDF original:
  `c3d3e72884cb3ee7686f1a61e5d31b6c5fda77667e81eeec9b86afeeed010fe4`
- Traz: 1º turno **espontâneo**, 1º turno **estimulado Cenário 1** e **Cenário 2**,
  três confrontos de **2º turno** (em gráfico) e as tabelas **comparativas**.

### `nacional-mar2026-BR-00873.txt`

Texto extraído do release de **março/2026**, registro **`BR-00873/2026`**.

- Post: `https://paranapesquisas.com.br/pesquisas/parana-pesquisas-registra-pesquisa-nacional-registro-tse-n-o-br-00873-2026-marco-2026/`
  (este post anexa **4** releases; o eleitoral é o quarto)
- PDF: `https://paranapesquisas.com.br/wp-content/uploads/2026/03/Nacional_Mar26-3.pdf`
  (466.653 bytes, 19 páginas)
  SHA-256 do PDF original:
  `86796ad1c00e9187d8cd61e213991f2d76c7f1495001d0f3d6206a0409c50fdd`
- Existe para provar **estabilidade estrutural** e capturar uma armadilha real: em
  março o instituto **rebatizou o 2º turno de "Cenário 2"**. Quem classificasse
  pelo rótulo publicaria um segundo turno como primeiro.

### `wp-search-BR-07974-2026.json`

Resposta **crua** da WP REST usada por `discover()`:

```
GET /wp-json/wp/v2/posts?categories=6&search=BR-07974&per_page=20
    &_fields=id,link,date,title,content
```

Três posts, todos com `BR-07974/2026` no título (situação eleitoral, avaliação da
administração federal, potencial eleitoral) — o caso real de "uma rodada, vários
posts".

## Como recapturar

```sh
UA='election-pool/1.0 (+https://<dominio>/metodologia; <contato>)'

# 1. robots.txt (antes de qualquer coisa)
curl -sL -A "$UA" https://paranapesquisas.com.br/robots.txt

# 2. busca por registro (fixture JSON)
curl -sL -A "$UA" \
  'https://paranapesquisas.com.br/wp-json/wp/v2/posts?categories=6&search=BR-07974&per_page=20&_fields=id,link,date,title,content' \
  -o wp-search-BR-07974-2026.json

# 3. PDF de release (URL vem do content.rendered do post)
curl -sL -A "$UA" \
  https://paranapesquisas.com.br/wp-content/uploads/2026/02/Nacional_Fev261.pdf \
  -o Nacional_Fev261.pdf

# 4. texto, com o MESMO extrator de produção (cnt-mda/pdf.ts → unpdf):
#    extractPdfText(bytes)  ⇒  grave o retorno como .txt
```

Aguarde **10 s entre requisições ao mesmo host** (`docs/04` §6).

## Única modificação feita na captura (R3)

O texto é o retorno **literal** de `extractPdfText` sobre o PDF original, com **uma**
exceção: o corpo em prosa do slide "Metodologia" (parágrafos autorais de
amostragem e auditoria) foi substituído pela linha marcadora
`[prosa metodologica removida da fixture - R3 / docs/08 §2]`. Motivo: `R3` e
`docs/08` §2 — não armazenamos nem republicamos texto de terceiro; o que fica é
fato (números, rótulos, rubricas de slide e a sentença legal de registro). O
parser **nunca lê** aquela página; nenhuma linha que ele consome foi tocada. O
original íntegro é recuperável pelo passo 3/4 acima.

## `make-pdf.ts`

Reembala o texto real num PDF multipágina para os specs percorrerem o caminho de
produção completo (blob → `extractPdfText` → V6 → parser). O conteúdo é o real; só
o invólucro é nosso. Não commitamos o PDF do instituto porque é peça gráfica de
terceiro (`docs/08` §2).

## Se a estrutura mudar

Tratar como **evento esperado** (`docs/04` §2), não excepcional: recapture, congele
de novo e só então ajuste o parser. O parser LANÇA quando a correspondência
valor↔rótulo deixa de fechar — é assim que a mudança aparece, em vez de virar
número errado publicado.
