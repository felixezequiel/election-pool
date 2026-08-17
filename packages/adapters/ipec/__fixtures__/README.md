# Fixtures do Ipec — CAPTURA REAL da fonte

Estas fixtures são a **camada de texto REAL** de releases publicados pelo próprio
Ipec, extraída com o mesmo `unpdf` que o adapter usa em produção. **Não há
estrutura inventada aqui** — nenhum atributo, rótulo, separador ou cabeçalho foi
criado por nós. Essa é a correção deliberada do erro registrado na
**Q-09** (`docs/OPEN-QUESTIONS.md`): fixture sintética de fonte externa não é
evidência de integração, e um parser escrito contra estrutura suposta passa nos
testes trazendo zero dado.

## O que foi capturado

| Fixture | Registro TSE | Documento de origem | Capturado em |
|---|---|---|---|
| `release-br-01979-2022.txt` | `BR-01979/2022` | `Repository/Files/1090/221426-2_ELEIÇÕES_2022_BR - release_v1.pdf` — "PESQUISA IPEC / TV GLOBO, Brasil – 1º Turno – 2ª Rodada, 29 de agosto de 2022" | 2026-08-17 |
| `release-br-08161-2022-am.txt` | `BR-08161/2022` (e `AM- 03931/2022` no TRE) | `Repository/Files/2185/221539-4_ELEIÇÕES_2022_AM - release.pdf` — "PESQUISA IPEC / REDE AMAZÔNICA, Amazonas – 2º Turno – 1ª Rodada, 19 de outubro de 2022" | 2026-08-17 |

Ambos são releases eleitorais reais do Ipec, escolhidos porque exercitam formas
**diferentes** do mesmo formato:

- o nacional tem **duas** colunas de rodada (`15/08 29/08`) e é de 1º turno;
- o estadual tem **uma** (`19/10`), é de 2º turno, e traz **governador e
  presidente no mesmo PDF** — o caso que obriga o parser a escopar por cargo.

## De onde vieram (e por que não do site)

O host do Ipec (`www.ipec-inteligencia.com.br`) responde **HTTP 403 com
`Cf-Mitigated: challenge`** — desafio gerenciado do Cloudflare, que só passa
executando JavaScript. Isso vale para o site, para o `/robots.txt` e para a API
JSON. A v1 não usa headless browser (`CLAUDE.md`; docs/04 §6), então **não há
caminho educado de captura live**. Não é bloqueio ao nosso User-Agent: a única
captura de 2026 do Internet Archive para o domínio também é 403.

As capturas vieram, portanto, do **Internet Archive**, que preservou os PDFs
originais do próprio Ipec (não de portal de notícia — a origem do arquivo é o
`Repository/Files/` do instituto, nível 2 da hierarquia de docs/04 §1).

Checksums SHA-256 dos PDFs originais, para auditoria:

```
f27150cef6830e3136dbdcd039333cdd72fe248fa5af61bf90cc777024258542  221426-2_ELEIÇÕES_2022_BR - release_v1.pdf
3e4e13d0a01c51c3c8bd768f19ae9028fe46d6f1fd3754b21749f1afd2937e13  221539-4_ELEIÇÕES_2022_AM - release.pdf
```

## Como recapturar

```sh
# 1. Baixar o PDF original (--path-as-is é necessário: o path tem %20 e acentos)
curl -sS --path-as-is -o br.pdf \
  'https://web.archive.org/web/20220906172929id_/https://www.ipec-inteligencia.com.br/Repository/Files/1090/221426-2_ELEI%C3%87%C3%95ES_2022_BR%20-%20release_v1.pdf'

curl -sS --path-as-is -o am.pdf \
  'https://web.archive.org/web/20240718120119id_/https://www.ipec-inteligencia.com.br/Repository/Files/2185/221539-4_ELEI%C3%87%C3%95ES_2022_AM%20-%20release.pdf'

# 2. Extrair a camada de texto com o MESMO extrator do adapter
node -e "
const {readFileSync,writeFileSync}=require('node:fs');
import('unpdf').then(async ({extractText,getDocumentProxy})=>{
  const pdf=await getDocumentProxy(new Uint8Array(readFileSync(process.argv[1])));
  const {text}=await extractText(pdf,{mergePages:true});
  writeFileSync(process.argv[2],text,'utf8');
});
" br.pdf br.full.txt

# 3. Diferenciar contra a fixture (ver a nota sobre elisão abaixo)
diff br.full.txt release-br-01979-2022.txt
```

