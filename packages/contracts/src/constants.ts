/**
 * Todo número mágico do projeto vive aqui, com citação da seção que o justifica
 * (CLAUDE.md "Definition of done"; docs/07 §5.1). Fora deste arquivo, apenas os
 * literais `0` e `1` são permitidos. Nenhum import de runtime além disto —
 * `packages/contracts` só depende de `zod`.
 */

// === Versão do modelo =======================================================

// docs/01 (cabeçalho): MODEL_VERSION. Muda com R1 do CLAUDE.md — o incremento
// exige justificativa ESCRITA ANTES de ver a nova saída.
// Pré-produção: o projeto NUNCA foi ao ar, então a versão vive em 0.x (semver:
// 0.x = sem promessa de estabilidade pública). O "2.0.0" anterior era um número
// aspiracional, não uma release. Esta renumeração NÃO altera a saída do modelo,
// só o rótulo. 0.0.4 (docs/OPEN-QUESTIONS.md Q-10): branco/nulo e não-sabe viram
// séries rastreadas e o modelo ganha estimativa de transferência entre estados. A
// justificativa e as sete condições que a implementação deve respeitar estão na
// Q-10, escrita antes desta linha existir.
// 0.0.5 (docs/OPEN-QUESTIONS.md Q-07 / docs/01 §4.5): o modelo ganha um estado
// latente de VIÉS COMUM `b_t` — um deslocamento de nível compartilhado por TODOS os
// institutos que o soma-zero (§1.1) não corrige. Sua variância (SIGMA_COMMON_BIAS²)
// PROPAGA para a banda sem ser lavada pela média, porque é correlacionada, não ruído
// por pesquisa. `μ_t`/`h_i` saem idênticos; só a banda alarga. Justificativa e
// critério do número escritos ANTES de rodar o backtest (R1).
export const MODEL_VERSION = '0.0.5';

// === Série latente / processo (docs/01 §2) ==================================

// docs/01 §2: passeio aleatório gaussiano, σ_process = 0.25 p.p./dia.
// Prior, não ajustado aos dados.
export const SIGMA_PROCESS = 0.25;

// docs/01 §2/§4 e docs/07 M-4: bandas de credibilidade reportadas em 90% (IC 90%).
// CI_Z_90 é o quantil normal-padrão bicaudal a 90% — z tal que P(-z<X<z)=0,90,
// i.e. o quantil da normal-padrão em p=0,95. Valor: 1.6448536269514722.
// Não é parâmetro de modelo nem correção direcional: é a escala fixa que converte
// desvio-padrão a semilargura de IC 90%. Adicionado por T-03 (ver docs/OPEN-QUESTIONS
// Q-04) porque nenhuma constante existente expressava o nível de credibilidade.
export const CI_Z_90 = 1.6448536269514722;

// === Erro amostral e variância (docs/01 §4.2) ===============================

// docs/01 §4.2: design effect deff = 1.5 (inflação típica de amostragem por
// cotas com estratificação). Prior fixo.
export const DEFF = 1.5;

// docs/01 §4.2: σ_house_extra = 1.0 p.p. — variância residual IDIOSSINCRÁTICA por
// pesquisa, não capturada por h_i. É ruído INDEPENDENTE (legitimamente lavado pela
// média); o viés COMUM a todos os institutos NÃO mora aqui — mora em
// SIGMA_COMMON_BIAS (docs/01 §4.5). Fica em 1.0 de propósito: inflá-lo para simular
// viés comum seria usar um termo independente para um efeito correlacionado (errado).
export const SIGMA_HOUSE_EXTRA = 1.0;

// docs/01 §4.5 (MODEL_VERSION 0.0.5, Q-07): σ_common = 3.0 p.p. — desvio-padrão do
// estado latente de VIÉS COMUM b_t, o deslocamento de nível compartilhado por TODOS
// os institutos que o soma-zero (§1.1) não corrige. Prior fixo, calibrado por
// PRINCÍPIO: a semilargura IC90 vinda só deste termo, CI_Z_90 · 3.0 ≈ 4.9 p.p., cobre
// o erro real de nível do 1º turno (~3–5 p.p.; 2022 R1 subestimou o vice ~5 p.p.).
// Escolhido o TOPO da faixa (o gate existe para o pior caso de viés comum). Por ser
// correlacionado, propaga para a banda sem ser lavado pela média (docs/01 §4.5). NÃO é
// direcional por candidato (R2): é simétrico e não sabe o lado do erro. Origem do
// número e critério escritos ANTES de rodar (R1): docs/OPEN-QUESTIONS.md Q-07.
export const SIGMA_COMMON_BIAS = 3.0;

