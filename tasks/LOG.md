# Log de execução

Cada agente escreve aqui ao concluir uma task: o que mudou, decisões tomadas e o
que o próximo agente precisa saber.

Formato:

```
## T-XX — <título>  ·  <data>
**Entregue:** ...
**Decisões:** ...
**Atenção para o próximo:** ...
```

---

## T-01 — Contratos · 2026-08-14

**Entregue:** Monorepo pnpm (`pnpm-workspace.yaml` com `apps/*` e `packages/*`),
`package.json` raiz com `lint`/`typecheck`/`test`/`verify`, `tsconfig.base.json`
(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `NodeNext`),
ESLint flat (`typescript-eslint` type-checked, `no-explicit-any` erro) + Prettier +
Vitest. Pacote `@election-pool/contracts` com os módulos: `enums.ts`, `branded.ts`,
`constants.ts`, `domain.ts`, `model-io.ts`, `public-data.ts`, `palette.ts`,
`races.ts`. 24 testes verdes; `pnpm verify` verde de ponta a ponta.

**Import path para os próximos agentes:** o pacote é `@election-pool/contracts`
e **não tem barrel** (CLAUDE.md). Importe direto do subpath, ex.:
`import { pollRegistrationSchema } from '@election-pool/contracts/domain';`
Subpaths exportados: `/enums`, `/domain`, `/public-data`, `/model-io`,
`/constants`, `/palette`, `/races`, `/branded`. Os `exports` apontam para o
`.ts` fonte (sem build) — resolvido via workspace pelo TS/Vitest.

**Decisões (nenhuma toca `docs/`):**
- `branded.ts`: `IsoDate` aceita ISO-8601 com offset **ou** data pura
  `AAAA-MM-DD` (para `field_start`/`field_end`, que são `date` no banco).
  Rejeita data-hora sem offset. `TseId` exige sequência de exatamente 5 dígitos
  zero-padded (`BR-06591/2026` aceito, `BR-6591/2026` rejeitado) — largura vem de
  `TSE_ID_SEQUENCE_DIGITS`. `Pct` é escala 0–100 (sem caminho 0–1).
- `constants.ts` concentra **todo** número mágico com citação da seção de origem
  (docs/01 e docs/07), incluindo V1–V7, limites de banda M-4, `HERDING_RATIO_THRESHOLD`,
  `MIN_POLLS_FOR_HOUSE_EFFECT` e `UPDATE_INTERVAL_MINUTES = 120`. Fora daqui só há
  `0`/`1`; `palette.ts` e `races.ts` derivam `slot`/`sortOrder` da posição no array
  para não introduzir literais.
- `public-data.ts` é o schema Zod **exato** de docs/03 §5, já com `nextUpdateAt`
  (string ISO -03:00) e `updateIntervalMinutes` (number) no topo. Os percentuais do
  `data.json` são `number` cru (formato serializado público), não `Pct` branded.
- `model-io.ts`: `Observation` usa `tseId: string` cru (o modelo não valida a
  forma do TSE, só rastreia proveniência) e não referencia banco/HTTP.

**Atenção para o próximo:**
- **T-02 (db):** os CHECKs das migrations devem bater 1:1 com os Zod enums de
  `enums.ts` (docs/03 §3 exige um teste de contrato comparando os dois). Ordem dos
  valores: veja `enums.spec.ts`. `race.status` inclui `encerrado` no enum, mas
  `PublicData.otherRaces.status`/`races.ts` só expõem `ativo|planejado`.
- **T-03 (model):** consuma `observationsSchema`/`modelOutputSchema` de
  `@election-pool/contracts/model-io`. Todas as constantes do modelo já existem em
  `/constants` — não redeclare número nenhum (o `no-directional-bias.spec.ts` de
  docs/07 §5.1 falha se houver literal não declarado).
- **T-10 (design):** cores em `@election-pool/contracts/palette` — `CANDIDATE_PALETTE`
  com `dark` (padrão) e `light` (~-12% luminância) por slot; slot 8 = "Demais".
- Se algum contrato precisar mudar, **pare** e escreva em `docs/OPEN-QUESTIONS.md`
  (CLAUDE.md) — mudar aqui invalida o trabalho de todos.

---

## T-02 — Banco · 2026-08-14

