/**
 * DiscoveryJob (docs/04 §2, T-05). Descobre e persiste os registros do PesqEle.
 *
 * Prioridade urgente: os dados do PesqEle expiram em 30 dias. Cada run captura a
 * janela móvel dos últimos 30 dias (eleição 2026, abrangência nacional) e faz
 * upsert por `tse_id`. NUNCA deleta: registro que sumiu da origem recebe
 * `source_expired_at` e permanece na tabela (docs/04 §2).
 *
 * A janela de 30 dias NÃO é uma consulta só: o PesqEle corta toda listagem em 50
 * registros, então o adapter varre a janela em FATIAS de data e alerta quando uma
 * fatia continua no teto mesmo subdividida (T-28, `docs/OPEN-QUESTIONS.md` Q-11).
 * O `sweep` do resultado é a contagem verificável dessa varredura: se
 * `truncagensSuspeitas` for maior que zero, o número colhido é um PISO e falta
 * registro. União com repetição é segura porque o upsert é idempotente.
 *
 * Idempotente:
 * - Rodar duas vezes seguidas não duplica nem altera `first_seen_at` (o upsert
 *   preserva o valor existente no conflito).
 * - Um registro reaparecido tem `source_expired_at` zerado (voltou à origem).
 *
 * Resiliência: transação POR PÁGINA. Uma falha de rede no meio da paginação não
 * corrompe o estado — as páginas já persistidas ficam, as seguintes são
 * retomadas no próximo run. Requisições ao TSE são SEQUENCIAIS (nunca paralelas).
 *
 * Cron: `0` minuto, a cada 2 horas (expressão "0 [asterisco]/2 [asterisco] [asterisco] [asterisco]").
 * Executável via `pnpm ingest:discover`. A expressão literal está em CRON_SCHEDULE.
 */

import pg from 'pg';
import type { QueryResultRow } from 'pg';
import { pollRegistrationSchema } from '@election-pool/contracts/domain';
import type { PollRegistration } from '@election-pool/contracts/domain';
import { DISCLOSURE_STATUS } from '@election-pool/contracts/enums';
import { HttpClient } from '@election-pool/adapters/http-client';
import { PesqEleClient } from '@election-pool/adapters/pesqele/client';
import type { PesqEleSweepStats } from '@election-pool/adapters/pesqele/client';
import { classifyContractor } from '@election-pool/adapters/pesqele/contractor-classifier';
import type { RawRegistration } from '@election-pool/adapters/pesqele/registration';
import { configurePgTypes } from '../db/types.js';
import { createDatabase } from '../db/pool.js';
import type { Database } from '../db/pool.js';
import { PollRegistrationsRepository } from '../db/poll-registrations.repository.js';
import { ReferenceRepository } from '../db/reference.repository.js';

const { Pool } = pg;

/**
 * Expressão cron do DiscoveryJob (T-05): minuto 0, a cada 2 horas. O
 * orquestrador (T-14) agenda o job com esta expressão. Mantida como constante
 * para não haver "número mágico" e para o agendador consumir daqui.
 */
export const CRON_SCHEDULE = '0 */2 * * *';

// docs/04 §2 — o mapa de corridas do PesqEle para os `race_id` internos é
// resolvido por rótulo. Enquanto o PesqEle só expõe presidencial nacional na v1,
// mapeamos pelo prefixo do rótulo. Rótulo não mapeado ⇒ registro é ignorado com
// alerta (não inventamos race_id).
const RACE_LABEL_PREFIX: ReadonlyArray<{ prefix: string; raceId: string }> = [
  // O PesqEle rotula "Presidente da República"; o id canônico é 'presidencia-2026'
  // (contracts/races). Casamos pelo prefixo 'presid' para tolerar variações.
  { prefix: 'presid', raceId: 'presidencia-2026' },
];

