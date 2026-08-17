/**
 * Aliases de candidato que os PDFs REAIS do REAL TIME BIG DATA imprimem — a
 * lista verbatim, retirada dos 6 documentos capturados em 2026-08-17.
 *
 * ISTO É APOIO A TESTE, NÃO CADASTRO. O cadastro de verdade é
 * `apps/api/src/db/seed-data.ts` (`candidateAliases`), que NÃO pertence a esta
 * task. Enquanto essas grafias não entrarem lá, o `BaseAdapter` lança
 * `UnknownCandidateError` para toda rodada deste instituto e o registro vai para
 * quarentena manual — que é o comportamento CORRETO (docs/04 §4.1: nunca criar
 * candidato automaticamente), não um bug do adapter.
 *
 * Por que são tantas grafias para poucas pessoas: o mesmo documento imprime o
 * nome de três formas diferentes, dependendo do gráfico —
 *
 *   espontânea (pergunta aberta) → `Lula`                  (sem partido)
 *   estimulada (lista de nomes)  → `Lula (PT)`             (com partido)
 *   confronto de 2º turno        → `LULA (PT)`             (caixa alta)
 *
 * O resolver do projeto casa alias EXATO por decisão de projeto (CLAUDE.md:
 * normalização de nome é MANUAL, nunca fuzzy), então cada grafia precisa de uma
 * linha revisada por humano. O parser deliberadamente NÃO normaliza: tirar o
 * partido ou baixar a caixa aqui seria mover uma decisão de identidade para
 * dentro do código.
 *
 * O caso `Outros`: não é pessoa, é o agregado dos candidatos que a fonte não
 * mostra individualmente. `ParsedPoll` não tem campo para agregado, e descartar
 * o número no parser seria perder dado publicado em silêncio (R4). Então ele sai
 * como alias e a decisão do que fazer com ele (mapear, ou recusar a rodada) é do
 * cadastro. Ver `tasks/T-25-adapter-realtime.md`.
 */

import { resolverFromMap } from '../../base/candidate-resolver.js';
import type { CandidateAliasResolver } from '../../base/candidate-resolver.js';
import { seedCandidateAliases } from '../../base/test-support.js';

/** Grafias observadas nos PDFs reais, por id canônico do seed. */
export const REALTIME_OBSERVED_ALIASES: ReadonlyArray<readonly [string, string]> = [
  // Já presentes no seed: 'Lula', 'Flávio Bolsonaro', 'Romeu Zema', 'Zema'.
  ['Lula (PT)', 'lula'],
  ['LULA (PT)', 'lula'],
  ['Flávio Bolsonaro (PL)', 'flavio-bolsonaro'],
  ['FLÁVIO BOLSONARO (PL)', 'flavio-bolsonaro'],
  ['Romeu Zema (Novo)', 'zema'],
  // Ausentes do seed: pessoas que só aparecem nesta fonte.
  ['Renan Santos', 'renan-santos'],
  ['Renan Santos (Missão)', 'renan-santos'],
  ['Ronaldo Caiado', 'ronaldo-caiado'],
  ['Ronaldo Caiado (PSD)', 'ronaldo-caiado'],
  ['Jair Bolsonaro', 'jair-bolsonaro'],
  ['Escritor Augusto Cury (Avante)', 'augusto-cury'],
  ['Cabo Daciolo (Mobiliza)', 'cabo-daciolo'],
  // Agregado, não pessoa — ver o cabeçalho deste arquivo.
  ['Outros', 'outros'],
];

/** Resolver de teste: seed manual (T-02) + grafias observadas nesta fonte. */
export const realtimeTestResolver: CandidateAliasResolver = resolverFromMap(
  new Map<string, string>([...seedCandidateAliases, ...REALTIME_OBSERVED_ALIASES]),
);
