/**
 * `BaseAdapter`: a canalização comum de todo `PollSourceAdapter` (docs/02 §4,
 * docs/04 §4). Cada instituto herda daqui e implementa apenas o que é específico
 * da fonte — a extração de cenários a partir do texto do documento e como
 * transformar o `RawDocument` em texto. O resto (que é a parte perigosa) é
 * comum e testado uma vez:
 *
 * - **V6 (identidade):** confirma que o documento contém o `tse_id` do registro,
 *   ANTES de qualquer extração. Documento de outra rodada ⇒ `ParseError`. Este é
 *   o guardião do pior bug do sistema.
 * - **Alias desconhecido ⇒ `UnknownCandidateError`** (quarentena; nunca auto-cria).
 *   Todo alias extraído é validado contra o resolver injetado.
 * - **Nunca parcial:** monta o `ParsedPoll` e o valida contra `parsedPollSchema`
 *   (Zod) antes de devolver. Falhou o schema ⇒ lança. Ou tudo válido, ou nada.
 * - **Ausência ≠ zero:** o adapter só inclui candidatos que aparecem no cenário.
 *   O `BaseAdapter` não injeta zero para candidato ausente (R4).
 *
 * O que a subclasse implementa:
 * - `documentToText(raw)`: RawDocument → texto (HTML→texto, PDF→texto).
 * - `extractScenarios(text, reg)`: texto → cenários crus (alias + valor). LANÇA
 *   `ParseError` se não achar nada extraível. NUNCA devolve parcial silencioso.
 *
 * O `candidateAlias` permanece no `ParsedPoll` (é o contrato de docs/04 §4). A
 * tradução alias→`candidate_id` é do HarvestJob na hora de gravar `poll_results`.
 * Aqui só VALIDAMOS que todo alias resolve — para a quarentena disparar no parse.
 */

import { parsedPollSchema } from '@election-pool/contracts/domain';
import type {
  ParsedPoll,
  PollRegistration,
  RawDocument,
  SourceCandidate,
} from '@election-pool/contracts/domain';
import type { ScenarioKind } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import type { PollSourceAdapter } from '../poll-source-adapter.js';
import { confirmTseId } from './tse-id.js';
import { resolveCandidateOrThrow } from './candidate-resolver.js';
import type { CandidateAliasResolver } from './candidate-resolver.js';
import { RawStorage } from './raw-storage.js';

/**
 * Valor cru de candidato: alias (grafia do documento) + percentual como `number`
 * simples (0–100). O branding para `Pct`/`TseId` acontece quando o `BaseAdapter`
 * valida o `ParsedPoll` inteiro contra `parsedPollSchema` — a subclasse trabalha
 * com números crus. É a camada de ENTRADA, legitimamente distinta do tipo de
 * domínio branded (não é um paralelo do schema: é o "antes da validação").
 */
export interface RawScenarioValue {
  candidateAlias: string;
  valuePct: number;
}

/** Cenário cru: o que a subclasse extrai, ainda com aliases (não resolvidos). */
export interface RawScenario {
  kind: ScenarioKind;
  label: string;
  t2Pair?: [string, string];
  values: RawScenarioValue[];
  blankNullPct?: number;
  undecidedPct?: number;
}

export interface BaseAdapterDeps {
  /**
   * Resolve alias→candidate_id. Alias não encontrado ⇒ `UnknownCandidateError`.
   * Injetado (o adapter não conhece o banco). Nos testes de parser, um mapa
   * estático basta.
   */
  resolveCandidate: CandidateAliasResolver;
  /** Acesso ao blob local (leitura do corpo bruto). Injetável para teste. */
  storage?: RawStorage;
}

export abstract class BaseAdapter implements PollSourceAdapter {
  abstract readonly id: string;
  abstract readonly instituteId: string;

  protected readonly resolveCandidate: CandidateAliasResolver;
  protected readonly storage: RawStorage;

  constructor(deps: BaseAdapterDeps) {
    this.resolveCandidate = deps.resolveCandidate;
    this.storage = deps.storage ?? new RawStorage();
  }

  canHandle(reg: PollRegistration): boolean {
    return reg.instituteId === this.instituteId;
  }

  abstract discover(reg: PollRegistration): Promise<SourceCandidate[]>;

  /** RawDocument (metadados + caminho no blob) → texto do corpo já lido do disco. */
  protected abstract documentToText(raw: RawDocument): Promise<string>;

  /**
   * Extrai os cenários crus (alias + valor) do texto. LANÇA `ParseError` se não
   * conseguir extrair nenhum cenário. NUNCA devolve cenário meio-montado.
   */
  protected abstract extractScenarios(
    text: string,
    reg: PollRegistration,
  ): Promise<RawScenario[]> | RawScenario[];

  /**
   * O caminho comum: texto → confirma V6 → extrai → valida aliases → valida schema.
   * Ou devolve `ParsedPoll` válido, ou lança. Nunca parcial.
   */
  async parse(raw: RawDocument, reg: PollRegistration): Promise<ParsedPoll> {
    const text = await this.documentToText(raw);

    // V6 primeiro, antes de extrair qualquer número. `tseId` devolvido é sempre
    // o do registro (a verdade), nunca um valor "lido" do documento.
    const tseId = confirmTseId(text, reg.tseId);

    const scenarios = await this.extractScenarios(text, reg);
    if (scenarios.length === 0) {
      throw new ParseError(
        `Nenhum cenário extraído de ${raw.url} para ${reg.tseId} (adapter ${this.id})`,
      );
    }

    // Toda grafia de candidato tem de resolver — senão quarentena
    // (UnknownCandidateError). Isso roda no parse, antes de qualquer persistência.
    for (const scenario of scenarios) {
      for (const value of scenario.values) {
        resolveCandidateOrThrow(this.resolveCandidate, value.candidateAlias);
      }
    }

    // Nunca parcial: o objeto inteiro passa pelo Zod. Percentual fora de 0–100,
    // kind inválido, etc. ⇒ lança aqui (ParseError com o erro do Zod como causa).
    const candidate = { tseId, scenarios };
    const result = parsedPollSchema.safeParse(candidate);
    if (!result.success) {
      throw new ParseError(
        `ParsedPoll inválido para ${reg.tseId} (adapter ${this.id}): ${result.error.message}`,
        result.error,
      );
    }
    return result.data;
  }
}