export interface DiscoveryAlert {
  /**
   * Alertas sem `tse_id` associado, todos vindos do adapter e todos sobre a MESMA
   * armadilha — sucesso silencioso:
   *
   * - `empty_search`: a varredura voltou VAZIA com filtro válido. Foi o silêncio
   *   nesse caso que escondeu o bug de T-05 por uma task inteira (Q-09).
   * - `truncation_suspected`: uma fatia de data continuou no teto de registros do
   *   PesqEle mesmo subdividida até um dia ⇒ há registro que não conseguimos ver e
   *   o total é um PISO (Q-11, T-28).
   * - `limit_mismatch`: o teto que o PesqEle declara mudou (ou o aviso sumiu). A
   *   detecção de truncagem depende desse número.
   */
  kind:
    | 'unknown_institute'
    | 'unmapped_race'
    | 'empty_search'
    | 'truncation_suspected'
    | 'limit_mismatch';
  tseId: string | null;
  detail: string;
}

export interface DiscoveryResult {
  seen: number;
  upserted: number;
  expired: number;
  alerts: DiscoveryAlert[];
  /**
   * Contagem da varredura fatiada do PesqEle (fatias, linhas, distintos, teto).
   * `null` só quando o adapter não a reportou — nunca zerada por conveniência.
   */
  sweep: PesqEleSweepStats | null;
}

const resolveRaceId = (raceLabel: string): string | null => {
  const normalized = raceLabel
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return RACE_LABEL_PREFIX.find((r) => normalized.startsWith(r.prefix))?.raceId ?? null;
};

/**
 * Executa `fn` dentro de UMA transação, com uma conexão dedicada. O pool `pg`
 * pode devolver conexões diferentes por `query`, então `BEGIN/COMMIT` no pool
 * NÃO seriam atômicos — por isso a transação recebe um `Database` amarrado a um
 * único client. Injetável para teste.
 */
export type WithTransaction = (fn: (tx: Database) => Promise<void>) => Promise<void>;

export interface DiscoveryDeps {
  /** Conexão de leitura/escrita fora de transação (sweep de expiração). */
  db: Database;
  /** Abre uma transação com conexão dedicada (persistência por página). */
  withTransaction: WithTransaction;
  pesqEle: PesqEleClient;
  now?: () => Date;
}

export class DiscoveryJob {
  private readonly db: Database;
  private readonly withTransaction: WithTransaction;
  private readonly pesqEle: PesqEleClient;
  private readonly now: () => Date;

  constructor(deps: DiscoveryDeps) {
    this.db = deps.db;
    this.withTransaction = deps.withTransaction;
    this.pesqEle = deps.pesqEle;
    this.now = deps.now ?? (() => new Date());
  }

  async run(): Promise<DiscoveryResult> {
    const runAt = this.now().toISOString();
    const alerts: DiscoveryAlert[] = [];
    const seenTseIds = new Set<string>();
    let upserted = 0;
    let sweep: PesqEleSweepStats | null = null;

    // O detalhe do PesqEle custa 2 requisições por registro e o rate limit é de
    // 1 req/10s (docs/04 §6). Como o registro é imutável depois de publicado, o
    // detalhe só é buscado para `tse_id` INÉDITO — decisão (a) da Q-09. O que já
    // está no banco continua contando como "visto" (não expira) via `onTseIdSeen`.
    const pages = this.pesqEle.discover({
      shouldFetchDetalhe: (tseId) => this.isUnknown(tseId),
      onTseIdSeen: (tseId) => seenTseIds.add(tseId),
      // O `kind` vem do adapter e é REPASSADO: fixá-lo em `empty_search` (como
      // era) transformaria uma suspeita de truncagem em "busca vazia" no log.
      onAlert: (alert) => alerts.push({ kind: alert.kind, tseId: null, detail: alert.detail }),
      onSweepStats: (stats) => {
        sweep = stats;
      },
    });

    for await (const rawPage of pages) {
      // Transação por página: falha de rede na página seguinte não desfaz esta.
      await this.persistPage(rawPage, runAt, seenTseIds, alerts);
      upserted += rawPage.length;
    }

    const revived = await this.reviveSeen(seenTseIds);
    const expired = await this.markAbsentAsExpired(seenTseIds, runAt);

    if (revived > 0) {
      console.warn(`[discovery] ${revived} registro(s) reapareceram na origem`);
    }
    return { seen: seenTseIds.size, upserted, expired, alerts, sweep };
  }

