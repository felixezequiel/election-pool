# Fixtures do PesqEle — CAPTURAS REAIS

**Datas de captura: 2026-08-16 (arquivos 01–07) e 2026-08-17 (arquivos 08–13).**
Origem: `https://pesqele-divulgacao.tse.jus.br` (PesqEle Público 3.9.2), filtro
"Eleições Gerais 2026" + abrangência "BRASIL".

Os arquivos 01–07 são da tela de **últimos 30 dias** (`listar30dias.xhtml`), que o
cliente usou até T-28. No dia da captura ela devolvia "50 registros em 5 páginas de
10" — e o que T-28 descobriu é que **esse 50 era o TETO do servidor, não o total**
(`docs/OPEN-QUESTIONS.md` Q-11).

Os arquivos 08–13 são da tela de **busca por período** (`listar.xhtml`), que é a que
o cliente usa desde T-28: ela aceita "Período de registro" e permite fatiar a janela
até nenhuma consulta bater no teto. Medições do dia 17: um ano inteiro ⇒ 50; a
janela de 30 dias ⇒ 50; as dez fatias de 3 dias da MESMA janela ⇒ **131**; a fatia
10–12/08 ⇒ 13, e suas três fatias de um dia ⇒ 6 + 6 + 1 = 13 (o filtro é inclusivo
nas duas pontas e a partição por data é exata).

Estas fixtures substituem as anteriores, que eram **sintetizadas** e usavam
atributos `data-field`/`data-row` que nunca existiram no PesqEle. Era por isso
que os testes ficavam verdes enquanto a integração devolvia `seen=0` — o
diagnóstico completo está em `docs/OPEN-QUESTIONS.md` Q-09. A lição, em uma
frase: **fixture sintética de fonte externa não é evidência de integração.**

## Arquivos

| Arquivo | Passo do protocolo | O que prova |
|---|---|---|
| `01-listar30dias-page.html` | `GET /app/pesquisa/listar30dias.xhtml` | ViewState inicial; `<select>` de eleição (`Eleições Gerais 2026` = `81`) e de abrangência (`BRASIL` = `BR`); presença do `formAviso` OCULTO (o modal "Sessão Expirada!", que NÃO indica expiração) |
| `02-busca-partial-response.xml` | `POST` AJAX do `formPesquisa:idBtnPesquisar` | `<partial-response>` com a tabela em CDATA (`<update id="formPesquisa">`), 10 linhas `<tr data-ri>`, `Total de registros: 50`, config do paginador e o ViewState novo |
| `03-paginacao-pagina2-partial-response.xml` | `POST` AJAX de paginação (`_pagination`/`_first=10`/`_rows=10`) | A resposta traz SÓ as `<tr>` (data-ri 10–19) e um ViewState **diferente** do da busca |
| `04-detalhar-redirect-partial-response.xml` | `POST` AJAX de `...:<ri>:detalhar` | A ação não devolve HTML: devolve `<redirect url="/app/pesquisa/detalhar.xhtml">` |
| `05-detalhe-BR-06783-2026.html` | `GET /app/pesquisa/detalhar.xhtml` | Pares rótulo/valor: entrevistados, datas de campo, CNPJ do instituto, contratante, valor. **Um** contratante |
| `06-detalhe-multi-contratante-BR-07185-2026.html` | idem | **Dois** contratantes na mesma célula (Folha + Globo) |
| `07-busca-vazia-partial-response.xml` | busca com eleição sem pesquisa na janela | `Total de registros: 0` e "Nenhum registro encontrado!" — o caso que precisa virar ALERTA, não sucesso silencioso |

### Busca por período (`listar.xhtml`, T-28)