// === Ponderação por recência (docs/01 §4.4) =================================

// docs/01 §4.4: w_recency = exp(-Δdias / τ), τ = 14 dias. Prior.
export const TAU_RECENCY_DAYS = 14;

// docs/01 §4.4: observações com Δdias > 45 saem da janela ativa.
export const ACTIVE_WINDOW_DAYS = 45;

// === House effect (docs/01 §5) ==============================================

// docs/01 §5: prior h_i ~ N(0, 2.0²) p.p. (regularização fraca em direção a zero).
export const HOUSE_EFFECT_PRIOR_SD = 2.0;

// docs/01 §5: instituto com menos de 3 pesquisas no ciclo recebe h_i = 0 fixo e
// é marcado house_effect_estimable = false.
export const MIN_POLLS_FOR_HOUSE_EFFECT = 3;

// docs/01 §6.3: divergência persistente — |h_i| acima deste limiar (com IC 90%
// que não cruza zero) marca o instituto como divergente.
export const DIVERGENCE_ABS_PP_THRESHOLD = 3;

// === Herding (docs/01 §6.2) =================================================

// docs/01 §6.2: ratio = s²_observado / s²_esperado; ratio < 0.5 é sinalizado.
export const HERDING_RATIO_THRESHOLD = 0.5;

// docs/01 §6.2: janela de herding é de 7 dias com ≥ 4 pesquisas do mesmo cenário.
export const HERDING_WINDOW_DAYS = 7;
export const HERDING_MIN_POLLS = 4;

// === Engavetamento / gaveta (docs/01 §6.1) ==================================

// docs/01 §6.1: só conta pesquisas cuja janela de divulgação passou —
// registro + 5 dias + carência de 15 dias.
export const DISCLOSURE_REGISTER_LEAD_DAYS = 5;
export const DISCLOSURE_GRACE_DAYS = 15;

// === Restrição de soma (docs/01 §4.3 / docs/07 M-2) =========================

// docs/01 §4.3: soma dos rastreados + resíduo deve fechar 100; desvio
// pré-normalização acima de 3 p.p. lança e bloqueia publicação.
export const SUM_DEVIATION_MAX_PP = 3;

// docs/07 M-2: Σ μ_t dos rastreados + resíduo deve estar em [97, 103] antes da
// normalização. (Também é o intervalo de V1, docs/04 §5.)
export const SUM_TOTAL_MIN = 97;
export const SUM_TOTAL_MAX = 103;

// === Cobertura mínima do modelo (docs/07 M-1) ===============================

// docs/07 M-1: ≥ 3 pesquisas de ≥ 2 institutos distintos na janela de 45 dias.
export const MODEL_MIN_POLLS = 3;
export const MODEL_MIN_DISTINCT_INSTITUTES = 2;

// === Continuidade e banda (docs/07 M-3, M-4) ================================

// docs/07 M-3: nenhum μ_t move mais que 5 p.p. entre dois runs consecutivos.
export const CONTINUITY_MAX_MOVE_PP = 5;

// docs/07 M-4: largura do IC 90% deve estar em [1.5, 15] p.p.
export const BAND_WIDTH_MIN_PP = 1.5;
export const BAND_WIDTH_MAX_PP = 15;

// === Gates de ingestão V1–V7 (docs/04 §5) ===================================

// V1: soma de candidatos + brancos/nulos + indecisos ∈ [97, 103]. (mesmos
// SUM_TOTAL_MIN/MAX acima — repetidos aqui como nome do gate para clareza.)
export const V1_SUM_MIN = SUM_TOTAL_MIN;
export const V1_SUM_MAX = SUM_TOTAL_MAX;

// V2: nenhum candidato acima de 70%.
export const V2_MAX_CANDIDATE_PCT = 70;

