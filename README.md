# election-pool

Agregador de pesquisas eleitorais brasileiras com estimativa explícita de *house effect*
por instituto. Publica uma página estática, o dado bruto e o código do modelo.

**Tese do projeto:** o valor não está em chegar mais perto do número verdadeiro que
qualquer instituto isolado. Está em produzir uma medida honesta de quanto não sabemos,
e em expor o viés de cada fonte em vez de escondê-lo dentro de uma média.

---

## Estado

Pré-implementação. Este repositório contém apenas especificação. Nenhum código foi escrito.

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
