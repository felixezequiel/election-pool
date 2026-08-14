# Manual do agente — election-pool

Você está implementando um agregador de pesquisas eleitorais. Leia este arquivo
inteiro antes de escrever qualquer código.

## Hierarquia de autoridade

Quando dois documentos discordarem, vale nesta ordem:

1. `docs/01-METHODOLOGY.md` — o modelo estatístico é inegociável
2. `docs/08-LEGAL-ETHICS.md` — restrições legais e éticas
3. `docs/03-DATA-MODEL.md` — contratos de dados
4. Os demais documentos
5. Sua própria opinião sobre o que seria melhor

Se você acredita que a metodologia está errada, **pare e escreva a objeção em
`docs/OPEN-QUESTIONS.md`**. Não implemente uma versão alternativa.

## Regras que não se negociam

**R1 — Nunca ajuste o modelo para bater com a intuição.**
Se a saída parecer estranha, a resposta é investigar os dados de entrada, não
mexer em prior, peso ou constante. Toda mudança de modelo é um commit com
`model_version` incrementado e justificativa escrita *antes* de ver a nova saída.

**R2 — Nunca hardcode correção direcional por candidato ou espectro político.**
Proibido: `if (candidate.spectrum === 'right') value += 2`. House effect é
estimado a partir de dados, por instituto, sempre. Um teste automatizado
(`no-directional-bias.spec.ts`) faz grep no código do modelo procurando
referências a nomes de candidatos ou partidos e falha o build se encontrar.

**R3 — Nunca armazene nem republique texto de terceiros.**
Extraia números. O HTML/PDF bruto vai para blob storage como evidência de
proveniência e nunca é servido ao público. Ver `docs/08-LEGAL-ETHICS.md`.

**R4 — Falha alta, nunca silenciosa.**
Parser que não consegue extrair um valor lança. Validação que não passa bloqueia
a publicação. Nunca use fallback com valor default (`?? 0`, `|| 40`) em dado de
pesquisa. Um zero silencioso corrompe a média e ninguém percebe.

**R5 — Raw e computed são tabelas separadas.**
`poll_results` é imutável depois de inserido. Todo número derivado vive em
`model_runs` / `model_estimates`, versionado, e é regenerável a partir do raw
sem re-scraping.

**R6 — Toda pesquisa exibida mostra o registro TSE.**
Sem exceção. É exigência legal e é a nossa auditabilidade.

## Convenções de código

- TypeScript estrito. `strict: true`, `noUncheckedIndexedAccess: true`, sem `any`.
- Runtime validation com **Zod** em toda fronteira (HTTP, parser, arquivo, DB row).
  Tipo derivado do schema (`z.infer`), nunca declarado à mão em paralelo.
- Datas: sempre `America/Sao_Paulo`, sempre ISO-8601 com offset. Nunca `Date` nu
  em lógica de negócio — use um tipo `IsoDate` branded.
- Percentuais: armazenados como `numeric(5,2)` no Postgres e `number` em TS,
  sempre na escala 0–100 (nunca 0–1). Nomeie variáveis com sufixo `Pct`.
- Nomes de domínio em português (`pesquisa`, `instituto`, `cenario`), nomes
  técnicos em inglês (`repository`, `adapter`, `handler`). Não misture no mesmo
  identificador.
- Sem barrel files (`index.ts` reexportando). Import direto do arquivo.

## Estrutura de pastas alvo

```
apps/
  api/            NestJS: jobs, ingestão, modelo, render trigger
  web/            Astro: site estático
packages/
  contracts/      Zod schemas + tipos compartilhados
  model/          Implementação do modelo estatístico, puro, sem I/O
  adapters/       Um adapter por fonte
infra/
  docker-compose.yml
  migrations/
docs/
tasks/
```

`packages/model` **não pode importar nada de `apps/`**. É uma biblioteca pura
que recebe um array de observações e devolve estimativas. Isso é o que torna o
backtest possível. Um teste de arquitetura garante isso.

## Definition of done (vale para toda task)

Uma task só está pronta quando:

- [ ] Typecheck passa sem erro e sem `@ts-ignore`
- [ ] Testes novos cobrem o caminho feliz e pelo menos dois casos de borda
- [ ] `pnpm verify` passa inteiro
- [ ] Nenhum valor mágico: constantes vão para `packages/contracts/constants.ts`
      com comentário explicando a origem do número
- [ ] Se a task toca o modelo, o backtest de 2022 roda e o resultado é anexado
      ao PR (ver `docs/07-QUALITY-GATES.md`)
- [ ] Se a task toca UI, foi verificada em 375px, 768px e 1440px, com foco de
      teclado visível e `prefers-reduced-motion` respeitado

## Como trabalhar em paralelo (subagents)

Cada arquivo em `tasks/` é um pacote autocontido com dependências declaradas no
front matter. Regras de coordenação:

- Um subagent por task. Não abra duas tasks que tocam os mesmos arquivos.
- Tasks com `depends_on: []` podem começar imediatamente e em paralelo.
- **T-01 (contracts) é bloqueante para quase tudo.** Faça primeiro, sozinho.
- Ao terminar, atualize o campo `status` no front matter da task e escreva um
  parágrafo em `tasks/LOG.md` dizendo o que mudou e o que o próximo agente
  precisa saber.
- Se você precisar mudar um contrato em `packages/contracts`, **pare**: isso
  invalida o trabalho de outros agentes. Escreva a proposta em
  `docs/OPEN-QUESTIONS.md` e sinalize.

## O que não fazer

- Não instale biblioteca de gráfico pronta (Chart.js, Recharts, ECharts). O
  visual depende de controle total sobre o SVG. Use D3 apenas para escalas,
  formas e eixos — o render é nosso.
- Não adicione autenticação, painel admin, CMS ou banco de usuários. Não existe
  usuário logado neste produto.
- Não crie um `POST /api/polls`. Ingestão é por job, nunca por request.
- Não implemente scraping de portais de notícia antes de esgotar as fontes
  primárias listadas em `docs/04-INGESTION-SPEC.md`.
- Não use `localStorage` para nada que não seja preferência de tema.
