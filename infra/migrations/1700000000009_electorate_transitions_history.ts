import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';
import { transitionStateKindSchema } from '@election-pool/contracts/model-io';

/**
 * Camada computed da MODEL_VERSION 2.0.0 (docs/OPEN-QUESTIONS.md Q-10) + índices
 * de histórico.
 *
 * Duas coisas novas precisam de lugar no banco, e nenhuma cabe nas tabelas que já
 * existem:
 *
 *  1. `model_electorate_estimates` — branco/nulo e não-sabe viraram séries
 *     rastreadas. Não cabem em `model_estimates` porque aquela tabela tem
 *     `candidate_id` com FK para `candidates`, e branco/nulo NÃO é candidato.
 *     Inventar uma linha falsa em `candidates` para acomodá-los seria corromper a
 *     tabela de referência — cada grandeza fica na sua tabela, com seu significado.
 *  2. `model_transitions` — os fluxos estimados entre estados. Guardamos a BANDA e
 *     o veredito `not_identifiable` junto de cada fluxo porque a Q-10 condição 3
 *     exige que a incerteza viaje colada ao número: uma tabela que guardasse só a
 *     média permitiria, mais tarde, alguém publicar a seta sem a dúvida.
 *
 * Ambas seguem a regra da camada computed (R5): são REGENERÁVEIS a partir do raw,
 * versionadas por `run_id`, e nunca são fonte de verdade.
 *
 * ── Índices de histórico ────────────────────────────────────────────────────
 * Nada neste sistema apaga nada: `poll_results` é append-only por trigger,
 * `poll_registrations` marca `source_expired_at` em vez de deletar, e cada rodada
 * do modelo grava um `model_runs` completo. Ou seja, o histórico da eleição — o
 * que o modelo acreditava a cada 2 horas — JÁ está sendo acumulado desde o
 * primeiro run. O que faltava era poder consultá-lo sem varrer a tabela inteira:
 * as chaves primárias existentes começam por `run_id`, ótimas para "o último run"
 * e péssimas para "a evolução deste candidato ao longo dos runs", que é exatamente
 * a pergunta de uma futura tela de histórico. Os índices abaixo existem para essa
 * pergunta.
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

const inList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(',');

/**
 * Os estados do eleitorado que NÃO são candidato. Derivado do enum Zod por
 * exclusão, em vez de escrito à mão, para que acrescentar um estado novo ao
 * contrato (ex.: "voto nulo" separado de "branco") apareça aqui sozinho. A
 * tabela `model_electorate_estimates` guarda só estas grandezas: 'candidate'
 * seria um valor sem sentido nela — cada candidato já tem sua linha em
 * `model_estimates`.
 */
const ELECTORATE_KINDS = transitionStateKindSchema.options.filter((kind) => kind !== 'candidate');

export function up(pgm: MigrationBuilder): void {
  // --- Séries de branco/nulo e não-sabe (Q-10) -------------------------------
  // `kind` distingue as duas grandezas; o CHECK é gerado do enum Zod para banco e
  // contrato não divergirem (mesmo padrão das outras migrations).
  pgm.createTable('model_electorate_estimates', {
    run_id: { type: 'uuid', notNull: true, references: 'model_runs(id)' },
    scenario_kind: { type: 'text', notNull: true },
    kind: {
      type: 'text',
      notNull: true,
      check: `kind IN (${inList(ELECTORATE_KINDS)})`,
    },
    date: { type: 'date', notNull: true },
    // Anuláveis de propósito: ponto sem medida é `null`, jamais 0 (R4). Um zero
    // aqui viraria "ninguém está indeciso", que é uma afirmação, não uma ausência.
    mean_pct: { type: 'numeric(5,2)' },
    lo90_pct: { type: 'numeric(5,2)' },
    hi90_pct: { type: 'numeric(5,2)' },
  });
  pgm.addConstraint('model_electorate_estimates', 'model_electorate_estimates_pkey', {
    primaryKey: ['run_id', 'scenario_kind', 'kind', 'date'],
  });

  // --- Transferência de votos (Q-10) ----------------------------------------
  pgm.createTable('model_transitions', {
    run_id: { type: 'uuid', notNull: true, references: 'model_runs(id)' },
    from_date: { type: 'date', notNull: true },
    to_date: { type: 'date', notNull: true },
    // Estados, não candidatos: podem ser um candidate_id, 'blank_null' ou
    // 'undecided'. Sem FK para `candidates` justamente por isso.
    from_state: { type: 'text', notNull: true },
    to_state: { type: 'text', notNull: true },
    // Fluxo em p.p. do eleitorado. numeric, nunca float (docs/03).
    pp: { type: 'numeric(5,2)', notNull: true },
    lo90_pp: { type: 'numeric(5,2)', notNull: true },
    hi90_pp: { type: 'numeric(5,2)', notNull: true },
    // Banda cruza zero ⇒ o fluxo não é distinguível de nada. NOT NULL: o veredito
    // é obrigatório, não um detalhe opcional (Q-10 condição 3).
    not_identifiable: { type: 'boolean', notNull: true },
  });
  pgm.addConstraint('model_transitions', 'model_transitions_pkey', {
    primaryKey: ['run_id', 'from_date', 'to_date', 'from_state', 'to_state'],
  });

  // --- Índices de histórico --------------------------------------------------
  // "Os runs desta corrida, do mais recente para o mais antigo" — a consulta que
  // tanto o provedor de μ_t corrente quanto uma tela de histórico fazem.
  pgm.createIndex('model_runs', ['race_id', { name: 'run_at', sort: 'DESC' }], {
    name: 'model_runs_race_run_at_idx',
  });
  // "A evolução deste candidato ao longo do tempo", atravessando runs.
  pgm.createIndex('model_estimates', ['candidate_id', 'date'], {
    name: 'model_estimates_candidate_date_idx',
  });
  // Idem para branco/nulo e não-sabe.
  pgm.createIndex('model_electorate_estimates', ['kind', 'date'], {
    name: 'model_electorate_kind_date_idx',
  });
  // "Todos os registros desta corrida por data de registro" — base da taxa de
  // engavetamento histórica e de qualquer recorte temporal de ingestão.
  pgm.createIndex('poll_registrations', ['race_id', 'registered_at'], {
    name: 'poll_registrations_race_registered_idx',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('poll_registrations', ['race_id', 'registered_at'], {
    name: 'poll_registrations_race_registered_idx',
  });
  pgm.dropIndex('model_electorate_estimates', ['kind', 'date'], {
    name: 'model_electorate_kind_date_idx',
  });
  pgm.dropIndex('model_estimates', ['candidate_id', 'date'], {
    name: 'model_estimates_candidate_date_idx',
  });
  pgm.dropIndex('model_runs', ['race_id', 'run_at'], {
    name: 'model_runs_race_run_at_idx',
  });
  pgm.dropTable('model_transitions');
  pgm.dropTable('model_electorate_estimates');
}
