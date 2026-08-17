# Fixtures do quaest — CAPTURAS REAIS

**Data da captura: 2026-08-17.** Origem: `https://quaest.com.br` (WordPress do
próprio instituto — nível 2 de `docs/04` §1). Nenhum arquivo aqui é sintetizado:
tudo veio de uma requisição real, e o que foi alterado está descrito em
"Redação de prosa" abaixo.

A ordem desta task foi deliberada: **investigar a fonte, congelar a captura,
escrever o parser depois** — invertendo o que produziu a Q-09
(`docs/OPEN-QUESTIONS.md`), onde um adapter escrito contra estrutura SUPOSTA
passou testes por uma task inteira trazendo zero dado. Fixture sintética de fonte
externa não é evidência de integração.

## O que a Quaest publica, e onde

`genial-quaest.com.br` **não existe** (sem registro em DNS, verificado
2026-08-17). O site da Genial Investimentos não respondeu; a landing page do
contratante (`lp.genialinvestimentos.com.br/pesquisas-genial-quaest/`, nível 3)
espelha os MESMOS PDFs, sem acrescentar dado nem registro TSE.

| Superfície | Tem percentual? | Tem registro TSE? |
|---|---|---|
| PDF de rodada (anexo de `/relatorios/<slug>/`) | **Não** — gráficos 100% rasterizados | **Não** |
| Post de blog do instituto (`quaest.com.br/<slug>/`) | Sim, em prosa | **Sim**, no parágrafo "Metodologia" |
| Índices HTML (`/relatorios/`, `/relatorios-quaest/`, `/blog/`) | Vazios no HTML (montados por JS/JetEngine) | — |
| `lp.genialinvestimentos.com.br` (contratante) | Não (mesmos PDFs) | Não |

`robots.txt` de `quaest.com.br` proíbe apenas `/wp-admin/` (exceto
`admin-ajax.php`) e publica `sitemap_index.xml`. Nada usado aqui é bloqueado.

## Arquivos

| Arquivo | Origem | O que prova |
|---|---|---|
| `2026-08-05-post-rodada-nacional.html` | `GET https://quaest.com.br/pesquisa-genial-quaest-recuperacao-de-flavio-bolsonaro/` | Rodada de 31/07–03/08/2026, registro **BR-06591/2026**. É o **caminho feliz** do parser: 1º turno estimulado (5 candidatos + brancos/nulos + indecisos, soma 97) e 2º turno (2 candidatos + brancos/nulos + indecisos, soma 100). Traz também o parágrafo de SUBGRUPO que casa a mesma âncora de 2º turno e precisa ser recusado |
| `2026-07-15-post-rodada-nacional.html` | `GET https://quaest.com.br/pesquisa-genial-quaest-saldo-de-aprovacao-de-lula/` | Rodada de 10–13/07/2026, registro **BR-7181/2026** (sic — sem o zero à esquerda). Prova que a redação MUDA entre rodadas: aqui o nome vem DEPOIS do percentual ("frente a 28% de Flávio Bolsonaro") e a decomposição publicada é incompleta (2º turno soma 82). O parser recusa os três cenários |
| `2026-08-14-rodada-1-pdf-textlayer.txt` | páginas 1–20 da camada de texto de `https://quaest.com.br/wp-content/uploads/2026/08/QUAEST1PRESIDENCIAL1408.pdf` | A camada de texto do relatório tem só títulos e enunciados de pergunta. Zero percentual, zero nome de candidato de gráfico, zero registro TSE |
| `2026-08-14-rodada-1-pdf-probe.json` | medição do mesmo PDF | O número que fecha o caso: 197 páginas, `percentSignsInTextLayer: 1`, `ptBrNumbersInTextLayer: 0`, `tseProtocolMatchesInTextLayer: 0`. Páginas 1–5 (capa/ficha técnica, onde o registro TSE apareceria) têm `textItems: 0` — são imagem inteira |
| `2026-08-17-wp-rest-media-parent-4768.json` | `GET https://quaest.com.br/wp-json/wp/v2/media?parent=4768` | O caminho de descoberta do PDF: post `relatorios` → anexos → `application/pdf`. Este é o post "…1º Turno – Rodada 1 – 14/08/2026" (id 4768) |

O PDF de 52 MB **não** é versionado. O `probe.json` guarda `sha256`
(`6cf7e4b4eb1da3ad5854168dc8770cb1afb1ed3e2cca112bbbd9f7fb70fb96e0`) e o tamanho
(`52904713` bytes) para conferência, e o `Last-Modified` do servidor
(`Sat, 15 Aug 2026 23:14:21 GMT`). O spec exercita o ramo de PDF montando um PDF
mínimo com as linhas REAIS de `…pdf-textlayer.txt` — a camada de texto é
reproduzida fielmente, só o invólucro é local.

## Redação de prosa (R3 / `docs/08` §2.1)

Nos dois posts HTML:

