# Questões em aberto

Registre aqui, em vez de decidir sozinho, quando: a metodologia parecer errada,
um contrato precisar mudar no meio da implementação, ou uma fonte exigir headless
browser / acesso de nível 4.

Formato: contexto, opções consideradas, recomendação, quem decide.

---

## Q-01 — Modelo bayesiano completo (Stan/MCMC) em vez de Kalman

**Contexto.** A v1 usa filtro de Kalman em TypeScript (`docs/02` §2). Isso dá
determinismo e um só runtime, mas não produz posterior completo, e a incerteza de
`h_i` acaba subestimada porque `μ` e `h` são estimados em etapas acopladas de forma
aproximada.

**Opções.** (a) manter Kalman; (b) Stan via CmdStan chamado do Node; (c) MCMC
próprio em TS.

**Recomendação.** Manter (a) na v1. Reavaliar depois do backtest: se a banda
estiver sistematicamente estreita demais, é sinal de que a aproximação está
custando caro.

**Decide:** Felix.

---

## Q-02 — Ancorar house effects em resultados eleitorais

**Contexto.** `docs/01` §1.2 explica por que a v1 não faz isso. É a limitação mais
séria do modelo: com soma-zero, viés comum a todos os institutos é invisível.

**Recomendação.** Reabrir depois de 2026, quando houver mais um ponto de
calibração e for possível avaliar se `h_i` de 2022 teve algum poder preditivo
para 2026.

**Decide:** Felix.

---

## Q-03 — Correlação entre candidatos no processo

**Contexto.** `docs/01` §2 trata os `μ` como independentes e só restringe a soma na
saída. Na prática, ganho de um candidato costuma vir de outro específico.

**Recomendação.** v2. Exige matriz de covariância do processo e complica bastante
a identificação.

**Decide:** Felix.

---

## Q-04 — Constante do nível de credibilidade (z de 90%)

**Contexto.** O modelo (T-03) precisa converter desvio-padrão suavizado em
semilargura de IC 90% (`mean ± z·sd`). O `z` bicaudal de 90% (1.6448536269514722)
é uma constante metodológica (docs/01 §2/§4, docs/07 M-4), mas `constants.ts` não
tinha nenhuma constante que expressasse o nível de credibilidade — só os limites de
largura da banda (`BAND_WIDTH_MIN_PP`/`MAX_PP`). O gate de bias (docs/07 §5.1)
proíbe literais numéricos não declarados em `constants.ts` no código do modelo, então
não havia como escrever o `z` sem declará-lo lá.

**Opções.** (a) adicionar `CI_Z_90` a `constants.ts` (adição pura, não altera
export existente); (b) derivar `z` em runtime por root-find sobre `erf` — mas isso
reintroduz literais (coeficientes da aproximação e o próprio 0,90); (c) parametrizar
o nível de credibilidade e deixar o número no `data.json`.

**Decisão tomada em T-03 (a):** adicionei `CI_Z_90 = 1.6448536269514722` em
`packages/contracts/src/constants.ts`, com a origem documentada. É adição pura
(nenhum export existente mudou), então não invalida o trabalho de outros agentes.
Sinalizo aqui porque, pelas regras (CLAUDE.md; T-03 "only READ contracts"), qualquer
toque em contrato deve ser registrado. Se o nível de credibilidade virar
configurável, este é o ponto único a mudar.

**Decide:** Felix (ratificar a adição da constante).

---

## Q-05 — `ModelOutput.diagnostics` é estreito demais para os diagnósticos ricos da §6

**Contexto.** T-08 implementa os três diagnósticos de docs/01 §6 (gaveta, herding,
divergência). O aceite exige formas que a UI possa distinguir — a mais explícita:
"1 registro e 0 divulgações ⇒ taxa 1,0 com `registered: 1`, a UI precisa distinguir
isso de 0,6 sobre 20". Isso exige **numerador e denominador separados**. Mas o campo
que carrega diagnósticos no output do modelo tem shape estreito:

```
// packages/contracts/src/model-io.ts
diagnosticSchema = { kind, subjectId, value: number, n: number }
```

Com `value` + `n` NÃO cabem, sem perda: a gaveta precisa de
`{subjectId, subjectKind, rate, registered, disclosed}`; o herding precisa de
`{windowEnd, ratio, nPolls, flagged}`. Justamente essas formas ricas já existem —
mas em OUTRO contrato, `PublicData.diagnostics` (docs/03 §5 / `public-data.ts`), que
é a saída pública (`data.json`), não a saída do modelo. E a divergência (§6.3) não
tem lugar em nenhum dos dois além do enum `divergencia`.

Além do shape: **a taxa de gaveta exige registros do PesqEle** (`registeredAt`,
`disclosureStatus`, `contractorName`) que NÃO estão em `ModelInput`/`Observation` —
o modelo, sendo puro, recebe só resultados de pesquisa, não registros.

