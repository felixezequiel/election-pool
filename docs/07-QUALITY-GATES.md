# Quality gates

## 1. Filosofia

Publicar dado velho é aceitável. Publicar dado errado não é. Todo gate deste
documento é **bloqueante**: falhou, não publica, a versão anterior fica no ar e um
alerta é emitido.

## 2. Gates de ingestão

Rodam por pesquisa, antes do `INSERT`. Detalhe em `docs/04-INGESTION-SPEC.md` §5
(V1–V7). Falha ⇒ nada persistido, adapter marcado suspeito.

## 3. Gates de modelo

Rodam ao fim de `ModelJob`, antes de gravar `gates_passed = true`.

| # | Gate | Critério |
|---|---|---|
| M-1 | Cobertura | ≥ 3 pesquisas de ≥ 2 institutos distintos na janela de 45 dias |
| M-2 | Soma | Σ `μ_t` dos rastreados + resíduo ∈ [97, 103] antes da normalização |
| M-3 | Continuidade | Nenhum `μ_t` move > 5 p.p. entre dois runs consecutivos |
| M-4 | Sanidade da banda | Largura do IC 90% ∈ [1,5 ; 15] p.p. Banda estreita demais é bug, larga demais é inútil |
| M-5 | Convergência | Filtro de Kalman não produziu `NaN`, `Infinity` nem variância negativa |
| M-6 | Determinismo | Segundo run com mesmo `input_hash` produz saída idêntica |
| M-7 | Backtest | §4 abaixo |

M-3 pode disparar legitimamente quando entra uma pesquisa muito divergente.
Resolução é humana, via `pnpm model:approve <run_id> --reason="..."`. **Não relaxe
o limite.**

## 4. Backtest 2022 — o gate que importa

### 4.1 Procedimento

1. Carregar as pesquisas presidenciais nacionais de 2022 (fixture versionada em
   `packages/model/__fixtures__/2022.json`, com `tse_id` de cada uma)
2. Rodar o modelo com `reference_date = 2022-10-01`, sem nenhum dado posterior
3. Converter a estimativa de intenção bruta para votos válidos
4. Comparar com o resultado oficial do 1º turno: **Lula 48,4% · Bolsonaro 43,2%**
5. Repetir para o 2º turno com `reference_date = 2022-10-29`, resultado oficial
   **Lula 50,9% · Bolsonaro 49,1%**

### 4.2 Critério de aprovação

O resultado oficial deve cair dentro do IC 90% para **ambos os candidatos**, nos
**dois turnos**. Quatro comparações, quatro aprovações necessárias.

### 4.3 Como interpretar

Leia isto antes de comemorar um backtest aprovado.

O modelo v1 usa restrição de soma-zero (`docs/01` §1.1). Ele **não tem mecanismo
para corrigir viés comum a todos os institutos**. No 1º turno de 2022 esse viés
comum existiu e foi grande — as pesquisas de véspera subestimaram Bolsonaro em 6 a
8 pontos, com Datafolha em 36%, Ipec em 37%, Ipespe em 35% e Quaest em 38%, contra
43,2% na urna.

Portanto: se o backtest passar, é quase certamente porque a banda ficou larga o
bastante para conter o erro, **não porque o modelo previu o desvio**. Isso é um
resultado legítimo — largura honesta é o produto — mas precisa ser comunicado como
tal, na UI, com essas palavras.

Se o backtest passar com banda estreita (< 4 p.p. de largura), desconfie: é mais
provável que haja vazamento de dado futuro na fixture do que genialidade no modelo.

### 4.4 Registro

Todo run de backtest grava em `docs/BACKTEST-RESULTS.md`: data, `model_version`,
`git_sha`, as quatro comparações com valor estimado, IC e valor oficial, e o
veredito. **Resultados reprovados também são registrados.** O histórico de falhas
é parte da credibilidade do projeto.

## 5. Gates de código

`pnpm verify` roda tudo e é o gate de CI:

```
lint          eslint, prettier --check
typecheck     tsc --noEmit em todos os pacotes
test:unit     vitest
test:arch     packages/model não importa de apps/; sem barrel files
test:bias     no-directional-bias.spec.ts (R2 do CLAUDE.md)
test:contract enums TS == CHECKs das migrations; data.json valida contra Zod
test:model    determinismo + backtest
build         astro build sem warning
```

### 5.1 `no-directional-bias.spec.ts`

Lê todo arquivo em `packages/model/**` e falha se encontrar:

- Nome próprio de candidato ou partido brasileiro (lista em fixture)
- Termo de espectro político (`esquerda`, `direita`, `left`, `right`, `centro`)
- Constante numérica não declarada em `packages/contracts/constants.ts`

O modelo tem que ser incapaz de saber de quem está falando. Se ele precisar saber,
o design está errado.

## 6. Gates de publicação

`RenderJob` só executa o swap atômico se **todos** forem verdade:

- [ ] `model_runs.gates_passed = true` no run mais recente
- [ ] `data.json` valida contra o schema Zod de `packages/contracts/public-data.ts`
- [ ] `astro build` terminou com código 0 e sem warning
- [ ] `dist-staging/index.html` existe e tem > 10 KB
- [ ] `dist-staging/data.json` existe e é JSON parseável
- [ ] Nenhum adapter em estado `suspeito` há mais de 3 ciclos
- [ ] `generatedAt` do novo build é mais recente que o do `dist/` atual

Falhou qualquer um: aborta, mantém `dist/` atual, emite alerta.

## 7. O gate humano

Antes de publicar em domínio público pela primeira vez, e depois a cada mudança de
`MODEL_VERSION`:

1. O backtest de 2022 passou e o resultado está em `docs/BACKTEST-RESULTS.md`
2. A página de metodologia contém `docs/01` §10 na íntegra, sem edição
3. Um leitor externo, sem contexto, consegue dizer o que o site **não** afirma
4. Nenhum texto do site avalia candidato ou instituto em termos morais
5. O `data.json` está público e a licença está declarada

Item 3 é o mais importante e o mais fácil de falhar. Teste com uma pessoa real.
