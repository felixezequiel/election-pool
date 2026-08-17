# election-pool

Agregador de pesquisas eleitorais brasileiras com estimativa explícita de *house effect*
por instituto. Publica uma página estática, o dado bruto e o código do modelo.

**Tese do projeto:** o valor não está em chegar mais perto do número verdadeiro que
qualquer instituto isolado. Está em produzir uma medida honesta de quanto não sabemos,
e em expor o viés de cada fonte em vez de escondê-lo dentro de uma média.

---

## Estado

Implementado (T-01 a T-14): contratos, banco, modelo, validação, diagnósticos,
backtest, design system, página e orquestração. `pnpm verify` verde, 330 testes.

Duas pendências conhecidas, ambas registradas em
[docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md):

- **Q-07** — o backtest de 2022 (gate M-7) REPROVA honestamente. Enquanto isso, o
  ModelJob não dispara publicação sozinho. É decisão de metodologia, não bug.
- **Q-09** — o cliente do PesqEle foi escrito contra uma estrutura suposta do site
  e devolve zero registro contra o TSE real. Reescrita especificada em
  [tasks/T-15-pesqele-real.md](tasks/T-15-pesqele-real.md). **Até ela, não há dado
  de pesquisa no sistema** e o site publica o estado vazio explicado.

## Subir tudo localmente

Um comando, depois de copiar o `.env` (não há segredo nele):

```bash
cp .env.example .env      # no Windows: Copy-Item .env.example .env
docker compose up
```

Sobe Postgres, roda as migrations, semeia as tabelas de referência, executa uma
passagem do pipeline (discovery → harvest → model → render) e serve o site:

| | |
|---|---|
| site | <http://localhost:8080> |
| dado público | <http://localhost:8080/data.json> |
| saúde interna | <http://localhost:8081/health> |

O `.env.example` documenta cada variável. As flags de boot
(`SEED_REFERENCE_ON_BOOT`, `RUN_JOBS_ON_BOOT`, `RENDER_ON_BOOT`,
`PUBLISH_PLACEHOLDER_WHEN_EMPTY`) existem para o ciclo local ser imediato — em
produção as quatro ficam `false` e valem o cron de `docs/02` §3 e o deploy de
`infra/docker-compose.prod.yml`.

### Postgres compartilhado entre projetos

O serviço `postgres` deste compose é o servidor de desenvolvimento da máquina —
container `dev-postgres`, rede `dev-shared`, volume `dev_pgdata`, porta 5432. A
lista `POSTGRES_DATABASES` do `.env` diz quais bancos garantir a cada `up`
(idempotente), então plugar outro projeto é acrescentar um nome ali. Aplicações
que rodam fora do Docker conectam em `localhost:5432`; containers de outros
projetos entram na rede `dev-shared` e usam o host `dev-postgres`.

## Ordem de leitura

| # | Documento | O que resolve |
|---|---|---|
| 1 | [docs/00-PRD.md](docs/00-PRD.md) | Por que existe, para quem, o que está fora de escopo |
| 2 | [docs/01-METHODOLOGY.md](docs/01-METHODOLOGY.md) | O modelo estatístico. **Fonte de verdade — contradições resolvem a favor deste arquivo** |
| 3 | [docs/02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) | Componentes, fluxo, decisões de stack |
| 4 | [docs/03-DATA-MODEL.md](docs/03-DATA-MODEL.md) | Schema Postgres e contratos TypeScript |
| 5 | [docs/04-INGESTION-SPEC.md](docs/04-INGESTION-SPEC.md) | PesqEle, adapters por instituto, validação |
| 6 | [docs/05-DESIGN-SYSTEM.md](docs/05-DESIGN-SYSTEM.md) | Tokens, tipografia, paleta, movimento |
| 7 | [docs/06-FRONTEND-SPEC.md](docs/06-FRONTEND-SPEC.md) | Estrutura da página, componentes, copy |
| 8 | [docs/07-QUALITY-GATES.md](docs/07-QUALITY-GATES.md) | Validação, backtest 2022, definition of done |
| 9 | [docs/08-LEGAL-ETHICS.md](docs/08-LEGAL-ETHICS.md) | Lei 9.504, robots.txt, o que nunca republicar |

Regras operacionais para agentes: [CLAUDE.md](CLAUDE.md)
Pacotes de trabalho: [tasks/README.md](tasks/README.md)

## Comandos

Fora do Docker (exige pnpm e Node 22):

```bash
pnpm install
pnpm db:up              # postgres via docker compose
pnpm db:migrate
pnpm ingest:discover    # PesqEle -> poll_registrations
pnpm ingest:harvest     # adapters -> poll_results
pnpm model:run          # estima house effects + série latente
pnpm model:backtest     # roda contra 2022, imprime erro vs urnas
pnpm render             # gera dist/ estático
pnpm test               # unit + contract
pnpm verify             # lint + typecheck + test + backtest gate
```

## Licença

Código MIT. Dados agregados sob CC BY 4.0. Textos de terceiros nunca são
armazenados nem republicados — ver `docs/08-LEGAL-ETHICS.md`.