// V3: cenário de 2º turno tem exatamente 2 candidatos.
export const V3_RUNOFF_CANDIDATE_COUNT = 2;

// V4: delta vs. rodada anterior do mesmo instituto, por candidato, ≤ 10 p.p.
export const V4_MAX_DELTA_SAME_INSTITUTE_PP = 10;

// V5: delta vs. μ_t corrente, por candidato, ≤ 15 p.p.
export const V5_MAX_DELTA_VS_LATENT_PP = 15;

// V6: tse_id extraído bate com o do registro (exato) — sem literal numérico.

// V7: nº de candidatos no cenário canônico ∈ [2, 20].
export const V7_MIN_CANDIDATES = 2;
export const V7_MAX_CANDIDATES = 20;

// === Cadência do pipeline (docs/02 §3 / docs/03 §5) =========================

// docs/03 §5 e docs/02 §3.1: cron a cada 2h ⇒ updateIntervalMinutes = 120.
export const UPDATE_INTERVAL_MINUTES = 120;

// === Publicação / cache (docs/03 §5) ========================================

// docs/03 §5: /data.json servido com Cache-Control public, max-age=300.
export const DATA_JSON_MAX_AGE_SECONDS = 300;

// === Backtest 2022 (docs/07 §4) — resultados oficiais =======================
// Constantes de referência do gate; usadas pela fixture/asserção do backtest.
export const BACKTEST_2022_R1_LULA_VALID_PCT = 48.4;
export const BACKTEST_2022_R1_BOLSONARO_VALID_PCT = 43.2;
export const BACKTEST_2022_R2_LULA_VALID_PCT = 50.9;
export const BACKTEST_2022_R2_BOLSONARO_VALID_PCT = 49.1;

// === Escala de percentual (CLAUDE.md convenções) ============================

// Escala 0–100, nunca 0–1.
export const PCT_MIN = 0;
export const PCT_MAX = 100;

// === Cadastro / formato (docs/03 §2.1, §2.3; docs/05 §2.1) ==================

// docs/05 §2.1 / docs/03 §2.1: color_slot 1..8.
export const COLOR_SLOT_MIN = 1;
export const COLOR_SLOT_MAX = 8;

// docs/03 §2.3: tse_id no formato BR-06591/2026 — sequência de 5 dígitos.
export const TSE_ID_SEQUENCE_DIGITS = 5;

// docs/03 §5: schemaVersion literal do contrato público.
// Sobe para '2' junto do MODEL_VERSION 0.0.4 (Q-10): o data.json ganhou
// `latent.electorate`, `transitions`, `polls[].blankNullPct`/`undecidedPct` e
// `candidates[].photoPath`/`photoSourceUrl`. São adições, mas o schemaVersion
// existe justamente para um consumidor externo saber que a forma mudou.
export const PUBLIC_DATA_SCHEMA_VERSION = '2';

// docs/03 §5 / docs/01 §7: histórico exibido cobre 1º e 2º turno.
export const ROUND_FIRST = 1;
export const ROUND_SECOND = 2;

// === Modelo de transferência de votos (MODEL_VERSION 0.0.4, Q-10) ============

// Peso do prior de PERMANÊNCIA na estimativa de transferência. Fluxo não é
// identificável a partir de agregado (Q-10): com K estados há K² incógnitas por
// passo e K equações marginais. O sistema só fecha com regularização, e a
// regularização escolhida é a hipótese mais fraca defensável — "na ausência de
// evidência, o eleitor permanece onde estava". Quanto maior, mais o resultado é
// o prior e menos é o dado; publicamos o número no data.json (`transitions.prior`)
// para que essa dependência fique visível, nunca implícita.
export const TRANSITION_STICKINESS_PRIOR = 0.85;

// Um fluxo cuja banda de 90% cruza zero é publicado como `notIdentifiable`
// (Q-10 condição 3). Este é o piso, em p.p. do eleitorado, abaixo do qual nem
// vale desenhar a seta — ruído de arredondamento das próprias pesquisas.
export const TRANSITION_MIN_VISIBLE_PP = 0.5;

// Passos mínimos de série latente para tentar estimar transferência. Com menos
// que isto não há movimento a decompor e o resultado seria o prior puro.
export const TRANSITION_MIN_STEPS = 3;
