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

---

## Q-09 — O cliente do PesqEle (T-05) foi escrito contra um PesqEle que não existe

**Contexto.** Ao subir a stack local completa e rodar o pipeline real contra o
`pesqele-divulgacao.tse.jus.br`, o DiscoveryJob terminou com `seen=0, upserted=0,
alerts=0` — sucesso silencioso, zero registro. O site está no ar e tem dado: a
consulta de últimos 30 dias para "Eleições Gerais 2026 / BRASIL" devolve **50
registros de pesquisas presidenciais** (Datafolha, Instituto Opnus, Instituto
Perfil, Verita, …), em 5 páginas de 10.

O motivo é que `packages/adapters/pesqele/` foi escrito contra uma estrutura
SUPOSTA, nunca confrontada com o site real. Divergências verificadas ao vivo:

| O que o código assume | O que o PesqEle 3.9.2 realmente faz |
|---|---|
| Busca em `POST /index.xhtml` | `/index.xhtml` é só um menu. A busca é `/app/pesquisa/listar30dias.xhtml` (há também `listar.xhtml`) |
| `formAviso` é um aviso legal a aceitar, com botão `formAviso:aceitar` | `formAviso` é o modal **"Sessão Expirada!"**, presente OCULTO em toda página; seus elementos são `j_id_q/j_id_s/j_id_t` e o botão só faz `window.location.href=''` |
| Campos `formPesquisa:eleicao`, `:abrangencia`, `:periodoInicio`, `:periodoFim`, `:btnPesquisar` | `formPesquisa:eleicoes_input` (`81` = Eleições Gerais 2026), `formPesquisa:filtroUF_input` (`BR` = BRASIL), `formPesquisa:selectCidades_input`; sem campos de período (a página JÁ é a de 30 dias); botão `formPesquisa:idBtnPesquisar` |
| POST de formulário comum, resposta HTML | commandLink PrimeFaces **AJAX**: exige `javax.faces.partial.ajax=true`, `javax.faces.source`, `partial.execute/render`; a resposta é `<partial-response>` com o HTML em CDATA e o ViewState novo num `<update>` |
| Paginação por `formPesquisa:tabelaPesquisas:pagina` | DataTable PrimeFaces `formPesquisa:tabelaPesquisas`, paginação AJAX (`_pagination`, `_first`, `_rows`) |
| Lista traz todos os campos do registro, marcados com `data-field="..."`/`data-row="registration"` | A lista tem 6 `<td>` SEM atributo semântico algum (tse_id, empresa, cargos, data de registro, abrangência, ações). `data-field`/`data-row` **não existem no PesqEle** — são invenção das fixtures |
| Um documento por registro | Datas de campo, nº de entrevistados, CNPJ, valor e contratante só existem na tela de detalhe: `detalhar` (AJAX) ⇒ `redirect` ⇒ `GET /app/pesquisa/detalhar.xhtml` |

**Por que os testes não pegaram.** As fixtures de `pesqele/__fixtures__/` foram
escritas com os mesmos `data-field` inventados que o parser procura — o teste
prova que o parser lê a fixture, não que o parser lê o PesqEle. O aceite de T-05
pedia "fixture de HTML **real** do PesqEle" e isso não foi cumprido. É a lição
cara desta task: **fixture sintética de fonte externa não é evidência de
integração**; ela só vale depois que uma captura real do site é congelada.

**Consequência.** Sem discovery não há `poll_registrations`; sem registro não há
harvest; sem harvest não há observação; sem observação o M-1 reprova e nada é
publicado. Toda a trilha de ingestão está de pé, testada e correta em relação a
si mesma — e alimentada por zero.

