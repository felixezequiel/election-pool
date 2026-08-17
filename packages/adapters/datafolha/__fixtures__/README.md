# Fixtures do datafolha — proveniência da captura real

## 1. O que foi capturado, quando, e como recapturar

Captura ao vivo em **2026-08-17, entre 09:09 e 09:19 (America/Sao_Paulo)**, com o
`User-Agent` de docs/04 §6 e ≥10s entre requisições ao mesmo host. Comando:

```sh
UA='election-pool/1.0 (+https://election-pool.example/metodologia; contato@election-pool.example)'
curl -sS -A "$UA" -L -o <arquivo> "<url>"      # 1 requisição por vez, ≥10s entre elas
sha256sum <arquivo>
```

| URL (host `datafolha.folha.uol.com.br`, exceto onde indicado)                                                        | HTTP | bytes  | SHA-256                                                            | registro TSE no corpo             |
| -------------------------------------------------------------------------------------------------------------------- | ---- | ------ | ------------------------------------------------------------------ | --------------------------------- |
| `/robots.txt`                                                                                                        | 200  | 2234   | `30a8a983c7cc21b6d1fe0c0dea183285dc04437882387fb035edf5a3adefcac1` | —                                 |
| `https://media.folha.uol.com.br/robots.txt`                                                                          | 200  | 175    | `a1c7791dbc79837f778438e8db51ade115b191a9cb9ece7895296076ef220f43` | —                                 |
| `/eleicoes/2026/` (índice do ano)                                                                                    | 200  | 113265 | `655384d5032df7fc5be91b5d2090c1cf9d90b410a71759ade1b1dfcdcf264daf` | —                                 |
| `/eleicoes/2026/07/em-cenario-estavel-lula-pt-lidera-no-1o-turno-e-2o-turno.shtml`                                   | 200  | 122140 | `a1549807ad6c9500a493c93695474bbbf06219ea254c564faf6f235a4e7d7bfe` | **BR-01166/2026**                 |
| `/eleicoes/2026/06/lula-pt-mantem-vantagem-no-1o-turno-e-2o-turno.shtml`                                             | 200  | 122890 | `5f96674a30a6573bb176c1919bf1a304158670ce951bb75a67041430cca2e749` | **AUSENTE**                       |
| `/eleicoes/2026/07/em-sao-paulo-flavio-bolsonaro-pl-e-lula-pt-estao-empatados-no-1o-e-2o-turno.shtml`                | 200  | 121386 | `7f56eac6a34e55048aec95712999120e6887d42d5504820cd6e360a53bdcf7d8` | **AUSENTE**                       |
| `/eleicoes/2026/07/tarcisio-de-freitas-republicanos-lidera-com-46-das-intencoes-de-voto-para-governador-de-sp.shtml` | 200  | 125816 | `f85b3aadcccaa12d92a42f97149a719667113c298a802ff53a85eb96e513754d` | SP-01703/2026 e **BR-06481/2026** |
| `/eleicoes/2026/07/81-nao-citam-espontaneamente-voto-para-senado-em-sao-paulo.shtml`                                 | 200  | 121662 | `06e16a6394c59983547ea050e0086e764903a0d1abd2e1f71b996961d9de225f` | **BR-06481/2026**                 |
| `/eleicoes/2026/08/raquel-lyra-psd-tem-48-das-intencoes-de-voto-no-1o-turno-ante-42-de-joao-campos-psb.shtml`        | 200  | 128603 | `588260425c1d9a3492a435eeb12ea40960ecd5a31de6029dad43646c9ce11d1b` | PE-04519/2026 e **BR-07601/2026** |

O tamanho/hash do HTML inclui marcação volátil (publicidade, tokens de sessão), por
isso pode mudar numa recaptura sem que o conteúdo mude. A evidência estável é o
TEXTO do `[itemprop="articleBody"]` e os seletores — é o que o parser usa.

## 2. O recorte REAL versionado, e por que só um recorte

`round-real-recorte.html` traz, **byte a byte**, os trechos da rodada presidencial
`BR-01166/2026` de que o veredito depende: a oração em que o valor do 1º colocado
está preso a uma descrição, a mesma coisa no 2º turno, e a frase de registro TSE
lida pelo V6. Todo o resto foi elidido com `[…]`. É o que prova, dentro do repo, que
a recusa vem do TEXTO REAL e não de uma estrutura suposta (Q-09).

O HTML COMPLETO das rodadas não é versionado: é reportagem, prosa de terceiro.
`docs/08` §2 e §2.1 mandam guardar o bruto **apenas como prova de proveniência, fora
de árvore servida e nunca em backup público** — e este repositório é público
(`docs/08` §4.3). Então:

