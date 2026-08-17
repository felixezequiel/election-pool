# Fixtures do adapter `realtime` — REAIS, capturadas da fonte primária

Estas fixtures vêm do **site do próprio instituto** (nível 2 da hierarquia de
`docs/04` §1). Nenhum portal de notícia foi tocado.

- **Data da captura:** 2026-08-17
- **Fonte:** `https://realtimebigdata.com.br/` (host canônico; `www.` responde 301)
- **Índice de divulgação:** `https://realtimebigdata.com.br/pesquisas/`
- **`robots.txt` no momento da captura:** `User-agent: *` / `Disallow:` (permite
  tudo). Sitemap em `/sitemap_index.xml` → `/page-sitemap.xml` lista `/pesquisas/`.
- **User-Agent usado:** o `DEFAULT_USER_AGENT` de `docs/04` §6, via `HttpClient`
  compartilhado (robots + 1 req/10s por host). Sem headless browser.

## O que a fonte publica

`/pesquisas/` é um WordPress/Elementor que lista as rodadas e linka **um PDF por
rodada**. Não há página por rodada e não há URL construível — o nome do arquivo
carrega o **número de registro TSE**, e a grafia do separador varia:

| Arquivo | Registro | Escopo |
|---|---|---|
| `Mato-Grosso-BR-06833-2026-Ago26.pdf` | `BR-06833/2026` | presidencial |
| `Bahia-BR-05205_2026_Ago26.pdf` | `BR-05205/2026` | presidencial |
| `Mato-Grosso-do-Sul-BR-01784_2026_Ago26.pdf` | `BR-01784/2026` | presidencial |
| `Para-BR-096502026_Ago26.pdf` | `BR-09650/2026` | presidencial (sem separador) |
| `Sergipe-BR-07696_2026_Ago26-1.pdf` | `BR-07696/2026` | presidencial |
| `Pernambuco-BR-08354_2026_Jul26.pdf` | `BR-08354/2026` | presidencial |
| `Mato-Grosso-MT-04560-2026-Ago26-1.pdf` | `MT-04560/2026` | estadual |
| `Bahia-BA-00277_2026-AGO26-1.pdf` | `BA-00277/2026` | estadual |
| `Mato-Grosso-do-Sul-MS-07706_2026-AGO26.pdf` | `MS-07706/2026` | estadual |
| `PA-084922026Ago-26.pdf` | `PA-08492/2026` | estadual |
| `Sergipe-SE-07327_2026_Ago26.pdf` | `SE-07327/2026` | estadual |
| `Pernambuco-PE-08413_2026_Jul26.pdf` | `PE-08413/2026` | estadual |

O registro presidencial é `BR-…` (cargo de presidente é registrado no TSE) e o
estadual é `UF-…`. As duas versões do MESMO estado saem no MESMO dia — por isso a
seleção é pelo número de registro e nunca por estado ou data.

**O número de registro aparece dentro do PDF**, na capa, em texto extraível:
`PESQUISA REGISTRADA: BR-NNNNN/2026` + `DIVULGAÇÃO: DD/MM/AAAA`. Sem isso o
`BaseAdapter` recusaria o documento (V6) e este adapter não existiria.

## Arquivos

### `01-pesquisas-index.html`

**Excerto VERBATIM** do container da lista de rodadas de `/pesquisas/`. Cabeçalho,
rodapé, scripts, estilos e imagens do site foram removidos: `docs/08` §2 diz que
não copiamos design nem imagem de terceiro, e o parser só precisa dos `<a href>`.
Os links e os títulos estão byte a byte como a fonte os publica, inclusive o
`data-settings` do Elementor com aspas escapadas — que é justamente o tipo de
ruído que um parser ingênuo quebraria.

### `02-…`, `03-…`, `04-….layout.txt`

Texto **REAL** dos PDFs, na forma que `pdf-layout.ts` produz (páginas separadas
por `\f`). É a entrada exata do parser.

| Fixture | Registro | Rodada |
|---|---|---|
| `02-mato-grosso-BR-06833-2026.layout.txt` | `BR-06833/2026` | Mato Grosso, divulgação 12/08/2026 |
| `03-bahia-BR-05205-2026.layout.txt` | `BR-05205/2026` | Bahia, divulgação 11/08/2026 |
| `04-mato-grosso-do-sul-BR-01784-2026.layout.txt` | `BR-01784/2026` | Mato Grosso do Sul, divulgação 06/08/2026 |