**O que o detalhe REALMENTE oferece** (capturado de `BR-06783/2026`): número de
identificação, data de registro, cargo(s), data de divulgação, empresa contratada
+ CNPJ, eleição, entrevistados (`1200`), data de início e término da pesquisa,
estatístico responsável e CONRE, valor (`R$ 148.800,00`), se é recurso próprio,
contratante(s) + CPF/CNPJ. **Margem de erro e nível de confiança NÃO existem em
campo estruturado** — aparecem apenas dentro do texto metodológico do instituto,
que R3/docs/08 proíbe armazenar. `marginOfError`/`confidenceLevel` são anuláveis
no schema, então o caminho honesto é `null`, nunca extrair da prosa.

**Custo a decidir.** Com o rate limit de 1 req/10s (docs/04 §6), colher o detalhe
de cada registro custa ~3 requisições (detalhar ⇒ GET detalhe ⇒ voltar). Para 50
registros isso é ~25 min de ciclo. Opções: (a) buscar detalhe só de registro
NOVO (o `tse_id` já visto não muda) — reduz o regime permanente a quase nada e é
o que a idempotência do upsert já permite; (b) aceitar o ciclo longo; (c) avaliar
se o TSE publica esses registros em dados abertos, evitando o scraping do JSF.

**Recomendação (minha):** (a) — detalhe só para `tse_id` inédito, com o resto do
ciclo intocado. E congelar capturas REAIS do site como fixtures antes de escrever
uma linha de parser novo, invertendo a ordem que produziu este bug.

**Decide:** Felix (sobretudo o custo/ritmo de (a)/(b)/(c)). A reescrita em si é
trabalho de implementação, especificada em `tasks/T-15-pesqele-real.md`.

---

## Q-10 — Modelo de transferência de votos: objeção registrada e decisão do Felix

**Registro obrigatório (R1).** Esta seção foi escrita ANTES de qualquer linha do
modelo novo e ANTES de ver qualquer saída dele. É a justificativa exigida pelo R1
do CLAUDE.md para incrementar `MODEL_VERSION`.

**O pedido.** Mostrar "para onde estão indo os votos ao longo do tempo" — fluxo
entre candidatos e entre candidatos e o bolo de branco/nulo/não-sabe.

**A objeção, registrada na íntegra.** A partir de pesquisa AGREGADA não é possível
IDENTIFICAR transferência individual de voto. É o problema clássico de inferência
ecológica. Se o "não sabe" cai 4 p.p. e o candidato A sobe 4 p.p., são
observacionalmente idênticos: (i) 4 p.p. de indecisos foram para A; (ii) 6 p.p. de
indecisos foram para A e 2 p.p. de A foram para B, com B recebendo também 2 p.p. de
C; (iii) nada se moveu e a composição da amostra mudou. Com `K` estados há `K²`
incógnitas por passo e apenas `K` equações (as marginais), mais a restrição de
soma. O sistema é subdeterminado por construção — nenhuma quantidade de dado
agregado o resolve. Só dado de PAINEL (mesma pessoa entrevistada duas vezes)
identifica fluxo, e o PesqEle não expõe painel.

Consequência honesta: **os números de fluxo serão determinados pelo PRIOR tanto
quanto pelo dado.** Mudar a força do prior muda o resultado sem que o ajuste do
dado piore. Isso é o oposto do que o resto deste projeto faz, e é o motivo de
`docs/01` §2 tratar os `μ` como independentes e de a Q-03 ter adiado correlação
para v2.

**Decisão (Felix, 2026-08-16), com a objeção acima à vista:** implementar o modelo
de transferência. Registro que a recomendação técnica era a alternativa "séries de
branco/nulo/não-sabe + co-movimento descritivo", e que ela foi preterida.

**Condições que a implementação DEVE respeitar** — sem elas o recurso vira
exatamente o número inventado que o R4 proíbe:

1. `MODEL_VERSION` vai a `0.0.4`. O espaço de estados muda (branco/nulo e
   não-sabe passam a ser estados rastreados, não descarte).
2. O prior é EXPLÍCITO, versionado em `constants.ts` e publicado em
   `params_json` e no `data.json`. Quem lê precisa poder ver de quanto foi a
   ajuda do prior.
