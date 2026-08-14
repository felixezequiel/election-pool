# Modelo de dados

## 1. Princípio

Três camadas, com direção de dependência única:

```
raw (imutável)  ──►  normalized (imutável)  ──►  computed (regenerável)
```

Nada em `computed` é fonte de verdade. Apagar `model_runs` e `model_estimates` e
rodar de novo tem que produzir exatamente o mesmo resultado (`docs/01` §9).

## 2. Schema

### 2.1 Referência

```sql
CREATE TABLE institutes (
  id              text PRIMARY KEY,           -- 'quaest', 'cnt-mda', 'nexus'
  display_name    text NOT NULL,              -- 'Genial/Quaest'
  legal_name      text,                       -- razão social no PesqEle
  cnpj            text,
  primary_method  text NOT NULL               -- ver enum §3
    CHECK (primary_method IN ('presencial','telefone','painel_online','misto')),
  site_url        text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE institute_aliases (
  alias        text PRIMARY KEY,              -- como aparece no PesqEle/imprensa
  institute_id text NOT NULL REFERENCES institutes(id)
);

CREATE TABLE candidates (
  id            text PRIMARY KEY,             -- 'lula', 'flavio-bolsonaro'
  display_name  text NOT NULL,
  party         text,
  color_slot    smallint NOT NULL,            -- 1..8, ver docs/05 §4
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Normalização de nomes é MANUAL. Nunca fuzzy match (CLAUDE.md).
CREATE TABLE candidate_aliases (
  alias         text PRIMARY KEY,
  candidate_id  text NOT NULL REFERENCES candidates(id)
);

CREATE TABLE races (
  id          text PRIMARY KEY,               -- 'presidencia-2026'
  display_name text NOT NULL,
  status      text NOT NULL CHECK (status IN ('ativo','planejado','encerrado')),
  sort_order  smallint NOT NULL
);
```

### 2.2 Raw

```sql
CREATE TABLE raw_documents (
  id            uuid PRIMARY KEY,
  url           text NOT NULL,
  fetched_at    timestamptz NOT NULL,
  http_status   smallint NOT NULL,
  content_type  text,
  content_hash  text NOT NULL,               -- sha256 do corpo
  storage_path  text NOT NULL,               -- caminho no blob local, NUNCA servido
  etag          text,
  last_modified text
);
CREATE INDEX ON raw_documents (url, fetched_at DESC);
```

> `raw_documents` existe para proveniência e depuração. Nunca é exposto na web
> nem republicado. Ver `docs/08-LEGAL-ETHICS.md`.

### 2.3 Registros do PesqEle

```sql
CREATE TABLE poll_registrations (
  tse_id             text PRIMARY KEY,        -- 'BR-06591/2026' — chave canônica
  race_id            text NOT NULL REFERENCES races(id),
  institute_id       text REFERENCES institutes(id),   -- null se alias desconhecido
  institute_raw_name text NOT NULL,
  contractor_name    text NOT NULL,           -- quem pagou
  contractor_type    text                     -- ver enum §3
    CHECK (contractor_type IN ('proprio','veiculo','instituicao_financeira',
                               'partido','campanha','entidade','outro','desconhecido')),
  registered_at      timestamptz NOT NULL,
  field_start        date NOT NULL,
  field_end          date NOT NULL,
  sample_size        integer NOT NULL CHECK (sample_size > 0),
  margin_of_error    numeric(4,2),            -- p.p.
  confidence_level   numeric(4,2),            -- normalmente 95.00
  cost_brl           numeric(12,2),
  first_seen_at      timestamptz NOT NULL DEFAULT now(),
  source_expired_at  timestamptz,             -- quando sumiu do PesqEle
  disclosure_status  text NOT NULL DEFAULT 'pending'
    CHECK (disclosure_status IN ('pending','disclosed','presumed_undisclosed'))
);
CREATE INDEX ON poll_registrations (race_id, field_end DESC);
CREATE INDEX ON poll_registrations (institute_id, disclosure_status);
```

`disclosure_status = 'presumed_undisclosed'` é o que alimenta a taxa de
engavetamento. É **dado**, não erro de pipeline.

### 2.4 Resultados normalizados

```sql
CREATE TABLE poll_scenarios (
  id                uuid PRIMARY KEY,
  tse_id            text NOT NULL REFERENCES poll_registrations(tse_id),
  raw_document_id   uuid NOT NULL REFERENCES raw_documents(id),
  kind              text NOT NULL CHECK (kind IN ('t1_estimulado','t1_espontaneo','t2')),
  label             text NOT NULL,            -- rótulo do instituto: 'Cenário 1'
  is_canonical      boolean NOT NULL DEFAULT false,
  canonical_reason  text,                     -- regra aplicada, docs/01 §3
  t2_pair           text[],                   -- [candidate_id, candidate_id], ordenado
  blank_null_pct    numeric(5,2),
  undecided_pct     numeric(5,2),
  extracted_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tse_id, kind, label)
);

CREATE TABLE poll_results (
  scenario_id   uuid NOT NULL REFERENCES poll_scenarios(id),
  candidate_id  text NOT NULL REFERENCES candidates(id),
  value_pct     numeric(5,2) NOT NULL CHECK (value_pct >= 0 AND value_pct <= 100),
  PRIMARY KEY (scenario_id, candidate_id)
);
```

**`poll_results` é append-only.** Correção de erro de extração se faz criando um
novo `poll_scenarios` e marcando o antigo como superado — nunca com `UPDATE`.
Trigger no banco impede `UPDATE` e `DELETE`.

### 2.5 Computed

