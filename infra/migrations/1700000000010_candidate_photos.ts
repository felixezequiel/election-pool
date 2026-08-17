import type { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';
import { PHOTO_FORMATS } from '@election-pool/adapters/tse-candidatos/image';

/**
 * Foto OFICIAL do candidato (T-17). Migration ADITIVA sobre `candidates`
 * (docs/03 §2.1) — não altera nem remove nada do que já existe.
 *
 * De onde a foto vem: SÓ do registro público de candidatura no TSE
 * (DivulgaCandContas). É registro da autoridade eleitoral, mesma natureza do dado
 * do PesqEle que já consumimos. Imagem de imprensa, agência, rede social ou banco
 * de imagens é obra protegida e está fora (docs/08 §2).
 *
 * Por que TODA coluna é nullable: a ausência de foto é um estado normal e
 * esperado — candidatura não encontrada, casamento ambíguo, ou o TSE não
 * autorizando a publicação. Nesse caso `photo_path` fica `null` e a UI cai para
 * monograma + cor. O que NÃO é aceitável é meia foto, e disso cuida o CHECK
 * `candidates_photo_all_or_nothing` abaixo (R4: nada de estado parcial silencioso).
 *
 * Colunas de auditoria (`photo_sha256`, `photo_bytes`, dimensões, `photo_captured_at`,
 * `photo_etag`/`photo_last_modified`) existem para dois fins: detectar troca de
 * foto sem comparar bytes toda hora, e provar qual arquivo estava no ar em que
 * data se alguém contestar. O CHECK do formato é derivado de `PHOTO_FORMATS`
 * (fonte única no código do adapter), no mesmo padrão dos enums de contracts nas
 * migrations de T-02.
 */

export const shorthands: ColumnDefinitions | undefined = undefined;

const inList = (values: readonly string[]): string => values.map((v) => `'${v}'`).join(',');

const ALL_OR_NOTHING = 'candidates_photo_all_or_nothing';
const CANDIDATURA_UNIQUE = 'candidates_photo_tse_candidatura_id_unique';

export function up(pgm: MigrationBuilder): void {
  pgm.addColumns('candidates', {
    // Caminho servido pelo site estático, ex.: '/candidatos/lula.jpg'. É o valor
    // que vai para `photoPath` em contracts/public-data.ts.
    photo_path: { type: 'text' },
    // Proveniência (R6): link do registro de candidatura no Divulga que originou
    // a foto. Sempre link, nunca conteúdo de terceiro (docs/08 §2.1).
    photo_source_url: { type: 'text' },
    // `sq_CANDIDATO` do TSE — o identificador oficial da CANDIDATURA usado no
    // casamento. Guardado para que a próxima execução saiba de qual registro a
    // foto veio, sem refazer o casamento por nome.
    photo_tse_candidatura_id: { type: 'text' },
    // URL crua da imagem no TSE. Não é o que exibimos (servimos o arquivo local),
    // mas é o que foi efetivamente baixado.
    photo_origin_url: { type: 'text' },
    photo_sha256: { type: 'text' },
    photo_bytes: { type: 'integer', check: 'photo_bytes IS NULL OR photo_bytes > 0' },
    photo_format: {
      type: 'text',
      check: `photo_format IS NULL OR photo_format IN (${inList(PHOTO_FORMATS)})`,
    },
    photo_width_px: { type: 'integer', check: 'photo_width_px IS NULL OR photo_width_px > 0' },
    photo_height_px: { type: 'integer', check: 'photo_height_px IS NULL OR photo_height_px > 0' },
    // Quando os bytes atuais foram capturados do TSE.
    photo_captured_at: { type: 'timestamptz' },
    // Validadores de conditional GET. O TSE não os envia hoje (medição de
    // 2026-08-16), mas o job os reenvia se um dia existirem.
    photo_etag: { type: 'text' },
    photo_last_modified: { type: 'text' },
  });

  /**
   * Ou a linha tem foto COMPLETA (arquivo + proveniência + auditoria), ou não tem
   * foto nenhuma. Um `photo_path` sem `photo_source_url` seria uma imagem no ar
   * sem origem declarada — exatamente o que R6 e docs/08 §2.1 proíbem.
   */
  pgm.addConstraint(
    'candidates',
    ALL_OR_NOTHING,
    `CHECK (
       (photo_path IS NULL
        AND photo_source_url IS NULL
        AND photo_tse_candidatura_id IS NULL
        AND photo_origin_url IS NULL
        AND photo_sha256 IS NULL
        AND photo_bytes IS NULL
        AND photo_format IS NULL
        AND photo_width_px IS NULL
        AND photo_height_px IS NULL
        AND photo_captured_at IS NULL)
       OR
       (photo_path IS NOT NULL
        AND photo_source_url IS NOT NULL
        AND photo_tse_candidatura_id IS NOT NULL
        AND photo_origin_url IS NOT NULL
        AND photo_sha256 IS NOT NULL
        AND photo_bytes IS NOT NULL
        AND photo_format IS NOT NULL
        AND photo_width_px IS NOT NULL
        AND photo_height_px IS NOT NULL
        AND photo_captured_at IS NOT NULL)
     )`,
  );

  /**
   * Uma candidatura do TSE não pode virar a foto de dois candidatos nossos. Se
   * isso acontecesse, alguém estaria com o rosto errado no site. O índice é
   * parcial porque `null` (sem foto) é o estado normal de muita gente.
   */
  pgm.createIndex('candidates', 'photo_tse_candidatura_id', {
    name: CANDIDATURA_UNIQUE,
    unique: true,
    where: 'photo_tse_candidatura_id IS NOT NULL',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('candidates', 'photo_tse_candidatura_id', { name: CANDIDATURA_UNIQUE });
  pgm.dropConstraint('candidates', ALL_OR_NOTHING);
  pgm.dropColumns('candidates', [
    'photo_path',
    'photo_source_url',
    'photo_tse_candidatura_id',
    'photo_origin_url',
    'photo_sha256',
    'photo_bytes',
    'photo_format',
    'photo_width_px',
    'photo_height_px',
    'photo_captured_at',
    'photo_etag',
    'photo_last_modified',
  ]);
}
