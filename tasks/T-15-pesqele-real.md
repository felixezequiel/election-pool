---
id: T-15
title: Reescrever o cliente/parser do PesqEle contra o site real
status: done
depends_on: []
owns: [packages/adapters/pesqele/**]
spec: docs/04-INGESTION-SPEC.md §2, docs/OPEN-QUESTIONS.md Q-09
---

# T-15 — PesqEle real

T-05 entregou um cliente escrito contra uma estrutura SUPOSTA do PesqEle. Rodado
contra o site real, ele termina com `seen=0` — sucesso silencioso, zero registro.
O diagnóstico completo, com a tabela de divergências, está em **Q-09**. Leia Q-09
antes desta task.

Sem esta task não há dado no sistema: sem registro não há harvest, sem harvest não
há observação, sem observação o M-1 reprova e nada é publicado.

## Protocolo real (capturado ao vivo em 2026-08-16, PesqEle Público 3.9.2)

Base: `https://pesqele-divulgacao.tse.jus.br`

1. **Sessão.** `GET /index.xhtml` → cookies (`JSESSIONID`, `sticky`, `BIGipServer…`,
   `TS…`). `/index.xhtml` é apenas o menu — não tem formulário de busca.
   Cuidado: `formAviso` existe OCULTO em toda página e é o modal
   **"Sessão Expirada!"**, não um aviso legal a aceitar. Submetê-lo é ruído.
2. **Página de busca.** `GET /app/pesquisa/listar30dias.xhtml` (é a "Consultar
   últimas Pesquisas", janela de 30 dias — exatamente a do DiscoveryJob; a busca
   com período livre é `/app/pesquisa/listar.xhtml`). Extrair
   `javax.faces.ViewState` do HTML.
3. **Busca (AJAX PrimeFaces).** `POST` na mesma URL, corpo urlencoded:

   ```
   javax.faces.partial.ajax=true
   javax.faces.source=formPesquisa:idBtnPesquisar
   javax.faces.partial.execute=formPesquisa
   javax.faces.partial.render=formPesquisa
   formPesquisa:idBtnPesquisar=formPesquisa:idBtnPesquisar
   formPesquisa=formPesquisa
   formPesquisa:eleicoes_input=81      # "Eleições Gerais 2026"
   formPesquisa:filtroUF_input=BR      # "BRASIL"
   formPesquisa:selectCidades_input=
   formPesquisa_SUBMIT=1
   javax.faces.ViewState=<vs>
   ```

   Cabeçalhos: `Content-Type: application/x-www-form-urlencoded; charset=UTF-8`
   e `Faces-Request: partial/ajax`. A resposta é `<partial-response>`: o HTML da
   tabela vem em CDATA dentro de `<update id="formPesquisa">` e o ViewState NOVO
   vem noutro `<update>` — reler o ViewState a cada passo é obrigatório.

   **O `81` não pode ser hardcoded.** É o id da eleição no `<select>` e muda a
   cada pleito: resolva pelo RÓTULO ("Eleições Gerais 2026") e LANCE se não achar
   (R4) — um id errado devolve a eleição errada em silêncio.

4. **Tabela de resultados.** DataTable `formPesquisa:tabelaPesquisas`, linhas
   `<tr data-ri="N">` com SEIS `<td>` sem atributo semântico, nesta ordem:

   | # | conteúdo | exemplo |
   |---|---|---|
   | 0 | número de identificação | `BR-06783/2026` |
   | 1 | empresa contratada / nome fantasia | `INSTITUTO OPNUS … / INSTITUTO OPNUS` |
   | 2 | cargo(s) | `Presidente` |
   | 3 | data de registro | `16/08/2026` |
   | 4 | abrangência | `BRASIL` |
   | 5 | ações (links `…:N:detalhar` e `…:N:edital`) | — |

   Rodapé do paginador: `Total de registros: 50` (5 páginas de 10 no dia da
   captura). Paginação é AJAX de DataTable (`_pagination`, `_first`, `_rows`).

5. **Detalhe** (obrigatório: a lista NÃO tem datas de campo nem amostra).
   `POST` com `javax.faces.source=formPesquisa:tabelaPesquisas:<ri>:detalhar` e
   `javax.faces.partial.execute=@all` ⇒ a resposta é um
   `<redirect url="/app/pesquisa/detalhar.xhtml"/>` ⇒ `GET` nessa URL com a mesma
   sessão. Campos disponíveis, como pares rótulo/valor:

   `Número de identificação`, `Data de registro`, `Cargo(s)`,
   `Data de divulgação`, `Empresa contratada/ Nome Fantasia` (com `CNPJ: …`),
   `Eleição`, `Entrevistados` (= `sampleSize`),
   `Data de início da pesquisa` (= `fieldStart`),
   `Data de término da pesquisa` (= `fieldEnd`), `Estatístico responsável`,
   `Valor` (= `costBrl`, `R$ 148.800,00`), `Contratante(s)` (com CPF/CNPJ).

   **`marginOfError` e `confidenceLevel` NÃO existem em campo estruturado.** Só
   aparecem dentro do texto metodológico do instituto, que R3/docs/08 proíbe
   armazenar. Grave `null` nos dois — nunca extraia da prosa, nunca invente.

## Entregável

- `pesqele/client.ts` reescrito no protocolo acima (sessão → listar30dias →
  busca AJAX → paginação → detalhe), sequencial, sob o `HttpClient` compartilhado
  (robots + 1 req/10s). Sem headless browser (CLAUDE.md).
- `pesqele/registration.ts` reescrito: parse posicional da tabela real e parse por
  RÓTULO da tela de detalhe. Campo obrigatório ausente ⇒ LANÇA (R4).
- Resolução do id da eleição por rótulo, com falha alta.
- Detalhe buscado APENAS para `tse_id` inédito (ver custo em Q-09), preservando a
  idempotência do upsert.
- Fixtures **capturadas do site real** e congeladas em `__fixtures__/`, com um
  README dizendo data da captura e como recapturar. As fixtures sintéticas atuais
  (`data-field`/`data-row`) devem ser DELETADAS — são a causa do falso verde.

## Aceite

- [ ] Fixture REAL da lista: parseia os 6 campos das 10 linhas, com o `tse_id` certo
- [ ] Fixture REAL do detalhe: extrai entrevistados, início e término do campo,
      CNPJ do instituto, contratante e valor; `marginOfError`/`confidenceLevel` = `null`
- [ ] Fixture da resposta `<partial-response>`: ViewState novo é lido do `<update>`
- [ ] Rótulo de eleição inexistente ⇒ LANÇA (não cai em id default)
- [ ] Linha com campo obrigatório vazio ⇒ LANÇA, não vira `0` nem `''`
- [ ] Rodar duas vezes não duplica nem altera `first_seen_at` (aceite herdado de T-05)
- [ ] **Teste de fumaça ao vivo** (fora do `pnpm verify`, opt-in por env): uma
      execução real devolve `seen > 0`. É o teste que faltou em T-05.

## Armadilhas

- ViewState muda a CADA resposta, inclusive nas parciais. Reusar o antigo derruba
  a sessão e o sintoma é uma página vazia — parecida com "não há resultado".
- `formAviso` presente no HTML não significa aviso a aceitar: é o modal de sessão
  expirada, sempre presente. Detectar expiração por ele dá falso positivo em toda
  requisição.
- Zero resultado é indistinguível de filtro errado se o job não reclamar. Emita
  ALERTA quando a busca voltar vazia com filtro válido — silêncio foi exatamente o
  que escondeu o bug de T-05 por uma task inteira.
- Fixture sintética de fonte externa não é evidência de integração. Capture antes
  de escrever o parser, nunca o contrário.