**Entregue:** `infra/docker-compose.yml` (Postgres 16, volume nomeado `election_pool_pgdata`,
healthcheck; host port **55432** para não colidir com um Postgres local em 5432). 5 migrations
node-pg-migrate em `.ts` (rodadas com `--tsx`) implementando docs/03 §2 na íntegra: reference,
raw, poll_registrations, poll_results/scenarios, computed. Trigger `BEFORE UPDATE OR DELETE ON
poll_results` que lança (append-only, R5). Índice único parcial de canônico com `NULLS NOT
DISTINCT` (cobre 1º turno com `t2_pair NULL`). Repositórios `pg`+SQL explícito em
`apps/api/src/db/` — toda linha lida passa pelo Zod de `@election-pool/contracts/domain` antes
de virar domínio. Seed manual (5 institutos, 7 candidatos com color_slot, 21 aliases, 4
corridas de `contracts/races`). 18 testes verdes contra Postgres real (trigger, índice único,
paridade enum↔CHECK lida de `pg_get_constraintdef`, `value_pct=100.5` rejeitado, round-trip);
todo `down` testado; typecheck/lint/prettier limpos.

**Decisões (nenhuma toca `docs/` nem contracts):** CHECKs de enum gerados a partir de
`enums.ts` (fonte única, verificada pelo teste de contrato). `DATABASE_URL` via `dotenv-cli`
lendo `infra/.env`. `model_estimates.t2_pair` é NOT NULL default `'{}'` porque docs/03 §2.5 o
inclui na PRIMARY KEY. `apps/api` só ganhou scaffold mínimo (sem NestJS ainda). Import `pg` por
default (`import pg from 'pg'`) por ser CJS.

**Atenção para o próximo (T-05/T-06):** chame `configurePgTypes()` uma vez no boot antes de
abrir o pool (numeric→number, timestamptz→ISO -03:00, date→'AAAA-MM-DD'). Repos prontos:
`PollRegistrationsRepository` (upsert por tse_id, nunca deleta), `RawDocumentsRepository`,
`PollScenariosRepository` (insert append-only atômico), `ReferenceRepository`
(`resolveInstituteAlias`/`resolveCandidateAlias`). Scripts reais em `apps/api/package.json`;
atalhos-raiz `db:up`/`db:down`/`db:migrate`/`db:seed` fiados pelo orquestrador. Testes da api
exigem Postgres no ar (`db:up`) antes de `pnpm test`/`verify`.

---

## T-03 — Série latente (Kalman + RTS) · 2026-08-14

**Entregue:** `packages/model` (novo pacote `@election-pool/model`, sem barrel, exports
apontam para `.ts` fonte). `kalman.ts` = filtro de Kalman forward + suavizador RTS por
candidato (escalar, exato — candidatos independentes no processo, docs/01 §2); `linalg.ts` =
álgebra de matriz pequena própria (p/ a extensão multivariada futura, Q-03). 16 testes verdes;
typecheck e lint limpos.

**Decisões:** Variância da observação usa `p` da estimativa CORRENTE (§4.2), não o valor
observado; recência entra na precisão (`R_eff = R/w`); `Δdias>45` excluído. Prior difuso finito
(var=100²) evita NaN. Datas em UTC via `Date.UTC` (determinismo). Saída = `KalmanResult.points:
{date,candidateId,mean,lo90,hi90,variance}[]`, ordenada por (date,candidateId), clamp [0,100]. É
a série crua de T-03 — a montagem em `modelOutputSchema.latent`, normalização de soma (§4.3),
house effects e gates ficam para T-04/T-08, que consomem `points`/`variance`.

**Contrato tocado (sinalizado):** adicionei `CI_Z_90 = 1.6448536269514722` em
`packages/contracts/src/constants.ts` (adição PURA — nenhum export existente mudou; contracts
seguem 24/24 verdes). Registrado em docs/OPEN-QUESTIONS **Q-04** para ratificação do Felix.

**Atenção para o próximo:**
- T-04/T-08: consumam `KalmanResult` de `@election-pool/model/kalman`. `variance` (p.p.²)
  exposta p/ diagnósticos.
- Autor do `no-directional-bias.spec.ts` (docs/07 §5.1): allowlist os índices de fatia de
  string ISO e a época UTC (`1970`) / radix `10` do parseInt em kalman.ts — aritmética de
  calendário, não parâmetro de modelo — ou o grep rejeitará manuseio de data.

---

## T-10 — Design system · 2026-08-14

