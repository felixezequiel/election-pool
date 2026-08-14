# PRD — election-pool

## 1. Problema

Pesquisas eleitorais brasileiras são publicadas isoladamente, como manchete, com a
margem de erro em nota de rodapé. O leitor recebe um ponto ("Lula 40,8%") e nenhuma
informação sobre três coisas que mudam completamente a leitura:

1. **Erro amostral** não é o maior erro. Com n≈2.000, o desvio-padrão amostral em
   p≈0,40 é ~1,1 p.p. A divergência observada entre institutos no mesmo período é
   maior que isso, o que significa que o componente dominante é sistemático, não
   aleatório.
2. **House effect existe e é mensurável.** No 1º turno de 2022, as pesquisas de
   véspera subestimaram Jair Bolsonaro em 6 a 8 pontos enquanto erravam Lula por
   1,5 a 2,5 — erro assimétrico, não ruído.
3. **Nem toda pesquisa registrada é publicada.** O registro no PesqEle é obrigatório
   5 dias antes da divulgação; a divulgação não é obrigatória. Pesquisas que somem
   entre registro e publicação carregam informação sobre seletividade de quem pagou.

Agregadores existentes (Poder360, entre outros) resolvem parcialmente (1) e ignoram
(2) e (3), além de serem fechados — o leitor não pode auditar nem rodar outro modelo.

## 2. Proposta

Um agregador que trata pesquisa como **medição instrumentada**, não como notícia:

- Estima uma série latente de apoio (`μ_t`) com banda de credibilidade
- Estima e **publica** o house effect de cada instituto (`h_i`)
- Rastreia a taxa de "pesquisa engavetada" por instituto e por contratante
- Roda teste de *herding* (dispersão menor que a teoria prevê)
- Publica o dado bruto, a metodologia e o código

## 3. Público-alvo

Brasileiro politicamente engajado e numericamente alfabetizado: jornalista de dados,
analista político, operador de mercado que precifica risco eleitoral, cientista
político, desenvolvedor curioso. **Não é** público de portal de notícias.

Implicação de design: o leitor tolera — e espera — ver incerteza. Não simplifique
para caber em manchete. Mas ele também não vai ler um paper: o gráfico precisa
comunicar em 5 segundos e a metodologia precisa estar a um clique.

## 4. Objetivos

| # | Objetivo | Como se mede |
|---|---|---|
| O1 | Produzir estimativa agregada auditável | Todo número na página tem `tse_id`, `model_version` e link para o raw |
| O2 | Tornar house effect visível | Existe um gráfico dedicado a `h_i` com intervalo de credibilidade |
| O3 | Não enganar sobre precisão | Nenhum ponto central aparece na UI sem sua banda ao lado, na mesma escala |
| O4 | Ser reproduzível por terceiros | `data.json` público + modelo em `packages/model` roda offline sobre ele |
| O5 | Passar no backtest de 2022 | Ver gate em `docs/07-QUALITY-GATES.md` |

## 5. Não-objetivos (escopo explicitamente fora)

- **Não prevê o resultado da eleição.** O produto estima apoio *hoje*, com incerteza.
  Não há modelo de previsão, não há probabilidade de vitória. Isso é uma decisão de
  produto, não uma limitação técnica: probabilidade de vitória exige modelar
  correlação de erro entre estados e mudança de opinião até a data, e a comunicação
  disso falha sistematicamente com o público.
- Não faz recorte por estado, região ou demografia na v1.
- Não tem usuário logado, alerta, newsletter ou API autenticada.
- Não cobre disputas estaduais na v1 (mas a UI anuncia que virão — ver §7).
- Não emite opinião editorial. Nenhum texto do site avalia candidato ou instituto
  em termos morais; só em termos de propriedades mensuráveis da pesquisa.

## 6. Escopo v1

**Corrida:** Presidência da República, eleições 2026.

**Cenários rastreados:**
- 1º turno estimulado (cenário canônico, definido em `docs/01-METHODOLOGY.md` §3)
- 2º turno, todos os pares testados que incluam pelo menos um candidato com média
  agregada ≥ 5%

**Candidatos exibidos:** todos que aparecem em ≥ 3 pesquisas na janela ativa.
Abaixo disso entram em "Demais" (agrupado, sem estimativa individual).

**Fontes:** ver `docs/04-INGESTION-SPEC.md`. Meta v1: PesqEle + 5 institutos com
publicação própria.

**Entrega:** site estático em `dist/`, servido por nginx numa VPS. Sem SSR.

## 7. Call to action para outras disputas

A página deve conter, abaixo do conteúdo principal e acima do rodapé, um bloco
que comunique expansão sem prometer data:

- Título: `A mesma metodologia, em breve, para outras disputas`
- Lista das disputas planejadas com estado visual `planejado`:
  Governos estaduais · Senado · Aprovação presidencial
- Uma linha explicando *por que* a metodologia transfere: o modelo é agnóstico à
  corrida; só depende de haver múltiplos institutos medindo a mesma quantidade.
- Sem campo de e-mail, sem "avise-me". Não coletamos dado de ninguém.

Requisito de implementação: as disputas planejadas vêm de
`packages/contracts/races.ts`, com `status: 'ativo' | 'planejado'`. Adicionar uma
corrida futura não deve exigir mexer em JSX.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Autor injeta o próprio viés ao "corrigir" viés alheio | R1 e R2 em `CLAUDE.md`; backtest cego; modelo e dado públicos |
| Scraper quebra silenciosamente e publica número errado | Validação bloqueante (`docs/04` §5); nenhum publish sem gate verde |
| PesqEle expira dados em 30 dias | Job de captura diária desde o dia 1; snapshot persistido |
| Instituto bloqueia nosso crawler | User-Agent identificável com contato, conditional GET, respeito a robots.txt |
| Modelo estatisticamente errado passa despercebido | Backtest 2022 como gate de CI, não como exercício opcional |
| Leitor interpreta o agregado como previsão | Copy explícita, ausência de probabilidade de vitória, banda dominante no gráfico |

## 9. Marcos

| Marco | Conteúdo | Gate |
|---|---|---|
| M0 | Contratos + schema + migrations | `pnpm verify` verde |
| M1 | Ingestão PesqEle + 2 adapters | ≥ 20 pesquisas de 2026 no banco |
| M2 | Modelo + backtest 2022 | Backtest dentro do gate de `docs/07` |
| M3 | Design system + página estática | Auditoria visual de `docs/06` §8 |
| M4 | Orquestração (cron, render atômico, alerta) | 72h rodando sem intervenção |