3. A banda do fluxo é publicada SEMPRE, e ela vai ser larga. Fluxo cuja banda
   cruza zero é publicado como "não distinguível de zero" — nunca escondido, nunca
   arredondado para uma seta bonita.
4. A UI rotula o painel como ESTIMATIVA DE MODELO sob suposição, não medida, com
   a limitação escrita na própria seção — não só na página de metodologia.
5. Entra uma linha nova em `docs/01` §10 ("o que este modelo não faz"):
   transferência é inferida de agregado e não identifica fluxo individual.
6. O backtest de 2022 ganha uma comparação de transferência entre o 1º e o 2º
   turno, onde o resultado da urna dá um ponto de checagem real. Se reprovar, o
   veredito é publicado como reprovado (R1) — não se ajusta o prior para passar.
7. Nada de transferência entra na estimativa de `μ_t` nem nos house effects. O
   modelo de fluxo LÊ a série latente e não a realimenta. Assim, um erro no fluxo
   não contamina o número principal do site.

**Decide:** decidido. Registrado para auditoria de por que a v2 existe.

### Q-10, adendo pós-implementação (2026-08-16) — o prior domina, e o rótulo não avisa

Escrito DEPOIS de rodar o modelo, e por isso separado da justificativa acima: o
que segue são MEDIÇÕES, não previsões. Elas confirmam a objeção original com
número, e uma delas exige decisão nova.

**1. Quanto do número é prior: ~92%.** No run de 1º turno de 2022, o ajuste ao
dado desloca 7,00 p.p. de 91,00 p.p. de massa por passo. Oito por cento do que
está publicado vem das pesquisas; o resto vem da hipótese de permanência. A
implementação publica essa medição em `transitions.prior.note`, então o número não
está escondido — mas é preciso dizer com todas as letras: **o painel de
transferência é majoritariamente uma consequência do prior.**

**2. O backtest de transferência REPROVOU, e ficou assim.** O modelo estima 38,7%
da massa liberada pelos eliminados indo ao primeiro finalista, IC 90% [31,6; 46,2];
a urna de 2022 implica 29,8% — fora da banda. O veredito geral do backtest passou a
`REPROVOU (2/4, transferência FAIL)`. Nada foi ajustado para passar (R1). A causa é
diagnóstica, não um bug: o prior de permanência redistribui a massa liberada de
forma quase simétrica, e 2022 foi fortemente assimétrico. A estimativa cai a meio
caminho entre o prior (~50/50) e o que as marginais sozinhas diriam (~15–20%).

**3. DECISÃO NOVA NECESSÁRIA — `notIdentifiable` não faz o que a condição 3
pretendia.** A condição 3 da Q-10 supunha que marcar fluxo com banda cruzando zero
protegeria o leitor. Não protege: a banda só captura ruído AMOSTRAL, e como as
bandas latentes são estreitas (Q-07, o mesmo problema de novo), fluxos de ~2 p.p.
quase inteiramente priorísticos saem com banda acima de zero e SEM rótulo. No run
de 2022, só 34 de 272 fluxos foram marcados. Um leitor que interprete
`notIdentifiable: false` como "este fluxo é confiável" está sendo enganado pela
nossa própria UI.

Opções: (a) publicar assim, com o aviso de prior em destaque máximo na seção e o
rótulo rebaixado a "banda não cruza zero", sem conotação de confiança; (b) criar um
segundo indicador, por fluxo, de QUANTO daquele número veio do prior, e marcar como
não-informativo o que passar de um limiar — mais honesto e mais caro; (c) não
publicar o painel de fluxo e ficar com as séries de branco/nulo e não-sabe, que são
dado puro.

**Recomendação:** (b) se o painel for publicado. (c) continua sendo a leitura
tecnicamente mais defensável, e o backtest reprovado é evidência a favor dela.
A implementação atual segue (a).

