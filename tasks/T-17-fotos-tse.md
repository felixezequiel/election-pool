---
id: T-17
title: Ingestão das fotos oficiais dos candidatos (TSE DivulgaCandContas)
status: done
depends_on: [T-01, T-02]
owns:
  [
    packages/adapters/tse-candidatos/**,
    infra/migrations/1700000000010_candidate_photos.ts,
    apps/api/src/db/candidate-photos.repository.ts,
    apps/api/src/jobs/candidate-photos.job.ts,
    apps/api/src/jobs/candidate-photos.entry.ts,
    apps/api/src/jobs/candidate-photos.job.integration.spec.ts,
  ]
spec: docs/08-LEGAL-ETHICS.md §2, docs/04-INGESTION-SPEC.md §4 e §6, docs/03-DATA-MODEL.md §2.1
---

# T-17 — Fotos oficiais dos candidatos

O dono do projeto decidiu exibir foto de candidato. `docs/08` §2 classifica imagem
de terceiro como obra protegida e proíbe copiar. A **única** fonte compatível é o
registro público de candidatura do TSE (DivulgaCandContas): a foto que o próprio
candidato entrega ao se registrar, publicada pela autoridade eleitoral — mesma
natureza do dado do PesqEle que já consumimos. O TSE ainda marca explicitamente,
por candidatura, um campo `fotoUrlPublicavel`, e nós só baixamos quando ele é
`true`.

Nada é buscado em portal de notícia, agência, rede social ou banco de imagens. O
adapter não conhece nenhuma outra URL.

## A API real (investigada ao vivo em 2026-08-16)

O Divulga é um SPA Angular sem documentação pública. As rotas vieram do bundle do
próprio TSE (`main.<hash>.js` → `CandidaturaService`). Fluxo em três passos:

1. `GET /divulga/rest/v1/eleicao/eleicao-atual?idEleicao=0` → `sq_ELEICAO`
   (`20322002026` em 2026), ano e `tp_ABRANGENCIA`. Não hardcodamos o id: ele é
   descoberto e o ano/abrangência são **conferidos** contra `ELECTION_YEAR` e
   `ABRANGENCIA_FEDERAL` (se o TSE virar a chave para outro pleito, o job para).
2. `GET /divulga/rest/v1/candidatura/listar/2026/BR/{sqEleicao}/1/candidatos` →
   as **13 candidaturas a Presidente**, com `nomeUrna`, `nomeCompleto`, `numero` e
   `partido`. Cargo 1 = Presidente vem de `/candidatura/cargos?ano=2026`.
3. `GET /divulga/rest/v1/candidatura/buscar/2026/BR/{sqEleicao}/candidato/{id}` →
   `fotoUrl` e `fotoUrlPublicavel`.

**Cinco surpresas da API real** (todas documentadas em
`packages/adapters/tse-candidatos/__fixtures__/README.md`):

- A **listagem não traz foto**: `fotoUrl` vem `null` e `fotoUrlPublicavel` vem
  `false` nas 13 candidaturas. Quem confia na listagem conclui que ninguém tem
  foto. Os valores reais só existem no detalhe — daí o GET por candidatura ser
  obrigatório, e daí só o fazermos para quem casou.
- O **`Content-Type` da imagem mente**: veio `image/png` com
  `Content-Disposition: filename=... .jpg` para bytes `FF D8 FF` (JPEG). O formato
  é decidido pelos bytes, nunca pelo cabeçalho.
- **Sem `ETag`/`Last-Modified`** no endpoint da imagem (só `Cache-Control:
  max-age=240`). O conditional GET continua sendo enviado, mas a detecção de troca
  é por `sha256`.
- **`robots.txt` responde 403** com HTML de erro. Pela RFC 9309 e por
  `packages/adapters/robots.ts`, não-2xx ⇒ sem restrições; rate limit e UA
  identificável continuam valendo.
- `candidatoscomvicessuplentes` devolve lista **vazia** para Presidente/2026 — não
  serve de atalho.

## Casamento determinístico

`packages/adapters/tse-candidatos/matching.ts`. Nunca fuzzy (CLAUDE.md). A única
transformação é **normalização** (NFD + remoção de marcas, caixa alta, pontuação
colapsada) — necessária porque o TSE grava `FLAVIO NANTES BOLSONARO` sem acento e
`LUIZ INÁCIO LULA DA SILVA` com, na mesma resposta. Grafias que normalizam
diferente continuam sendo pessoas diferentes.

Três travas, todas com teste:

- **T1** grafia que aponta para dois candidatos nossos ⇒ ninguém casa;
- **T2** partido divergente derruba o casamento (nome casou, sigla não confere);
- **T3** duas candidaturas para o mesmo candidato derrubam as duas.

Resultado contra o cadastro atual (22 candidatos) e o registro real de 2026:
**casam 13 candidaturas** — as 13 registradas no DivulgaCandContas, todas com alias
cadastrado à mão no seed. `tarcisio`, `ratinho-junior`, `ciro-gomes` e
`simone-tebet` **não têm candidatura registrada** e ficam com `photoPath = null` +
alerta `sem_candidatura` (junto dos demais rastreados sem registro, 9 no total).
Há teste explícito de que `RONALDO CAIADO (PSD)` **não** casa por partido — ele só
casa porque existe o alias `RONALDO CAIADO`, cadastrado por humano.

> **Casar candidatura ≠ ter foto.** São dois estados diferentes e o job os
> distingue: dos 13 casados, só quem o TSE marca com `fotoUrlPublicavel: true` e
> tem bytes de imagem recebe arquivo. Quem casa sem foto publicável fica `null` +
> alerta `foto_nao_publicavel`, e **é reconsultado no ciclo seguinte** — não ter
> foto hoje não significa não ter amanhã. Qualquer teste que confunda os dois
> números volta a quebrar quando o cadastro crescer.

## Banco

`infra/migrations/1700000000010_candidate_photos.ts` (aditiva sobre `candidates`):
`photo_path`, `photo_source_url`, `photo_tse_candidatura_id`, `photo_origin_url`,
`photo_sha256`, `photo_bytes`, `photo_format`, `photo_width_px`,
`photo_height_px`, `photo_captured_at`, `photo_etag`, `photo_last_modified`.

- CHECK de `photo_format` derivado de `PHOTO_FORMATS` (fonte única no código).
- CHECK `candidates_photo_all_or_nothing`: ou a linha tem foto completa (arquivo +
  proveniência + auditoria), ou não tem foto nenhuma. Meia foto seria imagem no ar
  sem origem declarada — o que R6 e docs/08 §2.1 proíbem.
- Índice único parcial `candidates_photo_tse_candidatura_id_unique`: uma
  candidatura do TSE não pode virar a foto de dois candidatos.

Aplica e reverte (`node-pg-migrate up`/`down`/`up` verificados contra o Postgres
local).

## Arquivos e publicação

As fotos são gravadas em **`apps/web/public/candidatos/<candidate_id>.<ext>`**.
O Astro copia `public/` para o build e o `RenderJob` (T-13) publica o build em
`PUBLISH_BASE_DIR`; logo `public/candidatos/lula.jpg` vira `/candidatos/lula.jpg`
no site, exatamente o formato de `photoPath` em `contracts/public-data.ts`.
Escrever direto no `PUBLISH_BASE_DIR` seria errado: o próximo swap atômico apagaria
as fotos.

Escrita é `write` em `.tmp` + `rename` (atômica, sem janela de arquivo pela metade).

## Idempotência

- Foto conferida há menos de `PHOTO_RECHECK_INTERVAL_MS` (24h) **não gera
  requisição** — nem o detalhe da candidatura. Como o TSE não fornece validador de
  cache, essa janela é a única forma honesta de não bater no servidor por nada.
  `pnpm ingest:photos --force` ignora a janela.
- A janela vale para quem **tem** foto. Candidatura casada **sem** foto é
  reconsultada a cada ciclo (é o detalhe que informa `fotoUrlPublicavel`), o que
  hoje são 10 GETs por execução. É tráfego legítimo e o rate limit de 1 req/10s o
  contém; suprimi-lo exigiria uma coluna de "última tentativa" independente do
  bloco `photo_*`, que é tudo-ou-nada por desenho.
- Bytes iguais ⇒ o arquivo **não** é reescrito (mtime preservado, verificado em
  teste).
- Bytes diferentes ⇒ arquivo trocado **e alerta `foto_alterada` com os dois
  hashes**. Nunca sobrescrevemos em silêncio.
- Arquivo sumido do disco (deploy limpo) ⇒ regravado sem mexer no registro.
- **Nada rebaixa dado bom.** TSE fora do ar, imagem corrompida ou casamento que
  parou de acontecer não apagam a foto que estava no ar. Remoção é ação humana
  (`CandidatePhotosRepository.clearPhoto`).

## Decisão que merece revisão humana

Quando o TSE deixa de marcar `fotoUrlPublicavel` numa foto que já estava no ar, o
job **não apaga sozinho**: emite alerta `autorizacao_revogada` com `isError: true`
(o entry sai != 0, o cron enxerga). O raciocínio: uma instabilidade da API não pode
destruir dado em silêncio (R4), mas revogação de autorização é assunto de docs/08
§3 e precisa de decisão humana em 48h. Se o dono preferir remoção automática, é uma
linha em `processarCandidato` — está isolada de propósito.

## Pendências para quem tem a caneta dos contratos

1. **`job_runs` não registra este job.** `JobName` em
   `@election-pool/contracts/enums` é `discovery | harvest | model | render |
   reparse`; `contracts` está congelado, então o job só loga em stdout e não
   aparece no `/health`. Acrescentar `candidate-photos` ao enum (e o CHECK
   correspondente) é uma linha, mas é decisão de quem é dono do contrato.
2. **Constantes fora de `contracts/constants.ts`.** Pelo mesmo congelamento, as
   constantes desta task vivem em
   `packages/adapters/tse-candidatos/constants.ts`, cada uma com a origem
   comentada. Quando `contracts` reabrir, `MAX_PHOTO_BYTES`,
   `MIN_PHOTO_DIMENSION_PX`, `MAX_PHOTO_DIMENSION_PX`,
   `PHOTO_RECHECK_INTERVAL_MS` e `PHOTO_PUBLIC_PREFIX` migram sem mudar de
   semântica.
3. **`packages/adapters` ganhou `zod` como dependência** (não tinha) e seis
   entradas novas em `exports`. Sem isso não há Zod na fronteira HTTP do adapter
   nem como `apps/api` importar os módulos. Foram as únicas linhas tocadas fora
   do escopo declarado, e são aditivas.
4. **Alias novo casa foto na hora.** `tarcisio`, `ratinho-junior`, `ciro-gomes` e
   `simone-tebet` ficam sem foto porque não têm candidatura registrada — não é
   falta de alias. Se algum deles registrar candidatura com nome de urna que a
   gente ainda não tem em `candidate_aliases`, basta cadastrar o alias à mão e
   rodar o job: nada no código precisa mudar.

## Verificação

- `pnpm --filter @election-pool/adapters exec vitest run tse-candidatos` → **41
  testes**, todos verdes (parse das capturas reais, casamento, imagem, cliente).
- `pnpm --filter @election-pool/api test:integration` → o arquivo
  `candidate-photos.job.integration.spec.ts` roda **15 testes**, todos verdes,
  contra o banco derivado `election_pool_test` com o seed real de 22 candidatos.
  As asserções são de INVARIANTE, não de contagem: nenhuma delas afirma quantos
  candidatos existem no cadastro (foi o que quebrou este arquivo quando o campo de
  2026 entrou no seed).
- Typecheck limpo em `packages/adapters` e `apps/api` para os arquivos desta task,
  sem `any` e sem `@ts-ignore`. ESLint e Prettier limpos.
- Migration aplicada, revertida e reaplicada no Postgres local.
- `pnpm ingest:photos` executado **de verdade** contra o TSE.
