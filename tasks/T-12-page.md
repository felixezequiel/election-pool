---
id: T-12
title: Página, copy e CTA de outras disputas
status: done
depends_on: [T-11]
owns: [apps/web/src/pages/**, apps/web/src/components/sections/**, apps/web/astro.config.mjs]
spec: docs/06-FRONTEND-SPEC.md
---

# T-12 — Página

## Entregável

- Astro `output: 'static'`, **tema escuro por padrão**, ilhas conforme `docs/06` §1
- Seções 01–10 de `docs/06` §2, na ordem
- Rotas `/`, `/metodologia`, `/dados`
- `/metodologia` contém `docs/01` §10 **na íntegra, sem editar nem resumir**, e
  explica a restrição de soma-zero e o que ela não resolve
- Hero conforme `docs/06` §4: a tese, não um número grande
- Seção de diagnósticos conforme `docs/06` §5 — explicação inocente no mesmo bloco
  e no mesmo peso visual do indicador
- **CTA de outras disputas** (`docs/06` §6): renderizado de `data.otherRaces`,
  nunca hardcoded. Sem campo de e-mail, sem botão
- `data.json` importado em build time, sem fetch em runtime
- `NextUpdateCountdown` no cabeçalho: contagem regressiva ao vivo `HH:MM:SS` a partir de
  `nextUpdateAt`, com rollover e fallback estático (`docs/06` §9)
- Números de destaque via `<AnimatedNum>`, sempre com `UncertaintyRule`

## Aceite

- [ ] Auditoria visual completa de `docs/06` §8, item a item
- [ ] JS comprimido < 120 KB; LCP < 1,8s em 4G simulado; CLS < 0,02
- [ ] Nenhum número de destaque sem `UncertaintyRule`
- [ ] Toda pesquisa exibida mostra `tse_id`
- [ ] Nenhum texto de terceiros em lugar nenhum — só números, metadata e link
- [ ] Nenhuma palavra da lista proibida de `docs/08` §5 aparece no site
- [ ] Adicionar uma corrida `planejado` em `races.ts` faz o item aparecer sem
      tocar em nenhum arquivo de componente
- [ ] Estado vazio testado: sem pesquisa na janela, a página é útil e não pede desculpa
- [ ] `generatedAt` visível no cabeçalho, não só no rodapé
- [ ] `NextUpdateCountdown` conta certo, faz rollover ao zerar e cai para valor estático
      sob `prefers-reduced-motion`

## Armadilhas

- O hero não é "Lula 40,8%". Um número grande sozinho é exatamente o gênero que
  este projeto critica
- Vocabulário: nada de "revela", "crava", "dispara", "encosta"
