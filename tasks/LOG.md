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

## Stack local de um comando, fallback de UI e o furo do PesqEle · 2026-08-16

**Objetivo:** `docker compose up` na raiz sobe tudo, depois de copiar o `.env`.
Feito e verificado de um start LIMPO (stack derrubada + volume de publicação
apagado): migrations → seed de referência → discovery → harvest → model → render
→ nginx servindo. Site em `:8080`, `/data.json` em `:8080/data.json`, `/health`
em `:8081`.

**Postgres compartilhado.** A máquina já tinha um `finance-insights-db` (postgres
17, 508 MB de dado REAL) ocupando a 5432. Em vez de um segundo servidor, o compose
agora define UM Postgres de desenvolvimento — container `dev-postgres`, rede
`dev-shared`, volume `dev_pgdata`, porta 5432 — com a lista de bancos em
`POSTGRES_DATABASES` do `.env`, garantida a cada `up` por um one-shot idempotente
(`postgres-init`); acrescentar um projeto é acrescentar um nome. Migração feita com
dump direcionado (`pg_dump -Fc`) + restore e CONFERÊNCIA de contagem linha a linha
(ledger_transaction 200000, transaction_read 200000, connections 2, system_events
113, ledger_merchant 242 — idênticos antes e depois). O container e o volume
ANTIGOS não foram removidos: `finance-insights` guarda o serviço `db` atrás do
profile `standalone` como caminho de volta. O `.env` daquele projeto não precisou
mudar (mesma porta, mesmas credenciais, mesmo banco); só ganhou comentário.

**Publicação em volume nomeado, não bind mount.** O swap de T-13 troca um SYMLINK;
bind mount de diretório do Windows não serve. `api` (rw) e `nginx` (ro)
compartilham `election_pool_publish`.

**Boot configurável** (`main.ts`, tudo `false` por padrão ⇒ produção intocada):
`SEED_REFERENCE_ON_BOOT` (o seed é bloqueante — sem referência o pipeline roda em
vazio em silêncio), `RUN_JOBS_ON_BOOT` (uma passagem imediata pelo MESMO caminho de
lock/job_runs do cron, em vez de esperar até 2h), `RENDER_ON_BOOT`,
`PUBLISH_PLACEHOLDER_WHEN_EMPTY`. `db/seed.ts` ganhou o guarda `isEntrypoint()` —
sem ele, `import { seed }` disparava a CLI como efeito colateral.

**Fallback de UI (pedido do Felix).** Sem cobertura o nginx devolvia 404 puro: não
dava para distinguir "quebrou" de "ainda não há pesquisa". Agora
`NoDataNotice.astro` troca as seções de dado por um estado vazio EXPLICADO —
mesmo header, mesma tipografia, mesmo rodapé com proveniência — com checklist do
que falta ("0 de 3 pesquisas", "0 de 2 institutos", das constantes reais) e a hora
da próxima tentativa. Do lado do render, `allowPlaceholderPublish` é uma exceção
ESTRITA: só quando NÃO existe `dist/` e o ÚNICO gate reprovado é o do modelo.
Nunca substitui site bom por placeholder, não afrouxa build/data.json/frescor/
adapter suspeito, e ainda emite alerta. `RenderResult.placeholder` distingue nos
logs "site com número" de "site dizendo que não há número".

**Bug de navegação achado e corrigido.** O astro gera `metodologia/index.html`, o
nginx emitia 301 ABSOLUTO para acrescentar a barra e montava a URL com a porta em
que ELE escuta (80), não a porta de entrada (8080): a home abria e o primeiro
clique caía em `http://localhost/metodologia/`, no vazio. `absolute_redirect off`
no `infra/nginx/election-pool.conf`. Mesma armadilha atrás de qualquer proxy.
Varredura de todas as rotas/assets depois do fix: 9 recursos, todos 200.

**CRLF quebrava o `pnpm verify`.** O repo não tinha `.gitattributes`; com
`core.autocrlf=true` (padrão do Git for Windows) o checkout gravou CRLF em 276
arquivos e o Prettier reprovou 208 deles — zero diferença de código. Pior: o
`COPY . .` levava o CRLF para a imagem. Adicionado `.gitattributes` com
`* text=auto eol=lf` e a árvore convertida (`git diff` confirma: só os 6 arquivos
realmente editados mudaram de conteúdo). Também adicionado `.dockerignore` — o
contexto de build levava `.git` e `node_modules` do host.

**`pnpm verify` VERDE dentro do container** (exit 0): lint + prettier limpos,
typecheck 0 erros, 330 testes (contracts 24, adapters 116, model 64, api 126),
astro build completo.

**O QUE O PRÓXIMO AGENTE PRECISA SABER — não há dado de pesquisa no sistema.**
O DiscoveryJob roda contra o TSE real e termina `seen=0`, sem erro. O PesqEle real
TEM o dado (50 registros presidenciais de 2026 nos últimos 30 dias: Datafolha,
Opnus, Perfil, Verita…). O cliente de T-05 foi escrito contra uma estrutura
SUPOSTA do site e erra tudo: URL, formulário, nomes de campo, protocolo (é AJAX
PrimeFaces) e o parser casa `data-field`/`data-row` que **não existem no PesqEle**
— são invenção das próprias fixtures, e por isso os testes ficaram verdes o tempo
todo. Diagnóstico completo em **Q-09**; protocolo real capturado e reescrita
especificada em **tasks/T-15-pesqele-real.md**. Enquanto T-15 não roda, o site
publica honestamente o estado vazio.

**Lição que vale registrar:** fixture sintética de fonte externa não é evidência de
integração. T-05 pedia "fixture de HTML REAL do PesqEle" no aceite e isso não foi
cumprido — o custo apareceu só quando alguém apontou o pipeline para o site de
verdade, uma task inteira depois.

---

## T-18 — Transferência de votos e séries de branco/nulo e não-sabe · 2026-08-16

**Entregue:** MODEL_VERSION 2.0.0 implementado dentro de `packages/model`, segundo
a decisão e as sete condições da Q-10. (1) Branco/nulo e não-sabe viraram estados
rastreados: `runElectorateKalman` (em `kalman.ts`) roda as duas séries pelo MESMO
suavizador dos candidatos — mesma variância amostral (§4.2), mesma recência (§4.4),
mesma banda de 90% — e um nó sem medida dentro da janela ativa sai `null`, nunca 0
(R4); grandeza que nenhum instituto publicou não vira série alguma. (2)
`packages/model/transitions.ts`: estimador puro e determinístico que resolve, entre
dois nós da série latente, o polítopo de transporte (`F ≥ 0`, linhas somam a massa
de origem, colunas reproduzem as marginais de t+1) escolhendo o ponto mais próximo
em divergência KL do prior de permanência `TRANSITION_STICKINESS_PRIOR` — que é o
ponto fixo do IPF/RAS. Banda por bootstrap com PRNG semeado (semente fixa + índice
do passo), `pp ± z₉₀·sd`. (3) `ModelInput.electorateObservations` é OBRIGATÓRIO
(combinado com o agente do backend): esquecer de passar quebra no typecheck em vez
de produzir série vazia em silêncio. (4) Backtest de transferência 1º ⇒ 2º turno,
gravado em `docs/BACKTEST-RESULTS.md`. 99 testes verdes, typecheck limpo, eslint e
prettier limpos.

**Decisões:** *Nós = datas de medição dentro da janela ativa*, não o grid diário —
entre duas medições o suavizador não recebeu informação nova e um "fluxo" ali seria
interpolação vendida como movimento. *As duas composições são postas na mesma massa
total* (a média das duas) para o polítopo existir; a variação do resíduo não
rastreado fica diluída nos fluxos entre rastreados, e isso está declarado no código.
*A matriz sai completa*, incluindo a diagonal (permanência): esconder a permanência
tornaria impossível conferir que as linhas fecham. *`notIdentifiable` = banda cruza
zero OU ponto abaixo de `TRANSITION_MIN_VISIBLE_PP`*, publicado sempre, nunca
omitido. *A banda cobre a incerteza do DADO, não a do prior* — inflá-la com um
segundo prior arbitrário empilharia suposição sobre suposição; em vez disso a
dependência do prior é QUANTIFICADA e publicada em `transitions.prior.note`.
Constantes de implementação (teto e tolerância do IPF, nº de réplicas do bootstrap,
semente, constantes de mistura do PRNG) ficaram como `const` nomeadas no módulo, com
comentário, seguindo o precedente de `house-effects.ts`/`backtest.ts` — nenhuma delas
é parâmetro de modelo, e `contracts` não foi tocado.

**Backtest de transferência: REPROVOU.** O modelo estima que 38,7% da massa liberada
pelos eliminados foi para o primeiro finalista, banda 90% [31,6; 46,2]; a urna
implica 29,8%. Fora da banda ⇒ FAIL, e o veredito geral do backtest passou a
`REPROVOU (2/4, transferência FAIL)`. **Nada foi ajustado para passar (R1).** O
diagnóstico é o previsto pela Q-10: o prior de permanência espalha a massa liberada
de forma quase simétrica entre os destinos, enquanto a realidade de 2022 foi
fortemente assimétrica; a estimativa cai a meio caminho entre o prior (50/50) e o
que as marginais sozinhas diriam.

**Atenção para o próximo — dois pontos que merecem virar adendo da Q-10 (decisão do
Felix, não fiz por estar fora do meu escopo de arquivos).** Primeiro: no run do 1º
turno de 2022 a nota publicada mede que o ajuste ao dado desloca **7,00 p.p. de
91,00 p.p. de massa por passo — 8%**. Ou seja, ~92% do número publicado é o prior.
Isso está publicado (condição 2), mas é o tamanho real da ressalva. Segundo, e mais
incômodo: como as bandas latentes são estreitas (o problema já registrado na Q-07),
fluxos cruzados de ~2 p.p. que são quase inteiramente prior saem com banda
inteiramente acima de zero e portanto **sem** o rótulo `notIdentifiable` — o rótulo
protege contra ruído amostral, não contra a suposição. Só 34 de 272 fluxos do run de
2022 foram marcados. A condição 4 (UI rotulando o painel inteiro como estimativa de
modelo sob suposição) deixa de ser cosmética e passa a ser a principal defesa do
leitor. Para quem for religar o backend: `ModelInput` agora exige
`electorateObservations`; a fixture de 2022 não tem branco/nulo nem não-sabe, então
o backtest roda com array vazio e **não exercita** a série de eleitorado — quando
houver dado real dessas grandezas, vale refazer o backtest incluindo-as.

---

## T-17 — fotos oficiais dos candidatos (TSE DivulgaCandContas) — `done`

Entreguei a ingestão das fotos oficiais. A decisão de produto (exibir foto) só
cabe em `docs/08` §2 por uma porta: o registro público de candidatura do TSE, que
é ato da autoridade eleitoral, não obra de terceiro — e que ainda traz um campo
`fotoUrlPublicavel` por candidatura, do qual dependemos. Nada vem de imprensa,
agência, rede social ou banco de imagens; o adapter não conhece outra URL.

**A API real desmentiu três suposições, e isso importa para quem mexer nela.**
(a) A listagem de candidaturas devolve `fotoUrl: null` e `fotoUrlPublicavel:
false` para as 13 candidaturas presidenciais — quem parar na listagem conclui que
ninguém tem foto; os valores verdadeiros só existem no endpoint de DETALHE, um GET
por candidatura. (b) O download da imagem vem com `Content-Type: image/png` e
`Content-Disposition: ....jpg` para bytes que são JPEG — três fontes, duas
erradas, então o formato é decidido pelos bytes. (c) O endpoint da imagem não
manda `ETag` nem `Last-Modified`, só `Cache-Control: max-age=240`, então
conditional GET não resolve e a detecção de troca é por `sha256`. As rotas não são
documentadas: saíram do bundle Angular do próprio Divulga. Tudo está capturado em
`packages/adapters/tse-candidatos/__fixtures__/` com o README explicando como
recapturar.

**Rodou de verdade contra o TSE, duas vezes.** Primeira: `casados=3 novas=3
downloads=3`. Segunda: `casados=3 novas=0 atualizadas=0 inalteradas=3 downloads=0`,
com mtime e md5 dos arquivos idênticos. As três fotos estão em
`apps/web/public/candidatos/` (`lula.jpg` 6621 B, `flavio-bolsonaro.jpg` 6394 B,
`zema.jpg` 4944 B, todas JPEG 161x225) e o `sha256` do disco bate com o do banco.
Testes: 41 no adapter (`packages/adapters/tse-candidatos`) e 15 de integração
(`apps/api/src/jobs/candidate-photos.job.integration.spec.ts`), todos verdes;
migration `1700000000010` aplica, reverte e reaplica.