**Decide:** Felix.

**4. Pendências menores.** O backtest não exercita as séries de branco/nulo — a
fixture de 2022 não traz essas grandezas e nenhum valor foi inventado (roda com
array vazio, e isso está dito em `docs/BACKTEST-RESULTS.md`). E o número de
réplicas do bootstrap (400) ficou como constante local em `transitions.ts`: não é
parâmetro de modelo, mas afeta o erro de Monte Carlo da largura da banda —
candidata a migrar para `constants.ts` se virar objeto de ajuste.

---

## Q-11 — Os números da Palver só existem como imagem, e o registro dela não está na nossa varredura do PesqEle

**Contexto (T-26).** Segui a receita da Q-09 — capturar a fonte real ANTES de
escrever parser — e ela encerrou duas dúvidas e abriu duas decisões.

**O que ficou resolvido.** A Palver publica **pesquisa de intenção de voto
registrada no TSE** (`BR-06596/2026`, divulgação 2026-08-10, campo 03–07/08/2026,
n=5.000, IC 95%, ± 3 p.p.), e **não** análise de menções. Isso foi verificado na
metodologia declarada pela própria Palver, não em imprensa: survey online com
questionário estruturado, amostra não-probabilística recrutada por anúncios em
redes sociais, formulário de link único, calibração por *raking* (IPF) no `survey`
do R ancorada em PNADc 2024 e no 2º turno de 2022. A empresa TAMBÉM opera uma
plataforma de escuta social que monitora menções (inclusive em apps de mensagem) —
esse produto nunca pode entrar no agregado, e o adapter só toca a pesquisa.

### Decisão 1 — como (e se) obter os percentuais

O relatório da onda (93 páginas, fonte de nível 2, `www.palver.com.br`) tem os
resultados **RASTERIZADOS**. A camada de texto do PDF traz moldura de página,
sumário, divisórias de seção, o registro TSE e a prosa de metodologia; as 74
páginas de resultado devolvem `RESULTADOS` + número da página + banner, e nada
mais. O repositório aberto `palverdata/pesquisa-palver` versiona a
*especificação* da onda (config, questionário, margens) e `.gitignore`a os
resultados de propósito. Ou seja: **não existe saída legível por máquina na fonte
primária.** O `parse` do adapter LANÇA com diagnóstico explícito, que é o
comportamento certo por R4.

Opções: (a) **esperar os microdados**, que a Palver se compromete a publicar depois
do 2º turno — é a única via que não exige nem OCR nem nível 4, e o
`palver.live.spec.ts` já é o canário que avisa quando a estrutura mudar;
(b) introduzir **OCR** no pipeline — não está proibido pelo nome, mas é vizinho do
"sem headless browser na v1" e, pior, transforma incerteza de reconhecimento em
número de pesquisa, o que colide de frente com R4; (c) tratar a Palver como fonte
de **nível 4** (imprensa), que docs/04 §1 admite só com aprovação explícita e
registro aqui.

**Recomendação:** (a). A fonte é uma referência de transparência metodológica e
vale esperar o dado dela em forma auditável, em vez de reconstruí-lo por OCR ou
copiar de terceiro. (b) é a que eu recusaria: OCR de gráfico é exatamente onde um
zero silencioso nasce.

### Decisão 2 — a varredura do PesqEle pode estar cega além de 50 registros

`BR-06596/2026` **não está** na janela de 30 dias do PesqEle. Sonda ao vivo em
2026-08-17 com o `PesqEleClient` (só listagem): 50 registros nacionais, e a
sequência 06596 cai no vão entre `BR-06267/2026` e `BR-06773/2026` — ausência de
verdade, não erro de paginação. Por docs/08 §1 a pesquisa não entra no agregado, e
o adapter fica corretamente sem uso.

