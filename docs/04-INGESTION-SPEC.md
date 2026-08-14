# Ingestão

## 1. Hierarquia de fontes

Ordem obrigatória. Só desça um nível quando o anterior não tiver o dado.

| Nível | Fonte | O que fornece |
|---|---|---|
| 1 | **PesqEle** (`pesqele-divulgacao.tse.jus.br`) | Metadata canônica: `tse_id`, instituto, contratante, datas de campo, amostra, margem, custo. **Não fornece resultado** — apresentação de resultados não é obrigatória no registro. |
| 2 | **Site do próprio instituto** | Resultado, primeira mão |
| 3 | Release em PDF do contratante (ex.: CNT) | Resultado, primeira mão |
| 4 | Imprensa | Só quando 2 e 3 não existem (caso Datafolha, atrás de paywall) |

Nível 4 exige aprovação explícita e registro em `docs/OPEN-QUESTIONS.md` com o
motivo. Não é o caminho padrão.

## 2. PesqEle

Sistema JSF (`.xhtml`) com `ViewState`. Implicações práticas para o adapter:

- Sessão precisa ser estabelecida (GET inicial) antes de qualquer POST de filtro
- `javax.faces.ViewState` deve ser extraído do HTML e reenviado a cada passo
- Paginação também é POST com ViewState; não dá para pular para a página N por URL
- É frágil por natureza — trate mudança de estrutura como evento esperado, não
  excepcional

**Filtros a usar:** eleição = 2026, abrangência = nacional (BR), período = janela
móvel dos últimos 30 dias.

**Requisito crítico:** os dados ficam disponíveis por apenas **30 dias**. O
`DiscoveryJob` precisa rodar desde já e persistir tudo. Registro capturado nunca é
deletado; se sumir da origem, marca `source_expired_at`.

**Classificação de `contractor_type`:** tabela de regras explícita em
`packages/adapters/pesqele/contractor-classifier.ts`, com match por CNPJ quando
disponível e por lista de padrões de nome como fallback. Sem match ⇒
`'desconhecido'`. Nunca chute.

## 3. Adapters da v1

Implementar nesta ordem. Os dois primeiros são os mais bem-comportados e servem
de referência para o padrão.

| Ordem | Adapter | Fonte | Formato | Observação |
|---|---|---|---|---|
| 1 | `nexus` | `nexus.fsb.com.br/estudos-divulgados` | HTML + PDF | Publica rodada semanal com texto estruturado |
| 2 | `cnt-mda` | Portal CNT | PDF (relatório completo) | Relatório mais completo do mercado; vale extrair decomposição inteira |
| 3 | `quaest` | Site Quaest / Genial | HTML + PDF | |
| 4 | `atlasintel` | `atlasintel.org` | HTML | Painel online — método diferente, importante para o modelo |
| 5 | `poderdata` | Poder360 | HTML | Parte do conteúdo é fechado; extrair só o aberto |

Institutos sem publicação própria acessível (Datafolha, Ideia/Meio, Gerp, Futura)
ficam para v1.1, com decisão registrada.

## 4. Contrato do adapter

```ts
interface PollSourceAdapter {
  readonly id: string;
  readonly instituteId: string;

  canHandle(reg: PollRegistration): boolean;

  /** URLs candidatas onde o resultado desta rodada provavelmente está. */
  discover(reg: PollRegistration): Promise<SourceCandidate[]>;

  /** Extrai. Lança ParseError se não conseguir. NUNCA retorna parcial. */
  parse(raw: RawDocument, reg: PollRegistration): Promise<ParsedPoll>;
}

type ParsedPoll = {
  tseId: string;                 // deve bater com reg.tseId — se não bater, lança
  scenarios: Array<{
    kind: 't1_estimulado' | 't1_espontaneo' | 't2';
    label: string;
    t2Pair?: [string, string];
    values: Array<{ candidateAlias: string; valuePct: number }>;
    blankNullPct?: number;
    undecidedPct?: number;
  }>;
};
```

### 4.1 Regras de parsing

- **Confirmação de identidade obrigatória.** O documento precisa conter o `tse_id`
  do registro. Se não contiver, é outro levantamento: lança. Isso previne o pior
  bug possível do sistema — atribuir números da rodada errada.
- Números em português: `38,8` → `38.8`. Um helper único
  (`packages/adapters/parse-ptbr-number.ts`) faz isso. Não replique a lógica.
- Não deduza valor ausente. Candidato que não aparece no cenário simplesmente não
  entra — não vira `0`.
- Alias de candidato desconhecido ⇒ lança `UnknownCandidateError` e o registro entra
  em quarentena para revisão manual. **Nunca crie candidato automaticamente.**

## 5. Validação bloqueante

Roda em `ParsedPoll` antes de qualquer `INSERT`. Falha em qualquer regra ⇒ nada é
persistido, evento logado em nível `error`, adapter marcado como suspeito.

| # | Regra | Limite |
|---|---|---|
| V1 | Soma de candidatos + brancos/nulos + indecisos | 97 ≤ soma ≤ 103 |
| V2 | Nenhum candidato acima de | 70% |
| V3 | Cenário de 2º turno tem exatamente 2 candidatos | — |
| V4 | Delta vs. rodada anterior **do mesmo instituto**, por candidato | ≤ 10 p.p. |
| V5 | Delta vs. `μ_t` corrente, por candidato | ≤ 15 p.p. |
| V6 | `tse_id` extraído bate com o do registro | exato |
| V7 | Nº de candidatos no cenário canônico | 2 ≤ n ≤ 20 |

V4 e V5 podem legitimamente disparar em movimento real (desistência, escândalo).
Nesse caso a resolução é humana: existe `pnpm ingest:approve <tse_id>` que insere
com flag `manually_approved` e a razão registrada. **Não relaxe os limites.**

## 6. Educação do crawler

Não-negociável, verificado em teste de integração:

- `robots.txt` consultado e respeitado antes de toda requisição, com cache de 24h
- `User-Agent: election-pool/1.0 (+https://<dominio>/metodologia; <contato>)`
- Máximo 1 requisição a cada 10s por host
- Conditional GET com `If-None-Match` / `If-Modified-Since`
- Timeout 20s, máximo 2 retries, backoff exponencial com jitter
- Sem headless browser na v1

Fonte que retornar 403/429 duas vezes é desabilitada automaticamente e vira alerta.
Não insista.

## 7. Reprocessamento

`pnpm ingest:reparse --adapter=nexus --since=2026-07-01` roda o parser atual sobre
os `raw_documents` já armazenados, sem rede. Isso é o que torna a correção de bug
de parser barata — e é a razão de guardar o raw.

Reparse cria novos `poll_scenarios` e marca os antigos como superados. Nunca faz
`UPDATE` (`docs/03` §2.4).