| Arquivo | Passo do protocolo | O que prova |
|---|---|---|
| `08-listar-periodo-page.html` | `GET /app/pesquisa/listar.xhtml` | ViewState inicial; `<select>` de eleição e abrangência; os DOIS campos de data ao lado do rótulo "Período de registro" (`j_id_2n_input`/`j_id_2p_input`, ids gerados pelo JSF, resolvidos por rótulo); e o aviso do próprio TSE: "O resultado da consulta está limitado a **50** registros" |
| `09-busca-periodo-partial-response.xml` | busca da fatia 10–12/08/2026 | `Total de registros: 13` em 2 páginas; colunas **diferentes** da tela de 30 dias ("Eleição" no lugar de "Cargos") — a razão pela qual o mapa de colunas passou a vir do cabeçalho |
| `10-paginacao-periodo-pagina2-partial-response.xml` | paginação `_first=10` | Só as 3 `<tr>` da página 2 (data-ri 10–12), sem cabeçalho |
| `11-busca-periodo-no-teto-partial-response.xml` | busca da janela de 30 dias inteira (19/07–17/08) | `rowCount:50` = **NO TETO**: a prova do bug. E `page:1` — esta captura foi feita depois de paginar, e mostra que a DataTable GUARDA a página corrente entre buscas (supor `page:0` pularia 10 linhas em silêncio) |
| `12-detalhe-BR-09275-2026.html` | `GET detalhar.xhtml` da linha `data-ri=0` | O detalhe continua idêntico vindo da busca por período |
| `13-detalhe-pagina2-BR-01495-2026.html` | idem, da linha `data-ri=10` (página 2) | O `data-ri` é índice GLOBAL e resolve o detalhe certo na página 2 |

Nos arquivos 08, 09 e 11 o miolo do `<select>`/`<ul>` de **empresas** foi cortado:
das 2.254 empresas que o PesqEle lista ali (645 KB de nomes que nenhum parser lê),
2.253 saíram e ficou um comentário HTML no lugar. Todo o resto é byte-a-byte o que o
servidor respondeu.

## Redação de prosa (R3 / docs/08 §2.1)

Nos dois arquivos de detalhe, o conteúdo dos `<span>` de **texto livre autoral do
instituto** foi substituído por um marcador:

- `form:lblMetodologia`
- `form:lblPlanoAmostral`
- `form:lblSistemaControle`
- `form:lblDadoMunicipio`

Nenhum deles é lido pelo parser. A redação existe porque este repositório é
público e R3 proíbe republicar texto de terceiro; **todo o resto dos arquivos é
byte-a-byte o que o servidor respondeu**. É também dentro desses blocos que
aparecem margem de erro e nível de confiança — motivo pelo qual
`marginOfError`/`confidenceLevel` são gravados como `null` e nunca extraídos.

## Codificação

O PesqEle declara `ISO-8859-1`, mas emite todo dado como referência numérica de
caractere (`Elei&#231;&#245;es`). Os arquivos foram salvos exatamente como o
`HttpClient` os entrega ao parser (o `Response.text()` do `fetch` decodifica como
UTF-8), de modo que a fixture é byte-fiel à ENTRADA do parser em produção. O
único efeito colateral é em dois comentários HTML ("Força inclusão", "CABEÇALHO"),
que contêm bytes latin-1 crus e aparecem com `U+FFFD`. Nenhum dado é afetado.

## Como recapturar

O protocolo completo está documentado em `tasks/T-15-pesqele-real.md` e
implementado em `../client.ts`. Para regravar (respeitando 1 req/10s, docs/04 §6),
o caminho mais curto é ligar o hook de proveniência do próprio cliente e gravar
cada corpo:

```ts
const client = new PesqEleClient({
  http: new HttpClient(),
  onRawDocument: (doc) => writeFileSync(`${doc.step}-${Date.now()}.txt`, doc.body, 'utf8'),
});
for await (const pagina of client.discover()) {
  /* … */
}
```

Depois, redija os blocos de prosa listados acima antes de commitar, e atualize a
data no topo deste arquivo. Recapture SEMPRE antes de mexer no parser — nunca
depois (Q-09).

Uma checagem ao vivo, sem recapturar nada, está em `../client.live.spec.ts`:

```
PESQELE_LIVE=1 pnpm --filter @election-pool/adapters test pesqele/client.live
```