  /** `true` se o `tse_id` ainda não existe no banco (⇒ vale pagar o detalhe). */
  private async isUnknown(tseId: string): Promise<boolean> {
    const existing = await new PollRegistrationsRepository(this.db).findByTseId(tseId);
    return existing === null;
  }

  private async persistPage(
    page: readonly RawRegistration[],
    runAt: string,
    seenTseIds: Set<string>,
    alerts: DiscoveryAlert[],
  ): Promise<void> {
    await this.withTransaction(async (tx) => {
      const registrations = new PollRegistrationsRepository(tx);
      const reference = new ReferenceRepository(tx);
      for (const raw of page) {
        // Preserva o `disclosure_status` atual: o upsert do repositório sempre
        // sobrescreve a coluna, e é o HarvestJob (T-06) quem faz a transição
        // para `disclosed`/`presumed_undisclosed`. A descoberta não pode zerar
        // esse progresso — só define `pending` num registro novo.
        const existing = await registrations.findByTseId(raw.tseId);
        const reg = await this.toRegistration(raw, reference, runAt, existing, alerts);
        if (reg === null) continue;
        await registrations.upsert(reg);
        seenTseIds.add(reg.tseId);
      }
    });
  }

  /**
   * Converte um registro cru do PesqEle em `PollRegistration`. Resolve instituto
   * por alias (desconhecido ⇒ `institute_id = null` + alerta), classifica o
   * contratante (sem match ⇒ `'desconhecido'`, nunca chute). Reaparecimento
   * zera `source_expired_at`. Rótulo de corrida não mapeado ⇒ pula com alerta.
   */
  private async toRegistration(
    raw: RawRegistration,
    reference: ReferenceRepository,
    runAt: string,
    existing: PollRegistration | null,
    alerts: DiscoveryAlert[],
  ): Promise<PollRegistration | null> {
    const raceId = resolveRaceId(raw.raceLabel);
    if (raceId === null) {
      alerts.push({ kind: 'unmapped_race', tseId: raw.tseId, detail: raw.raceLabel });
      return null;
    }

    const instituteId = await reference.resolveInstituteAlias(raw.instituteName);
    if (instituteId === null) {
      // Alias desconhecido: grava o nome cru e sinaliza cadastro manual. Nunca
      // fuzzy match (CLAUDE.md).
      alerts.push({ kind: 'unknown_institute', tseId: raw.tseId, detail: raw.instituteName });
    }

    const contractorType = classifyContractor({
      contractorName: raw.contractorName,
      contractorCnpj: raw.contractorCnpj,
      instituteName: raw.instituteName,
    });

    // `first_seen_at` é gravado só na primeira vez (o upsert preserva no
    // conflito). Enviamos `runAt` como candidato; o banco mantém o antigo se já
    // existir. `source_expired_at = null`: se o registro reapareceu, "revive".
    // `disclosure_status`: novo ⇒ `pending`; existente ⇒ preserva (T-06 é dono).
    return pollRegistrationSchema.parse({
      tseId: raw.tseId,
      raceId,
      instituteId,
      instituteRawName: raw.instituteName,
      contractorName: raw.contractorName,
      contractorType,
      registeredAt: raw.registeredAt,
      fieldStart: raw.fieldStart,
      fieldEnd: raw.fieldEnd,
      sampleSize: raw.sampleSize,
      marginOfError: raw.marginOfError,
      confidenceLevel: raw.confidenceLevel,
      costBrl: raw.costBrl,
      firstSeenAt: existing?.firstSeenAt ?? runAt,
      sourceExpiredAt: null,
      disclosureStatus: existing?.disclosureStatus ?? DISCLOSURE_STATUS.pending,
    });
  }

  /**
   * "Revive" (zera `source_expired_at`) o registro que reapareceu na origem. Isso
   * antes acontecia de graça no upsert, mas o detalhe de um `tse_id` já conhecido
   * não é mais rebuscado (Q-09 (a)), então não há upsert para ele. Só toca linhas
   * que estão marcadas como expiradas — nunca reescreve dado de pesquisa (R5).
   */
  private async reviveSeen(seenTseIds: Set<string>): Promise<number> {
    if (seenTseIds.size === 0) return 0;
    const rows = await this.db.query<{ tse_id: string }>(
      `UPDATE poll_registrations
          SET source_expired_at = NULL
        WHERE source_expired_at IS NOT NULL
          AND tse_id = ANY($1::text[])
      RETURNING tse_id`,
      [[...seenTseIds]],
    );
    return rows.length;
  }