## A única transformação aplicada: elisão da prosa (R3)

Os `.txt` contêm **todas** as linhas estruturais do documento real —
cabeçalho, linha "Pergunta:", cabeçalhos de seção, títulos de tabela, cabeçalhos
de coluna de data, todas as linhas de valor (inclusive as das tabelas que o
parser deve **ignorar**: "Rejeição", "Expectativa de vitória", "Avaliação",
"Aprovação"), a ficha técnica e a linha de Registro Eleitoral.

O que foi **removido** são os parágrafos NARRATIVOS do release (o texto de
análise e os marcadores de "DESTAQUES POR SEGMENTOS"), substituídos por uma
linha-marcador:

```
[parágrafo narrativo do release elidido nesta fixture - R3 / docs/08 §2; ver README.md]
```

Motivo: R3 e docs/08 §2 — prosa de terceiro é obra protegida, não pode ser
armazenada como conteúdo nem republicada, e este repositório é público
(docs/08 §4.3). Números e rótulos de tabela são FATO e ficam
(docs/08 §2, primeira linha da tabela).

Isso **não** enfraquece a fixture: o parser não consome prosa, e nenhuma linha
que ele lê foi alterada — separadores (EN DASH `–`), números de urna, siglas de
partido, marcadores `*`/`-` e o quebra-linha do registro estão byte a byte como
vieram do PDF. Para provar que prosa com percentuais não contamina a extração,
o spec injeta uma linha de prosa **de nossa autoria** com percentuais.

## Detalhes reais do formato que estas fixtures preservam

Cada um destes existe porque o documento real é assim, e cada um tem teste:

1. **Registro TSE quebrado entre linhas** — no release nacional a última linha é
   `Registro Eleitoral: registrada no Tribunal Superior Eleitoral sob o protocolo Nº BR-`
   e o número `01979/2022.` vem na linha seguinte. A confirmação V6
   (`base/tse-id.ts`) tolera o separador e casa.
2. **Espaço depois do hífen** — no release do Amazonas o protocolo do TRE aparece
   como `AM- 03931/2022` (com espaço). Mesma tolerância.
3. **Duas colunas de rodada** — `Lula – 13 – PT 51% 50%`: anterior e atual. A
   atual é a **última**.
4. **`*` = "Não foi citado" e `-` = "não foi testado"** — as duas legendas estão
   no rodapé real. `Vera – 16 – PSTU 0% *` e `Roberto Jefferson – 14 – PTB - *`
   são candidatos que NÃO entram no cenário (ausência ≠ zero).
5. **Rótulos na grafia do Ipec** — `Branco ou nulo` e
   `Não sabem ou preferem não opinar`, que não estão nas listas de
   `base/scenario-lines.ts`.
6. **Título de tabela truncado** — no release do Amazonas o título vem
   `Intenção de voto espontânea (sem a apresentação dos nomes dos candidatos`,
   sem fechar o parêntese. Por isso o casamento é por substring.
7. **Dois cargos no mesmo PDF** — `OUTRAS INFORMAÇÕES DA PESQUISA PARA GOVERNADOR`
   e depois `INTENÇÃO DE VOTO PARA PRESIDENTE`.
8. **O 1º turno estimulado não está no texto** — a linha
   `Pergunta: ... (Estimulada - %)` é seguida direto por
   `DESTAQUES POR SEGMENTOS`. O gráfico entre elas não deixa camada de texto
   (verificado extraindo página por página). É a limitação central do adapter.

## Fixtures derivadas

`make-pdf.ts` embala qualquer um destes `.txt` num PDF real (WinAnsi, multipágina)
para que o teste atravesse `extractPdfText` de verdade. Os casos de borda de
falha (rodada errada, valor ilegível, coluna a mais) são gerados no spec por
mutação **mínima e explícita** de uma destas fixtures reais — a mutação está à
vista no teste, em vez de escondida num arquivo à parte.