Só que o total voltou **exatamente 50**, o mesmo número da Q-09 — e "exatamente
redondo" é suspeito. Se o PesqEle limita a listagem a 50, tudo além disso é
invisível para nós e o `DiscoveryJob` **perde registro sem alertar**: sucesso
silencioso, a mesma classe de bug da Q-09, um nível acima. Hoje o cliente só
alerta em `empty_search` (zero resultado), não em "total suspeito de estar
truncado".

Opções: (a) conferir o `totalRecords` que o paginador do PesqEle declara contra as
linhas efetivamente colhidas e **alertar** quando o total for igual a um limite
redondo; (b) usar `/app/pesquisa/listar.xhtml` (busca com período livre) em janelas
mais estreitas, fatiando por data até nenhuma fatia bater no limite; (c) verificar
se o TSE publica os registros em dados abertos, contornando o JSF — a Q-09 já
levanta essa hipótese para outro fim.

**Recomendação:** (a) já, porque é barato e transforma o silêncio em alerta; (b) se
(a) confirmar o truncamento. Enquanto não se souber, o número de pesquisas "no
radar" que o site publica é um piso, não um total.

**Decide:** Felix. Dono da implementação de (a)/(b): quem cuida de
`packages/adapters/pesqele/**` (T-15), não T-26.

### RESULTADO (T-28, 2026-08-17) — a suspeita estava certa: o teto é 50 e era real

A desconfiança da Decisão 2 se confirmou, e o pior cenário era o verdadeiro. Fiz
(a) **e** (b) — (a) sozinho teria transformado o silêncio em alerta, mas nos
deixaria vendo 50 de 131.

**Medido ao vivo, eleição 2026 / BRASIL, por data de registro:**

| consulta | "Total de registros" |
|---|---|
| `listar30dias.xhtml` (o que o job usava) | **50** |
| `listar.xhtml`, 01/01/2026–31/12/2026 | **50** |
| `listar.xhtml`, 19/07/2026–17/08/2026 (a janela de 30 dias) | **50** |
| `listar.xhtml`, 10/08/2026–12/08/2026 | 13 |
| **as dez fatias de 3 dias da janela de 30 dias, somadas** | **131** |

Ou seja: a varredura via **50 de 131 registros — 62% de perda, sem um único
alerta**. E o teto não era dedução nossa: a tela `listar.xhtml` **declara** "O
resultado da consulta está limitado a 50 registros. Utilize os filtros para
pesquisar." A tela de 30 dias aplica o mesmo corte **sem dizer nada** — é por isso
que o adapter migrou de tela.

**O que foi implementado** (detalhe em `tasks/T-28-pesqele-teto-50.md`): varredura
da janela de 30 dias em fatias de 3 dias por `listar.xhtml`, união por `tse_id`
(upsert idempotente), subdivisão automática de qualquer fatia que volte no teto e
`DiscoveryAlert` de `truncation_suspected` quando nem a fatia de um dia escapa —
mais `limit_mismatch` se o teto declarado mudar ou o aviso sumir. Custo: ~21
requisições (~3,5 min) por ciclo em vez de ~6 (~1 min).

**Dois achados de brinde, ambos da mesma família de silêncio:**

1. A tabela de `listar.xhtml` tem a coluna **"Eleição" onde a de 30 dias tem
   "Cargos"**. O parse posicional fixo faria o nome do instituto virar "Eleições
   Gerais 2026" sem erro nenhum. O mapa de colunas passou a vir do cabeçalho.
2. A DataTable do PrimeFaces **guarda a página corrente entre buscas**: depois de
   paginar, a busca seguinte volta em `page:1`. O laço antigo (`for pagina = 1`)
   pularia a página 0 calado. Está congelado na fixture
   `11-busca-periodo-no-teto-partial-response.xml`.

