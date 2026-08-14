# Pacotes de trabalho

Cada arquivo `T-XX-*.md` é autocontido: contexto, entregável, critérios de aceite e
arquivos que pode tocar. Um subagent por task.

## Regras de orquestração

1. **T-01 roda sozinho, primeiro.** Ele define os contratos. Nada em paralelo com ele.
2. Depois de T-01, tasks com dependências satisfeitas rodam em paralelo, respeitando
   a regra: **duas tasks nunca tocam o mesmo arquivo**. O campo `owns` de cada task
   declara os caminhos que ela pode escrever.
3. Ao terminar: atualizar `status` no front matter e escrever em `tasks/LOG.md`.
4. Precisa mudar um contrato? **Pare.** Escreva em `docs/OPEN-QUESTIONS.md` e
   sinalize. Mudar contrato no meio invalida o trabalho de outros agentes.

## Grafo

```
T-01 contracts
  │
  ├──► T-02 db + migrations ──┬──► T-05 discovery (PesqEle)
  │                           └──► T-06 harvest + adapters ──► T-07 validação
  │
  ├──► T-03 model: kalman ────► T-04 model: house effects ──► T-08 diagnósticos
  │                                                             │
  │                                                             ▼
  │                                                          T-09 backtest 2022
  │
  ├──► T-10 design system (tokens, fontes, <Num>)
  │       └──► T-11 componentes de gráfico ──► T-12 página + CTA
  │
  └──► T-13 render job + swap atômico ──► T-14 orquestração + alerta
```

## Trilhas paralelas

Depois de T-01, três trilhas independentes:

| Trilha | Tasks | Toca |
|---|---|---|
| **Dados** | T-02, T-05, T-06, T-07 | `apps/api`, `packages/adapters`, `infra/migrations` |
| **Modelo** | T-03, T-04, T-08, T-09 | `packages/model` |
| **Interface** | T-10, T-11, T-12 | `apps/web` |

Só se encontram em T-13. A trilha do modelo usa fixtures, não banco — pode começar
antes de qualquer dado real existir. **Essa é a razão de `packages/model` ser puro.**

## Sequência sugerida

| Onda | Tasks | Paralelismo |
|---|---|---|
| 0 | T-01 | 1 agente |
| 1 | T-02, T-03, T-10 | 3 agentes |
| 2 | T-04, T-05, T-11 | 3 agentes |
| 3 | T-06, T-08, T-12 | 3 agentes |
| 4 | T-07, T-09, T-13 | 3 agentes |
| 5 | T-14 | 1 agente |

## Antes de abrir qualquer task

Leia, nesta ordem: `CLAUDE.md`, `docs/01-METHODOLOGY.md`, e o documento citado no
campo `spec` da task. Não comece sem isso — as regras R1 a R6 do `CLAUDE.md` são
mais importantes que qualquer instrução dentro de uma task individual.
