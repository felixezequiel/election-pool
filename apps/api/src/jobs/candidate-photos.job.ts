/**
 * CandidatePhotosJob (T-17) — ingestão das FOTOS OFICIAIS dos candidatos.
 *
 * FONTE ÚNICA E AUTORIZADA: o registro público de candidatura no TSE
 * (DivulgaCandContas). É a foto que o próprio candidato entregou ao se registrar,
 * publicada pela autoridade eleitoral — mesma natureza do dado do PesqEle que já
 * consumimos, e o TSE ainda marca explicitamente `fotoUrlPublicavel`. Foto de
 * portal de notícia, agência, rede social ou banco de imagens é obra protegida e
 * está TERMINANTEMENTE fora (docs/08 §2). Este job não conhece nenhuma outra URL.
 *
 * Sem foto casada com segurança, `photoPath` fica `null` e a UI cai para
 * monograma + cor. Nunca chutamos, nunca aceitamos "quase certo" (R4).
 *
 * IDEMPOTÊNCIA — o que a segunda execução faz:
 *  - Não rebaixa dado: um candidato que já tem foto NUNCA perde a foto porque o
 *    TSE ficou fora do ar, porque o casamento parou de acontecer ou porque uma
 *    imagem veio corrompida. A remoção de foto é ação humana (`clearPhoto`).
 *  - Não rebaixa arquivo: o arquivo no disco só é reescrito quando os bytes
 *    mudam de verdade (sha256 diferente), e a troca é sempre registrada em
 *    alerta — nunca sobrescrevemos em silêncio.
 *  - Não baixa de novo o que não mudou: foto conferida há menos de
 *    `PHOTO_RECHECK_INTERVAL_MS` nem chega a gerar requisição (o TSE não fornece
 *    `ETag`/`Last-Modified`, então esta é a única forma honesta de não bater no
 *    servidor por nada). `force: true` ignora a janela.
 *
 * Executável por `pnpm ingest:photos`.
 */

import { createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TseCandidatosClient } from '@election-pool/adapters/tse-candidatos/client';
import {
  inspectPhoto,
  InvalidPhotoError,
  PHOTO_EXTENSION,
} from '@election-pool/adapters/tse-candidatos/image';
import { casarCandidaturas } from '@election-pool/adapters/tse-candidatos/matching';
import type {
  AlertaCasamento,
  CandidatoLocal,
} from '@election-pool/adapters/tse-candidatos/matching';
import {
  PHOTO_PUBLIC_PREFIX,
  PHOTO_RECHECK_INTERVAL_MS,
} from '@election-pool/adapters/tse-candidatos/constants';
import { CandidatePhotosRepository } from '../db/candidate-photos.repository.js';
import type { CandidatePhoto, CandidateWithPhoto } from '../db/candidate-photos.repository.js';
import { toSaoPauloIso } from '../publish/time.js';

/** Alertas próprios do job, somados aos alertas de casamento do adapter. */
export type TipoAlertaFoto =
  /** Candidatura casada, mas o TSE não autoriza publicar a foto. */
  | 'foto_nao_publicavel'
  /** Já tínhamos foto e o TSE passou a NÃO autorizar: exige decisão humana. */
  | 'autorizacao_revogada'
  /** Candidatura casada, mas o registro não tem foto entregue. */
  | 'sem_foto_no_registro'
  /** Bytes recebidos não são uma imagem aceitável — nada é gravado. */
  | 'foto_invalida'
  /** Os bytes mudaram em relação ao que estava no ar. Nunca em silêncio. */
  | 'foto_alterada'
  /** Arquivo sumiu do disco (deploy limpo, disco novo): regravado. */
  | 'arquivo_ausente_regravado';

export interface AlertaFoto {
  kind: TipoAlertaFoto | AlertaCasamento['kind'];
  candidateId: string | null;
  idCandidatura: string | null;
  detail: string;
  /** `true` quando o alerta é falha operacional (o entry sai com código != 0). */
  isError: boolean;
}

export interface CandidatePhotosResult {
  candidatosLocais: number;
  candidaturasTse: number;
  casados: number;
  /** Fotos gravadas pela primeira vez. */
  novas: number;
  /** Fotos cujos bytes mudaram e foram substituídas. */
  atualizadas: number;
  /** Fotos conferidas e inalteradas (ou dentro da janela de recheck). */
  inalteradas: number;
  /** Downloads efetivamente realizados (mede a educação do crawler). */
  downloads: number;
  alerts: AlertaFoto[];
}

