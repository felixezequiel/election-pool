# Fixtures da AtlasIntel — CAPTURAS REAIS

**Data da captura: 2026-08-17** (America/Sao_Paulo). Origem: `https://atlasintel.org`
(site do próprio instituto — nível 2 da hierarquia de `docs/04` §1). Todas as
requisições foram feitas com o `User-Agent` do projeto e espaçadas, respeitando
`docs/04` §6. Nenhum portal de notícia foi tocado (CLAUDE.md "o que não fazer").

A ordem desta task foi deliberadamente a do `docs/OPEN-QUESTIONS.md` **Q-09**:
investigar a fonte real → congelar captura → só então escrever código. O resultado
foi um achado que muda o veredito do adapter, e está registrado abaixo.

## O que a fonte primária realmente publica

O site é um Nuxt (SSR). A listagem de releases vem de uma **API pública JSON** —
não é endpoint privado: é a mesma requisição que o site faz para renderizar
`/polls/<categoria>`, e não exige token. Ela foi descoberta no bundle do próprio
site, não suposta:

```sh
curl -s https://atlasintel.org/polls/general-release-polls | grep -oE 'src="/_nuxt/[^"]*"'
curl -s https://atlasintel.org/_nuxt/56c233c.js | grep -oE '"/api[a-zA-Z0-9/_-]*"'
# => "/api/public-polls/"
#    $axios.$get("/api/public-polls/".concat(category,"?limit=20&page=1"))
```

O mesmo bundle (módulo 324) revela a regra de CDN do arquivo do relatório:

```js
l = "2026-08-13"                      // corte, também em __NUXT__.config.CDN_CUTOFF_DATE
c = "https://cdn.atlasintel.org"      // file_created_on ANTES do corte
d = "https://cdn1.atlasintel.org"     // file_created_on NO corte ou depois
```

Categorias existentes (array `links` do bundle): `general-release-polls`,
`exclusive-polls`, `latam-pulse`.

### Onde a rodada nacional presidencial de 2026 está

Só em **`exclusive-polls`**, com `title` exatamente `Brazil: National` e descrição
"Electoral scenarios for 1st round and runoff…". Foram seis rodadas em 2026 até a
captura: ids 489 (2026-01-21), 501 (02-25), 516 (03-25), 543 (04-28), 576 (07-01),
589 (07-29) — cadência mensal, publicadas 1 a 2 dias após o fim do campo.

`general-release-polls` traz, no ciclo 2026, **só pesquisas estaduais**
(Piauí, Maranhão, Amazonas, Minas, Paraná, Santa Catarina, Amapá) e pesquisas
temáticas. A última `Brazil: National` dessa categoria é de **2024-08-28**.
`latam-pulse` traz o "Latam Pulse: Brazil" mensal (Atlas + Bloomberg), que é
nacional mas de aprovação/economia, não de cenário eleitoral.

## O bloqueio — e por que ele é o entregável desta task

| Superfície | Host | `robots.txt` | Percentuais? | Registro TSE? |
|---|---|---|---|---|
| `GET /api/public-polls/<cat>?limit=&page=` | `atlasintel.org` | **404 ⇒ permite** | **NÃO** | **NÃO** |
| `GET /poll/<slug>` (HTML) | `atlasintel.org` | **404 ⇒ permite** | **NÃO** | **NÃO** |
| `GET /<uuid>.pdf` (relatório) | `cdn.atlasintel.org` | **`User-agent: * / Disallow: /`** | único lugar | não verificável |
| idem, arquivos de 2026-08-13 em diante | `cdn1.atlasintel.org` | 403 sem arquivo ⇒ permite | único lugar | nenhum arquivo ainda |

As duas superfícies que podemos buscar trazem **apenas metadado**: título, data de
publicação, `country_code`, nome do arquivo, e um parágrafo de descrição do
instituto (tamanho de amostra e margem em prosa). **Nenhum percentual por
candidato e nenhum `BR-NNNNN/AAAA`.** Verificado nas 539 entradas das três
categorias e na página de detalhe da rodada nacional mais recente.

Os números existem só no relatório em PDF — e o `robots.txt` de
`cdn.atlasintel.org` (arquivo real, `Last-Modified: 2024-09-24`, servido por S3)
proíbe todo agente. `docs/04` §6 é explícito e não-negociável, e `docs/08` §3
repete o princípio. Logo **o PDF não foi buscado**, nem para inspeção: ele não
poderia sequer virar fixture, porque `docs/08` §2 classifica gráfico do instituto
como obra protegida que "nunca copiamos, nunca embutimos", e o relatório da Atlas
é um deck de gráficos.