- Blocos do corpo do artigo que o parser **não lê** tiveram o texto substituído
  por `[prosa do instituto redigida — R3 / docs/08 §2.1; nunca lida pelo parser]`.
  Ficaram intactos, byte a byte, exatamente os blocos que o parser lê ou recusa:
  os parágrafos ancorados de cenário e o parágrafo "Metodologia" que carrega o
  número de registro no TSE (necessário para o V6).
- O conteúdo de `<style>`, `<script>` e `<noscript>`, e o banner de cookies, foram
  substituídos por um marcador: são assets gerados pelo WordPress/Elementor, nunca
  lidos pelo parser.
- **Todo o resto da árvore HTML é o que o servidor respondeu** — incluindo o
  seletor `.elementor-widget-theme-post-content .elementor-widget-container` de
  que o parser depende.

A redação existe porque este repositório é público e R3 proíbe republicar texto de
terceiro; as sentenças mantidas são as que contêm os fatos numéricos, que
`docs/08` §2 classifica como fato extraível.

## Como recapturar

Requer só `curl` e o `node-html-parser` já instalado no pacote. Respeite a
etiqueta de `docs/04` §6 (1 requisição a cada 10 s por host) — as capturas abaixo
são 5 requisições no total.

```sh
UA='election-pool/1.0 (+https://<dominio>/metodologia; <contato>)'
cd packages/adapters

# 1. Descobrir o post da rodada e a página do relatório
curl -sA "$UA" 'https://quaest.com.br/post-sitemap.xml'         # slugs dos posts
curl -sA "$UA" 'https://quaest.com.br/relatorios-sitemap1.xml'  # slugs dos relatórios

# 2. Post da rodada (HTML cru, antes da redação)
curl -sA "$UA" 'https://quaest.com.br/<slug-do-post>/' -o /tmp/post.html

# 3. Redigir a prosa não lida + os assets, e gravar a fixture
#    (o script está reproduzido no bloco abaixo)
node redact-quaest-fixture.mjs /tmp/post.html quaest/__fixtures__/<data>-post-rodada-nacional.html

# 4. PDF da rodada: id do post -> anexos -> application/pdf
curl -sA "$UA" 'https://quaest.com.br/wp-json/wp/v2/relatorios?slug=<slug-do-relatorio>'
curl -sA "$UA" 'https://quaest.com.br/wp-json/wp/v2/media?parent=<id>&per_page=50' \
  -o quaest/__fixtures__/<data>-wp-rest-media-parent-<id>.json
```

`redact-quaest-fixture.mjs` (não versionado: é ferramenta de captura, roda uma vez
por fixture):

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseHtml } from 'node-html-parser';
const norm = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// mesmas âncoras de constants.ts + 'protocolo' (parágrafo de Metodologia)
const KEEP = ['cenario estimulado de primeiro turno', 'intencao de voto espontanea',
  'para o segundo turno', 'simulacao de segundo turno', 'protocolo'];
const MARK = '[prosa do instituto redigida — R3 / docs/08 §2.1; nunca lida pelo parser]';
const ASSET = '/* asset gerado pelo WordPress/Elementor — conteúdo removido da fixture */';
const [src, dst] = process.argv.slice(2);
const root = parseHtml(readFileSync(src, 'utf8'));
for (const el of root.querySelectorAll('style, script, noscript')) el.set_content(ASSET);
for (const box of root.querySelectorAll(
  '.elementor-widget-theme-post-content .elementor-widget-container')) {
  for (const el of box.querySelectorAll('p, h2, h3, li, figure, figcaption')) {
    const t = norm(el.text);
    if (t.length === 0 || KEEP.some((k) => t.includes(k))) continue;
    el.set_content(MARK);
  }
}
for (const el of root.querySelectorAll(
  '.cmplz-cookiebanner, .cmplz-document, #cmplz-manage-consent')) el.set_content(ASSET);
writeFileSync(dst, root.toString(), 'utf8');
```

A medição do PDF (`…pdf-probe.json` e `…pdf-textlayer.txt`) sai de `unpdf`, já
dependência do pacote:

```js
import { extractText, getDocumentProxy } from 'unpdf';
const pdf = await getDocumentProxy(new Uint8Array(readFileSync('QUAEST1PRESIDENCIAL1408.pdf')));
const { text } = await extractText(pdf, { mergePages: false });
// numPages, (text.join('\n').match(/%/g) ?? []).length, /\d{1,3},\d/g, /BR[-\s]?\d{3,6}\/\d{4}/g
// e, por página, (await (await pdf.getPage(n)).getTextContent()).items.length
```

## O teste que a fixture NÃO substitui

Fixture é foto: prova que o parser lê AQUELA resposta, não que a redação do post
de amanhã ainda casa. É a lição literal da Q-09. Por isso existe
`quaest.live.spec.ts`, opt-in por ambiente e fora do `pnpm verify`:

```sh
QUAEST_LIVE=1 pnpm --filter @election-pool/adapters test quaest/quaest.live
```