export interface CandidatePhotosDeps {
  repo: CandidatePhotosRepository;
  client: TseCandidatosClient;
  /** Diretório físico das fotos (`apps/web/public/candidatos`). */
  photosDir: string;
  now?: () => Date;
  /** Ignora a janela de recheck e reconfere todas as fotos. */
  force?: boolean;
}

const sha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(Buffer.from(bytes)).digest('hex');

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

export class CandidatePhotosJob {
  private readonly repo: CandidatePhotosRepository;
  private readonly client: TseCandidatosClient;
  private readonly photosDir: string;
  private readonly now: () => Date;
  private readonly force: boolean;

  constructor(deps: CandidatePhotosDeps) {
    this.repo = deps.repo;
    this.client = deps.client;
    this.photosDir = deps.photosDir;
    this.now = deps.now ?? ((): Date => new Date());
    this.force = deps.force ?? false;
  }

  async run(): Promise<CandidatePhotosResult> {
    const candidatos = await this.repo.listCandidatesWithPhotos();
    const aliases = await this.repo.loadCandidateAliases();

    const eleicao = await this.client.resolveEleicaoAlvo();
    const candidaturas = await this.client.listarCandidaturasPresidente(eleicao.idEleicao);

    const locais: CandidatoLocal[] = candidatos.map((c) => ({
      id: c.id,
      displayName: c.displayName,
      party: c.party,
    }));
    const casamento = casarCandidaturas(candidaturas, locais, aliases);

    const result: CandidatePhotosResult = {
      candidatosLocais: candidatos.length,
      candidaturasTse: candidaturas.length,
      casados: casamento.matches.length,
      novas: 0,
      atualizadas: 0,
      inalteradas: 0,
      downloads: 0,
      alerts: casamento.alerts.map((a) => ({ ...a, isError: false })),
    };

    const porId = new Map(candidatos.map((c) => [c.id, c]));
    await mkdir(this.photosDir, { recursive: true });

    // Sequencial de propósito: o rate limit é por host e nunca paralelizamos
    // requisições ao TSE (docs/04, armadilha do PesqEle).
    for (const match of casamento.matches) {
      const local = porId.get(match.candidateId);
      if (local === undefined) continue; // impossível: veio de `candidatos`.
      await this.processarCandidato(local, match.candidatura.id, eleicao.idEleicao, result);
    }

    return result;
  }

  private alert(result: CandidatePhotosResult, alerta: AlertaFoto): void {
    result.alerts.push(alerta);
  }

