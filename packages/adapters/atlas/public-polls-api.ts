/**
 * Fronteira HTTP da API pública de releases da AtlasIntel
 * (`GET /api/public-polls/<categoria>?limit=&page=`). É a MESMA requisição que o
 * site faz para renderizar a listagem — descoberta no bundle do próprio site, não
 * suposta (ver `constants.ts` e `__fixtures__/README.md`).
 *
 * Zod na fronteira (CLAUDE.md): o corpo cru é validado aqui e só então circula
 * tipado. Tipos derivados do schema (`z.infer`), nunca declarados em paralelo.
 *
 * R3 na prática: modelamos SÓ os campos factuais que usamos. O campo
 * `description` do feed é um parágrafo autoral do instituto — não é declarado no
 * schema, então o Zod o DESCARTA e ele nunca entra em objeto nosso. O mesmo vale
 * para `thumbnail`. O corpo bruto continua indo para `raw_documents` como
 * proveniência (responsabilidade do HarvestJob), nunca republicado.
 *
 * R4 na prática: entrada malformada LANÇA. Não existe "pula a entrada ruim e
 * segue": uma entrada sem `file` ou sem data significa que a API mudou, e um
 * feed silenciosamente menor é exatamente o bug do Q-09 (sucesso com zero dado).
 * Verificado contra as 539 entradas reais das três categorias em 2026-08-17:
 * todas têm `file`, `file_created_on`, `date` no formato AAAA-MM-DD e
 * `status === 'published'`.
 */

import { z } from 'zod';
import { ParseError } from '../poll-source-adapter.js';
import {
  BRAZIL_COUNTRY_CODE,
  NATIONAL_RELEASE_TITLE,
  PUBLIC_POLLS_API_PATH,
  PUBLIC_POLLS_PAGE_LIMIT,
  RELEASE_LAG_MAX_DAYS,
  REPORT_CDN_CUTOFF_DATE,
  REPORT_CDN_ORIGIN_BEFORE_CUTOFF,
  REPORT_CDN_ORIGIN_FROM_CUTOFF,
  ATLAS_SITE_ORIGIN,
  POLL_PAGE_PATH,
} from './constants.js';
import type { PublicPollsCategory } from './constants.js';

/** Data pura AAAA-MM-DD, como o feed publica em `date`. */
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'campo `date` do feed fora do formato AAAA-MM-DD',
});

export const publicPollsEntrySchema = z.object({
  id: z.number().int().positive(),
  status: z.string().min(1),
  /** Rótulo da série ('Brazil: National', 'Brazil: Ceará | …'). Identificador. */
  title: z.string().min(1),
  slug: z.string().min(1),
  /** Data de PUBLICAÇÃO do release (não é data de campo). */
  date: dateOnly,
  /** Nome do arquivo do relatório no CDN ('<uuid>.pdf'). */
  file: z.string().min(1),
  /** Timestamp de criação do arquivo — é o que decide QUAL CDN serve o PDF. */
  file_created_on: z.string().min(1),
  country_code: z.string().min(1),
});
export type PublicPollsEntry = z.infer<typeof publicPollsEntrySchema>;

export const publicPollsResponseSchema = z.object({
  data: z.array(publicPollsEntrySchema),
});
export type PublicPollsResponse = z.infer<typeof publicPollsResponseSchema>;

/** URL da requisição que o site faz (mesma forma, mesmo `limit`). */
export const publicPollsUrl = (
  category: PublicPollsCategory,
  page = 1,
  limit = PUBLIC_POLLS_PAGE_LIMIT,
): string =>
  `${ATLAS_SITE_ORIGIN}${PUBLIC_POLLS_API_PATH}/${category}` +
  `?limit=${String(limit)}&page=${String(page)}`;

/** Página de detalhe do release (só metadado; usada como referência de fonte). */
export const pollPageUrl = (slug: string): string =>
  `${ATLAS_SITE_ORIGIN}${POLL_PAGE_PATH}/${slug}`;

/**
 * Valida o corpo cru do feed. LANÇA `ParseError` se o JSON for inválido ou se a
 * forma não casar o schema — nunca devolve lista parcial nem vazia por omissão.
 */
export const parsePublicPollsFeed = (body: string, sourceUrl: string): PublicPollsResponse => {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch (err) {
    throw new ParseError(`Corpo de ${sourceUrl} não é JSON válido`, err);
  }
  const result = publicPollsResponseSchema.safeParse(json);
  if (!result.success) {
    throw new ParseError(
      `Feed de releases da AtlasIntel em forma inesperada (${sourceUrl}): ${result.error.message}`,
      result.error,
    );
  }
  return result.data;
};

/**
 * Monta a URL do relatório aplicando a regra REAL de corte de CDN do site: o
 * arquivo criado ANTES de `REPORT_CDN_CUTOFF_DATE` é servido por
 * `cdn.atlasintel.org`; no corte ou depois, por `cdn1.atlasintel.org`.
 *
 * LANÇA se `file_created_on` não for uma data reconhecível (R4): sem saber a
 * data não há como saber o host, e chutar um deles produziria 403/404 mudo.
 */
export const buildReportUrl = (entry: PublicPollsEntry): string => {
  const createdDay = entry.file_created_on.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDay)) {
    throw new ParseError(
      `Release ${String(entry.id)} (${entry.slug}) com file_created_on ilegível: ` +
        `"${entry.file_created_on}" — sem a data não é possível decidir o CDN`,
    );
  }
  // Comparação lexicográfica de AAAA-MM-DD é equivalente à cronológica.
  const origin =
    createdDay >= REPORT_CDN_CUTOFF_DATE
      ? REPORT_CDN_ORIGIN_FROM_CUTOFF
      : REPORT_CDN_ORIGIN_BEFORE_CUTOFF;
  return `${origin}/${entry.file}`;
};

/** Soma dias a uma data pura AAAA-MM-DD, devolvendo AAAA-MM-DD. */
const addDays = (day: string, days: number): string => {
  const ms = Date.UTC(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
  );
  const shifted = new Date(ms + days * 24 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
};

/**
 * Filtra do feed os releases que PODEM ser a rodada nacional presidencial de um
 * registro: país Brasil, título exato da série nacional, e data de publicação na
 * janela `[fieldEnd, fieldEnd + RELEASE_LAG_MAX_DAYS]`.
 *
 * A janela é só um FILTRO de candidatos — a confirmação de identidade é o V6 do
 * `BaseAdapter` sobre o texto do documento. Nunca assumimos que o candidato mais
 * próximo é a rodada certa (docs/04 §4.1: atribuir números da rodada errada é o
 * pior bug do sistema).
 */
export const selectNationalReleases = (
  entries: readonly PublicPollsEntry[],
  fieldEndDay: string,
): PublicPollsEntry[] => {
  const from = fieldEndDay.slice(0, 10);
  const to = addDays(from, RELEASE_LAG_MAX_DAYS);
  return entries.filter(
    (e) =>
      e.country_code === BRAZIL_COUNTRY_CODE &&
      e.title === NATIONAL_RELEASE_TITLE &&
      e.date >= from &&
      e.date <= to,
  );
};
