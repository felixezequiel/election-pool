---
id: T-07
title: Validação bloqueante de ingestão
status: done
depends_on: [T-06]
owns: [packages/adapters/validation/**, apps/api/src/ingestion/approve.command.ts]
spec: docs/04-INGESTION-SPEC.md §5
---

# T-07 — Validação

## Entregável

- Validadores V1–V7 de `docs/04` §5, cada um em arquivo próprio, com mensagem de
  erro que diga o valor observado, o limite e o `tse_id`
- Execução antes de qualquer `INSERT`. Falha ⇒ nada persiste, log `error`, adapter
  marcado suspeito
- `pnpm ingest:approve <tse_id> --reason="..."` para aprovação manual de V4/V5,
  gravando `manually_approved` e a razão
- Contador de falhas por adapter; 3 ciclos seguidos ⇒ alerta

## Aceite

- [ ] Um teste por validador, com caso que passa e caso que falha na borda exata
- [ ] Teste: soma 96,9 falha; 97,0 passa; 103,0 passa; 103,1 falha
- [ ] Teste: falha de validação não deixa linha órfã em `poll_scenarios`
- [ ] Teste: `approve` insere e registra a razão; sem `--reason` recusa
- [ ] Mensagem de erro contém `tse_id`, regra violada, valor e limite

## Armadilhas

- **Não relaxe limite para fazer teste passar.** V4/V5 disparando em movimento
  real é comportamento correto; o caminho é a aprovação manual
- Validação é bloqueante, nunca warning
