---
id: T-13
title: RenderJob, data.json e publicação atômica
status: done
depends_on: [T-08, T-12]
owns: [apps/api/src/jobs/render.job.ts, apps/api/src/publish/**]
spec: docs/02-ARCHITECTURE.md §3.4, docs/07-QUALITY-GATES.md §6
---

# T-13 — Publicação

Onde as três trilhas se encontram.

## Entregável

- Serialização de `data.json` conforme `docs/03` §5, validada contra o schema Zod
  antes de escrever
- Disparo de `astro build` para `dist-staging/`
- **Swap atômico:** `rename(dist-staging → dist-new)` → `rename(dist → dist-old)`
  → `rename(dist-new → dist)`. nginx nunca vê estado intermediário
- Retenção dos 5 últimos `dist-*` e comando `pnpm publish:rollback`
- Gates de publicação de `docs/07` §6, todos bloqueantes
- Cabeçalhos: `data.json` com `Cache-Control: public, max-age=300` e CORS aberto

## Aceite

- [ ] Teste: `data.json` que não valida ⇒ publicação abortada, `dist/` intacto
- [ ] Teste: `astro build` com código != 0 ⇒ abortado, `dist/` intacto
- [ ] Teste: durante o swap, um leitor concorrente de `dist/index.html` nunca lê
      arquivo parcial nem recebe ENOENT
- [ ] Teste: `gates_passed = false` no run ⇒ não publica
- [ ] `publish:rollback` restaura a versão anterior e é idempotente
- [ ] `data.json` gerado passa em `no-third-party-prose.spec.ts` (`docs/08` §2.1)

## Armadilhas

- `rename` só é atômico dentro do mesmo filesystem. `dist-staging` precisa estar
  no mesmo volume que `dist`
- Publicar dado velho é aceitável; publicar dado errado não é. Na dúvida, aborta
