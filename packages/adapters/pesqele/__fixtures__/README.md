# Fixtures do PesqEle — CAPTURAS REAIS

**Data da captura: 2026-08-16.** Origem: `https://pesqele-divulgacao.tse.jus.br`
(PesqEle Público 3.9.2), filtro "Eleições Gerais 2026" + abrangência "BRASIL" na
tela de últimos 30 dias. No dia da captura o filtro devolvia **50 registros
presidenciais em 5 páginas de 10**.

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