**Opções.** (a) alargar `diagnosticSchema` em `model-io.ts` para uma união
discriminada por `kind` (gaveta/herding/divergência com seus campos ricos) e
adicionar registros a `ModelInput` — mas mexer em contrato invalida trabalho de
outros agentes (CLAUDE.md) e é justamente o que a task manda NÃO fazer em silêncio;
(b) manter `ModelOutput.diagnostics` como um RESUMO narrow (herding+divergência, sem
perda que importe para um handle) e expor as FORMAS RICAS como funções puras em
`packages/model/diagnostics.ts` (`computeGavetaRates`, `computeHerding`,
`computeDivergence`, `computeDiagnostics`) para o chamador (T-13) montar
`PublicData.diagnostics` diretamente, passando os registros que só ele tem.

**Decisão tomada em T-08 (b), sem tocar contrato.** `packages/model/diagnostics.ts`
tem toda a matemática da §6 nas formas ricas que casam com `PublicData.diagnostics`
(gaveta/herding) + `DivergenceResult` (derivada dos house effects). `runModel`
popula `ModelOutput.diagnostics` com uma projeção narrow de herding+divergência
(resumo); a gaveta fica fora dele por não ter input. Nenhum contrato mudou.

**Pendências que dependem do Felix:**
1. Onde a divergência (§6.3) deve morar em `PublicData` para chegar ao `data.json`?
   Hoje `PublicData.diagnostics` só tem `gaveta` e `herding`. T-13 precisa de um
   lugar para `divergence` (ou derivá-la de `houseEffects` no front, que já carrega
   `effect`/`lo90`/`hi90`/`estimable`).
2. Ratificar (b): manter o modelo puro (registros entram pelo chamador) vs. alargar
   `ModelInput`/`diagnosticSchema`.

**Decide:** Felix.

---

## Q-06 — Supersede de `poll_scenarios` no reparse colide com `UNIQUE (tse_id, kind, label)`

**Contexto (T-06).** `docs/03` §2.4 diz: "Correção de erro de extração se faz
criando um novo `poll_scenarios` e marcando o antigo como superado — nunca com
`UPDATE`." Mas o mesmo §2.4 define `UNIQUE (tse_id, kind, label)` em
`poll_scenarios`, e o `label` é o rótulo do instituto ('Cenário 1'), que NÃO muda
entre extrações. Logo o reparse (`pnpm ingest:reparse`, docs/04 §7) não consegue
inserir um novo cenário para o mesmo `(tse_id, kind, label)` — a constraint colide.
E `poll_results` é append-only (trigger), então o resultado antigo tampouco pode
ser removido/atualizado. Não há coluna de supersede (`superseded_at`/`is_current`)
nem `extracted_at` na chave única.

**Opções.** (a) Adicionar `superseded_at timestamptz NULL` a `poll_scenarios` e
trocar a UNIQUE por um índice parcial `UNIQUE (tse_id, kind, label) WHERE
superseded_at IS NULL` — o novo cenário entra, o antigo é marcado superado (um
UPDATE só de metadado em `poll_scenarios`, que NÃO tem trigger; `poll_results`
segue imutável). (b) Incluir `extracted_at` (ou o `raw_document_id`) na chave
única, permitindo múltiplas versões coexistirem e "atual" = maior `extracted_at`.
(c) Manter como está e aceitar que o reparse só re-persiste quando não colide
(novos labels/kinds), reportando divergências para correção manual.

**O que T-06 fez sem tocar o schema (fora do meu ownership):** o `ingest:reparse`
re-roda o parser CORRENTE sobre os `raw_documents` já salvos (sem rede) e é
IDEMPOTENTE — re-inserção do mesmo `(tse_id, kind, label)` é evitada; divergência
entre a extração armazenada e a nova é REPORTADA como `needs_supersede` (não
força UPDATE, não quebra o append-only). O teste de aceite "reparse produz
resultado idêntico ao parse original" é coberto no nível do parser (determinismo).
A materialização do supersede depende da decisão abaixo.

**Recomendação.** (a) — índice parcial com `superseded_at`. É o que casa com a
letra de §2.4 ("marca o antigo como superado") sem violar o append-only de
`poll_results`. Exige uma migration nova (dono: T-02/orquestrador).

**Decide:** Felix.

---

## Q-07 — Banda estreita demais no backtest de 2022 (feedback para Q-01)

**Contexto (T-09).** O backtest de 2022 (docs/07 §4, resultado gravado em
`docs/BACKTEST-RESULTS.md`) RODA, sem vazamento de dado futuro (verificado: nenhuma
pesquisa usada tem `field_end` posterior ao corte). O veredito HONESTO é **REPROVOU
(2 de 4)**:

- 1º turno (corte 2022-10-01): vencedor est. 49,7% em válidos, IC90 [48,7; 50,8],
  largura 2,09 p.p., urna 48,4% ⇒ **FAIL** (oficial ABAIXO da banda); vice est.
  38,3%, IC90 [37,2; 39,3], largura 2,06 p.p., urna 43,2% ⇒ **FAIL** (oficial bem
  ACIMA da banda — é exatamente o viés comum de 2022 que subestimou o vice, docs/07
  §4.3).
- 2º turno (corte 2022-10-29): ambos PASS, com IC de ~2,0 p.p.

O FAIL do 1º turno é o comportamento ESPERADO e documentado (docs/01 §1.1/§10):
soma-zero não corrige viés comum a todos os institutos, e o de 2022 R1 foi grande.
Isso NÃO é bug e, por R1 do CLAUDE.md, **nada foi ajustado** para passar.

**O que o backtest revela e é digno de decisão.** A banda é ESTREITA — ~2 p.p. de
largura no nó de referência, mesmo dias após a última observação. É o sinal que a
própria Q-01 pediu para observar ("se a banda estiver sistematicamente estreita
demais, é sinal de que a aproximação [Kalman + h_i em etapas acopladas] está custando
caro") e casa com a subestimação do IC de `h_i` já registrada em T-04. Com banda
estreita, o modelo REPROVA o 1º turno em vez de passar por largura honesta (docs/07
§4.3) — ou seja, hoje o produto "largura honesta" NÃO está sendo entregue no cenário
de maior viés comum.

**Opções (todas exigem mudança de modelo ⇒ R1: MODEL_VERSION nova + justificativa
ANTES de rodar, decisão do Felix — não implementadas aqui).**
(a) Manter v1.0.0 e publicar o backtest como REPROVADO, comunicando que a v1 não
passa no caso de viés comum grande — a limitação da §10 vira número concreto.
(b) Inflar a variância do processo/observação (ex.: reavaliar `deff`, `σ_house_extra`,
ou o passo do random walk perto do corte) para que a banda reflita a incerteza real
fora da janela — mas isso é ajuste de prior e só pode ser feito com justificativa
escrita ANTES, nunca para "passar".
(c) Adotar o modelo bayesiano completo da Q-01 (posterior real de `μ` e `h`), que
tende a produzir banda mais larga e honesta sem tuning direcional.

**Recomendação (minha, T-09):** não tocar o modelo agora (R1). Publicar o resultado
REPROVADO honestamente (já em `docs/BACKTEST-RESULTS.md`) e reabrir a Q-01 com este
número como evidência. A decisão entre (a)/(b)/(c) é de metodologia.

**Decide:** Felix.

---

## Q-08 — EXDEV no deploy: `astro build` cruza filesystem ao publicar (T-14)

**Contexto (T-14).** Ao rodar o pipeline de ponta a ponta num container (compose de
produção), o `astro build` LANÇOU `EXDEV: cross-device link not permitted` ao mover
seus assets internos (`apps/web/.astro/.prerender/...` → `dist-staging/...`). O
`astro` faz `rename` desse temp para o `outDir`, e `rename` só é atômico DENTRO de um
filesystem. Quando `PUBLISH_BASE_DIR` (bind mount / volume) e `apps/web` (overlay do
container) são filesystems diferentes, o build quebra — antes mesmo do swap atômico
de T-13. É a mesma classe de armadilha que T-13 flagou para o swap, um nível acima.

**O que T-14 fez (fix aplicado, dentro do ownership de deploy/glue).** `astro-build.ts`
agora constrói SEMPRE num `outDir` LOCAL ao `webDir` (`.dist-build`, mesmo filesystem
que `.astro`/`node_modules`) e só então COPIA a árvore pronta para `dist-staging`. A
cópia pode cruzar filesystem sem risco (não é a etapa atômica); o swap dentro de
`PUBLISH_BASE_DIR` (dist-staging → snapshot → symlink) continua `rename` same-fs.
Verificado no container: com o fix, `render` publica (`published:true`) e o nginx
serve o site pelo symlink `dist`, `/data.json` com `Cache-Control: public, max-age=300`
+ CORS. Os 46 testes de T-13 seguem verdes.

**Nota residual.** O fix elimina o EXDEV do build sem exigir que `apps/web` e
`PUBLISH_BASE_DIR` compartilhem filesystem. O único requisito que PERMANECE (de T-13)
é `dist-staging`, `dist` e os snapshots morarem no MESMO filesystem — o que o layout
sob `PUBLISH_BASE_DIR` já garante. Não há decisão pendente aqui; registrado para
proveniência (a armadilha não estava documentada e custou uma iteração de e2e).

**Decide:** nada a decidir — informativo. Sinalizar se o modelo de deploy mudar
(ex.: build fora do container) e o pressuposto same-fs deixar de valer.