**Entregue:** Scaffold do `apps/web` (Astro 7.2.2, `output: 'static'`) + design system
dark-first. `src/styles/*` com tokens de cor/tipografia/movimento/layout (escuro em `:root`,
claro via `[data-theme="light"]` e `prefers-color-scheme`), escala tipográfica §3.2 como classes
utilitárias, grade de 12 colunas + `.bleed`, `<Substrate>` (grade sutil fixa, reforço
`.substrate-plot`, densidade some <480px). Componentes `Num`, `AnimatedNum` (ilha
`client:visible`, valor final no SSR/no-JS, re-anima ao mudar `data-target`, estático sob
`prefers-reduced-motion`), `Substrate`, `BaseHead`, layout `Base` (dark sem flash via inline
script + único uso de localStorage permitido). Fontes auto-hospedadas (subset latin+latin-ext,
swap, preload das duas primeiras). Lint `scripts/lint-num.mjs` proíbe dígito solto fora de
`<Num>`/`<AnimatedNum>`. `build`/`typecheck`(astro check)/`lint` verdes.

**Decisões (nenhuma toca `docs/` nem contratos):**
- Fontes self-hosted em `public/fonts/` em vez de `fonts.googleapis.com` (docs/05 §3): mesmas
  fontes/subsets/swap, sem script de terceiro (docs/06 §7), preload real e CLS baixo.
- Corpo usa `--ink` e `.label` usa `--ink-2` para cumprir o piso de contraste (AAA corpo / AA
  rótulos nos dois temas); `.body-muted` (`--ink-2`) para apoio. Valores de token intocados.
- Página `/design-system` é scaffold-demo, em rota própria (não colide com as páginas reais).

**Atenção para o próximo (T-11/T-12):**
- Todo numeral em `<Num>`; número que anima usa `<AnimatedNum>` — e NUNCA dispensa a
  `UncertaintyRule` ao lado (docs/05 §1.1). Cores `--c1..--c8` (=CANDIDATE_PALETTE; `--c8`=
  "Demais"); reforce a grade sob o plot com `.substrate-plot`. Durações/easings `--dur-chart`/
  `--ease-out`.
- Página: `import '../styles/global.css'` uma vez; `.container`/`.grid-12`/`.col-text` (8 col)/
  `.bleed` (12 col). `<Substrate>` já entra no `Base.astro`; mantenha `<html data-theme="dark">`
  + inline no-flash script. `ThemeToggle` só escreve `localStorage['theme']` e seta `data-theme`.
  `astro.config.mjs` está mínimo de propósito — estenda aqui.

---

## T-04 — House effects (estimação de h_i) · 2026-08-14

**Entregue:** `packages/model/house-effects.ts` (estimação conjunta ML de h_i e μ_t sobre o
ciclo inteiro), `packages/model/index.ts` (`runModel(input): ModelOutput` — a ÚNICA API pública
do pacote, orquestração real: kalman + house-effects + normalização de soma §4.3 + gates, saída
validada contra `modelOutputSchema`), `packages/model/calendar.ts` (aritmética de data com
constantes nomeadas). Testes: `house-effects.spec.ts` (13) e `no-directional-bias.spec.ts` (4).
33/33 verdes; typecheck e lint limpos. `package.json` exports agora expõem `.`, `/house-effects`,
`/calendar` (além de `/kalman`, `/linalg`).

**Decisões (nenhuma toca `docs/` nem contracts):** h_i é UM escalar por instituto (docs/01 §1.2:
v1 não modela h_ij); `houseEffects[]` repete o mesmo h_i/IC por (instituto, candidato).
Restrição Σ w_i·h_i=0 como função pura testável (projeção ponderada); w_i = nº de observações;
institutos < MIN_POLLS_FOR_HOUSE_EFFECT ficam h=0, estimable:false. Estimação por
coordinate-ascent (μ|h via Kalman; h|μ = resíduos ponderados por precisão + prior ridge +
projeção); IC de h aproximado (subestima — Q-01). Normalização §4.3 por data; desvio >
SUM_DEVIATION_MAX_PP LANÇA (R4).

**Correções em arquivos do T-03 (autorizadas pelo handoff de T-03):** literais de calendário de
`kalman.ts` → `calendar.ts` (constantes nomeadas); divisores `2` nomeados (`MIDPOINT_DIVISOR`,
`PAIR_MEAN_DIVISOR`) para o gate de viés passar honesto sem enfraquecer o grep. Bug de
determinismo corrigido: `compareObservations` não desempatava por scenarioKind/t2Pair.

