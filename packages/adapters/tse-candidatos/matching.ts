/**
 * Casamento entre uma candidatura do TSE e um `candidate_id` nosso.
 *
 * REGRA DURA (CLAUDE.md): DETERMINÍSTICO e CONSERVADOR. Nunca fuzzy match — não
 * há distância de edição, não há substring, não há "parecido o bastante", não há
 * desempate por ordem de chegada. Ou o nome bate EXATAMENTE com uma grafia que um
 * humano cadastrou em `candidate_aliases`, ou não bate. Sem casamento seguro a
 * foto fica `null` e a UI cai para monograma + cor (R4: um palpite quase certo é
 * um erro que ninguém revisa).
 *
 * O que fazemos com o texto antes de comparar é NORMALIZAÇÃO, não aproximação:
 * remover acento, unificar caixa e colapsar pontuação/espaço. O TSE grava
 * 'FLAVIO NANTES BOLSONARO' sem acento e 'LUIZ INÁCIO LULA DA SILVA' com, na
 * mesma resposta — a diferença é ruído de cadastro, não de identidade. Duas
 * grafias que normalizam para strings diferentes continuam sendo pessoas
 * diferentes para nós.
 *
 * Três travas contra atribuir a foto errada:
 *
 *  T1. Uma grafia que aponta para DOIS candidatos nossos é ambígua ⇒ ninguém casa.
 *  T2. Partido divergente derruba o casamento. Nome bate mas a sigla do TSE não é
 *      a que temos cadastrada? É outra pessoa, ou o nosso cadastro envelheceu —
 *      em ambos os casos quem decide é um humano, não o job.
 *  T3. DUAS candidaturas casando com o MESMO candidato nosso derruba as duas.
 *      Homônimo em cargo diferente, candidatura substituída, seja o que for: se
 *      há mais de um registro possível, não existe "o" registro.
 */

import type { CandidaturaLista } from './api-schemas.js';

/** Um candidato nosso, como vem de `candidates` (docs/03 §2.1). */
export interface CandidatoLocal {
  id: string;
  displayName: string;
  party: string | null;
}

export type TipoAlertaCasamento =
  /** Uma grafia do TSE aponta para mais de um candidato nosso (T1). */
  | 'nome_ambiguo'
  /** Nome casou, sigla de partido não confere (T2). */
  | 'partido_divergente'
  /** Mais de uma candidatura casou com o mesmo candidato nosso (T3). */
  | 'candidato_com_multiplas_candidaturas'
  /** Candidato nosso sem candidatura correspondente no TSE. */
  | 'sem_candidatura'
  /** Candidatura no TSE que não rastreamos — informativo, não é problema. */
  | 'candidatura_nao_rastreada';

export interface AlertaCasamento {
  kind: TipoAlertaCasamento;
  /** `candidate_id` nosso, quando o alerta é sobre um candidato nosso. */
  candidateId: string | null;
  /** Id da candidatura no TSE, quando o alerta é sobre uma candidatura. */
  idCandidatura: string | null;
  detail: string;
}

export interface CasamentoConfirmado {
  candidateId: string;
  candidatura: CandidaturaLista;
}

export interface ResultadoCasamento {
  matches: CasamentoConfirmado[];
  alerts: AlertaCasamento[];
}

/**
 * Normaliza uma grafia para comparação: sem acento, caixa alta, pontuação virando
 * espaço e espaços colapsados. Determinística e total — a mesma entrada dá sempre
 * a mesma saída, e nada aqui inventa equivalência entre nomes distintos.
 */
export const normalizeNome = (nome: string): string =>
  nome
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

/** Mesma normalização para sigla de partido ('Novo' e 'NOVO' são a mesma sigla). */
const normalizeSigla = (sigla: string): string => normalizeNome(sigla).replace(/ /g, '');

/**
 * Índice grafia-normalizada → candidato nosso, mais o conjunto das grafias
 * AMBÍGUAS (usadas por mais de um candidato). Duas estruturas em vez de um valor
 * sentinela porque `candidate_id` é texto livre: qualquer sentinela em string
 * poderia, um dia, colidir com um id de verdade.
 */
interface IndiceGrafias {
  porGrafia: ReadonlyMap<string, string>;
  ambiguas: ReadonlySet<string>;
}

const buildIndex = (
  candidatos: readonly CandidatoLocal[],
  aliases: ReadonlyMap<string, string>,
): IndiceGrafias => {
  const porGrafia = new Map<string, string>();
  const ambiguas = new Set<string>();
  const add = (grafia: string, candidateId: string): void => {
    const key = normalizeNome(grafia);
    if (key.length === 0) return;
    const existing = porGrafia.get(key);
    if (existing === undefined) {
      porGrafia.set(key, candidateId);
    } else if (existing !== candidateId) {
      ambiguas.add(key);
    }
  };

  // `display_name` conta como grafia canônica: foi um humano quem o escreveu.
  for (const cand of candidatos) add(cand.displayName, cand.id);
  for (const [alias, candidateId] of aliases) add(alias, candidateId);
  return { porGrafia, ambiguas };
};

