import { z } from 'zod';
import { raceStatusSchema } from './enums.js';

/**
 * Registro de corridas (docs/00 §7, docs/03 §2.1). Adicionar uma corrida futura
 * não deve exigir mexer em JSX — a UI lê daqui. `sortOrder` define a ordem de
 * exibição. A corrida ativa da v1 é a Presidência 2026; as demais são
 * `planejado` e alimentam o bloco de CTA (docs/00 §7).
 */

export const raceSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: raceStatusSchema,
  sortOrder: z.number().int(),
});
export type Race = z.infer<typeof raceSchema>;

export const raceRegistrySchema = z.array(raceSchema);
export type RaceRegistry = z.infer<typeof raceRegistrySchema>;

// docs/00 §6: corrida da v1 = Presidência 2026 (ativo).
// docs/00 §7: planejadas = Governos estaduais · Senado · Aprovação presidencial.
// `sortOrder` é derivado da posição na lista (não escrito à mão) para evitar
// literais numéricos fora de constants.ts (CLAUDE.md). Reordenar = mover a linha.
const raceOrder: ReadonlyArray<Omit<Race, 'sortOrder'>> = [
  { id: 'presidencia-2026', displayName: 'Presidência da República 2026', status: 'ativo' },
  { id: 'governos-estaduais-2026', displayName: 'Governos estaduais', status: 'planejado' },
  { id: 'senado-2026', displayName: 'Senado', status: 'planejado' },
  { id: 'aprovacao-presidencial', displayName: 'Aprovação presidencial', status: 'planejado' },
];

export const RACES: RaceRegistry = raceRegistrySchema.parse(
  raceOrder.map((race, index) => ({ ...race, sortOrder: index })),
);