**Atenção para o próximo:** T-08 (§6 diagnósticos): `runModel` devolve `diagnostics: []` hoje;
herding/gaveta/divergência consomem `houseEffects` + série latente. T-13 (render): chame
`runModel({observations, referenceDate})` de `@election-pool/model` (export `.`); saída já
validada. Gates M-3/M-6 comparam runs consecutivos ⇒ ficam `true` num run isolado; quem chama
compara.

---

## T-05 — Descoberta (PesqEle + DiscoveryJob) · 2026-08-14

**Entregue:** Scaffold do `@election-pool/adapters` (sem barrel) + infra compartilhada que T-06
reusa: `poll-source-adapter.ts` (interface docs/04 §4 + ParseError/UnknownCandidateError),
`parse-ptbr-number.ts` (helper único, lança em lixo), `robots.ts` (RobotsCache RFC 9309, cache
24h, 404→allow-all), `rate-limiter.ts` (PerHostRateLimiter 1 req/10s, serial por host),
`http-client.ts` (conditional GET/304, timeout 20s, ≤2 retries backoff+jitter só em 5xx/rede, UA
identificável, robots+rate-limit antes de todo request). Adapter PesqEle:
`pesqele/{viewstate,registration,contractor-classifier,client}.ts` + fixtures HTML SINTETIZADAS.
`apps/api/src/jobs/discovery.{job,entry}.ts` + script `ingest:discover` (passthrough-raiz fiado).
48 testes adapters + 8 integração do job (Postgres real) verdes.

**Decisões:** infra compartilhada FLAT na raiz de `packages/adapters` (não em `http/`) p/ não
colidir com o que T-06 possui. Cliente JSF: GET index → submete formAviso → POST filtro
(2026/BR/30d) → paginação por POST reenviando ViewState; sessão expirada reestabelece UMA vez sem
loop. Transação por página com conexão DEDICADA. Upsert preserva `first_seen_at` e
`disclosure_status` (T-06 é dono das transições de disclosure). Contratante sem match →
'desconhecido'; alias de instituto desconhecido → institute_id=null + raw_name + alerta.

**TSE estava ACESSÍVEL neste sandbox** (probe: 200, ISO-8859-1, formAviso, ViewState, JSESSIONID;
robots.txt=404). Não rodei discover ao vivo; lógica testada com fixtures + HTTP mockado + fake
timers.

**Atenção para o próximo (T-06):** importe a infra direto dos subpaths (sem barrel); NÃO
re-implemente parse pt-BR; COMPARTILHE um único HttpClient/RateLimiter/RobotsCache no processo;
304 encerra o ciclo sem parse. `DEFAULT_USER_AGENT` existe; injete domínio/contato reais. V6
(tse_id) é responsabilidade do `parse()` do adapter. `apps/api` ainda não tem script `lint`.

---

## T-11 — Componentes de gráfico em SVG · 2026-08-14

**Entregue:** `apps/web/src/components/charts/**` — `LatentBandChart` (herói: banda 90% dominante,
linha discreta 1.5px/60%, pontos 40%/r3px; scrub por mouse e teclado animando `<AnimatedNum>` com
`UncertaintyRule` ao lado; tooltip instituto/contratante/`tse_id`/`n`/datas/valores; setas;
`Escape` fecha; orquestração banda→linha→ponto; transição de atualização via
`window.__latentUpdate(id,{series})`), `UncertaintyRule` (régua escala real, `domain`
compartilhável), `HouseEffectPlot` (dot plot IC90, zero enfatizado, `estimable:false` esmaecido
com `—`), `PollStrip` (uma linha/pesquisa, `tse_id` mono, link à fonte), `DiagnosticGauge` (valor
+ denominador no MESMO tamanho), `HachuraDefs` (4 hachuras por `color_slot`, daltônico/P&B). Libs
puras em `charts/lib/`. Cada gráfico SSR-completo: `role="img"`+`<title>`+`<desc>` e `<details>`
com tabela HTML real. D3 só escalas/formas/ticks. build/typecheck(0 erros)/lint-num verdes;
verificado no navegador real (hidratação, scrub, tooltip, teclado, sem-JS, update).

**Decisões (nenhuma toca docs/ nem contratos):** sem integração de framework — interação via
`<script>` hoisted do Astro (mesmo padrão do `AnimatedNum` de T-10), não ilha `client:*` (`.astro`
puro não hidrata com framework). Cada instância recebe `id` único (namespace de `<pattern>` e
script). D3 (`d3-scale/shape/axis/time` + `@types/*`) adicionado a `apps/web/package.json`.