Proveniência do binário de origem (que NÃO é versionado — ver abaixo), para que
qualquer pessoa confirme que o texto acima veio do arquivo que o instituto
publicou:

| Registro | URL | Bytes | sha256 |
|---|---|---|---|
| `BR-06833/2026` | `…/wp-content/uploads/2026/08/Mato-Grosso-BR-06833-2026-Ago26.pdf` | 2 497 773 | `bc20e7e1fdf3669f99313252f24e39fe17f2f944bb0fb7e102bfa1a1a3161100` |
| `BR-05205/2026` | `…/wp-content/uploads/2026/08/Bahia-BR-05205_2026_Ago26.pdf` | 2 454 650 | `d3d623329cf0aab5466946ffaf4e88a6f110ab2a992ae71328b27337234a7106` |
| `BR-01784/2026` | `…/wp-content/uploads/2026/08/Mato-Grosso-do-Sul-BR-01784_2026_Ago26.pdf` | 2 520 355 | `cfb6c0630df74c7bad0360456238082a44ff0c01a550dad1b620b1fe24a52ff2` |

Cada PDF tem 17 páginas e ~5 kB de texto extraível — é texto de verdade, não
varredura de imagem.

**Por que texto e não o PDF.** `docs/08` §2 é explícito: gráfico/imagem do
instituto nunca é copiado. O PDF original tem 2,5 MB do design deles e o
repositório é público (`docs/08` §4.3). O que congelamos são os **fatos**
(rótulos e números) mais o enunciado das perguntas, que é metadado de método e é
necessário para provar que a prosa é corretamente IGNORADA pelo parser. Nada
disso é servido ao público nem entra em `data.json`.

**Por que estas três.** Não são intercambiáveis:

- **Mato Grosso** — o finalista da DIREITA lidera o 2º turno.
- **Bahia** — o finalista da ESQUERDA lidera, com o mesmo layout. Juntas, as duas
  provam que o pareamento do confronto é POSICIONAL: um parser que lesse a ordem
  de fluxo do PDF erraria as duas, em direções opostas, sem quebrar nenhuma
  validação.
- **Mato Grosso do Sul** — a espontânea publicada pelo instituto soma **110 p.p.**
  (medido nas coordenadas do PDF: 8 rótulos, 8 barras, cada rótulo com o valor da
  sua barra). O parser extrai como está; quem bloqueia é a V1 (`97 ≤ soma ≤ 103`,
  `docs/04` §5). Serve de fixture de anomalia real.

### `make-pdf.ts`

Gera um PDF sintético com texto POSICIONADO, reproduzindo a geometria medida no
original (camada de texto duplicada; valores do confronto escritos na ordem de
fluxo inversa à posição). É o que exercita o passo PDF→texto no CI sem colocar o
documento do instituto no repo. **Os números dele são inventados** — o dado real
está nos `*.layout.txt`.

### `aliases.ts`

Apoio a teste: as grafias de candidato que os PDFs reais imprimem. **Não é
cadastro** — o cadastro é `apps/api/src/db/seed-data.ts`, fora desta task. Ver o
cabeçalho do arquivo e `tasks/T-25-adapter-realtime.md`.

## Como recapturar

O teste ao vivo faz a captura pelo mesmo caminho de produção (`discover` →
`HttpClient` compartilhado → `RawStorage` → `parse`), então recapturar é rodar:

```
REALTIME_LIVE=1 REALTIME_CAPTURE=1 \
  pnpm --filter @election-pool/adapters test realtime-adapter.live
```

Isso reescreve os três `*.layout.txt`. Leva ~50s (rate limit real de 1 req/10s por
host) e fica FORA do `pnpm verify`, porque usa rede.

O `01-pesquisas-index.html` é recapturado à mão: buscar `/pesquisas/` com o
`User-Agent` do projeto e recortar o container da lista (o `<div>` que envolve os
itens com os links de PDF), mantendo o markup verbatim.

Se a estrutura do deck mudar (evento esperado, `docs/04` §2), o teste ao vivo
falha alto — que é o ponto dele. Recapture e ajuste `parse.ts`.