```sql
CREATE TABLE model_runs (
  id             uuid PRIMARY KEY,
  race_id        text NOT NULL REFERENCES races(id),
  model_version  text NOT NULL,
  run_at         timestamptz NOT NULL DEFAULT now(),
  reference_date date NOT NULL,
  input_hash     text NOT NULL,               -- docs/01 §9
  git_sha        text NOT NULL,
  params_json    jsonb NOT NULL,              -- todos os priors, explícitos
  gates_passed   boolean NOT NULL,
  gates_json     jsonb NOT NULL
);

CREATE TABLE model_estimates (           -- série latente μ_t
  run_id        uuid NOT NULL REFERENCES model_runs(id),
  scenario_kind text NOT NULL,
  t2_pair       text[],
  candidate_id  text NOT NULL REFERENCES candidates(id),
  date          date NOT NULL,
  mean_pct      numeric(5,2) NOT NULL,
  lo90_pct      numeric(5,2) NOT NULL,
  hi90_pct      numeric(5,2) NOT NULL,
  PRIMARY KEY (run_id, scenario_kind, candidate_id, date, t2_pair)
);

CREATE TABLE model_house_effects (
  run_id        uuid NOT NULL REFERENCES model_runs(id),
  institute_id  text NOT NULL REFERENCES institutes(id),
  candidate_id  text NOT NULL REFERENCES candidates(id),
  effect_pp     numeric(5,2) NOT NULL,
  lo90_pp       numeric(5,2) NOT NULL,
  hi90_pp       numeric(5,2) NOT NULL,
  n_polls       integer NOT NULL,
  estimable     boolean NOT NULL,             -- false se n_polls < 3
  PRIMARY KEY (run_id, institute_id, candidate_id)
);

CREATE TABLE model_diagnostics (
  run_id      uuid NOT NULL REFERENCES model_runs(id),
  kind        text NOT NULL CHECK (kind IN ('gaveta','herding','divergencia')),
  subject_id  text NOT NULL,                  -- institute_id ou contractor_name
  value       numeric(8,4) NOT NULL,
  n           integer NOT NULL,
  payload     jsonb,
  PRIMARY KEY (run_id, kind, subject_id)
);
```

## 3. Enums em `packages/contracts`

Todos os `CHECK` acima têm contraparte em Zod. Fonte única:
`packages/contracts/enums.ts`. Um teste compara os valores do enum TS com os
`CHECK` da migration e falha se divergirem.

## 4. Regras de integridade

| Regra | Onde vive |
|---|---|
| `value_pct` entre 0 e 100 | CHECK no banco |
| Soma dos candidatos + brancos + indecisos ≈ 100 (±3) | Validação de aplicação, bloqueante |
| `field_end >= field_start` | CHECK |
| Um único `is_canonical = true` por `(tse_id, kind, t2_pair)` | Índice único parcial |
| `poll_results` imutável | Trigger `BEFORE UPDATE OR DELETE` que lança |
| Todo `candidate_id` exibido tem `color_slot` único dentro da corrida | Teste |

## 5. Contrato de saída — `data.json`

Único artefato público de dado. Versionado, com contrato Zod em
`packages/contracts/public-data.ts`.

```ts
type PublicData = {
  schemaVersion: '1';
  generatedAt: string;          // ISO-8601 com offset -03:00
  nextUpdateAt: string;         // ISO-8601 -03:00 — próximo slot de 2h; alimenta a contagem regressiva (docs/06 §9)
  updateIntervalMinutes: number;// 120 — cadência do pipeline (docs/02 §3)
  modelVersion: string;
  gitSha: string;
  race: { id: string; displayName: string };

  candidates: Array<{
    id: string; displayName: string; party: string | null; colorSlot: number;
  }>;

  institutes: Array<{
    id: string; displayName: string;
    method: 'presencial' | 'telefone' | 'painel_online' | 'misto';
  }>;

  // Série latente — a banda é o dado principal, a média é secundária
  latent: {
    firstRound: Array<{
      date: string;
      byCandidate: Record<string, { mean: number; lo90: number; hi90: number }>;
    }>;
    runoffs: Array<{
      pair: [string, string];
      series: Array<{
        date: string;
        byCandidate: Record<string, { mean: number; lo90: number; hi90: number }>;
      }>;
    }>;
  };

  // Pesquisas individuais — sempre com tse_id (R6)
  polls: Array<{
    tseId: string;
    instituteId: string;
    contractorName: string;
    contractorType: string;
    fieldStart: string; fieldEnd: string;
    sampleSize: number;
    marginOfError: number | null;
    firstRound: Record<string, number> | null;
    runoffs: Array<{ pair: [string, string]; values: Record<string, number> }>;
    sourceUrl: string;              // link para a fonte, nunca o texto dela
  }>;

  houseEffects: Array<{
    instituteId: string; candidateId: string;
    effect: number; lo90: number; hi90: number;
    nPolls: number; estimable: boolean;
  }>;

  diagnostics: {
    gaveta: Array<{ subjectId: string; subjectKind: 'institute' | 'contractor';
                    rate: number; registered: number; disclosed: number }>;
    herding: Array<{ windowEnd: string; ratio: number; nPolls: number;
                     flagged: boolean }>;
  };

  // Contexto histórico descritivo (docs/01 §7) — não entra no modelo
  historicalError: Array<{
    instituteId: string; election: string; round: 1 | 2;
    candidateLabel: string; signedErrorPp: number;
  }>;

  // Alimenta o bloco de CTA (docs/00 §7)
  otherRaces: Array<{ id: string; displayName: string;
                      status: 'ativo' | 'planejado' }>;

  methodologyNotes: string[];   // docs/01 §10, literal
};
```

Servido em `/data.json` com `Cache-Control: public, max-age=300` e CORS aberto.
É a API pública do projeto.
