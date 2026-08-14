---
id: T-05
title: Adapter do PesqEle e DiscoveryJob
status: done
depends_on: [T-02]
owns: [packages/adapters/pesqele/**, apps/api/src/jobs/discovery.job.ts]
spec: docs/04-INGESTION-SPEC.md §2
---

# T-05 — Descoberta

**Prioridade alta e urgente:** os dados do PesqEle expiram em 30 dias. Cada dia
sem este job rodando é dado perdido para sempre.

## Entregável

- Cliente do PesqEle lidando com JSF: sessão inicial, extração e reenvio de
  `javax.faces.ViewState`, paginação por POST
- Filtros: eleição 2026, abrangência nacional, últimos 30 dias
- Upsert em `poll_registrations` por `tse_id`. **Nunca deleta.** Registro que some
  da origem recebe `source_expired_at`
- `contractor-classifier.ts`: CNPJ quando disponível, padrões de nome como
  fallback, `'desconhecido'` sem match. Nunca chute
- Resolução de `institute_id` por `institute_aliases`. Alias desconhecido ⇒ grava
  `institute_raw_name` com `institute_id = null` e emite alerta para cadastro manual
- `DiscoveryJob` no cron `0 */2 * * *`, idempotente, executável via
  `pnpm ingest:discover`

## Aceite

- [ ] Teste com fixture de HTML real do PesqEle: parseia lista e detalhe
- [ ] Teste: rodar duas vezes seguidas não duplica nem altera `first_seen_at`
- [ ] Teste: registro presente no run 1 e ausente no run 2 recebe `source_expired_at`
      e continua na tabela
- [ ] Teste: contratante sem match vira `'desconhecido'`, não `null` e não chute
- [ ] Respeita robots.txt e o rate limit de 1 req/10s por host
- [ ] Falha de rede não corrompe estado: transação por página

## Armadilhas

- `ViewState` expira. Detecte a resposta de sessão inválida e reestabeleça, sem
  entrar em loop
- Não paralelize requisições ao TSE. Sequencial, com o delay
