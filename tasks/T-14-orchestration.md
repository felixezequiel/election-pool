---
id: T-14
title: Orquestração, observabilidade e deploy
status: done
depends_on: [T-13, T-07, T-09]
owns: [apps/api/src/main.ts, apps/api/src/health/**, infra/nginx/**, .github/workflows/**]
spec: docs/02-ARCHITECTURE.md §5, §7
---

# T-14 — Orquestração

## Entregável

- Cron de todos os jobs conforme `docs/02` §3, com lock para impedir sobreposição
  de execuções do mesmo job
- Tabela `job_runs` e log estruturado JSON em stdout
- `GET /health` interno: idade do último run bem-sucedido, adapters em falha,
  idade do `dist/` publicado
- Alertas: adapter falhando 3 ciclos seguidos, ou `dist/` com mais de 6h. Webhook
  configurável, padrão log `error`
- `docker-compose.yml` de produção: `postgres` + `api`. Migrations no boot, antes
  dos jobs; falha de migration impede o boot
- Config do nginx servindo `/var/lib/election-pool/dist`, com os cabeçalhos de cache
- CI: `pnpm verify` em todo push; build de imagem em tag

## Aceite

- [ ] 72h rodando sem intervenção manual (marco M4)
- [ ] Teste: duas execuções simultâneas do mesmo job ⇒ a segunda não roda
- [ ] Teste: `/health` reporta staleness corretamente com `dist/` envelhecido
      artificialmente
- [ ] Teste: falha de migration impede o boot da API
- [ ] Alerta dispara de fato no cenário simulado — teste, não presuma
- [ ] `docker compose up` do zero chega a um site servido, com dados de seed

## Armadilhas

- O que importa monitorar aqui não é uptime — é **staleness e falha silenciosa**.
  Um site no ar com dado de duas semanas atrás é pior que um site fora do ar
- Nenhum job pode rodar antes das migrations terminarem
