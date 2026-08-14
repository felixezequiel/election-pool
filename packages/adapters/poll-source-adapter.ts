/**
 * Contrato do adapter de fonte (docs/04 §4). Definido aqui, no raiz de
 * `packages/adapters`, para ser reusado por T-06 (nexus, cnt-mda, ...). Os tipos
 * de I/O vêm dos contracts (`@election-pool/contracts/domain`) — não redeclaramos
 * forma de dado (CLAUDE.md: tipo derivado do schema, nunca paralelo).
 *
 * Semântica não-negociável:
 * - `discover` devolve URLs candidatas onde o resultado da rodada provavelmente
 *   está (nível 2+ da hierarquia de docs/04 §1). Não busca; só aponta.
 * - `parse` EXTRAI ou LANÇA `ParseError`. NUNCA retorna parcial (docs/04 §4).
 *   O `tse_id` extraído tem de bater com `reg.tseId` (V6) — senão lança, para
 *   não atribuir números da rodada errada (o pior bug do sistema).
 */

import type {
  ParsedPoll,
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';

export interface PollSourceAdapter {
  readonly id: string;
  readonly instituteId: string;

  canHandle(reg: PollRegistration): boolean;

  /** URLs candidatas onde o resultado desta rodada provavelmente está. */
  discover(reg: PollRegistration): Promise<SourceCandidate[]>;

  /** Extrai. Lança `ParseError` se não conseguir. NUNCA retorna parcial. */
  parse(raw: RawDocument, reg: PollRegistration): Promise<ParsedPoll>;
}

/** Erro de parsing: o documento não tem o que precisamos, ou está corrompido. */
export class ParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ParseError';
  }
}

/**
 * Alias de candidato não reconhecido. O registro vai para quarentena manual; o
 * adapter NUNCA cria candidato automaticamente (docs/04 §4.1).
 */
export class UnknownCandidateError extends Error {
  constructor(readonly alias: string) {
    super(`Alias de candidato desconhecido: "${alias}" (quarentena para revisão manual)`);
    this.name = 'UnknownCandidateError';
  }
}
