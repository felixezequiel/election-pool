# Fixtures do palver

Duas classes de fixture, e a distinção entre elas é o ponto inteiro deste
diretório (Q-09: _fixture sintética de fonte externa não é evidência de
integração_). Não misture.

| arquivo                               | classe                          | vale como                      |
| ------------------------------------- | ------------------------------- | ------------------------------ |
| `relatorio-onda-01.textlayer.txt`     | **REAL**, capturada da fonte    | evidência de estrutura         |
| `press-release-onda-01.textlayer.txt` | **REAL**, capturada da fonte    | evidência de estrutura         |
| `make-pdf.ts`                         | **SINTÉTICA**, gerada em código | exercício do caminho feliz, só |

---

## 1. A conclusão que autorizou esta task: é pesquisa REGISTRADA, não menções

Verificado **antes** de escrever qualquer parser, na metodologia declarada pela
própria Palver (relatório, páginas 12–14 e 16; press release, seção
"Metodologia"), não em cobertura de imprensa.

A Palver tem **dois produtos que não podem ser confundidos**:

1. **Monitoramento de narrativa / escuta social** — a plataforma que a empresa
   vende, que agrega menções em imprensa, rádio, TV, redes sociais e aplicativos
   de mensagem. É medida de **menção**. **Nunca entra neste sistema.** Misturar
   isso com intenção de voto no mesmo agregado seria o erro mais grave possível
   nesta fonte.
2. **Pesquisa Palver** — o que este adapter colhe, e só isso:
   - survey quantitativo online, questionário estruturado;
   - amostra **não-probabilística**, recrutamento por **anúncios em redes
     sociais**, formulário de link único e intransferível (30 cotas de veiculação
     por faixa etária × gênero × região, 75 variações de anúncio);
   - calibração por _raking_ (IPF) no pacote `survey` do R, ancorada em PNADc
     2024 (5ª entrevista) e na votação do 2º turno de 2022 do TSE;
   - **registro no TSE: `BR-06596/2026`**, divulgação 2026-08-10;
   - n = 5.000; IC 95%; margem de erro amostral máxima ± 3,0 p.p.;
     n efetivo (Kish) 1.151; efeito dos pesos desiguais 4,31; sem aparo;
   - estatístico responsável declarado, com CONRE.

Portanto: **é pesquisa de intenção de voto registrada no TSE.** Não é análise de
sentimento nem contagem de menções.

**Correção de fato para o cadastro do instituto.** O comentário do `seed-data.ts`
diz que "Palver mede por mensageria (WhatsApp)". A metodologia declarada da
pesquisa **não** usa mensageria: o recrutamento é por anúncio em rede social e a
coleta é por formulário web de link único. O WhatsApp aparece no _outro_ produto
(item 1). O valor `painelOnline` do enum continua correto; a justificativa escrita
ao lado dele é que está errada.

**Divergência da própria fonte, registrada e não resolvida.** O período de campo
aparece como `03/08/2026 – 07/08/2026` na página "Amostra" do relatório e como
`data_inicio: 2026-08-03` / `data_fim: 2026-08-09` no `ondas/2026-08-10/config.yaml`
do repositório. Não escolhemos nenhum dos dois: a data de campo é metadado do
PesqEle (docs/04 §1, nível 1), não do adapter.

---

## 2. O bloqueio real: os resultados são imagem

`relatorio-onda-01.textlayer.txt` é o que a extração de texto (`unpdf`, sem
headless) devolve do relatório publicado, com a **prosa removida** (R3, docs/08
§2: extraímos números e estrutura, nunca guardamos texto de terceiro) e todo o
resto **verbatim**.

Olhe as páginas 19 a 92 na fixture. Cada uma é:

```
RESULTADOS
19
PESQUISA PALVER | AGOSTO/2026
```

Isto é a moldura da página, e **é tudo que existe**. As 74 páginas de resultado
do deck são gráficos **rasterizados**: nenhum percentual, nenhum nome de
candidato, nenhum rótulo de branco/nulo ou não-sabe está na camada de texto do
PDF. Não há nada a extrair sem OCR, que está fora de escopo na v1.

Consequência: `PalverAdapter.parse` rodado contra o documento real **LANÇA**, com
diagnóstico explícito. Isso é o R4 funcionando, não um bug. O bloco
`captura REAL da Palver` em `parse.spec.ts` exercita exatamente esse caminho
contra a captura real, e `palver.live.spec.ts` (opt-in, `PALVER_LIVE=1`) repete a
afirmação contra a fonte ao vivo — é a asserção que faltou em T-05.

A Palver se compromete a publicar os **microdados** depois do 2º turno. É aí que a
colheita fica viável, e é aí que esta fixture precisa ser recapturada.

### Armadilhas que só a captura real revelou

Todas viraram regra explícita em `parse.ts`, com comentário:

1. `RESULTADOS` casa como divisória de seção (`RESULTADO` + `S` colado) e fecharia
   todo cenário na primeira página de resultado. Daí o descarte de linha
   inteiramente em CAIXA ALTA antes de qualquer outra regra.