Também foi verificado que `atlasintel.org` **não** faz proxy do PDF: `/<uuid>.pdf`,
`/files/<uuid>.pdf` e `/api/files/<uuid>.pdf` respondem `302 → /`. E que os
produtos com dado ao vivo (`tracking.atlasintel.org`, `monitor.atlasintel.org`)
respondem `403` e ficam atrás de `/login` — o que CLAUDE.md proíbe usar.

Na captura, **nenhum** arquivo do feed tinha `file_created_on >= 2026-08-13` (o
mais novo era 2026-08-12), então nada estava no `cdn1` ainda. É por ali que o
bloqueio deve cair naturalmente: o próximo relatório será servido por um host sem
restrição de robots.

## Arquivos

| Arquivo | Requisição | O que prova |
|---|---|---|
| `01-public-polls-exclusive-polls.json` | `GET /api/public-polls/exclusive-polls?limit=20&page=1` | Forma real do feed; a rodada `Brazil: National` de 2026-07-29 (id 589) e as anteriores; `file`/`file_created_on` presentes em toda entrada; **nenhum campo de resultado e nenhum `tse_id`** |
| `02-public-polls-general-release-polls.json` | `GET /api/public-polls/general-release-polls?limit=20&page=1` | A categoria "principal" do menu **não** tem a rodada nacional — se o adapter olhasse só ela, acharia zero |
| `03-poll-brazil-national-2026-07-29.html` | `GET /poll/brazil-national-2026-07-29` | A página da rodada nacional: título, data e um botão "Download" apontando para `cdn.atlasintel.org`. **Zero percentual, zero registro TSE** — é a prova do V6 recusando por ausência de identidade |
| `04-robots-cdn.atlasintel.org.txt` | `GET https://cdn.atlasintel.org/robots.txt` | Byte-a-byte (25 bytes): `User-agent: *` + `Disallow: /`. É o bloqueio |

## Redação e recorte (R3 / `docs/08` §2.1)

Este repositório é público, então prosa de terceiro não entra. As edições nos
arquivos são só estas, e nada mais foi tocado:

1. **`description` redigido** nos dois JSON (20 ocorrências cada) e na página HTML
   (no `<p class="card__text">`, no `<meta name="description">`, no
   `<meta name="og:description">` e no payload `window.__NUXT__`). O marcador é
   `[REDIGIDO - prosa do instituto, R3 / docs/08 2.1]`. O schema de
   `public-polls-api.ts` nem declara esse campo, então o Zod o descarta e ele
   nunca entra em objeto nosso.
2. **Conteúdo do único `<style>` da página HTML removido** (287.190 dos 294.374
   bytes originais). É a folha de estilo do site: não é lida por parser algum
   (`documentToText` remove `script`/`style` antes de extrair texto) e não afeta
   uma única asserção. A tag foi mantida com um comentário no lugar do conteúdo.
   Mesmo critério de recorte documentado que `tse-candidatos/__fixtures__`.

Todo o resto — estrutura, ids, slugs, datas, uuids de arquivo, o link do CDN, o
payload do Nuxt — é o que o servidor respondeu.

## Como recapturar

```sh
UA='election-pool/1.0 (+https://election-pool.example/metodologia; contato@election-pool.example)'

# robots ANTES de qualquer coisa (docs/04 §6) — os dois hosts têm política oposta
curl -sS -A "$UA" https://atlasintel.org/robots.txt -w '%{http_code}\n'      # 404 => permite
curl -sS -A "$UA" https://cdn.atlasintel.org/robots.txt                       # Disallow: /

# feeds (espaçar 10s entre requisições ao mesmo host)
curl -sS -A "$UA" 'https://atlasintel.org/api/public-polls/exclusive-polls?limit=20&page=1'
curl -sS -A "$UA" 'https://atlasintel.org/api/public-polls/general-release-polls?limit=20&page=1'

# página de detalhe da rodada nacional mais recente do feed
curl -sS -A "$UA" https://atlasintel.org/poll/brazil-national-2026-07-29
```

Depois: redija as descrições e o `<style>` como descrito acima e atualize a data no
topo deste arquivo. **Recapture SEMPRE antes de mexer no parser — nunca depois**
(Q-09).

Para checar se o bloqueio caiu (isto é, se já existe relatório no `cdn1`):

```sh
curl -sS -A "$UA" 'https://atlasintel.org/api/public-polls/exclusive-polls?limit=20&page=1' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const a=JSON.parse(s).data.filter(p=>p.file_created_on>="2026-08-13");
      console.log(a.length?"cdn1 tem arquivo: "+a.map(p=>p.slug).join(", "):"ainda nada no cdn1");})'
```