  /**
   * Marca como expirado todo registro que NÃO apareceu neste run mas que ainda
   * está "vivo" (`source_expired_at IS NULL`). Nunca deleta (docs/04 §2). Só
   * afeta registros que já estavam vivos — não ressuscita nem remexe expirados.
   */
  private async markAbsentAsExpired(seenTseIds: Set<string>, runAt: string): Promise<number> {
    const seen = [...seenTseIds];
    const rows = await this.db.query<{ tse_id: string }>(
      `UPDATE poll_registrations
          SET source_expired_at = $1
        WHERE source_expired_at IS NULL
          AND NOT (tse_id = ANY($2::text[]))
      RETURNING tse_id`,
      [runAt, seen],
    );
    return rows.length;
  }
}

/**
 * Constrói um `WithTransaction` a partir de um pool `pg`, usando UMA conexão
 * dedicada por transação (BEGIN/COMMIT/ROLLBACK atômicos) e devolvendo-a ao pool
 * ao final. Fora daqui (job/testes) ninguém precisa conhecer o `pg`.
 */
export const makePoolTransaction = (pool: pg.Pool): WithTransaction => {
  return async (fn) => {
    const client = await pool.connect();
    const tx: Database = {
      async query<Row extends QueryResultRow>(
        text: string,
        params?: readonly unknown[],
      ): Promise<Row[]> {
        const result = await client.query<Row>(
          text,
          params === undefined ? undefined : [...params],
        );
        return result.rows;
      },
      async end(): Promise<void> {
        // No-op: a conexão da transação é devolvida ao pool no `finally`.
      },
    };
    try {
      await client.query('BEGIN');
      await fn(tx);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  };
};

/**
 * Log da varredura fatiada. É a linha que precisa deixar ÓBVIO se algo foi
 * perdido: `truncadas>0` significa que existe registro no PesqEle que não
 * conseguimos ver, e `sweep=ausente` significa que nem sabemos dizer.
 */
const logSweep = (sweep: PesqEleSweepStats | null): void => {
  if (sweep === null) {
    console.warn('[discovery][sweep] ausente: o adapter não reportou a contagem da varredura');
    return;
  }
  const linha =
    `[discovery][sweep] janela=${sweep.janela.inicio}..${sweep.janela.fim} ` +
    `fatias=${sweep.fatias} linhas=${sweep.linhasVistas} distintos=${sweep.tseIdsDistintos} ` +
    `no_teto=${sweep.fatiasNoTeto} truncadas=${sweep.truncagensSuspeitas} ` +
    `teto_declarado=${sweep.limiteDeclarado ?? 'ausente'}`;
  if (sweep.truncagensSuspeitas > 0) {
    console.warn(`${linha} :: PERDA POSSÍVEL — o total colhido é um PISO`);
    return;
  }
  console.log(linha);
};

/** Ponto de entrada de `pnpm ingest:discover`. */
export const runDiscoveryJob = async (): Promise<DiscoveryResult> => {
  configurePgTypes();
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL não definida (veja infra/.env)');
  }
  const pool = new Pool({ connectionString });
  const db = createDatabase(pool);
  try {
    const job = new DiscoveryJob({
      db,
      withTransaction: makePoolTransaction(pool),
      pesqEle: new PesqEleClient({ http: new HttpClient() }),
    });
    const result = await job.run();
    console.log(
      `[discovery] seen=${result.seen} upserted=${result.upserted} expired=${result.expired} alerts=${result.alerts.length}`,
    );
    logSweep(result.sweep);
    for (const alert of result.alerts) {
      console.warn(`[discovery][alert] ${alert.kind} tse_id=${alert.tseId} :: ${alert.detail}`);
    }
    return result;
  } finally {
    await db.end();
  }
};