2. A linha `5.000 BR -06596/2026 4,31 95%` (página "Amostra") tem o formato
   `<rótulo> <número>` de uma linha de valor. Idem `1.151 26,1 4,31 Nenhum` e
   `5.000 0,007 0,433 1,819` (página "Calibração"). Nenhuma está dentro de seção
   de voto, e é por isso que valor só é colhido com seção aberta.
3. O sumário (página 2) repete os títulos das seções com a letra **antes**
   (`B 1º Turno (Estimulada)`), enquanto a divisória real traz a letra **colada no
   fim** (`1º Turno (Estimulada)B`). Reconhecer a divisória pelo título solto
   abriria cenário no sumário.
4. Depois do 2º turno vêm `Reconhecimento e Rejeição` e `Aprovação e Avaliação do
Governo` — que também são percentuais **por candidato**. Se a divisória de
   seção não-voto não fechasse o cenário corrente, rejeição entraria no agregado
   como intenção de voto.
5. O `tse_id` sai do PDF como `BR -06596/2026`, **com espaço depois do `BR`**
   (no press release sai sem espaço, `BR-06596/2026`). O `documentContainsTseId`
   do `BaseAdapter` tolera o separador — verificado contra os dois textos reais.
6. A divisória `Reconhecimento e Rejeição` sai **quebrada em duas linhas**
   (`Reconhecimento e` / `RejeiçãoD`). A letra fica na segunda, que é a que casa.

### O que o parser deliberadamente não resolve

A seção `2º Turno (Estimulada)` ocupa 12 páginas do relatório, isto é **vários
pareamentos**. A camada de texto não traz delimitador entre eles. Inventar um
seria o pecado da Q-09, então a seção rende um cenário e o parser **recusa** se
ele não vier com exatamente 2 candidatos (V3). Resolve-se quando existir captura
com camada de texto nos resultados.

---

## 3. Como recapturar

Fonte primária (nível 2 de docs/04 §1). `robots.txt` de `www.palver.com.br`
responde **404** em 2026-08-17 — sem restrição declarada. Respeite 1 req/10s
(docs/04 §6) e o `User-Agent` do projeto.

```sh
UA='election-pool/1.0 (+https://<dominio>/metodologia; <contato>)'

# Relatório completo (o que tem as seções de cenário) — ~16 MB, 93 páginas
curl -sSL -A "$UA" -o relatorio.pdf \
  https://www.palver.com.br/api/surveys/voting-intention-2026-august/report

# Press release — ~78 KB, 2 páginas, traz o registro TSE e a metodologia
curl -sSL -A "$UA" -o press-release.pdf \
  https://www.palver.com.br/api/surveys/voting-intention-2026-august/press-release
```

Espelho versionado por onda no repositório aberto da Palver, com a data de
divulgação no caminho (mesma fonte primária, e cada onda ganha uma tag git):

```sh
curl -sSL -o relatorio.pdf \
  https://raw.githubusercontent.com/palverdata/pesquisa-palver/main/divulgacao/2026-08-10/relatorio-onda-01.pdf
```

Os dois arquivos têm bytes diferentes (compressão de imagem) e **camada de texto
idêntica** (18.412 bytes em 2026-08-17) — conferido.

Para regerar a fixture: extraia o texto com `extractPdfText` (`cnt-mda/pdf.ts`),
remova a prosa e mantenha verbatim moldura de página, sumário, divisórias de
seção, linhas de registro e as linhas de tabela em formato `<rótulo> <número>`.
**Não reformate**: a fixture só vale se for o que a fonte devolve.

### Onde as URLs foram descobertas

`GET https://www.palver.com.br/survey` — a página lista a onda corrente
("Eleições Presidenciais 2026: Intenção de Voto | Agosto/2026") e os dois
downloads como `href`. É uma SPA: **nenhum percentual no HTML**, então não existe
caminho de HTML para os números. Não há URL por `tse_id` nem índice de ondas no
site; o índice de ondas está no `README.md` do repositório aberto.

---

## 4. `make-pdf.ts` — SINTÉTICA, e é para ser lida com desconfiança

Gerador determinístico de PDF (mesma técnica do cnt-mda: PDF 1.4 mínimo,
`/WinAnsiEncoding`, bytes latin1, sem headless) mais conjuntos de linhas
**inventados**.

**Estes conjuntos não existem na fonte.** Eles descrevem o documento que a Palver
publicaria _se_ as páginas de resultado tivessem camada de texto. Eles provam que
o parser lê aquele formato — **não** provam que ele lê a Palver de hoje. A prova
sobre a Palver de hoje é a fixture REAL da seção 2, e ela diz que o parser
recusa.

A estrutura sintética copia verbatim da captura real tudo que é estrutura
(moldura, divisórias com a letra colada, o sumário com a letra antes, a linha de
registro com o espaço em `BR -`) e só acrescenta as linhas `<rótulo> <número>`
dentro das seções.

O gerador de PDF é uma cópia local do de `cnt-mda/__fixtures__/make-pdf.ts`, de
propósito: sete agentes trabalhavam em paralelo e depender do diretório de outro
adapter para uma fixture custaria mais do que 50 linhas duplicadas. Candidato a
subir para `base/` quando a poeira assentar.