**O que continua aberto, e é decisão sua:** se algum dia UM DIA inteiro estourar o
teto (perto do pleito é plausível), não há mais como estreitar por data. As saídas
seriam varrer por `formPesquisa:empresas_input` (o formulário tem filtro por
empresa) — são **2.254 empresas no `<select>`, mais de 6 horas por ciclo a 1
req/10s, inviável como regime** — ou insistir na hipótese (c), dados abertos do
TSE, que resolveria Q-09 e Q-11 de uma vez. Até lá, o alerta
`truncation_suspected` é o que garante que a perda seja VISTA em vez de suposta.

**Sobre `BR-06596/2026`, o registro da Palver que motivou esta questão: era o teto,
sim, e a varredura fatiada o RECUPEROU.** Execução ao vivo em 2026-08-17 com o
conserto: `seen=131`, e o `BR-06596/2026` está entre eles — instituto "PALVER
CONSULTORIA E DESENVOLVIMENTO TECNOLOGICO LTDA. / PALVER", registro em 04/08/2026,
campo de 03/08 a **09/08**/2026 (a Q-11 dizia 03–07/08 a partir do material da
própria Palver; o registro do TSE diz 09/08), n = 5.000. Ele estava na janela de 30
dias o tempo todo — só não estava nos 50 que o servidor devolvia. A hipótese de
"fora da janela" está descartada, e o valor da correção fica medido: **131 contra 50,
com o registro concreto que faltava de volta**.

---

## Q-12 — O Ipec está atrás de um desafio Cloudflare: sem headless não há colheita live

> Numeração: escrita em 2026-08-17 por T-23 (adapter Ipec), com sete agentes em
> paralelo. Se outra task tomou `Q-12` no mesmo ciclo, renumerar — o conteúdo é
> independente.

**Contexto (T-23).** O adapter do Ipec foi escrito na ordem que a Q-09 pediu:
investigar a fonte primeiro, congelar captura real, parser depois. A investigação
achou coisas boas e uma parede.

O bom: o Ipec publica release eleitoral em PDF em
`ipec-inteligencia.com.br/Repository/Files/<id>/…`, indexado por uma API JSON
(`/api/arquivo/ListAtivos/`), e **o release traz o número de registro no TSE**
("registrada no Tribunal Superior Eleitoral sob o protocolo Nº BR-01979/2022").
O V6 é viável e o parser funciona: extrai 1º turno espontâneo e 2º turno, por
candidato, de duas capturas reais.

A parede: **o host inteiro responde 403 com `Cf-Mitigated: challenge`** — site,
`/robots.txt` e API. É desafio gerenciado do Cloudflare, que só passa executando
JavaScript. A v1 não usa headless browser (`CLAUDE.md` "o que não fazer";
docs/04 §6). Não é bloqueio ao nosso User-Agent: a única captura de 2026 do
Internet Archive para o domínio também é 403 — o rastreador do archive.org
tampouco entra. Verificado ao vivo em `ipec/ipec.live.spec.ts` (opt-in
`IPEC_LIVE=1`), que é um CANÁRIO: no dia em que o acesso liberar, ele falha e
avisa.

Consequência: o `parse` está pronto e testado, mas o `discover` aponta para URLs
que hoje devolvem 403. Pelo docs/04 §6, duas respostas 403 desabilitam a fonte e
geram alerta — que é o comportamento correto. **Na prática, o Ipec não entra no
agregado pela via automática.**

**Opções.** (a) Aceitar e mover o Ipec para v1.1, com o adapter no repo pronto
para o dia em que o bloqueio cair (o canário avisa) — o `parse` continua útil já,
via `ingest:reparse`, para qualquer release do Ipec que chegue ao blob por outro
caminho. (b) Abrir exceção de headless browser SÓ para resolver o desafio e obter
o PDF, mantendo todo o resto da etiqueta — muda uma regra do `CLAUDE.md` e é
decisão de projeto, não de implementação. (c) Ingestão manual assistida: um
operador baixa o release e o joga no blob; o `parse` versionado faz o resto, com
proveniência registrada. (d) Pedir ao Ipec um caminho de acesso (feed, allowlist
de User-Agent) — é o que docs/08 §3 já pressupõe como postura, e o instituto tem
interesse em ser citado corretamente.

