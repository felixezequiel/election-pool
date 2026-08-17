import { z } from 'zod';

/**
 * Enums do modelo de dados. Fonte única espelhada pelos CHECK das migrations
 * (docs/03 §3). Cada const object existe para uso em valor; cada Zod enum para
 * validação de fronteira. O tipo é sempre derivado do schema via `z.infer`.
 */

// docs/03 §2.1 — institutes.primary_method
export const PRIMARY_METHOD = {
  presencial: 'presencial',
  telefone: 'telefone',
  painelOnline: 'painel_online',
  misto: 'misto',
} as const;

export const primaryMethodSchema = z.enum([
  PRIMARY_METHOD.presencial,
  PRIMARY_METHOD.telefone,
  PRIMARY_METHOD.painelOnline,
  PRIMARY_METHOD.misto,
]);
export type PrimaryMethod = z.infer<typeof primaryMethodSchema>;

// docs/03 §2.3 — poll_registrations.contractor_type
export const CONTRACTOR_TYPE = {
  proprio: 'proprio',
  veiculo: 'veiculo',
  instituicaoFinanceira: 'instituicao_financeira',
  partido: 'partido',
  campanha: 'campanha',
  entidade: 'entidade',
  outro: 'outro',
  desconhecido: 'desconhecido',
} as const;

export const contractorTypeSchema = z.enum([
  CONTRACTOR_TYPE.proprio,
  CONTRACTOR_TYPE.veiculo,
  CONTRACTOR_TYPE.instituicaoFinanceira,
  CONTRACTOR_TYPE.partido,
  CONTRACTOR_TYPE.campanha,
  CONTRACTOR_TYPE.entidade,
  CONTRACTOR_TYPE.outro,
  CONTRACTOR_TYPE.desconhecido,
]);
export type ContractorType = z.infer<typeof contractorTypeSchema>;

// docs/03 §2.3 — poll_registrations.disclosure_status
export const DISCLOSURE_STATUS = {
  pending: 'pending',
  disclosed: 'disclosed',
  presumedUndisclosed: 'presumed_undisclosed',
} as const;

export const disclosureStatusSchema = z.enum([
  DISCLOSURE_STATUS.pending,
  DISCLOSURE_STATUS.disclosed,
  DISCLOSURE_STATUS.presumedUndisclosed,
]);
export type DisclosureStatus = z.infer<typeof disclosureStatusSchema>;

// docs/03 §2.4 — poll_scenarios.kind
export const SCENARIO_KIND = {
  t1Estimulado: 't1_estimulado',
  t1Espontaneo: 't1_espontaneo',
  t2: 't2',
} as const;

export const scenarioKindSchema = z.enum([
  SCENARIO_KIND.t1Estimulado,
  SCENARIO_KIND.t1Espontaneo,
  SCENARIO_KIND.t2,
]);
export type ScenarioKind = z.infer<typeof scenarioKindSchema>;

// docs/03 §2.1 — races.status
export const RACE_STATUS = {
  ativo: 'ativo',
  planejado: 'planejado',
  encerrado: 'encerrado',
} as const;

export const raceStatusSchema = z.enum([
  RACE_STATUS.ativo,
  RACE_STATUS.planejado,
  RACE_STATUS.encerrado,
]);
export type RaceStatus = z.infer<typeof raceStatusSchema>;

// docs/03 §2.5 — model_diagnostics.kind
export const DIAGNOSTIC_KIND = {
  gaveta: 'gaveta',
  herding: 'herding',
  divergencia: 'divergencia',
} as const;

export const diagnosticKindSchema = z.enum([
  DIAGNOSTIC_KIND.gaveta,
  DIAGNOSTIC_KIND.herding,
  DIAGNOSTIC_KIND.divergencia,
]);
export type DiagnosticKind = z.infer<typeof diagnosticKindSchema>;

// docs/02 §5 — job_runs.status (observabilidade). Adição de T-14 (orquestração):
// nenhum outro contrato existente depende destes; espelhado pelo CHECK da
// migration 1700000000007_job_runs.
export const JOB_RUN_STATUS = ['running', 'ok', 'error'] as const;

export const jobRunStatusSchema = z.enum(JOB_RUN_STATUS);
export type JobRunStatus = z.infer<typeof jobRunStatusSchema>;

// docs/02 §3 — nome de cada job do pipeline. Usado no log estruturado, no
// `job_runs.job` e nas chaves do /health. Não tem CHECK no banco (texto livre por
// design: um job novo não deve exigir migration), mas o valor sempre vem daqui.
export const JOB_NAME = {
  discovery: 'discovery',
  harvest: 'harvest',
  model: 'model',
  render: 'render',
  reparse: 'reparse',
  // Fotos oficiais de candidatura no TSE. Entra aqui — e não só como CLI — para
  // que o job apareça em `job_runs` e no /health como qualquer outro: um job que
  // falha calado é a classe de bug que já custou uma task inteira neste projeto.
  candidatePhotos: 'candidate_photos',
} as const;

export const jobNameSchema = z.enum([
  JOB_NAME.discovery,
  JOB_NAME.harvest,
  JOB_NAME.model,
  JOB_NAME.render,
  JOB_NAME.reparse,
  JOB_NAME.candidatePhotos,
]);
export type JobName = z.infer<typeof jobNameSchema>;