**Atenção para o próximo (T-12):** APAGAR `src/pages/charts-demo.astro` e
`src/components/charts/__demo__/` (harness) e alimentar os componentes a partir do `data.json`
validado por `@election-pool/contracts/public-data`, via os helpers de `charts/lib/transform.ts`.
Prop API tipada/exportada no topo de cada `.astro`. Nenhum número de destaque sem `UncertaintyRule`
ao lado. `.astro` não passa por prettier no repo (sem plugin) — condição pré-existente de T-10.

---

## T-06 — Colheita (HarvestJob + adapters nexus/cnt-mda) · 2026-08-14

**Entregue:** `packages/adapters/base/**` (BaseAdapter com V6→extração→alias→Zod, nunca parcial;
AdapterRegistry tipado simples; candidate-resolver; tse-id V6; scenario-lines; raw-storage sha256
fora da árvore servida). Adapters `nexus` (HTML) e `cnt-mda` (PDF via `unpdf`, sem headless) +
fixtures SINTETIZADAS. `http/shared-client.ts` (singleton do HttpClient de T-05 — NÃO reimplementei
robots/rate-limit/conditional-GET). `apps/api/src/jobs/`: harvest.job + harvest-eligibility (backoff
puro docs/02 §3.2) + reparse.job + build-registry + entries; scripts `ingest:harvest`/`ingest:reparse`
(passthroughs-raiz fiados). 76 testes adapters + 40 api (5 harvest integração + reparse, Postgres
real) verdes; typecheck/lint limpos.

**Decisões:** Registry PLANO (não módulo NestJS — Nest não montado; segue T-05). Backoff em
`harvest-constants.ts` (operacional). Cenários persistidos is_canonical=false (seleção canônica é
passo posterior). **V6 é O teste mais importante — passa em 3 níveis** (unit, adapter, integração).

**Contrato/schema tocado (sinalizado):** Q-06 em docs/OPEN-QUESTIONS — `UNIQUE(tse_id,kind,label)`
colide com o supersede do reparse (docs/03 §2.4) e não há `superseded_at`. Reparse ficou IDEMPOTENTE
+ reporta `needs_supersede` (append-only intacto). Índice parcial `WHERE superseded_at IS NULL`
precisa de migration nova (T-02/orquestrador).

**Atenção para o próximo:** T-07: rode V1–V5,V7 ENTRE `adapter.parse` e `persistParsed` em
harvest.job.ts (V6 já é do BaseAdapter). T-13: t2_pair persistido já é candidate_id; nenhum cenário
é canônico ainda. Seed (T-02/T-14): adicionar institutos `nexus` e `mda` + aliases p/ o harvest
achar adapter (hoje os testes de integração self-seedam).

---

## T-08 — Diagnósticos (gaveta, herding, divergência) · 2026-08-14

**Entregue:** `packages/model/diagnostics.ts` (puro, docs/01 §6): `computeGavetaRates` (por instituto
E contratante; só registros com janela reg+5+15 já passada; saída sempre com registered/disclosed),
`computeHerding` (janelas de 7d por (cenário,candidato), ≥4 pesquisas; ratio=s²_obs/s²_esp;
flagged<HERDING_RATIO_THRESHOLD; sempre com nPolls), `computeDivergence` (|h|>3 E IC90 fora de zero E
estimável; estimável=false nunca marca). `index.ts`: `runModel` popula `ModelOutput.diagnostics`
(narrow {kind,subjectId,value,n}). 51/51 verdes; vocabulário docs/08 §5 auditado (limpo).

**Decisões:** Diagnóstico NÃO altera o agregado — separação estrutural verificada por teste. Gaveta
recebe registros do CHAMADOR (modelo continua puro, não lê banco). Nenhum limiar embutido.

**Contrato NÃO tocado — Q-05 registrado:** `ModelOutput.diagnostics` é narrow demais p/ as formas
ricas (gaveta registered/disclosed/subjectKind; herding windowEnd/flagged) e a gaveta precisa de
dados do PesqEle ausentes de `ModelInput`. As FORMAS RICAS que casam com `PublicData.diagnostics`
vivem em `diagnostics.ts`. Divergência (§6.3) não tem lar em `PublicData` hoje. Aguarda Felix.

**Atenção para o próximo (T-12/T-13):** monte `data.json`.diagnostics.gaveta/herding chamando
`computeGavetaRates`/`computeHerding` direto (passando os registros do PesqEle).

---

## T-12 — Página, copy e CTA · 2026-08-14

