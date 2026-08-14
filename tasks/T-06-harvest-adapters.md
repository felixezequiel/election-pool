---
id: T-06
title: HarvestJob e adapters de institutos
status: done
depends_on: [T-02, T-05]
owns: [packages/adapters/{base,nexus,cnt-mda}/**, packages/adapters/http/**, apps/api/src/jobs/harvest.job.ts]
spec: docs/04-INGESTION-SPEC.md §3, §4, §6
---

# T-06 — Colheita

## Entregável

- Cliente HTTP educado em `packages/adapters/http/`: robots.txt com cache de 24h,
  rate limit 1 req/10s por host, conditional GET com ETag/Last-Modified, timeout
  20s, 2 retries com backoff + jitter, User-Agent identificável
- `PollSourceAdapter` base + registry NestJS
- **Adapter `nexus`** e **adapter `cnt-mda`** (o segundo lê PDF)
- Persistência de `raw_documents` em disco, fora da árvore servida
- `HarvestJob` com o backoff de `docs/02` §3.2 e transição para
  `presumed_undisclosed` após 15 dias
- `pnpm ingest:reparse --adapter=X --since=Y` rodando parser sobre raw já salvo,
  sem rede

## Aceite

- [ ] Teste com fixture real de cada fonte: extrai os cenários corretos
- [ ] Teste: documento sem o `tse_id` do registro ⇒ lança (V6). **Este é o teste
      mais importante da task** — atribuir números da rodada errada é o pior bug
      possível do sistema
- [ ] Teste: alias de candidato desconhecido ⇒ `UnknownCandidateError`, quarentena,
      zero criação automática
- [ ] Teste: `parse` nunca retorna objeto parcial — ou `ParsedPoll` válido ou lança
- [ ] Teste: 304 encerra o ciclo sem parse
- [ ] Teste: `38,8` vira `38.8` pelo helper único
- [ ] Teste: registro sem resultado após 15 dias vira `presumed_undisclosed`
- [ ] `reparse` produz resultado idêntico ao parse original sobre o mesmo raw

## Armadilhas

- Nada de `?? 0` ou `|| 0` em valor de pesquisa (R4)
- Candidato ausente do cenário não entra; não vira zero
- Sem headless browser. Fonte que exigir JS sai da v1