- o bruto vai para `raw_documents` (blob local, tratado pelo `HarvestJob`);
- aqui ficam **URL + data + HTTP + tamanho + SHA-256**, que provam o que foi lido
  sem republicar o artigo, mais o recorte mínimo acima;
- quem quiser conferir roda o `curl` da §1 e compara o corpo do artigo;
- e o canário `datafolha.live.spec.ts` confere contra o site de hoje, não contra a
  foto de ontem.

O `robots.txt` das duas hosts, sim, está versionado: é arquivo de diretiva técnica,
não obra, e é a evidência que sustenta a decisão de nunca buscar o PDF.

## 3. O que a captura real mostrou (e que o parser codifica)

1. **A fonte primária existe** (docs/04 §1 nível 2): `/eleicoes/<ano>/<mes>/<slug>.shtml`,
   com índice navegável em `/eleicoes/` e `/eleicoes/<ano>/`. **Sem paywall** — o
   corpo inteiro vem no HTML. Ou seja, não é preciso descer para imprensa (nível 4).
2. **O registro TSE aparece no corpo em 4 das 6 rodadas capturadas**, na frase de
   ficha técnica ("A pesquisa está registrada no TSE: BR-01166/2026"). Nas outras
   duas não aparece — e sem ele o V6 do `BaseAdapter` recusa, corretamente.
3. **Não há tabela, `data-*` nem JSON-LD.** Os percentuais estão em prosa editorial.
   O único material estruturado é o PDF "RELATÓRIO COMPLETO", em
   `media.folha.uol.com.br`, cujo `robots.txt` é `User-agent: * / Disallow: /`:
   proibido por docs/04 §6, que não é negociável.
4. **A mesma forma de superfície serve a quatro coisas diferentes**: intenção de
   voto, rejeição ("48% não votariam de jeito nenhum"), valor da rodada anterior
   ("(tinha 2%)") e cruzamento por segmento ("52% a 37%"). Nada na marcação
   distingue — só a redação do parágrafo.
5. **Nas rodadas presidenciais, o valor dos dois primeiros colocados está preso a uma
   DESCRIÇÃO, não a um nome**: "o atual presidente tem 40% …, contra 32% do
   presidenciável do PL"; "No segundo turno, Lula tem 48%, contra 43% do senador pelo
   PL". Atribuir exigiria assumir quem é a descrição — chute proibido (docs/04 §4.1)
   e chute que o V6 não pega, porque o `tse_id` está certo. O parser recusa.
6. **Nas rodadas estaduais a redação é nominal e o parser extrai tudo.** Verificado
   contra a captura de governo de SP: `Tarcísio 46, Haddad 30, Vera Lúcia 5, Vivian
Mendes 4, Carlos Machado 4, brancos/nulos 8, indecisos 3` (soma 100).

## 4. As fixtures versionadas

`robots-datafolha.txt`, `robots-media-folha.txt` — capturas REAIS, byte a byte.
`round-real-recorte.html` — recorte REAL descrito na §2.

Os `round-*.html` são **derivados da estrutura real** (mesma cadeia de elementos —
`<div class="c-news__body" data-news-content-text itemprop="articleBody"><p>…`) com
frases NOSSAS que reproduzem cada forma de redação observada, e nomes/valores
inventados a partir do seed de candidatos (T-02). Não contêm prosa do Datafolha
(R3). O comportamento contra o texto real é coberto por `datafolha.live.spec.ts`.

- `round-nominal.html` — redação nominal: 1º turno estimulado, espontâneo e dois
  cenários de 2º turno. O espontâneo NÃO traz brancos/nulos (como no real) ⇒
  `blankNullPct` é `undefined`, nunca 0. Ciro só aparece no 2º cenário de 2º turno.
- `round-anaforico.html` — a forma das rodadas presidenciais: valor preso a
  descrição ⇒ o parser LANÇA.
- `round-rejeicao-e-segmento.html` — parágrafo de rejeição e de cruzamento por
  segmento junto de um cenário válido ⇒ só o cenário sai; nenhum número de
  rejeição/segmento entra.
- `round-valores-anteriores.html` — "(tinha 38%)", "(mesmo índice anterior)",
  "(eram 12%)" ⇒ valor da rodada passada nunca é lido como atual.
- `round-outro-registro.html` — outro `tse_id` ⇒ V6 recusa.
- `round-candidato-desconhecido.html` — alias fora do seed ⇒ `UnknownCandidateError`
  (quarentena; nunca auto-cria candidato).
- `round-valor-ilegivel.html` — `com --%` ⇒ LANÇA. Nunca vira 0 (R4).

Se a redação do Datafolha mudar, o efeito é falha alta: ou nenhum cenário é
reconhecido (o `BaseAdapter` lança), ou um percentual fica sem dono (o parser
lança). Nunca um número atribuído ao candidato errado.