**Entregue:** Site estático (`/`, `/metodologia`, `/dados`), dark por padrão, seções 01–10 de docs/06
§2 na ordem. Costura de dados em `apps/web/src/data/`: `sample-data.json` (PublicData COMPLETO e
válido), `load.ts` (import + `publicDataSchema.parse` → `PublicData` tipado), `chart-inputs.ts`
(mapeia o schema aos props de T-11). 10 componentes em `components/sections/**` + `ThemeToggle` e
`NextUpdateCountdown`. Hero = a tese (não número solto); leituras com `<AnimatedNum>` + `UncertaintyRule`
no mesmo domínio. Diagnósticos com explicação inocente no mesmo bloco/peso, "X de Y registradas"
(inclui 1 de 1) + herding com `n` e ressalva. CTA de `data.otherRaces` (planejado aria-disabled, sem
e-mail/botão). Countdown ao vivo HH:MM:SS com rollover e fallback estático. Demos throwaway apagados.
build/typecheck(0 erros)/lint-num verdes. JS ~3,4 KB gz na `/` (orçamento 120 KB).

**Decisões:** componentes de página são `.astro` puro com `<script>` hoisted (segue T-11). "fraude"
só na linha verbatim de docs/01 §10. Janela vazia usa `ACTIVE_WINDOW_DAYS` de constants.

**Atenção para o próximo (T-13 render):** substitua a amostra pelo `data.json` real na COSTURA
`apps/web/src/data/load.ts` — sobrescreva `sample-data.json` antes do `astro build` OU redirecione o
import. `publicDataSchema.parse` continua o gate (R4). `otherRaces` derive de `RACES`
(`@election-pool/contracts/races`). Nenhuma página importa o JSON direto — só via `load.ts`.

---

## T-07 — Validação bloqueante de ingestão · 2026-08-14

**Entregue:** `packages/adapters/validation/**` — V1–V7 cada um em arquivo próprio (limites 100% de
`contracts/constants`, zero literal), `ValidationError` com tse_id+regra+valor+limite na mensagem,
orquestrador `validateParsedPoll` (V6 primeiro; por cenário V7→V1→V2→V3→V4→V5; bloqueia na 1ª falha),
`AdapterFailureCounter` (3 ciclos ⇒ alerta). `apps/api/src/ingestion/`: `approve.command.ts` (recusa
sem `--reason`), `manual-approvals.repository.ts`, entry; script `ingest:approve`. Validação fiada
ENTRE `adapter.parse` e `persistParsed` em `harvest.job.ts`. 116 adapters + 14 api (Postgres) verdes;
bordas exatas (96,9/97,0/103,0/103,1); sem linha órfã provado.

**Desvio (sinalizado):** migration ADITIVA `1700000000006_manual_approvals.ts` (tabela nova; poll_results
segue append-only). Aplicada no dev — **precisa entrar no migrate chain do orquestrador**.

**Atenção (T-14):** injete UMA `AdapterFailureCounter` em todo HarvestJob p/ o alerta ter memória entre
execuções. V5 (μ_t) NÃO é carregado no harvest — injete `currentLatent` via `ValidationContext`.

---

## T-09 — Backtest 2022 · 2026-08-14

**Entregue:** `packages/model/__fixtures__/2022.json` (40 pesquisas, ids neutros), `backtest.ts`
(harness puro: descarta field_end > corte, roda `runModel`, converte a válidos, gera
`docs/BACKTEST-RESULTS.md`), entry (exit 1 em FAIL), `backtest.spec.ts` (13). Script `model:backtest`.
64/64 verdes.

**Veredito HONESTO: REPROVOU (2/4).** R1 vencedor 49,7% [48,7;50,8] w2,09 urna 48,4% FAIL; vice 38,3%
[37,2;39,3] w2,06 urna 43,2% FAIL (viés comum 2022). R2 ambos PASS. NADA ajustado (R1). Falha por
**banda estreita** — **Q-07** liga à Q-01.

**Atenção:** M-7 FALHA ⇒ publicação bloqueada até decisão de metodologia do Felix. Fixture RECONSTRUÍDA
(tse_ids sintéticos) — parte do erro pode ser dela. `git_sha`=UNAVAILABLE (não é repo git).

---

## T-13 — RenderJob, data.json e publicação atômica · 2026-08-14