**O QUE O PRÓXIMO AGENTE PRECISA SABER.** O casamento é determinístico e
conservador (nunca fuzzy): casam **lula**, **flavio-bolsonaro** e **zema**.
`tarcisio`, `ratinho-junior`, `ciro-gomes` e `simone-tebet` ficam com `photo_path
= NULL` porque **não têm candidatura registrada no TSE** — não é bug de alias nem
falta de dado nosso, é o registro eleitoral real de 2026. Quem for ligar a foto no
`data.json` e na UI: leia `candidates.photo_path` e `candidates.photo_source_url`,
trate `NULL` como o caso NORMAL e caia para monograma + cor; o `photo_source_url`
é obrigatório na tela junto da foto (proveniência, R6). O CHECK
`candidates_photo_all_or_nothing` garante que nunca existe meia foto, então não
precisa de defesa contra `photo_path` sem `photo_source_url`.

Duas coisas ficaram travadas pelo congelamento de `packages/contracts`, e são
decisão de quem tem essa caneta: `JobName` não tem `candidate-photos`, então este
job **não aparece no `job_runs` nem no `/health`** (só loga em stdout); e as
constantes numéricas novas moram em
`packages/adapters/tse-candidatos/constants.ts` em vez de `contracts/constants.ts`,
cada uma com a origem comentada. Fora do meu escopo declarado eu toquei só
`packages/adapters/package.json`, de forma aditiva: `zod` não era dependência do
pacote (sem ela não há Zod na fronteira HTTP) e faltavam as entradas de `exports`
dos módulos novos. Detalhes e a decisão sobre `autorizacao_revogada` — o job
alerta alto mas NÃO apaga foto sozinho — estão em `tasks/T-17-fotos-tse.md`.

---

## T-19 — UI da MODEL_VERSION 2.0.0 (fotos, eleitorado, transferência) · 2026-08-16

**Entregue, só em `apps/web/**`:** (1) `CandidatePhoto.astro` — foto local quando
`candidates[].photoPath` existe, monograma sobre a cor do `colorSlot` quando é
`null` (o caso NORMAL, como T-17 avisou); a foto é decorativa (`alt=""`) onde o
nome está ao lado, e o componente LANÇA se receber URL absoluta, porque servir
imagem de fora seria o erro que ninguém percebe olhando a página (docs/08 §2).
Aparece no herói, no readout da série latente, na lista de pesquisas e em `/dados`,
que ganhou o bloco "Candidatos e proveniência da foto" com o link do registro de
candidatura de cada um. (2) `ElectorateSeriesChart` + `electorate-geometry.ts` —
branco/nulo e não-sabe no MESMO eixo do tempo da série de candidatos (mesmo
`xDomain`, mesmas margens laterais) e em gráfico separado, com identidade neutra:
grafite e tinta secundária, hachura própria, traço tracejado. Não recebem cor do
espectro porque não são candidatura, e porque o não-sabe costuma ser maior que o
terceiro colocado — colorido como candidato, distorceria a leitura da disputa.
(3) `TransitionPanel` + `TransitionSection`. (4) `polls[].blankNullPct` e
`undecidedPct` na tira de pesquisas, com "não publicado" quando o instituto não
divulgou a grandeza. (5) `gen-sample-data.mjs` regenerado para o schema `'2'`
(nomes fictícios mantidos), com buracos na série do eleitorado e fluxos
`notIdentifiable` na transferência. **Typecheck 0 erros / 0 avisos (44 arquivos),
build limpo sem warning (3 páginas), `lint-num` limpo (31 `.astro`).**

**`null` da série do eleitorado.** Um ponto sem medida quebra a série em SEGMENTOS
contíguos: cada trecho tem seu próprio path e o vão simplesmente não tem traço.
Não há interpolação por cima do buraco (afirmaria caminho medido) nem zero
desenhado (afirmaria "ninguém está indeciso", que é outra coisa). O vão ainda ganha
duas marcas explícitas: uma linha vertical pontilhada e uma "linha de cobertura" no
topo do gráfico, com marca cheia para data medida e vazada para data sem medida —
sem isso o buraco pareceria fim de série. Trecho de um ponto só (acontece na
amostra em 08/08, depois do buraco de 01/08) vira barra vertical da banda + ponto,
para não sumir por falta de vizinho.

**O painel de transferência foi REESCRITO no meio da task, e vale registrar por
quê.** A primeira versão era um Sankey desenhado à mão com `d3-shape`: nós dos dois
lados, fitas curvas, permanência como fita reta. Estava pronto e funcionando quando
chegou a medição de T-18 — o ajuste ao dado desloca 7,00 de 91,00 p.p. de massa por
passo, ou seja **~92% do número publicado é o prior de permanência**. Fita grossa e
limpa entre dois nós comunica trajetória medida; era desenho bonito sustentando
afirmação que o dado não faz. Joguei fora e troquei pela linguagem que o site já
reserva para estimativa incerta (o dot plot de house effect, docs/05 §5): **uma
FAIXA por relação origem→destino, em escala real, com o zero marcado e
enfatizado**. Assim a incerteza é o desenho inteiro, a média é uma marca fina em
cima dela, e "não distinguível de zero" virou coisa que se VÊ (a faixa atravessa a
linha do zero — na amostra, 4 das 7 relações) em vez de selo em que se acredita.
Nada é escondido: todos os fluxos cruzados do passo entram no painel, os de
permanência saem numa lista à parte (em escala comum, dezenas de p.p. achatariam
décimos de p.p.), e a tabela traz todos os passos.

**O rótulo `notIdentifiable` NÃO é tratado como sinal de confiança**, e isso é
explícito na tela. T-18 mediu que só 34 de 272 fluxos de 2022 ficaram marcados e
que o rótulo captura ruído amostral, não a dependência do prior. Então: o contraste
visual entre marcados e não marcados é pequeno de propósito (o marcado ganha
contorno tracejado, o não marcado NÃO ganha ar de sólido), o texto do selo diz
"distinguível de zero"/"não distinguível de zero" — nunca "confiável" —, e há frase
fixa dizendo que relação sem selo não é relação medida. O aviso de "estimativa de
modelo, não medida" saiu de parágrafo de corpo para bloco com régua de acento,
tipo de display e posição ANTES do painel, com o peso do prior e a
`transitions.prior.note` (onde a participação medida do prior é publicada) exibida
em tipo grande. Q-10 condição 4 deixou de ser cosmética.

**O QUE O PRÓXIMO PRECISA SABER.** (a) `apps/web/public/candidatos/` tem dois donos
agora: T-17 escreveu as fotos reais ali e, ao fazer isso, apagou as duas imagens de
amostra que eu tinha criado; recriei como `amostra-andrade.svg` e
`amostra-barros.svg` — desenhos abstratos NOSSOS, sem rosto de pessoa, porque a
amostra não pode conter presidenciável real. Se aquele diretório for sincronizado
por job, ele precisa preservar arquivos que não vieram do TSE, ou a amostra quebra
de novo. (b) `src/data/sample-data.json` foi regenerado pelo script; para rodá-lo é
preciso loader de TS (`node ../../node_modules/.pnpm/tsx@4.19.2/.../cli.mjs
scripts/gen-sample-data.mjs`), porque `@election-pool/contracts` exporta `.ts`.
(c) **Nenhum breakpoint foi verificado com olho humano** — não há browser nesta
sessão; conferi só o CSS e a marcação gerada. (d) O painel desenha todos os fluxos
cruzados do passo: com K estados são até K²−K faixas, e não impus teto porque
cortar por magnitude esconderia justamente os `notIdentifiable`. Detalhes e
pendências em `tasks/T-19-ui-v2.md`.

---

## T-15 — PesqEle real (reescrita do cliente/parser)  ·  2026-08-16

**Entregue: o DiscoveryJob traz dado de verdade.** Rodado contra o
`pesqele-divulgacao.tse.jus.br` ao vivo: `seen=50 upserted=50 expired=1 alerts=50`
(~17 min, primeira coleta com detalhe de todos). Segunda execução logo em seguida:
`seen=50 upserted=0 expired=0 alerts=0` em **51 segundos**, com `first_seen_at`
intocado — idempotência preservada e o regime permanente barato que a Q-09 pedia.
No banco: 51 linhas em `poll_registrations` (50 novas + 1 de teste antiga, que foi
marcada `source_expired_at`), 50 com `cost_brl`, **0 com `margin_of_error` e 0 com
`confidence_level`** (é o esperado: esses dois não existem em campo estruturado no
PesqEle e R3 proíbe extraí-los da prosa).

**O que mudou.** `pesqele/client.ts` e `pesqele/registration.ts` reescritos do zero
contra o protocolo real (Q-09/T-15): sessão em `/app/pesquisa/listar30dias.xhtml`
(NÃO `/index.xhtml`), busca por AJAX PrimeFaces com `<partial-response>`, paginação
de DataTable (`_pagination`/`_first`/`_rows`) e detalhe via
`detalhar` ⇒ `<redirect>` ⇒ `GET detalhar.xhtml`. Módulos novos:
`constants.ts` (URLs, ids de campo JSF e rótulos, cada um com a origem no
comentário), `partial-response.ts` (leitura do XML parcial), `select-options.ts`
(resolução do filtro por RÓTULO) e `viewstate.ts` reescrito (lê o ViewState do HTML
E do `<update>`). O `81` da eleição **não é hardcoded**: sai do `<option>` com o
rótulo "Eleições Gerais 2026" e rótulo ausente LANÇA.

**Fixtures: as sintéticas foram DELETADAS.** No lugar entraram 7 capturas REAIS de
2026-08-16 (lista, busca, paginação, redirect do detalhar, dois detalhes — um com
contratante único e um com dois — e uma busca vazia), com README dizendo data,
origem e como recapturar. Nos dois detalhes, a prosa metodológica do instituto foi
redigida (R3 / docs/08 §2.1 — o repo é público); todo o resto é byte-a-byte a
resposta do servidor, e nenhum dos blocos redigidos é lido pelo parser. **A ordem
foi capturar primeiro, escrever o parser depois** — o inverso do que produziu o bug.

**Decisões.** (1) Detalhe só para `tse_id` inédito — opção (a) da Q-09, é o que faz
a diferença entre 17 min e 51 s por ciclo. (2) `discover()` ganhou um argumento de
opções (`shouldFetchDetalhe`, `onTseIdSeen`, `onAlert`) e **continua emitindo
`RawRegistration[]`**, de propósito: o fake do `discovery.job.integration.spec.ts`
segue válido e os 8 testes dele passam sem tocar em nada de apps/api além do próprio
job. (3) Registro já conhecido não é reemitido, então o "revive" de
`source_expired_at` virou um UPDATE explícito no job (antes vinha de graça no
upsert). (4) Com dois contratantes, `contractor_name` junta os nomes com ' + ' e
`contractor_cnpj` fica `null` — com dois CNPJs não existe "o" CNPJ e chutar o
primeiro seria inventar; a lista estruturada continua em `PesqEleDetalhe.contratantes`.
(5) Busca válida com zero resultado emite alerta `empty_search` (novo `kind` em
`DiscoveryAlert`, cujo `tseId` passou a ser `string | null`) — foi o silêncio nesse
caso que escondeu o bug de T-05 por uma task inteira.

**Atenção para o próximo — três coisas.** Primeira, e mais urgente: os 50 alertas do
primeiro run são TODOS `unknown_institute`. O PesqEle publica a razão social
completa ("DATAFOLHA INSTITUTO DE PESQUISAS LTDA.", "QUAEST PESQUISAS, CONSULTORIA E
PROJETOS LTDA.", "NEXUS PESQUISA E INTELIGENCIA DE DADOS LTDA / NEXUS") e a tabela de
aliases só conhece os nomes curtos, então **os 50 registros estão com
`institute_id = null`** — sem isso não há house effect por instituto. Isso é
curadoria de dado de referência (seed/`institute_aliases`), não parser, e por isso
não foi feito aqui: o adapter grava o nome cru e alerta, nunca faz fuzzy match.
Segunda: existe um smoke test AO VIVO em `pesqele/client.live.spec.ts`, opt-in por
`PESQELE_LIVE=1`, fora do `pnpm verify` (4 requisições, ~31 s). Rode-o quando
suspeitar que o TSE mudou a tela — fixture nenhuma detecta isso. Terceira, uma
fragilidade que ficou registrada e não é minha para consertar: o PesqEle declara
`ISO-8859-1` e o `HttpClient` decodifica com `Response.text()` (sempre UTF-8). Hoje
não há perda porque o TSE emite todo dado como entidade numérica (`&#231;`) — só dois
comentários HTML saem com `U+FFFD` —, mas no dia em que vier acento em byte cru o
dado chega corrompido. O conserto seria decodificar pelo charset do `Content-Type` em
`packages/adapters/http-client.ts`, que está fora do escopo desta task.

## Integração da MODEL_VERSION 2.0.0 e primeira colheita real · 2026-08-16

**Contratos (feitos SOZINHO, antes de abrir os agentes — são bloqueantes).**
`MODEL_VERSION` → 2.0.0 e `PUBLIC_DATA_SCHEMA_VERSION` → '2', com a justificativa
escrita ANTES em Q-10 (R1). `public-data.ts` ganhou `candidates[].photoPath`/
`photoSourceUrl`, `latent.electorate`, `polls[].blankNullPct`/`undecidedPct` e
`transitions`. `model-io.ts` ganhou `ElectorateObservation`, `TRANSITION_STATE_KIND`
e os tipos de fluxo. O schema de transferência OBRIGA banda + `notIdentifiable` em
cada fluxo: é impossível consumir a média sem ver a incerteza.

**Persistência/histórico (pedido do Felix).** Descoberta boa: nada no sistema
apaga nada, então o histórico da eleição já vinha sendo acumulado a cada 2h desde
o primeiro run. Faltava lugar para o dado novo e poder consultar por TEMPO — as PKs
começam por `run_id`, boas para "o último run" e ruins para "a evolução deste
candidato". Migration `1700000000009`: tabelas `model_electorate_estimates` (não
cabe em `model_estimates`, que tem FK para `candidates`, e branco/nulo não é
candidato) e `model_transitions` (com banda e `not_identifiable` colados ao
número), mais índices de histórico. Aplica e reverte.

