---
id: T-21
title: Adapter de colheita da AtlasIntel (atlasintel.org)
status: blocked # fonte primária não publica número extraível — ver "Veredito"
depends_on: [T-01, T-06]
owns: [packages/adapters/atlas/**]
spec: docs/04-INGESTION-SPEC.md §1/§3/§4/§5/§6, docs/08-LEGAL-ETHICS.md §2, docs/OPEN-QUESTIONS.md Q-09
---

# T-21 — Adapter AtlasIntel

`docs/04` §3 lista `atlasintel` como a fonte 4 e a descreve como "HTML — painel
online". Investigada ao vivo em **2026-08-17**, a descrição **não se confirma**.
Esta task entrega o que é entregável e documenta, com evidência congelada, por que
o resto não é.

## Veredito

**A AtlasIntel publica a rodada nacional presidencial de 2026, e ela é exatamente
o que precisamos — mas o número não está em nenhuma superfície que possamos
buscar.**

- O que existe: `Brazil: National`, mensal, descrita como "Electoral scenarios for
  1st round and runoff ahead of the Brazilian Presidential Elections of 2026".
  Seis rodadas em 2026 (2026-01-21, 02-25, 03-25, 04-28, 07-01, 07-29), publicadas
  1 a 2 dias após o fim do campo.
- Onde os números estão: **só** no relatório em PDF, hospedado em
  `cdn.atlasintel.org`.
- Por que não podemos buscá-lo: o `robots.txt` desse host responde
  `User-agent: *` + `Disallow: /`. `docs/04` §6 é não-negociável.
- **Número de registro TSE: NÃO aparece** em nenhuma superfície buscável — nem no
  JSON da API pública, nem no HTML de `/poll/<slug>`. Sem ele o V6 recusa, e sem
  V6 o adapter não tem como funcionar mesmo que o PDF fosse acessível.

Nada de portal de notícia foi usado (CLAUDE.md proíbe antes de esgotar fonte
primária, e `docs/08` §2 proíbe armazenar texto de terceiro). A página `/media` do
próprio site é só clipping de imprensa — nível 4, fora do caminho padrão.

## Superfícies verificadas

| Superfície | Host | `robots.txt` | Percentuais | Registro TSE |
|---|---|---|---|---|
| `GET /api/public-polls/<cat>?limit=&page=` | `atlasintel.org` | 404 ⇒ permite | NÃO | NÃO |
| `GET /poll/<slug>` (HTML) | `atlasintel.org` | 404 ⇒ permite | NÃO | NÃO |
| `GET /<uuid>.pdf` | `cdn.atlasintel.org` | **`Disallow: /`** | único lugar | não verificável |
| idem, arquivo de 2026-08-13 em diante | `cdn1.atlasintel.org` | sem robots ⇒ permite | único lugar | nenhum arquivo ainda |
| `tracking.` / `monitor.atlasintel.org` | — | — | produto pago | 403 + `/login` |
| `atlaspolitico.com.br` | — | — | DNS não resolve | — |

Também verificado: `atlasintel.org` **não** faz proxy do PDF (`/<uuid>.pdf`,
`/files/<uuid>.pdf`, `/api/files/<uuid>.pdf` respondem `302 → /`).

## O que foi entregue

- `packages/adapters/atlas/constants.ts` — constantes com a origem comentada,
  todas extraídas da fonte real (bundle `/_nuxt/56c233c.js` e as três respostas da
  API). Não podem morar em `packages/contracts/constants.ts` porque contracts está
  congelado; se um dia virarem compartilhadas, é este o ponto único a migrar.
- `packages/adapters/atlas/public-polls-api.ts` — fronteira Zod da API pública de
  releases (a MESMA requisição que o site faz, não endpoint privado). Modela só os
  campos factuais: o `description` do feed é prosa do instituto e nem é declarado,
  então o Zod o descarta e ele nunca entra em objeto nosso (R3). Inclui a regra
  REAL de corte de CDN (`cdn` vs `cdn1` por `file_created_on`).
- `packages/adapters/atlas/atlas-adapter.ts` — `AtlasAdapter extends BaseAdapter`,
  `id = 'atlas'`, `instituteId = 'atlas'`. `discover` **funciona**: uma requisição
  ao feed, casa a rodada pela janela de publicação e devolve o URL do relatório.
  `documentToText` despacha PDF (reusa `cnt-mda/pdf.ts`) / HTML / JSON e LANÇA em
  tipo desconhecido.
- `packages/adapters/atlas/parse.ts` — recusa DOCUMENTADA, não stub. Explica a
  tabela acima e as quatro condições, em ordem, para deixar de recusar.
- `packages/adapters/atlas/__fixtures__/` — capturas REAIS + README de proveniência
  (data, URL, protocolo de recaptura, redações R3).
- Specs: 29 testes verdes (17 + 12) + 2 ao vivo opt-in.

## O que NÃO foi entregue, e por quê

Percentuais do 1º turno, cenário de 2º turno, branco/nulo, não-sabe e
`UnknownCandidateError` pela via do adapter. Todos dependem de um documento com
números, e o único que existe é inacessível. Escrever o parser contra a estrutura
SUPOSTA do PDF é literalmente o erro da **Q-09** — um adapter que passa testes e
traz zero dado. Não repeti.

Além do robots: mesmo se o PDF fosse acessível, ele **não poderia virar fixture**.
`docs/08` §2 classifica gráfico do instituto como obra protegida que "nunca
copiamos, nunca embutimos", e o relatório da Atlas é um deck de gráficos. A fixture
honesta, quando houver, será o TEXTO extraído por `extractPdfText`.

## Como esta task destrava

1. **Esperar um relatório no `cdn1`.** Arquivo com
   `file_created_on >= 2026-08-13` é servido por `cdn1.atlasintel.org`, que não tem
   `robots.txt` — logo é buscável sem violar a §6. Em 2026-08-17 não havia nenhum
   (o mais novo era 2026-08-12). A próxima rodada nacional deve cair aí.
   Detector pronto: `ATLAS_LIVE=1 pnpm --filter @election-pool/adapters test atlas/atlas.live`
   imprime `DESTRAVOU` ou `AINDA BLOQUEADO`, e o segundo teste FALHA no dia em que
   o `robots.txt` do CDN antigo deixar de proibir.
2. **Congelar o texto extraído** desse relatório como fixture (não o PDF).
3. **Verificar se o relatório traz `BR-NNNNN/AAAA`.** Se não trouxer, a fonte é
   inviável para nós (R6 + V6) e a decisão sobe para `docs/OPEN-QUESTIONS.md`.
4. **Só então** escrever o parser, reusando `base/scenario-lines` (que já classifica
   branco/nulo e não-sabe) e `cnt-mda/pdf.ts`.

## Pendências para o dono do glue (não são minhas)

- **NÃO ligar `atlas` no registry ainda.** Com `parse` recusando, cada rodada
  viraria um `ParseError` previsível a cada ciclo. Ligar só depois do passo 4.
- **`.prettierignore` precisa de uma linha**:
  `packages/adapters/atlas/__fixtures__/**`, no mesmo bloco que já ignora
  `pesqele/__fixtures__` e `tse-candidatos/__fixtures__`. As capturas são
  EVIDÊNCIA e precisam seguir byte-a-byte o que a fonte devolveu; reformatá-las
  recria a Q-09 em outra forma. Sem a linha, `pnpm lint` reclama de 3 arquivos.
  Não editei porque o arquivo é da raiz e sete agentes irmãos estão em voo.
- O alias de instituto `AtlasIntel` já está no seed (T-14), então
  `instituteId = 'atlas'` casa com os registros reais do PesqEle.
