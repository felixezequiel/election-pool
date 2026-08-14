/**
 * Erro de validação bloqueante de ingestão (docs/04 §5). LANÇAR isto ⇒ nada é
 * persistido, o evento é logado em nível `error` e o adapter é marcado suspeito
 * (R4: falha alta, nunca silenciosa; validação bloqueia, nunca vira warning).
 *
 * Toda mensagem carrega, por contrato, o `tse_id`, a regra violada (`rule`), o
 * valor OBSERVADO (`observed`) e o LIMITE (`limit`) — é o que torna a falha
 * auditável. `subject` identifica o alvo (um
 * candidato, um cenário) quando a regra é por-item; fica de fora quando a regra
 * é do documento inteiro.
 */

export type ValidationRule = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7';

export interface ValidationErrorFields {
  readonly rule: ValidationRule;
  readonly tseId: string;
  /** Descrição do que foi observado (ex.: 'soma=96.90', 'lula=71.00'). */
  readonly observed: string;
  /** Descrição do limite violado (ex.: '[97, 103]', '≤ 70'). */
  readonly limit: string;
  /** Alvo por-item, quando aplicável (candidato/cenário). */
  readonly subject?: string;
}

export class ValidationError extends Error {
  readonly rule: ValidationRule;
  readonly tseId: string;
  readonly observed: string;
  readonly limit: string;
  readonly subject: string | undefined;

  constructor(fields: ValidationErrorFields) {
    const subjectPart = fields.subject === undefined ? '' : ` [${fields.subject}]`;
    super(
      `${fields.rule} FALHOU (tse_id=${fields.tseId})${subjectPart}: ` +
        `observado ${fields.observed}, limite ${fields.limit} (docs/04 §5).`,
    );
    this.name = 'ValidationError';
    this.rule = fields.rule;
    this.tseId = fields.tseId;
    this.observed = fields.observed;
    this.limit = fields.limit;
    this.subject = fields.subject;
  }
}