**Religação do backend (minha).** `read-model` ganhou `listCanonicalElectorate` +
branco/nulo por pesquisa + colunas de foto; `data-assembler` repassa tudo;
`ModelJob` persiste eleitorado e transferências; `RenderJob` alimenta o montador.
Job de fotos entrou no orquestrador com cron diário e `JOB_NAME.candidatePhotos` —
antes era só CLI, ou seja, fora de `job_runs` e do /health.

**DOIS BUGS MEUS, um deles grave.** (1) O guarda `isEntrypoint()` que eu tinha
adicionado ao `seed.ts` comparava `import.meta.url` com `argv[1]`: no Windows é
`/` contra `\`, então `pnpm db:seed` virou NO-OP SILENCIOSO — saía com código 0 sem
inserir linha nenhuma, e só o Linux do container escondia. Extraído para
`apps/api/src/is-entrypoint.ts`, que compara caminhos canônicos; `main.ts` tinha o
mesmo defeito de origem e foi corrigido junto. (2) Ao ligar as fotos no read-model
adicionei as colunas à query e ao tipo mas esqueci de mapeá-las no `parse` —
`undefined` em vez de `null` derrubou 5 testes de integração do render.

**Aliases de instituto.** O PesqEle publica razão social; nossa tabela só tinha
nome curto, e por isso os 50 registros da primeira colheita vieram com
`institute_id` nulo. Cadastrei as grafias EXATAS (Datafolha, Quaest, AtlasIntel,
Ipec, Nexus), conferidas uma a uma. Instituto que não rastreamos segue SEM alias de
propósito: cadastrar exigiria inventar `primaryMethod`, e chute em referência é R4.

**Fixtures capturadas entraram no `.prettierignore`.** Reformatar HTML capturado do
TSE recria, em outra forma, exatamente o problema da Q-09: a fixture deixa de ser o
que a fonte devolve.

**`pnpm verify` VERDE no container (exit 0): 464 testes** — contracts 27,
adapters 196 (+1 skip), model 99, api 142.

**E2E do zero (`docker compose down` + volume de publicação apagado + `up`):**
migrations → seed → fotos (3 baixadas) → discovery (**50 registros REAIS do TSE**,
37 alertas de instituto sem cadastro) → harvest (29 considerados, 1 tentado, 28
`no_adapter`, 1 `parse_error`) → model (0 observações, M-1 reprova) → render
(placeholder publicado). Site servido, todas as rotas 200.

**O V6 provou seu valor em dado real:** o único harvest tentado buscou a página do
Nexus, NÃO encontrou o `tse_id` do registro e RECUSOU — em vez de atribuir números
de outra rodada. É o guardião do pior bug do sistema funcionando fora de teste.

**O QUE O PRÓXIMO AGENTE PRECISA SABER.** O gargalo mudou de lugar. Descobrir
registro funciona; COLHER resultado não. Só existem adapters para nexus e CNT/MDA,
e dos 14 registros com instituto resolvido apenas 3 são Nexus. Datafolha,
AtlasIntel, Quaest e Ipec estão no banco como registro e ninguém sabe buscar os
números deles. Sem adapter novo, `poll_scenarios` fica em 0, o M-1 reprova e o site
segue no estado vazio — agora dizendo "0 de 3" com 51 pesquisas no radar. Esta é a
próxima task, e ela é de ingestão, não de modelo.

---

## T-21 — Adapter AtlasIntel · 2026-08-17 — `blocked`

**Conclusão negativa, com evidência congelada: a AtlasIntel publica exatamente a
rodada que precisamos e não publica nenhum número que possamos buscar.**

Segui a ordem da Q-09 — investigar a fonte real, congelar captura, só então
escrever código — e ela mudou o veredito da task antes da primeira linha de
parser. `docs/04` §3 descreve `atlasintel` como "HTML — painel online". Não é:
o site é um Nuxt cujo HTML e cuja API pública carregam **só metadado**.

**O que existe.** A série nacional presidencial de 2026 é real e está viva:
`title: "Brazil: National"`, mensal, "Electoral scenarios for 1st round and runoff
ahead of the Brazilian Presidential Elections of 2026" — seis rodadas em 2026
(01-21, 02-25, 03-25, 04-28, 07-01, 07-29), publicadas 1 a 2 dias depois do fim do
campo. Ela **não** está na categoria do menu principal (`general-release-polls`,
que no ciclo 2026 só tem pesquisas estaduais); está em `exclusive-polls`. Quem
olhasse só o menu concluiria que a Atlas não faz rodada nacional.

A API que serve isso não é engenharia reversa de endpoint privado: é a mesma
requisição que o site faz, achada no bundle dele
(`$axios.$get("/api/public-polls/".concat(category,"?limit=20&page=1"))`), sem
token, `application/json`.

**O bloqueio.** Os percentuais existem só no relatório em PDF, e o PDF mora em
`cdn.atlasintel.org`, cujo `robots.txt` (arquivo real, S3, `Last-Modified:
2024-09-24`) responde `User-agent: *` + `Disallow: /`. `docs/04` §6 é
não-negociável, então **não busquei o PDF** — nem para olhar. E ele não poderia
virar fixture de todo modo: `docs/08` §2 classifica gráfico do instituto como obra
protegida que "nunca copiamos, nunca embutimos", e o relatório é um deck de
gráficos. Verifiquei também que o site não faz proxy do arquivo (`/<uuid>.pdf`,
`/files/…`, `/api/files/…` respondem `302 → /`) e que os produtos com dado ao vivo
(`tracking.`/`monitor.atlasintel.org`) são 403 atrás de `/login`.

**A resposta à pergunta que decide a task: o número de registro TSE NÃO aparece.**
Nem no JSON (539 entradas das três categorias), nem no HTML da página da rodada
nacional mais recente. Sem `BR-NNNNN/AAAA` o V6 recusa — e recusa com razão, porque
é o guardião contra atribuir números da rodada errada. Ou seja: mesmo que o robots
liberasse o PDF amanhã, o adapter só funciona se o registro estiver dentro dele.

**O que entreguei, e que é real.** `discover` FUNCIONA: uma requisição ao feed,
casa a rodada por janela de publicação de 14 dias (medida nas seis rodadas: atraso
observado de 1–2 dias; a cadência mensal garante que a janela não alcança a rodada
seguinte) e devolve o URL do relatório com a regra REAL de CDN do site
(`file_created_on` antes de 2026-08-13 ⇒ `cdn`, no corte ou depois ⇒ `cdn1`).
`documentToText` despacha PDF (reusando `cnt-mda/pdf.ts`, sem recriar extração),
HTML e JSON, e LANÇA em tipo desconhecido. `extractScenarios` **recusa**, com o
motivo escrito por extenso em `atlas/parse.ts` — recusa documentada, não stub.

**O que NÃO entreguei:** percentuais, 2º turno, branco/nulo, não-sabe e
`UnknownCandidateError` pela via do adapter. Todos dependem de um documento com
números; o único que existe é inacessível. Escrever o parser contra a estrutura
SUPOSTA do PDF seria exatamente a Q-09 de novo, e não repeti.

**Como destrava, e o detector já está pronto.** Arquivo com `file_created_on >=
2026-08-13` é servido por `cdn1.atlasintel.org`, que **não** tem `robots.txt` —
logo é buscável sem violar a §6. Em 2026-08-17 não havia nenhum (o mais novo era
2026-08-12), então o caminho natural é o próximo relatório mensal.
`ATLAS_LIVE=1 pnpm --filter @election-pool/adapters test atlas/atlas.live` imprime
`DESTRAVOU`/`AINDA BLOQUEADO`, verifica que a série não foi renomeada, e FALHA no
dia em que o `robots.txt` do CDN antigo deixar de proibir. Depois disso: congelar o
TEXTO extraído do relatório como fixture, conferir se ele traz o registro TSE, e só
então escrever o parser sobre `base/scenario-lines`.

**Números.** 29 testes verdes (17 da fronteira da API + 12 do adapter) + 2 ao vivo
opt-in (skipped por default). `tsc --noEmit` sem um único erro em `atlas/**`,
eslint e prettier limpos nos meus arquivos. Suíte inteira de adapters: 33 arquivos
passam, 260 testes verdes — a única falha é `ipec/ipec-adapter.spec.ts`, de agente
irmão em voo, sem relação com esta task.

**O QUE O PRÓXIMO AGENTE PRECISA SABER.**
1. **Não ligue `atlas` no registry ainda.** Com `parse` recusando, cada rodada
   viraria um `ParseError` previsível todo ciclo. Ligue depois de o parser existir.
2. **`.prettierignore` precisa de uma linha:**
   `packages/adapters/atlas/__fixtures__/**`, no mesmo bloco que já ignora
   `pesqele/__fixtures__` e `tse-candidatos/__fixtures__`. As capturas precisam
   seguir byte-a-byte o que a fonte devolveu; reformatar recria a Q-09 em outra
   forma. Não editei porque o arquivo é da raiz e sete agentes irmãos estão em voo.
   Sem a linha, `pnpm lint` reclama de 3 arquivos de `atlas/__fixtures__`.
3. As constantes novas ficaram em `packages/adapters/atlas/constants.ts` com a
   origem comentada, porque `packages/contracts` está congelado. Se virarem
   compartilhadas, é ali o ponto único a migrar.
4. **O padrão que valeu a pena:** consultar o `robots.txt` de CADA host ANTES de
   escrever qualquer coisa. Dois hosts do mesmo instituto tinham política oposta, e
   isso — não a estrutura do documento — foi o que decidiu a viabilidade da fonte.
   Vale para os adapters irmãos: `atlasintel.org` (404, permite) e
   `cdn.atlasintel.org` (`Disallow: /`) são o mesmo produto para um humano e coisas
   opostas para um crawler educado.

---

## T-26 — adapter Palver: o método da Q-09 encontrou o bloqueio antes do parser

**A resposta que a task pedia primeiro: a Palver publica pesquisa de INTENÇÃO DE
VOTO REGISTRADA no TSE, não análise de menções.** Verificado na metodologia
declarada pela própria Palver (relatório da onda, páginas 12–14 e 16; press
release), não em imprensa: survey online, questionário estruturado, amostra
não-probabilística recrutada por anúncios em redes sociais, formulário de link
único e intransferível, calibração por *raking* (IPF) no pacote `survey` do R
ancorada na PNADc 2024 e no 2º turno de 2022. **Registro `BR-06596/2026`**,
divulgação 2026-08-10, campo 03–07/08/2026, n=5.000, IC 95%, ± 3 p.p., estatístico
responsável com CONRE.

A empresa TAMBÉM vende uma plataforma de escuta social que monitora menções
(imprensa, rádio, TV, redes e apps de mensagem). São **dois produtos** e o adapter
só toca o primeiro. Misturar menções com intenção de voto no mesmo agregado era o
erro mais grave possível aqui, e a separação está escrita no cabeçalho do adapter e
no `__fixtures__/README.md`.

**Correção de fato para quem cuida do seed.** O comentário ao lado do instituto
`palver` em `apps/api/src/db/seed-data.ts` diz "Palver mede por mensageria
(WhatsApp)". A metodologia declarada da PESQUISA não usa mensageria — o WhatsApp
está no outro produto. O valor `painelOnline` do enum continua correto; só a
justificativa escrita está errada. Não toquei o arquivo (não é meu).

**Segui a ordem da Q-09 e ela salvou a task.** Capturei o real antes de escrever
uma linha de parser, e o real diz: **os resultados da Palver estão RASTERIZADOS.**
A fonte primária é `www.palver.com.br`; `/survey` é SPA sem número no HTML e os
documentos saem de dois endpoints em PDF (relatório de 93 páginas, ~16 MB; press
release de 2 páginas). A camada de texto do relatório traz moldura de página,
sumário, divisórias de seção, o registro TSE e prosa de metodologia — e as 74
páginas de resultado devolvem literalmente `RESULTADOS` + número da página +
banner. Zero percentual, zero nome de candidato. O repositório aberto
`palverdata/pesquisa-palver` versiona a *especificação* da onda e `.gitignore`a os
resultados de propósito, então também não há saída legível por máquina ali.
Escrever o parser primeiro contra fixture inventada produziria testes verdes e zero
dado — a Q-09 de novo, na mesma semana.

**Confirmei ao vivo que o registro não está na nossa janela do PesqEle.** Sonda com
o `PesqEleClient` (só listagem, sem detalhe) em 2026-08-17: 50 registros nacionais,
e `BR-06596/2026` não está entre eles — a sequência cai no vão entre
`BR-06267/2026` e `BR-06773/2026`, ausência real e não erro de paginação. Por
docs/08 §1 a pesquisa não entra no agregado, então o adapter está de pé, correto e
sem uso imediato, exatamente como o briefing previa.

**Duas decisões foram para a Q-11.** (1) Como obter os percentuais: esperar os
**microdados** que a Palver promete para depois do 2º turno (minha recomendação),
OCR (que eu recusaria — é onde nasce zero silencioso) ou nível 4. (2) O total do
PesqEle voltou **exatamente 50**, o mesmo número da Q-09; se o sistema limita a
listagem a 50, o `DiscoveryJob` perde registro **sem alertar**, que é a classe de
bug da Q-09 um nível acima. Hoje só existe alerta para `empty_search`, não para
total suspeito de truncamento. Implementação é de quem cuida de `pesqele/**`.

**O que entrou** (`packages/adapters/palver/**`, nada fora): `palver-adapter.ts`
(`PalverAdapter extends BaseAdapter`, `discover` com as 3 URLs reais da fonte
primária, `documentToText` por `unpdf`), `parse.ts` (escrito contra a captura real),
fixtures **REAIS** (`*.textlayer.txt`, prosa removida por R3, resto verbatim)
separadas das **SINTÉTICAS** (`make-pdf.ts`, rotuladas como tal em toda menção),
`__fixtures__/README.md` com proveniência e receita de recaptura, e três specs.
**21 testes verdes** (13 de parse + 8 de adapter); suíte de adapters inteira em
**246 verdes**; typecheck do palver limpo, sem `any` nem `@ts-ignore`. O
`package.json` não precisou de entrada — o curinga `"./*"` cobre `palver/*`.

**Armadilhas reais que só a captura revelou, e que valem para o próximo adapter de
deck em PDF.** (a) `RESULTADOS` casa como divisória de seção (`RESULTADO` + `S`
colado) e fecharia todo cenário na primeira página; a defesa é descartar linha
inteiramente em CAIXA ALTA antes de qualquer outra regra. (b) A linha
`5.000 BR -06596/2026 4,31 95%` da página "Amostra" tem o formato exato de uma
linha de valor — valor só pode ser colhido com seção de voto ABERTA. (c) O sumário
grafa `B 1º Turno (Estimulada)` (letra antes) e a divisória real grafa
`1º Turno (Estimulada)B` (letra colada no fim): casar pelo título solto abriria
cenário no sumário. (d) **Depois do 2º turno vêm `Reconhecimento e Rejeição` e
`Aprovação e Avaliação do Governo`, que também são percentuais por candidato** — se
a divisória de seção não-voto não fechasse o cenário corrente, **rejeição entraria
no agregado como intenção de voto**. Há teste dedicado a isso. (e) O `tse_id` sai do
relatório como `BR -06596/2026`, com espaço depois do `BR`; o
`documentContainsTseId` do `BaseAdapter` tolera, confirmado contra os dois textos
reais. (f) A seção de 2º turno cobre 12 páginas, isto é vários pareamentos, e não há
delimitador na camada de texto: o parser **recusa** em vez de fatiar por conta
própria.

**O QUE O PRÓXIMO AGENTE PRECISA SABER.** Duas coisas, além da Q-11.

Primeira: **`palver.live.spec.ts` é um canário, não uma trava.** Ele é opt-in
(`PALVER_LIVE=1`), fica fora do `pnpm verify`, e afirma que `parse` LANÇA porque os
resultados são imagem. Se ele **falhar**, isso não é regressão — é o aviso de que a
Palver passou a publicar número em camada de texto e a colheita virou possível.
Rodado ao vivo hoje: passa em 11s, robots e rate limit respeitados. Recomendo o
mesmo padrão para todo adapter novo: uma asserção sobre a FONTE, não só sobre a
fixture. É o que faltou em T-05.

Segunda: **`extractPdfText` virou dependência de dois adapters** (`cnt-mda` e
`palver`) e continua morando em `packages/adapters/cnt-mda/pdf.ts`. Importei de lá
em vez de duplicar, mas o nome do diretório já não descreve o dono. Candidato a
subir para `base/pdf.ts` quando ninguém mais estiver com `cnt-mda/**` aberto. Pelo
mesmo motivo — sete agentes em paralelo — o gerador de PDF de fixture ficou
duplicado em `palver/__fixtures__/make-pdf.ts` de propósito, e também é candidato a
subir para `base/`. As duas dívidas estão anotadas nos cabeçalhos dos arquivos.

---

**T-23 — adapter Ipec (`packages/adapters/ipec/**`), status `done`.** Entreguei
`IpecAdapter extends BaseAdapter` (`id`/`instituteId` = `ipec`), parser, duas
fixtures REAIS com README de proveniência, 22 specs + 1 canário ao vivo opt-in.
`typecheck`/`eslint`/`prettier` limpos no diretório; a suíte do pacote segue verde
(268 testes). Detalhe completo em `tasks/T-23-adapter-ipec.md`; a decisão pendente
está em **Q-12**.

**A investigação mudou o desenho três vezes, e é o principal produto da task.**
(a) O domínio do enunciado e do seed, `ipec.com.br`, **não resolve** — o real é
`ipec-inteligencia.com.br`. (b) `/pesquisas/` é SPA AngularJS: o índice de rodadas
não está no HTML, vem de `GET /api/arquivo/ListAtivos/` (descoberto lendo o JS real
do site, não suposto). (c) Os PDFs vivem em `/Repository/Files/<id>/…` e são de
DOIS tipos, e a diferença decide a task: o **release** (4–6 páginas) **traz o
registro TSE** ("sob o protocolo Nº BR-01979/2022"); o **relatório de tabelas**
(50+ páginas) **não traz registro nenhum** — verifiquei, zero ocorrência de
`BR-NNNNN/AAAA` no PDF inteiro — e o V6 o recusa, corretamente. Resposta à pergunta
decisiva do enunciado: **o número de registro APARECE**, no release, e o adapter
funciona.

**A parede, e por que não insisti.** O host todo (site, `/robots.txt` e API)
responde **403 com `Cf-Mitigated: challenge`** — desafio Cloudflare que exige
JavaScript. Sem headless na v1 não existe colheita live. Confirmei que não é
bloqueio ao nosso User-Agent: a única captura de 2026 do Internet Archive para o
domínio **também é 403**. As capturas reais vieram do Internet Archive, que
preservou os PDFs do próprio `Repository/Files/` do instituto (origem primária,
não portal de notícia). Registrado em **Q-12** com quatro opções; minha
recomendação é v1.1 + pedir acesso ao Ipec, e explicitamente **não** headless.

**O QUE O PRÓXIMO AGENTE PRECISA SABER.** Cinco coisas.

**1. O número principal do agregador não é colhível do Ipec.** O 1º turno
ESTIMULADO é publicado como **gráfico**, sem camada de texto: a linha
`Pergunta: … (Estimulada - %)` é seguida direto por `DESTAQUES POR SEGMENTOS`
(confirmei extraindo página por página com o mesmo `unpdf` do adapter). O que dá
para extrair é o **2º turno** e o **1º turno espontâneo**. Os números do estimulado
existem só na PROSA, misturados a percentuais de segmento ("73% entre quem avalia
como ruim") e a faixas de margem ("pode ter entre 42% e 46%") — um regex ali daria
topline errado com cara de acerto, então não extraí (R4). Há um teste que FIXA essa
ausência: se o Ipec passar a publicar a tabela em texto, ele quebra e avisa. É a
mesma classe de bloqueio que T-26 achou na Palver — já são **dois** institutos cujo
número principal é imagem, o que talvez mereça uma decisão de projeto sobre OCR.

**2. A armadilha das DUAS COLUNAS, que o V6 não pegaria.** As tabelas do Ipec
comparam a rodada anterior com a atual: cabeçalho `15/08 29/08`, linha
`Lula – 13 – PT 51% 50%`. A atual é a **última**. Ler a primeira importaria os
números da rodada PASSADA sob o `tse_id` desta — e o V6 não acusa, porque é o mesmo
documento e o `tse_id` está certo. O parser lê o número de colunas do cabeçalho e
exige que cada linha case; divergência **lança** em vez de escolher. Se outro
adapter encontrar tabela comparativa, essa é a armadilha a copiar a defesa.

**3. As listas de `base/scenario-lines.ts` não cobrem a grafia do Ipec.** Lá existem
`branco/nulo`, `branco e nulo`, `nao sabe`, `nao sabe/nao respondeu`. O Ipec escreve
**`Branco ou nulo`** e **`Não sabem ou preferem não opinar`** — nenhum dos dois casa,
e sem tratamento local **toda** pesquisa do Ipec cairia em quarentena com
`UnknownCandidateError`. Classifiquei no meu diretório e deleguei o resto ao helper
comum (não toquei em `base/`, que é de outro dono). **Quem for mexer em
`base/scenario-lines.ts` um dia: valeria consolidar as grafias dos institutos ali.**

**4. `scenarioKindSchema.enum.t1Espontaneo` é `undefined` — e me custou um bug.** O
`.enum` de um `z.enum([...])` é indexado pelos VALORES (`t1_espontaneo`), não pelas
chaves camelCase de `SCENARIO_KIND`. Escrevi `.enum.t1Espontaneo`, o cenário saiu
**sem `kind`**, e só o Zod do `BaseAdapter` pegou. `.enum.t2` funciona por
coincidência (chave = valor), o que torna o erro sorrateiro. Use o const
**`SCENARIO_KIND.t1Espontaneo`**, que o typecheck garante. `cnt-mda` usa
`.enum.t1_espontaneo` (snake) e está correto.

**5. Duas correções que não são minhas.** `apps/api/src/db/seed-data.ts` linha 43
tem `siteUrl: 'https://www.ipec.com.br'`, que **não resolve** — o correto é
`https://www.ipec-inteligencia.com.br`. E `quaest/quaest-adapter.ts:108` tem o mesmo
`TS18047` de `contentType` possivelmente nulo que corrigi no meu; **hoje é o único
erro de `typecheck` do pacote `adapters`**, então quem estiver com `quaest/**`
aberto derruba o gate do `pnpm verify` para todos.

Por fim, sobre fixtures: congelei a **camada de texto real** dos PDFs, com os
parágrafos narrativos elididos e marcados, porque prosa de terceiro não pode morar
num repo público (R3, docs/08 §2) — números e rótulos de tabela são fato e ficaram
byte a byte. O README traz URL, data, **checksum SHA-256 do PDF original** e o
comando de recaptura, então a fidelidade é auditável. Recomendo o padrão: captura
real + checksum + comando de recaptura + canário ao vivo. É o conjunto que faz a
Q-09 não se repetir.

---

## T-27 — Adapter Paraná Pesquisas (`packages/adapters/paranapesquisas/**`)

Adapter entregue e verde: **42 testes** próprios, **375/375** no pacote `adapters`,
`typecheck`/`eslint`/`prettier` limpos nos meus arquivos. Detalhes em
`tasks/T-27-adapter-paranapesquisas.md`. Três coisas que o próximo agente precisa
saber, em ordem de importância.

**1. V6 do `BaseAdapter` NÃO basta em fonte que publica série histórica — e isto vale
para vários adapters, não só o meu.** O release de fevereiro/2026 do Paraná Pesquisas
(`BR-07974/2026`) traz tabelas comparativas cujos cabeçalhos de coluna citam o
`tse_id` de rodadas anteriores; `documentContainsTseId(fevereiro, 'BR-08254/2026')`
devolve **`true`**. Ou seja: rodar esse PDF contra o registro de **janeiro** passa em
V6 e atribui os números de fevereiro à rodada errada — "o pior bug do sistema"
entrando exatamente pela porta que V6 não fecha. Meu parser aperta:
`paranapesquisas/tse-registration.ts` exige que o `tse_id` apareça na **sentença de
registro da Res.-TSE 23.600/2019** ("registrada no Tribunal Superior Eleitoral sob o
n.º …"), não em qualquer lugar do texto, e há spec provando as duas metades (V6
aceitaria; o adapter recusa). **Se o seu instituto publica comparativo/série
histórica, faça o mesmo.** Se um dia `base/tse-id.ts` ganhar dono, é o lugar natural
para um `confirmTseIdInRegistrationSentence` compartilhado.

**2. Não confie no rótulo do cenário para decidir o `kind`; confie na estrutura.**
Em fevereiro o 2º turno é a página "ESTIMULADA – 2º Turno"; em **março o mesmo
instituto rebatizou o 2º turno de "Cenário 2"** — e "Cenário 2" em fevereiro era um
1º turno com 6 candidatos. Classifico por contagem de candidatos (exatamente 2 ⇒
`t2`), com a captura de março congelada só para provar isso. Aproveito para
**confirmar o alerta do T-23**: usei `scenarioKindSchema.enum.t1_espontaneo` (chave =
VALOR, snake_case), nunca `.enum.t1Espontaneo`, que é `undefined`.

**3. Cruzamento demográfico se disfarça de cenário canônico.** As páginas de recorte
(sexo/idade/escolaridade/região/Bolsa Família) repetem o cenário por subgrupo, e uma
delas (março, p. 12) tem exatamente o mesmo formato "um percentual por linha" da
página de gráfico. Ingerida, publicaria o número de um subgrupo como se fosse o
total — erro grave e silencioso. Filtro por rótulo de recorte
(`paranapesquisas/labels.ts`), com spec provando que `Masculino`/`Nordeste`/`Total`
nunca viram alias de candidato.

**Também confirmo o item 3 do T-23 sobre `base/scenario-lines.ts`.** As listas de lá
classificariam `'Nenhum/ Branco/ Nulo'`, `'Ninguém/ Branco/ Nulo'` e
`'Não sabe/ não opinou'` como CANDIDATO — normalizam espaço, mas não o espaço em
volta da barra. Sem tratamento local, **três candidatos fantasmas por cenário** e
quarentena eterna. Classifiquei no meu diretório (não toquei em `base/`) e continuo
usando o helper único de número (`parsePtBrPercent`). Já são **dois institutos** com
o mesmo problema: consolidar as grafias em `base/scenario-lines.ts` virou dívida com
juros.

**O que a fonte é, em uma linha.** WordPress; divulgação na categoria "Pesquisas"
(`id` 6, nunca a `id` 1, que é clipping de imprensa = nível 4); o `tse_id` está no
título do post; **a página do post não tem um único percentual** — todo resultado
está em PDF anexado. `discover` faz **uma** requisição à WP REST por registro
(`?categories=6&search=BR-07974`), valida com Zod, confirma o `tse_id` no título,
exclui o comprovante de registro (que não tem cenário e só inflaria o
`failure-counter`) e ordena o release de intenção de voto primeiro.

**Duas pendências que não são minhas.**
(a) **`apps/api/src/db/seed-data.ts` (dono: orquestrador).** A captura real traz
quatro aliases ausentes do seed: **Jair Bolsonaro** (citação espontânea), **Renan
Santos**, **Ronaldo Caiado** e **Aldo Rebelo** (em cenário estimulado, 1,1–3,6%).
Com o seed atual a rodada inteira vai para quarentena por `UnknownCandidateError` —
correto por docs/04 §4.1, mas bloqueante. Meus specs declaram os quatro num resolver
local, com o motivo escrito ao lado. Ainda no seed: `siteUrl` do instituto está
`https://www.paranapesquisas.com.br`, que responde **301** para o host sem `www`;
funciona, mas gasta um salto por requisição num host com rate limit de 1 req/10s.
(b) **`typecheck` do pacote `adapters` está vermelho por
`datafolha/datafolha-adapter.spec.ts:152` (`Pct` branded vs `number`)** — não é meu
diretório, mas derruba o gate do `pnpm verify` para todos.

**Cobertura, dita na cara.** O Paraná Pesquisas **não aparece** nos 51 registros
presidenciais da janela de 30 dias de agosto/2026, e a divulgação nacional
presidencial mais recente do site é de **março/2026**. O adapter está correto e
testado contra captura real; a fonte é que está em silêncio. `discover` devolve lista
vazia sem inventar URL — que é a própria taxa de gaveta de docs/01 §6, não uma falha.

**Sobre fixture, subscrevendo o padrão do T-23.** Congelei a **camada de texto real**
dos dois PDFs (retorno literal de `extractPdfText`), com **uma** elisão marcada: o
corpo em prosa do slide "Metodologia" (R3, docs/08 §2 — prosa de terceiro não mora em
repo público). Nenhuma linha que o parser consome foi tocada. O README traz URL, data
da captura, **SHA-256 do PDF original** e o comando de recaptura, então a fidelidade
é auditável. Como o release é peça gráfica, **não** commitei o PDF: os specs o
remontam a partir do texto real (`__fixtures__/make-pdf.ts`, multipágina) para
percorrer o caminho de produção inteiro — blob → `extractPdfText` → V6 → parser.

---

## T-22 — Adapter Quaest (Genial/Quaest) — `packages/adapters/quaest/**`

Investiguei a fonte ANTES de escrever parser, que era o ponto da task, e o
resultado muda o que se pode esperar da Quaest. **O PDF de rodada — a divulgação
canônica, a que `docs/04` §3 aponta — é imprestável.** No relatório de 14/08/2026
(197 páginas, 52,9 MB) a camada de texto inteira tem **1 caractere `%`**, **zero
números pt-BR** e **zero ocorrências de registro TSE**: só títulos e enunciados de
pergunta são texto, todo gráfico é imagem, e as páginas 1–5 (capa/ficha técnica,
onde o registro apareceria) têm `textItems: 0`. Verifiquei em **4 PDFs, 2 hosts,
jan/2025 → ago/2026** — não é regressão, é o formato do instituto. Sem OCR o V6
recusa o PDF, e recusa com razão. `genial-quaest.com.br` **não existe** (sem DNS);
a landing page da Genial (nível 3) só espelha os mesmos PDFs.

**O número de registro no TSE aparece: SIM — mas no post de blog do instituto**
("…registrado no Tribunal Superior Eleitoral (TSE) sob o protocolo BR-06591/2026"),
que é a única superfície com registro **e** percentuais em texto, e é fonte
primária (site do próprio instituto, nível 2 — não é portal de notícia). Por isso o
adapter existe e funciona: **30 testes offline verdes, typecheck e lint limpos, e o
canário ao vivo rodado de verdade** (`QUAEST_LIVE=1`, 41 s, 6 requisições sob o
rate limit real) — passou contra o site de hoje.

**A ressalva que o próximo agente precisa levar a sério: os percentuais só existem
em prosa editorial, e a prosa muda a cada rodada.** Congelei duas capturas de
rodadas diferentes justamente para medir isso: a de 2026-08-05 é lida inteira (1º
turno estimulado com 5 candidatos + brancos/nulos + indecisos, soma 97; 2º turno
com par + brancos/nulos + indecisos, soma 100); a de 2026-07-15 é **recusada nos
três cenários**, porque lá o nome vem DEPOIS do percentual ("frente a 28% de Flávio
Bolsonaro") e a decomposição publicada é incompleta (2º turno soma 82 — o instituto
não publicou o resíduo). Cobertura é parcial por construção. Preferi recusa alta a
cenário parcial; nenhuma rodada entra pela metade.

**A armadilha que vale copiar, e que o V6 NÃO pega.** O mesmo post mistura, nas
mesmas construções de frase, quatro coisas: número nacional desta rodada, número da
rodada ANTERIOR ("a oscilação de Flávio Bolsonaro de 28% em julho para 30% em
agosto"), número de SUBGRUPO ("o apoio a Flávio saltou de 74% para 81% entre os
eleitores … 'direita não-bolsonarista'" — e esse parágrafo casa a MESMA âncora de 2º
turno do parágrafo nacional) e números de OUTRAS perguntas (potencial de voto,
rejeição, aprovação). Importar qualquer um deles seria publicar número errado sob um
`tse_id` correto, no mesmo documento — o V6 fica cego. Minhas quatro defesas, em
ordem de importância: (G1) **ler só o parágrafo ancorado**, nunca o post; (G2)
**colapsar "de A% … para B%" para B** antes de qualquer leitura; (G3) exigir que o
dono do número seja **nome próprio dentro da oração que fecha no `%`**, e recusar o
cenário quando sobra percentual sem dono ou aparece marcador de subgrupo na janela;
(G4) **checar a aritmética** (V1 [97,103], V3, V7), porque leitura errada quase
sempre estoura a soma. Quem for atacar Datafolha/PoderData/Palver a partir de
release em prosa: G1 e G2 são o essencial, e G2 é literal — em português "de A para
B" sempre significa B.

**Duas pendências que não são minhas.**

1. **`apps/api/src/db/seed-data.ts` (T-02) precisa dos aliases da rodada real da
   Quaest:** `Luiz Inácio Lula da Silva`, `Lula`, `Flávio Bolsonaro`, `Flávio`,
   `Ronaldo Caiado`, `Renan Santos`, `Romeu Zema`. Sem eles toda rodada cai em
   quarentena com `UnknownCandidateError` — correto, mas rende zero dado. No spec
   o mapa é local (o resolver é injetado; o adapter não conhece o banco).
2. **`base/tse-id.ts` tem falso-negativo de V6 por zero à esquerda.** O post de
   julho grafa **`BR-7181/2026`**; `tseIdSchema` exige `BR-<5 dígitos>/<ano>`, logo
   o registro canônico é `BR-07181/2026`, e o casamento de sequência exata de
   `documentContainsTseId` não reconhece a grafia do instituto — o documento é
   recusado antes de qualquer extração. Deixei **teste explícito** marcando a
   armadilha em `quaest-adapter.spec.ts` em vez de contornar: `base/` é congelado
   nesta task, e normalizar `tse_id` dentro do adapter seria enfraquecer o V6 por
   fora, exatamente o que não se faz. Quem é dono de `base/` decide se o casamento
   deve tolerar zeros à esquerda. Vale para qualquer instituto que grafe o
   protocolo sem padding.

Sobre `contentType` possivelmente nulo em `quaest/quaest-adapter.ts:108`, apontado
no registro do T-23 como o único `TS18047` do pacote: **corrigido** — content-type
ausente ou inesperado LANÇA, porque ler PDF como HTML devolveria texto vazio e o V6
recusaria pelo motivo errado. No fim desta task o `typecheck` do pacote `adapters`
tem **um** erro, e ele não é meu: `datafolha/datafolha-adapter.spec.ts(152,28)`,
`TS2345` de `number` vs `Pct` branded. O `vitest` do pacote também tem **uma**
falha alheia: `poderdata/parse.spec.ts` ("recusa quando os cruzamentos empatam").
Quem estiver com esses dois abertos derruba o gate do `pnpm verify` para todos.

Sobre fixtures, seguindo o padrão que o T-15 estabeleceu e o T-23 recomendou:
capturas **reais**, com a prosa que o parser **não lê** redigida e marcada (R3,
docs/08 §2 — este repo é público), e byte a byte exatamente os blocos que o parser
lê ou recusa, mais o parágrafo de Metodologia que carrega o registro. O PDF de
52,9 MB não é versionado: ficaram a **camada de texto real** (páginas 1–20), uma
**medição** (`…pdf-probe.json`: contagem de `%`, de números pt-BR e de protocolos
TSE, mais `textItems` por página) e o **sha256** do original, com URL, data e o
comando de recaptura no README. E, sobretudo, o canário ao vivo: fixture é foto, e
no caso da Quaest a foto envelhece a cada rodada.

---

## T-25 — adapter `realtime` (REAL TIME BIG DATA)

**A fonte primária existe, publica PDF por rodada e traz o registro TSE.**
`https://realtimebigdata.com.br/pesquisas/` é um índice que linka um PDF por
rodada; o nome do arquivo carrega o número de registro, e a capa do PDF traz
`PESQUISA REGISTRADA: BR-NNNNN/2026` em texto extraível. `robots.txt` libera tudo.
Nenhum portal de notícia foi tocado. Na captura de 2026-08-17 havia 12 rodadas: 6
presidenciais (`BR-…`) e 6 estaduais (`UF-…`), as duas do mesmo estado publicadas
no mesmo dia — daí a seleção ser pelo registro no nome do arquivo e nunca por
estado/data/posição.

**O que a investigação-antes-do-parser pegou, e que nenhuma validação pegaria.**
A ordem de fluxo do texto do PDF **inverte os valores do 2º turno** em relação à
posição na página. Em `BR-06833/2026` o fluxo emite `51%` e depois `37%`, mas o
`37%` está em x=511,3 (lado do primeiro nome) e o `51%` em x=745,1 (lado do
segundo). Reusar `cnt-mda/pdf.ts` (`mergePages`, sem coordenadas) trocaria os dois
finalistas — com soma 100, V1–V7 passando, e o sinal do erro mudando de documento
para documento (na Bahia lidera o finalista da esquerda; em MT e MS, o da direita).
É o "pior bug do sistema" de docs/04 §4.1 sem nenhum sintoma. Foi a medição das
coordenadas do PDF real, antes de escrever regex, que evitou. **Quem for escrever
adapter de PDF de deck de apresentação: não confie em ordem de fluxo para gráfico
com dois lados.** `realtime/pdf-layout.ts` faz extração posicionada (dedupe da
camada de texto duplicada, faixas por baseline, junção de palavras por vão medido,
pareamento rótulo→valor dentro da faixa) e o par do confronto é ordenado por `x`.

**Estrutura do deck é estável e ancorável.** 17 páginas, o título de cada seção
sozinho numa página divisória e o gráfico na seguinte. O parser ancora na
divisória, o que exclui por construção os recortes de gênero/idade/renda — onde,
de propósito, NÃO se pode ler nada: neles o número de rótulos e o de valores
DIVERGE (a fonte omite a barra de quem ficou em 0) e o pareamento seria ambíguo.

**Fixtures.** Reais, mesmo padrão que T-15/T-22 estabeleceram: o PDF do instituto
NÃO é versionado (docs/08 §2 — 2,5 MB do design deles, repo público); ficaram o
**texto real** dos 3 documentos na forma exata que o parser consome, o excerto
**verbatim** do container da lista do índice, e URL + bytes + sha256 de cada
original, com o comando de recaptura. O canário ao vivo
(`REALTIME_LIVE=1 … test realtime-adapter.live`) colhe 3 rodadas de ponta a ponta
pelo caminho de produção e falha alto se a estrutura mudar; com
`REALTIME_CAPTURE=1` ele recongela as fixtures. Verificado ao vivo hoje: 3
rodadas, 3 cenários cada.

**51 testes, typecheck limpo, pacote inteiro verde** (442 testes do `adapters`).

**Quatro pendências que não são minhas** (detalhe em `tasks/T-25-adapter-realtime.md`):

1. **`seed-data.ts` precisa das grafias desta fonte.** O MESMO documento imprime
   `Lula` (espontânea), `Lula (PT)` (estimulada) e `LULA (PT)` (confronto). Faltam
   no seed: `Lula (PT)`, `LULA (PT)`, `Flávio Bolsonaro (PL)`,
   `FLÁVIO BOLSONARO (PL)`, `Romeu Zema (Novo)`; e como candidatos novos
   `Renan Santos` (+ `(Missão)`), `Ronaldo Caiado` (+ `(PSD)`), `Jair Bolsonaro`,
   `Escritor Augusto Cury (Avante)`, `Cabo Daciolo (Mobiliza)`. Lista verbatim em
   `realtime/__fixtures__/aliases.ts`. Sem elas: quarentena em toda rodada —
   correto, e zero dado. Confirmo o que T-22 já registrou: esta é a pendência que
   mais barata destrava dado real.
2. **`Outros` precisa de decisão.** A fonte publica uma barra `Outros` (1–3 p.p.)
   com o agregado dos candidatos que não mostra. `ParsedPoll` não tem campo para
   agregado. O parser emite como alias, porque descartar seria perder dado
   publicado em silêncio (R4) e mapear para um candidato criaria uma pessoa que
   não existe. Sem decisão do dono do cadastro, o item 1 não basta.
3. **O `HttpClient` compartilhado corrompe PDF.** `body: string` via
   `Response.text()` destrói binário, e o `HarvestJob` monta o cliente com o
   `fetch` cru. Isso afeta o `cnt-mda` também, não só este adapter. A solução já
   está no repo: `tse-candidatos/binary-fetch.ts` (`createBase64Fetch`). Dentro do
   meu escopo, `realtime/raw-body.ts` aceita as duas formas de corpo e LANÇA com a
   causa provável quando nenhuma serve — nunca finge ter lido um PDF.
4. **Estas rodadas presidenciais têm universo ESTADUAL** (`BR-…` com 1.600
   entrevistas em um estado). Não são amostras nacionais, e `ParsedPoll` não
   carrega abrangência — quem trata é o modelo, a partir do `PollRegistration`. É a
   diferença mais importante entre este instituto e nexus/CNT, e vale para quem
   for medir house effect.

Uma nota para `base/`: `base/scenario-lines.ts` não conhece `Nulo/Branco` (ordem
invertida), `NS/NR` nem `NS / NR`. Com `categorizeLine`, esses rótulos cairiam em
"candidato" e toda rodada deste instituto iria para quarentena. Como `base/` é
congelado nesta task, a tabela de grafias ficou em `realtime/labels.ts` — que é
também o lugar certo, grafia é característica da fonte — com um teste que PROVA a
divergência (`labels.spec.ts`). Quem for dono de `base/` decide se as grafias
comuns devem crescer.

---

## T-24 — Adapter PoderData (`packages/adapters/poderdata/**`)

Verde: **38 testes** (21 de parser, 17 de adapter/discover) + **2 ao vivo** contra o
poder360.com.br. `tsc --noEmit` limpo em `poderdata/**`; a suíte inteira do pacote
passa (442 testes). Detalhe completo em `tasks/T-24-adapter-poderdata.md`.

**Registro TSE: SIM.** Aparece na capa (`Registro TSE` / `BR-07845/2026`), na ficha
técnica e no rodapé de TODAS as páginas de conteúdo. Nas quatro rodadas de 2026:
`BR-04882/2026`, `BR-05722/2026`, `BR-00059/2026`, `BR-07845/2026`. Todos com 5
dígitos, casam com `tseIdSchema`, V6 funciona.

**Divulgação x matéria — o julgamento que a task pedia.** O PoderData é o instituto
do Poder360, e o critério que resolveu foi: *se tem autoria e parágrafo, é matéria*.
As páginas HTML todas têm — inclusive a "Leia os resultados", que é a mais sóbria
(`/author/ligia-saba/`, `article:published_time`, prosa descrevendo os resultados). O
que NÃO tem é o PDF `static.poder360.com.br/.../Relatorio-PoderData-Eleitoral-*.pdf`,
assinado por "PoderData Pesquisas, Jornalismo e Comunicação LTDA", com `Ficha
técnica`, `Registro TSE` e as tabelas. **Todo número sai do PDF; o HTML é usado só
como lista de `href`** (docs/08 §2.1). Assim a proibição de "scraping de portal de
notícia" do CLAUDE.md continua satisfeita: não lemos a matéria, lemos o release.

**O que o próximo agente precisa saber:**

1. **Aliases a cadastrar no seed** (dono: registry/`seed-data.ts`): `Lula`,
   `Flávio Bolsonaro`, `Renan Santos`, `Ronaldo Caiado`, `Romeu Zema`,
   `Augusto Cury` e — para as rodadas de maio e junho — `Joaquim Barbosa`. As
   grafias do PoderData são limpas e curtas (sem partido no rótulo), então o
   casamento exato do `resolverFromMap` basta. Sem `Joaquim Barbosa`, maio e junho
   vão para quarentena (correto, e zero dado). `base/scenario-lines.ts` já reconhece
   `Branco/Nulo` e `Não sabe`, as duas únicas grafias não-candidato da fonte — este
   adapter NÃO precisa de tabela de grafias própria.
2. **O 1º turno vem dos CRUZAMENTOS, não do gráfico.** O relatório publica o mesmo
   marginal em 7 páginas de cruzamento (coluna `Total`) e numa página de gráfico. No
   cruzamento rótulo e valor estão na mesma linha; no gráfico de barras não, e a
   leitura é posicional. Cruzamento é fonte, gráfico é conferência. **Não invertam
   isso.**
3. **Divergência REAL de 1 p.p. na fonte.** Em ~250 células das 4 rodadas há duas
   divergências, ambas em `BR-05722/2026`/`Joaquim Barbosa`: 6 cruzamentos dizem
   `2%`, o sétimo (`Aprovação de Lula`) diz `3%`, e o gráfico diz `3`. É
   arredondamento independente, declarado pelo próprio relatório. Regra
   implementada: rótulos idênticos em todos ⇒ obrigatório; amplitude ≤ 1 p.p.
   (`ROUNDING_TOLERANCE_PP`, origem escrita); valor publicado = **maioria estrita**;
   **empate LANÇA**. Maioria e não média, porque a média inventaria um número que o
   instituto nunca imprimiu.
4. **Salvaguarda de onda.** Cada gráfico traz a série histórica inteira (até 4
   ondas). `extractScenarios` usa `reg.fieldEnd` para CONFERIR que a última legenda
   é o mês/dia do fim de campo do registro. É o V6 da série temporal: sem isso,
   "pegar a última coluna" seria suposição sobre a ordem cronológica. Três grafias
   reais de legenda: `mai/26`, `29-Jul` (Excel em inglês), `29/jul`.
5. **Dialeto de barras só com oráculo.** O 2º turno não tem cruzamento. Nas rodadas
   de mai/jun/16-jul ele é gráfico de barras, com casamento posicional que poderia
   trocar Lula pelo adversário sem alterar a soma. O adapter só aceita depois que o
   MESMO decodificador reproduz a coluna Total dos cruzamentos no gráfico de 1º turno
   do mesmo documento. Sem oráculo, ou com oráculo falhando, **recusa**. Não relaxem
   isso — é a única coisa entre a leitura posicional e um número trocado em silêncio.
6. **Cenários.** `t1_estimulado` (rótulo do instituto) + um `t2` por par publicado
   (5 em maio, 4 em julho; rótulo NOSSO, composto dos aliases, para não republicar o
   enunciado e para não colidir na UNIQUE `(tse_id, kind, label)` de docs/03 §2.4).
   **`t1_espontaneo` é legitimamente AUSENTE**: a pesquisa é IVR com lista lida ao
   entrevistado e nenhuma das 4 rodadas tem seção de espontâneo.
7. **`discover` LANÇA em vez de devolver vazio.** Busca o índice da série 2026 e, se
   ele não render, a institucional; filtra `href` por `Relatorio-PoderData-Eleitoral`
   (o infixo "Eleitoral" descarta o relatório não eleitoral da institucional) e ordena
   por ano/mês da URL, porque as duas páginas listam em ordens opostas. Lista vazia
   seria o `seen=0` da Q-09.
8. **O teste ao vivo já pagou por si.** `PODERDATA_LIVE=1 … test poderdata.live` roda
   o parser sobre o texto INTEGRAL dos 4 PDFs reais, sem redação. Ele pegou um bug que
   a fixture escondia: o enunciado da pergunta (que a redação remove) fica logo acima
   dos valores no gráfico de barras e derrubava a leitura posicional. Com fixture só, o
   adapter ficaria verde e quebraria no primeiro documento real — a Q-09 outra vez. O
   mesmo arquivo, com `PODERDATA_CAPTURE=1`, é a ferramenta de recaptura.
9. **Fixtures são captura real com prosa redigida** (o PDF é obra protegida e o repo é
   público). Linhas mantidas são byte a byte as reais; o filtro está em
   `__fixtures__/redact.ts` e a procedência inteira em `__fixtures__/README.md`. O
   `make-pdf.ts` local PAGINA — um gerador de página única faz o pdf.js descartar
   tudo fora da `MediaBox` e só ~57 das ~500 linhas sobrevivem, o que faria o teste
   rodar sobre um pedaço do documento sem ninguém notar.

**Pendência externa (não minha):** `npx tsc --noEmit` no pacote reporta um erro em
`datafolha/datafolha-adapter.spec.ts:152` (`number` não atribuível a
`number & BRAND<"Pct">`), de um agente irmão. `poderdata/**` está limpo.

## T-20 — Adapter Datafolha (site do próprio instituto, HTML)

Investiguei a fonte antes de escrever parser, e a primeira descoberta contraria
`docs/04` §3: o Datafolha **tem** publicação própria acessível, sem paywall, em
`datafolha.folha.uol.com.br/eleicoes/<ano>/<mes>/<slug>.shtml`, com índice navegável
por ano — nível 2 da hierarquia, então não há motivo para descer para imprensa
(nível 4). E o dado decisivo: **o registro TSE está no corpo da publicação** em 4 das
6 rodadas que capturei em 2026-08-17 (`BR-01166/2026`, `BR-06481/2026` em duas
páginas do mesmo levantamento, `BR-07601/2026`); nas outras duas não está, e nessas o
V6 recusa — o que é o comportamento correto, não um bug. A segunda descoberta é a que
manda no resto: **a publicação não tem tabela, `data-*` nem JSON-LD**. Os percentuais
vivem em prosa editorial dentro de `[itemprop="articleBody"]`, e o único material
estruturado (o PDF "RELATÓRIO COMPLETO") está em `media.folha.uol.com.br`, cujo
`robots.txt` é `User-agent: * / Disallow: /`. Por `docs/04` §6 esse host está fora de
alcance para sempre; deixei constante nomeada, comentário e teste com o robots REAL
das duas hosts para que ninguém "resolva" a falta de tabela buscando o PDF — e o
`HttpClient` compartilhado já recusaria sozinho com `RobotsDisallowedError`.

O parser que escrevi contra essa realidade tem uma invariante única no lugar de
dezenas de regras: **num parágrafo de cenário, todo percentual precisa ser
atribuível** — a um candidato NOMEADO, a brancos/nulos, a indecisos, a um parêntese
de comparação ("(tinha 2%)"), ou a um limiar declarado ("não atingiram 1%"). Sobrou um
número sem dono, o documento é recusado inteiro. Isso resolve de uma vez as quatro
armadilhas da fonte, que usam a MESMA forma de superfície (`Nome (48%)`): intenção de
voto, rejeição, valor da rodada anterior e cruzamento por segmento. E é o que faz a
recusa acontecer exatamente onde precisa: nas rodadas **presidenciais** — a única
corrida ativa — o Datafolha atrela o valor dos dois primeiros colocados a uma
DESCRIÇÃO e não a um nome ("o atual presidente tem 40%…, contra 32% do presidenciável
do PL"; "Lula tem 48%, contra 43% do senador pelo PL"). Resolver essa anáfora exigiria
assumir quem é "o atual presidente" ou quem o partido lança: chute proibido por
`docs/04` §4.1 e, pior, chute que o V6 **não pega**, porque o `tse_id` está certo.
Então o adapter recusa e o registro vai para quarentena. **Quem for mexer aqui precisa
saber disso: hoje este adapter não publica número da corrida presidencial, e isso é o
comportamento correto, não uma pendência para "melhorar" com um mapa
partido→candidato.** O mesmo parser, nas rodadas estaduais (redação nominal), extrai o
cenário inteiro: contra a captura real de governo de SP saem `Tarcísio 46, Haddad 30,
Vera Lúcia 5, Vivian Mendes 4, Carlos Machado 4` + brancos/nulos 8 + indecisos 3
(soma 100). Ou seja, a gramática não é código morto — ela liga sozinha no dia em que a
redação presidencial nomear os líderes, e o canário avisa.

Sobre fixtures, segui o padrão que T-15/T-23 firmaram, com o limite de `docs/08` §2.1
à vista (repo público): versionei os dois `robots.txt` REAIS byte a byte e um
`round-real-recorte.html` com os trechos byte a byte da rodada `BR-01166/2026` de que
o veredito depende (as duas orações com valor sem nome e a frase do registro TSE),
todo o resto elidido com `[…]`; o `README.md` do diretório traz URL, data, HTTP,
tamanho e **sha256** das 6 capturas e o comando de recaptura. As demais fixtures são
derivadas da estrutura real com frases nossas. O que substitui a foto é o canário
`datafolha.live.spec.ts` (`DATAFOLHA_LIVE=1`), que rodei nesta task: índice do ano OK,
publicação com corpo parseável, registro `BR-07601/2026` encontrado, parse recusando
pelo motivo documentado e host do PDF ainda proibido. Ele falha se o Datafolha passar
a nomear os líderes — que é justamente quando queremos ser avisados.

Dois recados para os vizinhos. (1) O `TS2345` que o registro do T-23 apontou em
`datafolha/datafolha-adapter.spec.ts:152` era meu e está **corrigido**; no fim desta
task `tsc --noEmit` do pacote está limpo e `vitest` do pacote fecha **442 passando, 0
falhando**. (2) Uma fragilidade do `base/tse-id.ts` que encontrei e não corrigi
(arquivo não é meu): o casamento aceita o prefixo opcional, então um registro
`BR-04519/2026` seria "confirmado" por uma publicação que traz `PE-04519/2026` — e o
Datafolha publica os dois protocolos na mesma frase ("TSE: PE-04519/2026 e
BR-07601/2026"). A sequência do estado colidir com a do BR é improvável, mas o V6 é a
defesa contra o pior bug do sistema e merece exigir o prefixo. Quem é dono de `base/`
decide.

### T-22, adendo — `discover` devolvia URL intermediária; agora devolve post final

O coordenador ligou o adapter no `AdapterRegistry` e o `HarvestJob` real falhou com
`parse_error … content-type inesperado ("text/xml; charset=UTF-8") em
…/post-sitemap.xml`. **A culpa era minha e é um erro de contrato, não de parser:**
meu `discover` devolvia as URLs INTERMEDIÁRIAS da caminhada (sitemap, `wp-json`)
como `SourceCandidate`, e o `HarvestJob` trata cada candidata como um DOCUMENTO a
buscar, salvar em `raw_documents` e mandar ao `parse` — ele não segue cadeia. O
sitemap chegava ao `extractScenarios`, que recusava por content-type. Li o
`NexusAdapter` de novo: `discover` só aponta URL **final**. Anotando para quem vier:
**se a sua candidata não é um documento que o `parse` saberia ler, ela não é
candidata.**

**Corrigido, e este `discover` FAZ REDE — o único do projeto.** Tentei a rota sem
rede primeiro, como o coordenador preferia, e ela não existe: **o slug do post da
Quaest é um título editorial.** `…/recuperacao-de-flavio-bolsonaro/`,
`…/saldo-de-aprovacao-de-lula/`, `…/lula-abre-vantagem-sobre-flavio-bolsonaro/`,
`…/51-desaprovam-lula-flavio-lidera-entre-os-independentes/`. Não há data, número de
rodada, nem qualquer campo do `PollRegistration` ali. Derivar candidatas disso seria
adivinhar URL — a versão de rede do erro da Q-09: geraria requisições que só dão 404
e cobertura zero, gastando o rate limit do instituto para nada. (Os slugs de
`relatorios` até carregam data — `…-rodada-1-14-08-2026` — mas aquele post só tem o
PDF rasterizado, então derivá-lo não serve de nada.)

O que **é** derivável é a **janela**: o post sai poucos dias depois do fim do campo
(2 dias nas duas capturas). Então `discover` faz **uma** requisição ao WP REST com
`after`/`before` em torno de `reg.fieldEnd` (`QUAEST_POST_LAG_DAYS = 14`,
`_fields=id,date,slug,link` — `title` não é pedido, prosa de terceiro não interessa
nem para filtrar) e devolve as URLs de post daquela janela, no máximo 6. **Quem
separa o post certo do vizinho é o V6**, que é exatamente para isso. Medido ao vivo
para a rodada de agosto: 2 candidatas, ambas URL de post, uma delas a certa.
`HttpClient` é o SINGLETON do processo (robots + 1 req/10 s por host), injetado com
default — não inventei cliente.

**Duas semânticas que separei de propósito, e que valem para qualquer `discover` com
rede:** janela vazia devolve `[]`, porque "o instituto ainda não divulgou" é um
FATO e o `decideHarvest` já sabe voltar depois; requisição que FALHA (status ≠ 200,
JSON inválido, forma mudada) **lança**, porque aí não sei quais são as candidatas e
devolver `[]` seria fingir "nada publicado" — o zero silencioso da Q-09 outra vez, um
nível acima. Há teste para as duas.

**Uma consequência operacional que é do dono do job, não minha:**
`HarvestJob.attempt` não envolve `await adapter.discover(reg)` em `try/catch`. Como o
meu é o único `discover` que faz rede, é o único que pode lançar ali — e sem proteção
uma falha de transporte da Quaest **aborta o ciclo inteiro, para todos os
institutos**. Não relaxei o R4 para contornar (não vou devolver `[]` numa falha); o
lugar certo do contêiner é o job, com o mesmo `try/catch` que já existe em volta do
`http.request`, empurrando `robots_or_http_error`.

Sobre as mudanças que o coordenador fez depois que eu terminei: o bug de bytes do
`HttpClient` **não altera minha conclusão sobre o PDF da Quaest** — eu medi a camada
de texto do arquivo baixado direto por `curl`, com `sha256` e tamanho conferidos
contra o `Content-Length` do servidor (`52904713`), então o rasterizado é da fonte e
não do transporte; o `…pdf-probe.json` guarda a evidência. O reforço do prefixo `BR`
em `base/tse-id.ts` é bem-vindo e não me afeta; a fragilidade do zero à esquerda
(`BR-7181/2026`) segue aberta e meu teste que a marca segue válido. As grafias novas
em `base/scenario-lines.ts` não mudam nada aqui: o meu caminho é prosa, e por isso
classifico brancos/nulos e indecisos por palavra-chave em janela de oração, não por
rótulo exato — está comentado no `constants.ts` para não parecer duplicação
gratuita.

Estado final: **34 testes offline verdes** (20 de parser, 14 de adapter, 5 deles só
sobre o `discover`), `typecheck` do pacote `adapters` **limpo** (o `TS2345` do
datafolha que eu havia reportado já foi corrigido pelo dono), `eslint`/`prettier`
limpos, e o **canário ao vivo rodado**: 3 testes, 52 s, 8 requisições sob o rate
limit real — inclusive a asserção de que o `discover` devolve URL de post final e
alcança o post da rodada corrente.

---

## T-28 — PesqEle: o teto de 50 registros e a varredura fatiada · 2026-08-17

**Entregue:** conserto de uma PERDA SILENCIOSA DE DADO no `DiscoveryJob`. O PesqEle
corta toda listagem em **50 registros** e o job fazia UMA consulta da janela de 30
dias — colhia 50, achava que eram todos e não emitia alerta nenhum. Medido ao vivo
em 2026-08-17 (eleição 2026 / BRASIL, por data de registro): a janela de 30 dias
devolve 50, um ano inteiro devolve 50, três dias devolvem 13, e as dez fatias de 3
dias da mesma janela somam **131**. Ou seja: **perdia 81 de 131 registros (62%), em
silêncio**, com o agravante de que o PesqEle expira o registro em 30 dias — o que
passava do teto era dado perdido para sempre. É a Q-11 confirmada, e a mesma classe
de bug da Q-09 um nível acima (lá era `seen=0`; aqui era `seen=50` de 131).

**Prova ao vivo, `pnpm ingest:discover` depois do conserto:** `seen=131`,
`sweep fatias=10 linhas=131 distintos=131 no_teto=0 truncadas=0 teto_declarado=50`.
`linhas == distintos` é a confirmação de que a partição de datas não sobrepõe nem
repete. E o registro concreto que motivou a Q-11 voltou: **`BR-06596/2026` (Palver,
n=5.000) está no banco** — estava na janela de 30 dias o tempo todo, só não estava
nos 50 que o servidor devolvia.

O `discover` passou de `listar30dias.xhtml` para `listar.xhtml` (busca com período
livre), que é a única tela que aceita período — e, de bônus, a única que **declara o
teto**: "O resultado da consulta está limitado a 50 registros". A tela de 30 dias
aplica o mesmo corte sem dizer nada. A janela de `JANELA_DIAS` (30) é varrida em
fatias de `FATIA_DIAS` (3), da mais antiga para a mais recente (o registro antigo é
o que está a ponto de expirar), com união por `tse_id`.

**Decisões:**

- **Fatia de 3 dias, com subdivisão automática.** O pico medido numa fatia de 3 dias
  foi 20 registros — margem de 2,5x até o teto. Fatia que volta NO TETO é
  subdividida em duas metades e as metades são varridas no lugar dela; a fatia mãe
  truncada **não** é colhida (as filhas cobrem o mesmo período e veem mais). Chegando
  a uma fatia de UM DIA ainda no teto, sai `DiscoveryAlert` de
  `truncation_suspected` e o que é visível continua sendo colhido, declarado como
  PISO. Nunca engolir e nunca jogar fora.
- **O teto vem DECLARADO pela resposta**, não da constante. A constante
  `LIMITE_RESULTADO_DECLARADO = 50` é a referência conhecida; se o site declarar
  outro número, ou o aviso desaparecer, sai `limit_mismatch` (uma vez por varredura).
  Preferi alerta a `throw` aqui porque o teto é parâmetro de protocolo, não dado de
  pesquisa: derrubar o ciclo inteiro por uma mudança cosmética de rótulo seria pior
  que seguir com a constante e gritar.
- **Mapa de colunas pelo cabeçalho.** A tabela de `listar.xhtml` tem "Eleição" onde a
  de 30 dias tem "Cargos" — na MESMA posição em que a outra tem "Empresa". O parse
  posicional fixo faria o nome do instituto virar "Eleições Gerais 2026" sem erro
  nenhum. Agora `parseColunas` lê o índice de cada coluna do `<th>`, e coluna
  obrigatória ausente LANÇA. `PesqEleLinhaLista.raceLabel` virou anulável: nesta tela
  não existe coluna de cargo, e o `raceLabel` que o job usa para resolver `race_id`
  sempre veio do DETALHE.
- **Campos de data resolvidos por rótulo.** São `formPesquisa:j_id_2n_input` e
  `j_id_2p_input`, gerados pelo JSF. Ficam resolvidos a partir do rótulo "Período de
  registro" (`periodo-inputs.ts`) e a ausência LANÇA — um POST sem período volta
  truncado em 50 com cara de acerto, que é exatamente o bug consertado.
- **`janela.ts` é puro** (sem I/O) para que a aritmética de borda seja testável sem
  rede: fatias fechadas nas duas pontas, contíguas, sem vão e sem sobreposição.
  Confirmado ao vivo: a fatia 10–12/08 devolve 13 e suas três fatias de um dia
  devolvem 6 + 6 + 1 = 13.

**Bug de brinde, achado no caminho:** a DataTable do PrimeFaces **guarda a página
corrente entre buscas**. Depois de paginar numa fatia, a busca da fatia seguinte
volta em `page:1`, não em `page:0` — o laço antigo (`for pagina = 1; …`) pularia a
página 0 em silêncio, perdendo 10 linhas por fatia. O cliente agora varre todas as
páginas do paginador e só aproveita a que a busca trouxe. Está congelado na fixture
`11-busca-periodo-no-teto-partial-response.xml`, que é uma captura real desse estado.

**Atenção para o próximo:**

- `DiscoveryResult` ganhou o campo **`sweep`** (`PesqEleSweepStats | null`): janela,
  fatias, fatias no teto, truncagens suspeitas, linhas lidas, `tse_id` distintos e
  teto declarado. O log escreve uma linha `[discovery][sweep] …` e usa `console.warn`
  com "PERDA POSSÍVEL" quando `truncadas > 0`. **`apps/api/src/main.ts` (T-14) não é
  meu** e hoje grava só `{seen, upserted, expired, alerts}` no `job_runs`: quem cuida
  da orquestração ganharia muito adicionando `truncadas: r.sweep?.truncagensSuspeitas`
  ali, senão o alarme fica só no stdout.
- **O `kind` do alerta agora é REPASSADO** pelo job. Antes ele era fixado em
  `'empty_search'` na chamada do adapter — o que transformaria uma suspeita de
  truncagem em "busca vazia" no log. `DiscoveryAlert.kind` cresceu com
  `truncation_suspected` e `limit_mismatch`.
- **Custo de rede medido ao vivo:** ciclo em regime permanente **3m13s** (21
  requisições: 1 GET + 10 buscas + 10 paginações, a 1 req/10s), contra ~1 min de
  antes. Ciclo com 11 registros inéditos: 6m52s. **Cold start com o banco vazio:
  46m34s** — porque cada registro inédito custa 2 requisições de detalhe e eram 130.
  Quem chamar isso de um cron de 2h precisa saber: o regime permanente é curto, o
  cold start não é.
- **131 registros no banco, 83 deles com `institute_id = null`** (48 resolvidos). São
  83 alertas `unknown_institute` num run — não é regressão, é o efeito de finalmente
  ver a janela inteira: institutos que antes ficavam atrás do teto agora aparecem.
  Quem cuida de `institute_aliases` (seed) tem uma lista pronta no log do run.
- **Não volte para `listar30dias.xhtml`** e não alargue a fatia sem refazer a conta
  que está comentada em `FATIA_DIAS`. Se um DIA inteiro estourar o teto (plausível
  perto do pleito), não há mais como estreitar por data; as saídas estão escritas na
  Q-11 (filtrar por empresa é inviável: 2.254 empresas no `<select>` = mais de 6h por
  ciclo).
- **Erro operacional que vale como aviso (e que já está consertado por outro
  agente):** rodei `discovery.job.integration.spec.ts` no MESMO banco enquanto o run
  ao vivo estava no ar. O `truncateData` do `beforeEach` apagou 11 registros já
  persistidos e o `markAbsentAsExpired` dos testes marcou 70 linhas do run como
  expiradas — o run seguinte as reviveu e o run 3 fechou limpo, então o dado voltou,
  mas o susto foi real. No meio da minha task entrou a separação
  `vitest.config.ts` / `vitest.integration.config.ts` com banco DERIVADO
  (`<banco>_test`, `db/test-helpers.ts`): reconferi depois dela e o banco de
  desenvolvimento ficou intocado (131 linhas antes e depois). Ou seja, a colisão que
  eu causei já não é possível — mas o comando mudou: integração agora é
  `pnpm --filter @election-pool/api exec dotenv -e ../../infra/.env -- vitest run -c
  vitest.integration.config.ts src/jobs/discovery.job.integration.spec.ts`, e um
  `vitest run <arquivo>` cru diz "No test files found".
- Fixtures novas, capturas reais de 2026-08-17: `08-listar-periodo-page.html`,
  `09-busca-periodo`, `10-paginacao-periodo-pagina2`, `11-busca-periodo-no-teto`,
  `12-detalhe-BR-09275-2026.html`, `13-detalhe-pagina2-BR-01495-2026.html`. Nas três
  primeiras o `<select>` de empresas (2.253 de 2.254 entradas, 645 KB que nenhum
  parser lê) foi cortado com marcador; o resto é byte-a-byte o que o servidor
  respondeu.

**Estado final:** 100 testes offline do PesqEle verdes (27 de cliente/varredura, 32
de parser, 13 de `janela`, 4 de `periodo-inputs`, mais os de viewstate,
select-options e contractor-classifier), 490 no pacote `adapters` inteiro; os testes
de integração do discovery em 10 (os 8 originais intactos + 2 novos sobre repasse de
alerta e `sweep`); `typecheck` limpo, `eslint`/`prettier` limpos; três execuções ao
vivo, a terceira com `upserted=0` e `first_seen_at` intocado (131 linhas, 131
distintas, zero duplicata).

### T-17 — addendum: o cadastro cresceu de 7 para 22 e um teste meu estava medindo o mundo errado

O seed passou a incluir as 13 candidaturas oficiais de 2026, e com isso o job passou
a casar **13** candidaturas, não 3. Isso é o comportamento CORRETO — o que estava
errado era uma asserção minha.

Investiguei antes de mexer, porque a hipótese em cima da mesa era que a segunda
execução estaria reconsultando candidatura já fotografada (bug de janela de
recheck). **Não era.** Instrumentei o job rodando duas vezes contra o banco de teste
e olhei as requisições da segunda execução: 12 requisições, `eleicao-atual` +
`listar` + 10 `/candidatura/buscar/`, e **nenhuma** mencionando as três candidaturas
que já tinham foto. `downloads=0`, `inalteradas=3`, arquivo e registro intactos. A
janela de recheck funciona.

O que falhava era a linha `expect(novas.some(url => url.includes('/candidatura/buscar/'))).toBe(false)`
— minha, e verdadeira só por acidente. Quando os únicos candidatos que casavam eram
os três de quem a fixture tem bytes, "nenhum detalhe pedido" e "nenhum recheck" eram
a mesma frase. Com 13 casados e 3 com imagem as duas se separaram, e a asserção
passou a proibir tráfego legítimo: **candidatura casada sem foto é reconsultada a
cada ciclo de propósito**, porque é o detalhe que informa `fotoUrlPublicavel`, e não
ter foto hoje não significa não ter amanhã.

Reescrevi para a invariante verdadeira, derivando do BANCO em vez de constante:
nenhuma requisição menciona candidatura que já rendeu foto; zero `/arquivo/img/`;
todo detalhe pedido é de candidatura ainda sem foto; e
`detalhesPedidos.length === casados - inalteradas`, que amarra tráfego a estado sem
afirmar nada sobre o tamanho do cadastro. **Nenhuma mudança no job — não havia bug.**

**Lição, e ela é irmã da que ficou registrada em T-15:** o teste original media o
tamanho do mundo achando que media comportamento. `toBe(3)` sobre `casados` e
"nenhum detalhe pedido" eram a mesma classe de erro — asserção que depende de quantas
linhas o cadastro tem. Quem escrever teste de job de ingestão daqui pra frente:
derive o esperado do estado (banco/fixture) e afirme relações entre grandezas
(`novas === downloads`, `detalhes === casados - inalteradas`), não literais.

**Fica um ponto para quem tocar o job:** os 10 GETs de detalhe por execução das
candidaturas sem foto são legítimos e o rate limit de 1 req/10s os contém, mas o
alerta `foto_nao_publicavel` dispara 10x por ciclo e vai virar ruído no log. Calar
isso exigiria uma coluna de "última tentativa" independente do bloco `photo_*` (que é
tudo-ou-nada por desenho) — decisão de quem tem a caneta da migration, não minha
para tomar sozinho.

---

## T-29 — Pergunta espontânea · 2026-08-17

**Entregue:** A seção que a Q-14 deixou em aberto ("onde exibir a série
espontânea"). `apps/web/src/components/sections/SpontaneousSection.astro`, montada
em `index.astro` logo depois da série latente, mais três peças novas:
`charts/SpontaneousContrast.astro` (as duas barras do eleitorado, uma por forma de
pergunta), `charts/SpontaneousSeriesChart.astro` (a série no tempo) e
`charts/lib/contrast-geometry.ts` (geometria pura, D3 só para `scaleLinear`). A
costura `data/chart-inputs.ts` ganhou `spontaneous` e `electorateLatest`. A amostra
`src/data/sample-data.json` foi regenerada com o campo `spontaneous` — sem isso o
build reprovava na validação Zod, porque o campo é obrigatório no schema `'2'`
(nulável, não opcional). Escopo todo dentro de `apps/web/**`; nada de contracts,
model, api ou infra foi tocado.

**Decisões:** (1) O contraste é comunicado em três camadas, na ordem número →
prosa → desenho. As duas leituras aparecem primeiro como dois números de destaque
com réguas na MESMA escala (37,2% não citam nome / 7,0% dizem não saber na
amostra); depois vem o bloco de explicação, com peso de seção e régua de acento à
esquerda, ANTES de qualquer gráfico — sem ele "um terço não tem candidato" parece
contradizer os "3% de indecisos" do jornal e o leitor conclui que um dos números
está errado; só então as duas barras. (2) `named` é aritmética e é exibida como
tal: segmento apagado, sem hachura, contorno tracejado, rótulo `aritmética` e
NENHUMA `<UncertaintyRule>` — no lugar da régua vai a frase "complemento para 100,
faixa somada de forma conservadora". O complemento da estimulada é calculado na
seção com o mesmo tratamento. (3) A banda de 90% é desenhada só no segmento
ancorado em zero; empilhada, a posição da banda carregaria a incerteza dos
segmentos anteriores e afirmaria precisão que a soma não tem — as outras medidas
levam régua no readout HTML, escala 0–100 igual à da barra. (4) Ponto `null`
interrompe a linha (geometria reusada de `electorate-geometry.ts`) e, na barra,
deixa o trecho vazado e rotulado "sem medida"; a barra não fecha 100 à força.
(5) Identidade visual própria: acento de interface na grandeza "sem candidato" nas
duas formas de pergunta, grafite no branco/nulo (o mesmo do gráfico do eleitorado),
zero cor de espectro de candidatos.

**Atenção para o próximo:** (a) `apps/web/src/data/sample-data.json` é gerado e
DEPOIS passado no prettier — o `JSON.stringify` do gerador não é prettier-clean
(arrays curtos), então quem regenerar tem de rodar
`npx prettier --write apps/web/src/data/sample-data.json` ou `pnpm lint` da raiz
reprova. (b) A amostra da estimulada tem não-sabe ~7 p.p., não ~3 como no dado
real de `BR-06833/2026`: os níveis de `LEVELS` no gerador somam 100 exato e
alimentam `transitions`, e mexer no não-sabe quebraria essa reconciliação. O
contraste da amostra (37 × 7) já é forte o bastante para conferir o visual; quem
precisar do contraste real na amostra tem de reequilibrar `LEVELS` inteiro.
(c) `SpontaneousContrast` usa `preserveAspectRatio="none"` (a barra é escala
horizontal, não desenho com proporção) e por isso todo traço leva
`vector-effect: non-scaling-stroke` e as hachuras são listras ortogonais em vez de
diagonais a 45° — diagonal sob esticamento horizontal vira quase-vertical em
telas estreitas e as duas texturas ficariam parecidas. Quem editar aquele SVG
mantenha as duas coisas. (d) `SpontaneousSeriesChart` NÃO tem animação de entrada,
igual ao `ElectorateSeriesChart`: `charts.css` só anima `.band`/`.center-line`/
`.poll-point` sob `.chart-animate`, classe que só o `LatentBandChart` adiciona ao
hidratar. Se alguém for orquestrar animação nesses dois gráficos, faça nos dois
juntos — eles aparecem lado a lado na página e animar um só chama atenção para o
gráfico errado.
