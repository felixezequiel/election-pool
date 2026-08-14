---
id: T-02
title: Schema Postgres, migrations e camada de acesso
status: done
depends_on: [T-01]
owns: [infra/migrations/**, infra/docker-compose.yml, apps/api/src/db/**]
spec: docs/03-DATA-MODEL.md
---

# T-02 — Banco

## Entregável

- `docker-compose.yml` com Postgres 16, volume nomeado, healthcheck
- Migrations em node-pg-migrate implementando `docs/03` §2 na íntegra
- Trigger `BEFORE UPDATE OR DELETE ON poll_results` que lança exceção (§2.4)
- Índice único parcial: um `is_canonical = true` por `(tse_id, kind, t2_pair)`
- Repositórios em `apps/api/src/db/`, SQL explícito, sem ORM. Toda linha lida do
  banco passa pelo schema Zod correspondente antes de virar objeto de domínio
- Seed: institutos, candidatos com `color_slot`, aliases, corridas

## Aceite

- [ ] `pnpm db:up && pnpm db:migrate` sobe do zero
- [ ] Teste de integração: `UPDATE poll_results` falha com erro do trigger
- [ ] Teste de integração: inserir dois cenários canônicos para a mesma
      `(tse_id, kind, t2_pair)` viola o índice único
- [ ] Teste de contrato: valores dos enums TS batem com os `CHECK` das migrations
- [ ] Toda migration tem `down` funcional e testado
- [ ] `value_pct = 100.5` é rejeitado pelo CHECK

## Armadilhas

- `numeric`, nunca `float`/`double`. Erro de ponto flutuante em percentual é
  inaceitável num projeto sobre precisão
- Seed de candidato é manual e revisado. Nunca gere alias por fuzzy match