**Recomendação (minha, T-23):** (a) + (d). (a) porque é honesto e não custa nada:
o trabalho está feito e o canário monitora. (d) porque é a única saída que
respeita a etiqueta e resolve de verdade. (b) é o caminho que eu NÃO recomendo:
resolver desafio de bot é exatamente o oposto de "um crawler educado é um crawler
que sobrevive" (docs/08 §3), e abriria precedente para todas as fontes.

**Nota menor, mas de contrato.** O release do Ipec publica uma linha `Outros` nas
tabelas de intenção de voto (agregado dos candidatos que não são listados
individualmente). O `ParsedPoll` (docs/04 §4) não tem campo para isso: só
`values`, `blankNullPct` e `undecidedPct`. O parser do Ipec EXCLUI `Outros`, de
forma declarada e comentada — se entrasse como candidato, toda pesquisa do Ipec
cairia em quarentena; se virasse brancos/nulos, seria inventar semântica. Vale
0% nas duas capturas, e a janela do V1 (97–103) absorve quando não valer. Se
outra fonte publicar `Outros` com peso relevante, aí é preciso um campo no
contrato — não mexi em `packages/contracts` (congelado).

**Decide:** Felix — (a)/(b)/(c)/(d), e se `Outros` merece campo no contrato.

---

## Q-13 — O `cnt-mda` tem a doença da Q-09 e mais uma: ordem de fluxo em PDF

**Contexto.** O adapter do Real Time Big Data (T-25) descobriu, contra PDFs REAIS,
que **a ordem do fluxo de texto de um PDF de deck não corresponde à posição na
página**. Em `BR-06833/2026` a extração por fluxo emite `51%` e depois `37%`, mas o
`37%` está em x=511,3 (do lado do PRIMEIRO nome) e o `51%` em x=745,1. Extrair por
fluxo TROCA os dois finalistas do 2º turno.

Por que isso é do pior tipo de bug: a soma continua 100, V1–V7 todas passam, e o
sinal do erro muda de documento para documento (num estado lidera o finalista da
esquerda, noutro o da direita), então nem um viés constante que alguém notasse no
gráfico. É número errado, atribuído ao candidato errado, com registro TSE correto e
todos os gates verdes.

**A dívida no `cnt-mda`.** Duas coisas verificadas hoje:

1. `packages/adapters/cnt-mda/pdf.ts` extrai com
   `extractText(pdf, { mergePages: true })` — **ordem de fluxo, zero coordenada**.
   Está exposto exatamente à troca descrita acima.
2. `packages/adapters/cnt-mda/__fixtures__/` contém APENAS `make-pdf.ts` (gerador
   SINTÉTICO) e um README. **Não existe uma única captura real de PDF da CNT/MDA.**
   É a Q-09 outra vez: os testes provam que o parser lê a fixture que o próprio
   autor inventou, não que ele lê a CNT/MDA.

Ou seja: não sabemos se o `cnt-mda` traz número certo. Ele está LIGADO no
`AdapterRegistry` desde T-06. Hoje não há exposição real (a CNT/MDA não tem
registro presidencial na janela corrente), mas isso é sorte, não desenho.

**O que já existe de solução.** T-25 escreveu `packages/adapters/realtime/pdf-layout.ts`:
extração POSICIONADA (dedupe da camada duplicada, faixas por baseline, junção de
palavras por vão medido, pareamento por `x`), com duas fixtures em direções opostas
travando o comportamento. É a ferramenta certa e está no diretório errado — deveria
morar em `base/` e servir todo adapter de PDF.

**Opções.** (a) Promover `pdf-layout.ts` para `base/`, migrar o `cnt-mda` para ele
e capturar um PDF real da CNT/MDA como fixture antes de confiar em qualquer número
— a ordem que a Q-09 ensinou. (b) Manter o `cnt-mda` como está e DESLIGÁ-LO do
registry até haver captura real, para não publicar número que não sabemos ler.
(c) Deixar como está e aceitar o risco.