/**
 * Casa as candidaturas do TSE com os nossos candidatos.
 *
 * `aliases` é o conteúdo de `candidate_aliases` (alias → candidate_id), cadastrado
 * à mão. O adapter NUNCA cria candidato nem alias (docs/04 §4.1).
 */
export const casarCandidaturas = (
  candidaturas: readonly CandidaturaLista[],
  candidatos: readonly CandidatoLocal[],
  aliases: ReadonlyMap<string, string>,
): ResultadoCasamento => {
  const index = buildIndex(candidatos, aliases);
  const porId = new Map(candidatos.map((c) => [c.id, c]));
  const alerts: AlertaCasamento[] = [];

  /** Candidaturas que casaram, agrupadas por candidato nosso (para a trava T3). */
  const porCandidato = new Map<string, CandidaturaLista[]>();

  for (const candidatura of candidaturas) {
    // As duas grafias que o TSE fornece. `Set` porque nome de urna e nome
    // completo podem coincidir e não queremos "dois acertos" que são um só.
    const grafias = new Set([
      normalizeNome(candidatura.nomeCompleto),
      normalizeNome(candidatura.nomeUrna),
    ]);

    const encontrados = new Set<string>();
    let ambiguo = false;
    for (const grafia of grafias) {
      if (index.ambiguas.has(grafia)) {
        ambiguo = true;
        continue;
      }
      const hit = index.porGrafia.get(grafia);
      if (hit === undefined) continue;
      encontrados.add(hit);
    }

    if (ambiguo || encontrados.size > 1) {
      alerts.push({
        kind: 'nome_ambiguo',
        candidateId: null,
        idCandidatura: candidatura.id,
        detail:
          `'${candidatura.nomeUrna}' / '${candidatura.nomeCompleto}' casa com ` +
          `${ambiguo ? 'uma grafia ambígua' : `${encontrados.size} candidatos`}: cadastro manual`,
      });
      continue;
    }

    const candidateId = [...encontrados][0];
    if (candidateId === undefined) {
      alerts.push({
        kind: 'candidatura_nao_rastreada',
        candidateId: null,
        idCandidatura: candidatura.id,
        detail: `${candidatura.nomeUrna} (${candidatura.partido.sigla ?? 'sem partido'})`,
      });
      continue;
    }

    // T2 — corroboração por partido.
    const nosso = porId.get(candidateId);
    const nossaSigla = nosso?.party;
    const siglaTse = candidatura.partido.sigla;
    if (
      nossaSigla != null &&
      nossaSigla.length > 0 &&
      siglaTse != null &&
      siglaTse.length > 0 &&
      normalizeSigla(nossaSigla) !== normalizeSigla(siglaTse)
    ) {
      alerts.push({
        kind: 'partido_divergente',
        candidateId,
        idCandidatura: candidatura.id,
        detail:
          `nome casou com '${candidateId}', mas o TSE registra ${siglaTse} e ` +
          `temos ${nossaSigla}: revisão manual antes de usar a foto`,
      });
      continue;
    }

    const lista = porCandidato.get(candidateId);
    if (lista === undefined) {
      porCandidato.set(candidateId, [candidatura]);
    } else {
      lista.push(candidatura);
    }
  }

  const matches: CasamentoConfirmado[] = [];
  for (const [candidateId, lista] of porCandidato) {
    const unica = lista[0];
    if (lista.length > 1 || unica === undefined) {
      // T3 — derruba TODAS. Escolher uma seria exatamente o chute proibido.
      alerts.push({
        kind: 'candidato_com_multiplas_candidaturas',
        candidateId,
        idCandidatura: null,
        detail: `${lista.length} candidaturas casaram com '${candidateId}': ${lista
          .map((c) => c.id)
          .join(', ')}`,
      });
      continue;
    }
    matches.push({ candidateId, candidatura: unica });
  }

  const casados = new Set(matches.map((m) => m.candidateId));
  for (const cand of candidatos) {
    if (casados.has(cand.id)) continue;
    // Já houve alerta específico (ambíguo/partido/múltiplas)? Então não repetimos
    // "sem candidatura" — o motivo real já está registrado.
    if (alerts.some((a) => a.candidateId === cand.id)) continue;
    alerts.push({
      kind: 'sem_candidatura',
      candidateId: cand.id,
      idCandidatura: null,
      detail: `'${cand.displayName}' não tem candidatura correspondente no registro do TSE`,
    });
  }

  return { matches, alerts };
};