**Entregue:** `apps/api/src/publish/**` + `jobs/render.job.ts` + entries; scripts `render`/
`publish:rollback` (+ dep `@election-pool/model`). Monta `data.json` (docs/03 §5) de `runModel` +
diagnósticos ricos de T-08 sobre `poll_registrations`, otherRaces de `RACES`, tempos -03:00, validado
contra `publicDataSchema` ANTES de escrever. Costura T-12: sobrescreve `sample-data.json` antes do build.
46 T-13 + suíte api 95 verdes. E2E real publicou dist/ + data.json; rollback idempotente.

**Decisões (sinalizadas):** (1) Swap via **SYMLINK** — a dança de 3 renames de docs/02 §3.4 tem vão de
ENOENT (provado); `dist` é symlink trocado atomicamente, builds `dist-<generatedAt>`, retenção 5. **nginx
precisa `disable_symlinks off`.** (2) `historicalError: []` (docs/01 §7 descritivo). (3) Render lê só
`is_canonical=true` — sem canônico, M-1 reprova e NÃO publica.

**Pacote tocado:** +1 linha em `packages/model/package.json` (export `./diagnostics`, aditivo).

**Atenção (T-14):** gatilho = `render` após ModelJob gates_passed (exit 2 = abortado-por-gate; exit 1 =
crash). `PUBLISH_BASE_DIR` (obrigatória) no MESMO filesystem que `apps/web` (EXDEV). nginx:
`disable_symlinks off`; `/data.json` `Cache-Control: public, max-age=300` + CORS. **Seleção de canônico
precisa rodar antes do render** (harvest grava is_canonical=false) — falta esse passo no pipeline.

---

## T-14 — Orquestração, observabilidade e deploy · 2026-08-14

**Entregue (owns):** `apps/api/src/main.ts` (bootstrap PLANO, sem NestJS: migra ANTES
de qualquer job — falha ⇒ processo sai != 0, jobs nunca começam; `configurePgTypes`;
scheduler `node-cron` com LOCK anti-sobreposição por job; `/health` interno; loop de
alertas). `apps/api/src/health/**` (`health.ts` snapshot de staleness, `health-server.ts`
HTTP `node:http` cru, `alerts.ts` AlertSink webhook-ou-log-de-erro). `infra/nginx/`
(`election-pool.conf`: `disable_symlinks off`, `/data.json` `Cache-Control public,
max-age=300` + CORS). `.github/workflows/ci.yml` (pnpm verify com Postgres+migrate;
build de imagem em tag → ghcr).

**Glue MISSING criada (sinalizada, cada uma):**
- **ModelJob** (`apps/api/src/jobs/model.job.ts`, script `model:run`): roda seleção
  canônica, `runModel` sobre observações canônicas do banco, persiste `model_runs`
  (input_hash SHA-256 do conjunto ordenado, git_sha, params_json, gates_passed,
  gates_json), `model_estimates`, `model_house_effects`, `model_diagnostics`; avalia
  M-1..M-7 (M-3 vs run anterior, M-4 largura de banda, M-5 finitude, M-6 dois runs
  idênticos, **M-7 = backtest**); devolve `shouldRender = gatesPassed`. `model.entry.ts`.
- **Seleção canônica** (`apps/api/src/ingestion/canonical-selection.ts` puro +
  `canonical-selector.ts` DB): implementa docs/01 §3 EXATAMENTE (regra 1→2→3; 2º turno
  por par). Grava `is_canonical`/`canonical_reason`; roda no início do ModelJob (o
  harvest grava is_canonical=false; sem este passo M-1 reprova — lacuna que T-13 apontou).
- **Migration aditiva** `1700000000007_job_runs.ts` (`job, started_at, finished_at,
  status, error, metrics_json`) + `JobRunsRepository`. Enums novos `JOB_RUN_STATUS`/
  `JOB_NAME` em contracts (ADITIVOS, ninguém dependia); parity test estendido.

**V5 μ_t + AdapterFailureCounter (LOG T-07):** `main.ts` injeta UMA `AdapterFailureCounter`
em todo HarvestJob (memória entre ciclos p/ "3 ciclos ⇒ alerta") e um provider de
`currentLatentByCandidateId` (μ_t do último run com gates_passed, `latent-provider.ts`)
que o HarvestJob reprojeta para os aliases do poll no `ValidationContext.currentLatent`.

**Decisões/desvios sinalizados:**
- `runMigrations` (`db/migrate.ts`) faz `spawn` da CLI `node-pg-migrate --tsx` com
  `NODE_PATH=apps/api/node_modules` — o `runner` programático não resolve os subpaths
  `@election-pool/contracts` das migrations `.ts`; e sem o NODE_PATH um banco NOVO falha
  ao CARREGAR as migrations (num banco já migrado o load é pulado, o que mascarava).
