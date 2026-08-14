import type { PublicData } from '@election-pool/contracts/public-data';

/**
 * Verificação "sem prosa de terceiros" (docs/08 §2.1, R3). Percorre TODO campo de
 * string do `data.json` e reprova se algum, FORA da allowlist de campos nossos,
 * exceder MAX_FIELD_CHARS caracteres. A ideia: números, ids, nomes curtos e links
 * são fatos/metadata; um campo de string longo seria a única forma de vazar prosa
 * de terceiros (título de matéria, resumo, trecho) para o artefato público.
 *
 * A allowlist são campos comprovadamente NOSSOS ou triviais:
 *   - `methodologyNotes`: texto nosso, docs/01 §10 verbatim (pode passar de 200).
 *   - `displayName`: nome próprio de candidato/instituto/corrida (fato, curto).
 *   - `sourceUrl`: LINK (referência à fonte é sempre link, nunca conteúdo).
 *
 * Retorna a lista de violações (vazia = aprovado). Pura: sem I/O.
 */

const MAX_FIELD_CHARS = 200; // docs/08 §2.1

/** Nomes de campo cujo conteúdo textual é permitido (nosso/curto/link). */
const ALLOWLISTED_FIELDS: ReadonlySet<string> = new Set([
  'methodologyNotes',
  'displayName',
  'sourceUrl',
]);

export interface ProseViolation {
  path: string;
  length: number;
  sample: string;
}

export const findThirdPartyProse = (data: PublicData): ProseViolation[] => {
  const violations: ProseViolation[] = [];
  walk(data as unknown, '', null, violations);
  return violations;
};

const walk = (
  value: unknown,
  path: string,
  keyName: string | null,
  out: ProseViolation[],
): void => {
  if (typeof value === 'string') {
    if (keyName !== null && ALLOWLISTED_FIELDS.has(keyName)) return;
    if (value.length > MAX_FIELD_CHARS) {
      out.push({ path, length: value.length, sample: value.slice(0, 60) });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      // Itens de um array herdam o nome do campo do array (ex.: methodologyNotes[]).
      walk(item, `${path}[${String(i)}]`, keyName, out);
    });
    return;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      walk(v, path === '' ? k : `${path}.${k}`, k, out);
    }
  }
};

export const __test = { MAX_FIELD_CHARS, ALLOWLISTED_FIELDS };
