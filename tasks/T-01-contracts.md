---
id: T-01
title: Contratos, enums e constantes compartilhadas
status: done
depends_on: []
owns: [packages/contracts/**, tsconfig.base.json, package.json, pnpm-workspace.yaml]
spec: docs/03-DATA-MODEL.md
blocking: true
---

# T-01 — Contratos

**Roda sozinha. Nenhuma outra task em paralelo.** Tudo depende destes tipos.

## Entregável

Monorepo pnpm com `packages/contracts` publicando:

- `enums.ts` — todos os enums de `docs/03` §2 como const objects + Zod enums
- `domain.ts` — schemas Zod de `PollRegistration`, `PollScenario`, `PollResult`,
  `ParsedPoll`, `SourceCandidate`, `RawDocument`
- `public-data.ts` — schema Zod de `PublicData` (`docs/03` §5), exato
- `model-io.ts` — entrada e saída de `packages/model`: `Observation[]` →
  `ModelOutput`. Nenhum tipo do modelo referencia banco ou HTTP
- `constants.ts` — **todo** número mágico do projeto, com comentário citando a
  seção de `docs/01` que o justifica: `SIGMA_PROCESS`, `DEFF`, `SIGMA_HOUSE_EXTRA`,
  `TAU_RECENCY_DAYS`, `ACTIVE_WINDOW_DAYS`, `HOUSE_EFFECT_PRIOR_SD`,
  `MIN_POLLS_FOR_HOUSE_EFFECT`, `HERDING_RATIO_THRESHOLD`, limites V1–V7
- `palette.ts` — 8 slots de cor, variantes clara e escura (`docs/05` §2.1)
- `races.ts` — registro de corridas com `status: 'ativo' | 'planejado'`
- `branded.ts` — `IsoDate`, `TseId`, `Pct` como branded types

## Aceite

- [ ] `tsc --noEmit` com `strict` e `noUncheckedIndexedAccess`
- [ ] Todo tipo derivado de schema via `z.infer`. Zero interface paralela
- [ ] Nenhum literal numérico fora de `constants.ts`, exceto `0` e `1`
- [ ] Teste: `TseId` rejeita `'BR-6591/2026'` e aceita `'BR-06591/2026'`
- [ ] Teste: `PublicData` valida uma fixture completa e rejeita uma sem `tseId`
- [ ] `pnpm verify` verde (lint + typecheck + test)

## Armadilhas

- `Pct` é escala 0–100. Não crie caminho para 0–1 em lugar nenhum
- Não coloque nada de I/O aqui. `packages/contracts` não importa `pg`, `axios`,
  `@nestjs/*` nem nada de runtime além de `zod`