- **EXDEV no deploy (Q-08, novo):** `astro build` LANÇAVA `EXDEV` ao mover
  `.astro/.prerender → dist-staging` quando `apps/web` (overlay) e `PUBLISH_BASE_DIR`
  (bind mount) diferem de filesystem. Fix em `astro-build.ts` (T-13): build para
  `webDir/.dist-build` (same-fs) e COPIA a árvore pronta p/ `dist-staging`; o swap
  segue rename same-fs. 46 testes de T-13 verdes.
- Seed ganhou institutos `nexus`/`mda` + aliases (lacuna que T-06 apontou).
- Deploy é containerizado (postgres+api no compose; nginx pode ser host OU sidecar) —
  leve desvio de "nginx no host" de docs/02 §7, justificado e documentado no compose.

**Testes (aceite — RODEI, não presumi):**
- Lock: `job-lock.spec.ts` + `orchestrator.integration.spec.ts` provam que a 2ª
  execução simultânea do mesmo job NÃO roda (e nem abre linha em job_runs).
- `/health`: `health.integration.spec.ts` com dist envelhecido artificialmente
  (utimes no build-alvo) reporta stale/degraded corretamente; idade do último sucesso
  por job lida de job_runs.
- Alerta DISPARA: `alerts.spec.ts` + orchestrator provam adapter-em-falha e dist-velho
  virando log de erro (e POST no webhook quando configurado; webhook down não derruba).
- Migration bloqueia boot: `migrate.integration.spec.ts` (cadeia real resolve;
  DATABASE_URL inalcançável REJEITA). Provado TAMBÉM no container real: boot_failed em
  loop, jobs nunca iniciados.
- **docker compose up do zero → site servido:** RODEI e2e (imagem node:22, stack
  isolada). Boot migra→health→ready; seed + `model:run` (canonical=3, M-1..M-6 PASS,
  **M-7 REPROVA** ⇒ shouldRender=false, render NÃO disparado — honesto); `render`
  direto publicou (`published:true`, dist symlink → build de 84 KB, data.json válido);
  nginx serviu `/` (200, 84 KB) e `/data.json` (200, `Cache-Control: public, max-age=300`,
  `Access-Control-Allow-Origin: *`).
- 72h-sem-intervenção (M4): não roda aqui — provado por scheduler+lock+job_runs+
  recuperação (job que lança vira status=error e o próximo tick roda) em teste rápido.

**`pnpm verify` VERDE de ponta a ponta** (exit 0): eslint + prettier limpos, typecheck
(web 0 erros + todos os pacotes), testes (contracts 24, adapters 116, model 64, api
126 = 330), `astro build` completo. **Para deixar verde tive que:** (1) ajustar os
`ignores` do eslint root (`.astro/**`, `env.d.ts`, `**/*.mjs`, `infra/migrations/**` —
não são projeto TS type-checked; migrations rodam via `--tsx` e são cobertas por
integração); (2) `.prettierignore` p/ `**/.astro/**` (gerado) e `dist-*`; (3)
`prettier --write` num conjunto de arquivos PRÉ-EXISTENTES (T-10/T-12/T-13) que já
estavam fora do estilo (baseline estava VERMELHO — só-formatação, sem lógica); (4)
adicionar `build` ao `verify` (gate docs/07 §5) e o script `model:run`/`orchestrate`.
Root `package.json` editado (permitido ao orquestrador). O VEREDITO de reprovação do
M-7 NÃO falha o CI: `backtest.spec.ts` testa mecânica/determinismo, não `allPassed`;
só o gate de publicação consome o veredito (docs/07 §4/§6).

**Pipeline completo (discover→harvest→canonical→model→render):** todos ligados no
scheduler. **O que ainda bloqueia um publish REAL:** o **M-7 (backtest 2022) REPROVA
honestamente** (LOG T-09, Q-07) ⇒ ModelJob grava gates_passed=false ⇒ RenderJob não é
disparado pelo modelo. É o comportamento correto: publicar dado errado é pior que não
publicar. Desbloqueio = decisão de metodologia do Felix (Q-07/Q-01), NÃO tuning (R1).
O caminho de render em si está provado funcional (publica quando os gates do runModel
passam, independente do M-7, que só o ModelJob avalia).

**Atenção:** OPEN-QUESTIONS Q-08 (EXDEV, informativo/resolvido). Nada mais pendente —
esta é a última task.