  private async processarCandidato(
    local: CandidateWithPhoto,
    idCandidatura: string,
    idEleicao: string,
    result: CandidatePhotosResult,
  ): Promise<void> {
    const atual = local.photo;

    // Janela de recheck: foto recente e da MESMA candidatura não gera requisição.
    // Se a candidatura casada mudou, reconferimos na hora — é troca de registro,
    // não passagem do tempo.
    if (
      !this.force &&
      atual !== null &&
      atual.tseCandidaturaId === idCandidatura &&
      this.dentroDaJanela(atual.capturedAt) &&
      (await fileExists(join(this.photosDir, this.fileNameFor(local.id, atual))))
    ) {
      result.inalteradas += 1;
      return;
    }

    const detalhe = await this.client.buscarCandidatura(idEleicao, idCandidatura);

    if (detalhe.fotoUrlPublicavel !== true) {
      // O TSE é quem autoriza. Sem `true`, não baixamos — e se já havia foto no
      // ar, isto é um sinal de remoção que exige decisão humana (docs/08 §3:
      // pedido de remoção é atendido em 48h). NÃO apagamos sozinhos: uma
      // instabilidade da API não pode destruir dado bom em silêncio (R4). O
      // alerta é de ERRO justamente para que ninguém deixe passar.
      this.alert(result, {
        kind: atual === null ? 'foto_nao_publicavel' : 'autorizacao_revogada',
        candidateId: local.id,
        idCandidatura,
        detail:
          atual === null
            ? 'TSE não marca a foto como publicável; seguimos sem foto'
            : 'TSE deixou de marcar a foto como publicável: revisar e remover à mão',
        isError: atual !== null,
      });
      return;
    }

    const fotoUrl = detalhe.fotoUrl;
    if (fotoUrl == null || fotoUrl.length === 0) {
      this.alert(result, {
        kind: 'sem_foto_no_registro',
        candidateId: local.id,
        idCandidatura,
        detail: 'registro de candidatura sem foto entregue',
        isError: false,
      });
      return;
    }

    const baixada = await this.client.baixarFoto(fotoUrl, {
      etag: atual?.etag ?? null,
      lastModified: atual?.lastModified ?? null,
    });
    if (baixada === 'not-modified') {
      result.inalteradas += 1;
      return;
    }
    result.downloads += 1;

    let inspecionada;
    try {
      inspecionada = inspectPhoto(baixada.bytes);
    } catch (err) {
      // Imagem ruim NÃO derruba o que já está no ar nem o resto do job; vira
      // erro registrado (o entry sai != 0) e o candidato fica como estava.
      const motivo = err instanceof InvalidPhotoError ? err.message : String(err);
      this.alert(result, {
        kind: 'foto_invalida',
        candidateId: local.id,
        idCandidatura,
        detail: `${motivo} (nada foi gravado)`,
        isError: true,
      });
      return;
    }

    const hash = sha256(baixada.bytes);
    const fileName = `${local.id}.${PHOTO_EXTENSION[inspecionada.format]}`;
    const filePath = join(this.photosDir, fileName);

    if (atual !== null && atual.sha256 === hash) {
      // Mesmos bytes: não reescrevemos o arquivo. Só garantimos que ele existe —
      // um deploy em disco limpo perde `public/`, e nesse caso regravar é o certo.
      if (!(await fileExists(filePath))) {
        await this.writeAtomic(filePath, baixada.bytes);
        this.alert(result, {
          kind: 'arquivo_ausente_regravado',
          candidateId: local.id,
          idCandidatura,
          detail: `${fileName} não estava no disco e foi regravado a partir do TSE`,
          isError: false,
        });
      }
      result.inalteradas += 1;
      return;
    }

    if (atual !== null) {
      // Troca de foto NUNCA é silenciosa: fica registrada com os dois hashes.
      this.alert(result, {
        kind: 'foto_alterada',
        candidateId: local.id,
        idCandidatura,
        detail: `sha256 ${atual.sha256.slice(0, 12)}… → ${hash.slice(0, 12)}…`,
        isError: false,
      });
      // Formato diferente ⇒ o arquivo antigo tem outra extensão e viraria órfão
      // servido pelo site. Remove.
      const antigo = join(this.photosDir, this.fileNameFor(local.id, atual));
      if (antigo !== filePath) await rm(antigo, { force: true });
    }

    await this.writeAtomic(filePath, baixada.bytes);

    const photo: CandidatePhoto = {
      photoPath: `${PHOTO_PUBLIC_PREFIX}/${fileName}`,
      photoSourceUrl: this.client.urlPublicaCandidatura(idEleicao, idCandidatura),
      tseCandidaturaId: idCandidatura,
      originUrl: baixada.url,
      sha256: hash,
      byteLength: inspecionada.byteLength,
      format: inspecionada.format,
      widthPx: inspecionada.widthPx,
      heightPx: inspecionada.heightPx,
      capturedAt: toSaoPauloIso(this.now()),
      etag: baixada.etag,
      lastModified: baixada.lastModified,
    };
    await this.repo.setPhoto(local.id, photo);

    if (atual === null) result.novas += 1;
    else result.atualizadas += 1;
  }

  private fileNameFor(candidateId: string, photo: CandidatePhoto): string {
    return `${candidateId}.${PHOTO_EXTENSION[photo.format]}`;
  }

  private dentroDaJanela(capturedAt: string): boolean {
    const capturado = Date.parse(capturedAt);
    if (Number.isNaN(capturado)) return false; // data ilegível ⇒ reconfere.
    return this.now().getTime() - capturado < PHOTO_RECHECK_INTERVAL_MS;
  }

  /**
   * Grava por arquivo temporário + `rename`. O diretório é servido (via build do
   * Astro): um `writeFile` direto deixaria uma janela em que o arquivo existe
   * pela metade. `rename` no mesmo diretório é atômico.
   */
  private async writeAtomic(filePath: string, bytes: Uint8Array): Promise<void> {
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, filePath);
  }
}