**Recomendação:** (a), e (b) no intervalo. (c) não é defensável: o projeto existe
para não publicar número errado, e este é um caminho conhecido para publicar número
errado com todos os gates verdes.

**Decide:** Felix. Vale notar que (a) é trabalho de meio dia e elimina a classe
inteira para os adapters de PDF que vierem.

---

## Q-14 — O modelo agrupava 1º turno ESPONTÂNEO com ESTIMULADO (desvio de docs/01 §3)

**Como apareceu.** Na primeira vez que dado real de 1º turno **espontâneo** chegou
ao modelo (rodadas do Real Time Big Data, 2026-08-17), `runModel` LANÇOU:

```
sum constraint violated at 2026-08-01: tracked μ sum 73.61 vs target 100.00
(deviation 26.39 p.p. > 3); likely ingestion error (docs/01 §4.3)
```

A restrição de soma fez o trabalho dela. Mas a causa não era erro de ingestão: era
o modelo somando peras com maçãs.

**O desvio.** `packages/model/index.ts` filtrava o 1º turno como
`t1Estimulado || t1Espontaneo` em três lugares (partição, série corrigida e
`isFirstRoundKind` para o eleitorado). Ou seja, punha as duas medidas na MESMA série
latente.

São medidas diferentes por construção. Na rodada `BR-06833/2026`, medida pelo mesmo
instituto no mesmo campo:

| cenário | candidatos | branco/nulo | não-sabe |
|---|---|---|---|
| espontâneo (pergunta aberta) | **51** | 12 | 37 |
| estimulado (lista de nomes) | **93** | 4 | 3 |

Agrupar as duas produz uma série latente que não mede nada: o mesmo candidato
aparece com dois valores incomparáveis no mesmo dia, e a soma dos rastreados fica
onde caiu a mistura — daí 73,61.

**Por que isto NÃO é uma questão de metodologia, e sim conformidade.** `docs/01` §3
diz, na primeira linha: *"Uma pesquisa publica múltiplos cenários **estimulados**.
Precisamos de uma regra determinística, senão comparamos coisas diferentes."* Toda a
regra de canônico de 1º turno é escrita sobre cenário estimulado. A metodologia
nunca previu espontâneo alimentando `μ_t` — o código é que divergiu do documento, e
pela hierarquia do CLAUDE.md o documento vence. Não houve escolha metodológica minha
aqui, e nenhum prior foi tocado (R1).

**Correção aplicada.** O 1º turno do modelo passa a ser SÓ `t1_estimulado`, nos três
pontos. O espontâneo continua sendo colhido, validado e PERSISTIDO (`poll_scenarios`
guarda os dois) — ele só não entra na série latente. É dado bom para diagnóstico
(quanto do eleitorado não cita nome sem ajuda é informação real), e há lugar para
isso quando alguém quiser exibi-lo.

**Verificação de que não mexeu no que já existia:** o teste de isolamento de
`packages/model/__tests__/isolation.spec.ts` compara `μ_t` e house effects BIT A BIT
contra um baseline congelado. Ele continua passando — a fixture de 2022 só tem
cenário estimulado, então a saída para dado pré-existente é idêntica. Por isso NÃO
houve incremento de `MODEL_VERSION`: não há mudança de comportamento sobre entrada
válida, e sim recusa de uma entrada que nunca deveria ter sido misturada.

**Decide:** nada pendente na correção. O que sobra para o Felix é de produto: **onde
exibir a série espontânea**, que hoje é colhida e não aparece em lugar nenhum. É a
medida mais honesta de "quanto do eleitorado ainda não tem candidato" — mais do que
o não-sabe da estimulada, porque na estimulada a lista já ancora a resposta.
