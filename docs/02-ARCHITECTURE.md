# Arquitetura

## 1. Princípio organizador

O sistema é um **pipeline em lote com publicação atômica**. Não há request de
usuário tocando dado dinâmico em momento nenhum. O visitante recebe arquivo
estático servido por nginx; tudo que é caro acontece antes, offline.

```
PesqEle ──┐
          ├─► discover ─► registrations ─┐
sites dos │                              ├─► harvest ─► results ─► model ─► render ─► dist/
institutos┘                              │                                            │
                                    (calendário)                                   nginx
```

## 2. Stack e justificativa

| Camada | Escolha | Por quê |
|---|---|---|
| Runtime | Node 22 LTS + TypeScript estrito | Um toolchain só, do scraper ao modelo ao site |
| Jobs/API | NestJS + `@nestjs/schedule` | DI e módulos ajudam a isolar adapters; agendamento embutido |
| Banco | PostgreSQL 16 | Precisão numérica, `numeric`, constraints reais, janelas SQL para diagnóstico |
| Migrations | node-pg-migrate | SQL explícito, sem mágica de ORM |
| Acesso a dados | `pg` + queries SQL | Sem ORM. As queries são poucas e analíticas |
| Validação | Zod | Fronteira única de runtime + tipos derivados |
| Modelo | TypeScript puro em `packages/model` | Testável, determinístico, sem dependência de Python/Stan |
| Frontend | Astro (output static) + TS + D3 | Estático no build; JS como camada de animação/interação, dentro do orçamento de `docs/06` §7 |
| Gráficos | SVG próprio, D3 só para escalas/formas | Controle total; nenhuma lib de gráfico pronta |
| Blob | Sistema de arquivos local (`/var/lib/election-pool/raw`) | VPS única; S3 é overkill |
| Serving | nginx | Serve `dist/`, nada mais |

**Decisão consciente:** o modelo em TypeScript em vez de Python/Stan. Perdemos
inferência bayesiana completa (MCMC) e ganhamos: um só runtime, backtest rodando
em CI, e determinismo trivial. O filtro de Kalman com suavização RTS é adequado
para o modelo especificado em `docs/01-METHODOLOGY.md`. Se a v2 exigir posterior
completo, isso volta à mesa em `docs/OPEN-QUESTIONS.md`.

## 3. Jobs

Todos em `apps/api/src/jobs`. Cada job é idempotente e pode rodar sozinho via CLI.

### 3.1 `DiscoveryJob` — cron `0 */2 * * *`

Consulta o PesqEle, faz upsert em `poll_registrations` por `tse_id`.

Crítico: <mark>os dados do PesqEle expiram em 30 dias</mark>. Este job é a única
chance de capturá-los. Ele roda desde o dia 1 e **nunca deleta** registro já
capturado, mesmo que suma da origem. Um registro que desaparece da origem é marcado
`source_expired_at`, não removido.

### 3.2 `HarvestJob` — cron `5 */2 * * *`

Para cada registro elegível (campo encerrado, sem resultado, dentro da janela de
tentativas), resolve o adapter e tenta extrair.

Elegibilidade e backoff:
- Primeiras 72h após o fim do campo: tenta a cada ciclo
- 72h–15 dias: tenta 2×/dia
- Após 15 dias sem resultado: marca `presumed_undisclosed` e para.
  Esse estado alimenta a taxa de engavetamento (`docs/01` §6.1) — é dado, não falha.

Conditional GET obrigatório: guarda `etag` e `last_modified` por URL. 304 encerra
o ciclo sem parse.

### 3.3 `ModelJob` — cron `15 */2 * * *`, e sempre após harvest bem-sucedido

Roda `packages/model` sobre o conjunto atual. Grava `model_runs` +
`model_estimates`. Não publica nada — só calcula.

### 3.4 `RenderJob` — disparado por `ModelJob` quando o run passa os gates

1. Serializa `data.json` (contrato em `docs/03-DATA-MODEL.md` §5), incluindo
   `generatedAt`, `nextUpdateAt` (próximo slot de 2h do cron, offset `-03:00`) e
   `updateIntervalMinutes: 120` — insumos da contagem regressiva (`docs/06` §9)
2. Roda `astro build` com o JSON como entrada
3. **Swap atômico:** build vai para `dist-staging/`, depois
   `rename(dist-staging, dist-new)` → `rename(dist, dist-old)` → `rename(dist-new, dist)`.
   nginx nunca vê estado intermediário.
4. Mantém os 5 últimos `dist-*` para rollback

Se qualquer gate falhar, **não publica** e emite alerta. A versão anterior continua
no ar. Publicar dado errado é pior que publicar dado velho.

## 4. Adapters

```ts
interface PollSourceAdapter {
  readonly id: string;            // 'nexus' | 'cnt-mda' | ...
  readonly instituteId: string;
  canHandle(reg: PollRegistration): boolean;
  discover(reg: PollRegistration): Promise<SourceCandidate[]>;  // URLs prováveis
  parse(raw: RawDocument): Promise<ParsedPoll>;                 // lança se não conseguir
}
```

Registro via módulo NestJS. Adicionar instituto = adicionar arquivo + entrada no
registry. Nenhum `if/else` espalhado.

`parse` **nunca** retorna parcial. Ou devolve `ParsedPoll` válido pelo Zod schema,
ou lança `ParseError` com contexto suficiente para depurar (seletor tentado,
trecho onde falhou, URL).

Detalhes por fonte em `docs/04-INGESTION-SPEC.md`.

## 5. Observabilidade

Sem stack pesada. Numa VPS única:

- Log estruturado JSON em stdout, capturado por journald
- Tabela `job_runs(job, started_at, finished_at, status, error, metrics_json)`
- Endpoint `GET /health` (interno, não exposto) com: idade do último run bem-sucedido,
  contagem de adapters em falha, idade do `dist/` publicado
- Alerta: se qualquer adapter falhar 3 ciclos seguidos, ou se `dist/` tiver mais de
  6h, dispara webhook (destino configurável; padrão é log de nível `error`)

O que importa monitorar aqui não é uptime — é **staleness e falha silenciosa**.

## 6. Segurança e postura de crawler

- `User-Agent: election-pool/1.0 (+https://<dominio>/metodologia; contato@<dominio>)`
- Respeita `robots.txt` e `Crawl-delay`. Parser de robots em `packages/adapters/robots.ts`,
  consultado antes de toda requisição, sem exceção.
- Rate limit próprio: no máximo 1 req a cada 10s por host
- Timeout 20s, no máximo 2 retries com backoff exponencial + jitter
- Sem headless browser na v1. Se uma fonte exigir JS, ela sai da lista v1 e vai
  para `docs/OPEN-QUESTIONS.md` — não vale o custo nem o sinal de má-fé.

## 7. Deploy

`docker compose` com dois serviços: `postgres` e `api`. nginx no host, servindo
`/var/lib/election-pool/dist`. Build da imagem em CI, deploy por `docker compose pull && up -d`.

Migrations rodam no boot do `api`, antes dos jobs. Falha de migration impede o boot.
