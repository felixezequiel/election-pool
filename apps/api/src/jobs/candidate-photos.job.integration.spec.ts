/**
 * CandidatePhotosJob de ponta a ponta: Postgres REAL (migration 1700000000010),
 * `HttpClient` real (robots + rate limit + conditional GET) e um `fetch` duplo
 * que serve as capturas reais do TSE dos `__fixtures__` do adapter.
 *
 * Não bate na rede. O que é exercitado de verdade: casamento determinístico,
 * gravação do arquivo, hash, idempotência e o CHECK tudo-ou-nada do banco.
 */

import { readFileSync } from 'node:fs';
import { readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { HttpClient } from '@election-pool/adapters/http-client';
import type { HttpClientClock } from '@election-pool/adapters/http-client';
import { PerHostRateLimiter } from '@election-pool/adapters/rate-limiter';
import { createBase64Fetch } from '@election-pool/adapters/tse-candidatos/binary-fetch';
import type { RawFetch } from '@election-pool/adapters/tse-candidatos/binary-fetch';
import { TseCandidatosClient } from '@election-pool/adapters/tse-candidatos/client';
import { makeTestDatabase } from '../db/test-helpers.js';
import { CandidatePhotosRepository } from '../db/candidate-photos.repository.js';
import { CandidatePhotosJob } from './candidate-photos.job.js';

const { db } = makeTestDatabase();
const repo = new CandidatePhotosRepository(db);

const FIXTURES = fileURLToPath(
  new URL('../../../../packages/adapters/tse-candidatos/__fixtures__/', import.meta.url),
);
const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/**
 * Quantas candidaturas têm BYTES de imagem nesta fixture. É o teto de fotos que
 * qualquer execução pode gravar, e é DIFERENTE de `casados`: casar candidatura não
 * garante que a foto exista (as demais respondem 404, que é o caso real de
 * candidatura sem foto publicável). Asserir contra `casados` amarraria o teste ao
 * tamanho do cadastro, que cresce a cada candidatura nova.
 */
const FOTOS_NA_FIXTURE = 3;

/** Candidaturas reais que casam com o nosso seed. */
const ID_LULA = '280002542548';
const ID_FLAVIO = '280002551544';
const ID_ZEMA = '280002539826';

/** Relógio sem espera: o rate limit de 10s não pode fazer o teste dormir. */
const instantClock: HttpClientClock = { now: () => 0, sleep: async () => {}, random: () => 0 };

/**
 * Rate limiter com intervalo ZERO. O limite real de 1 req/10s por host (docs/04
 * §6) continua valendo em produção — aqui ele é neutralizado de propósito, senão
 * um job com ~20 requisições levaria 3 minutos de relógio de parede.
 */
const noWaitRateLimiter = (): PerHostRateLimiter => new PerHostRateLimiter(instantClock, 0);

/** JPEG sintético mínimo e válido para `inspectPhoto` (161x225, como o real). */
const makeJpeg = (marker: number, total = 1024): Uint8Array => {
  const out = new Uint8Array(total);
  out.set(
    [
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0xe1,
      0x00, 0xa1,
    ],
    0,
  );
  out[total - 1] = marker; // muda o sha256 sem mexer no cabeçalho
  return out;
};

interface ServerState {
  /** Bytes servidos por candidatura. */
  fotos: Map<string, Uint8Array>;
  /** `fotoUrlPublicavel` por candidatura. */
  publicavel: Map<string, boolean>;
  requests: string[];
}

const makeState = (): ServerState => ({
  fotos: new Map([
    [ID_LULA, makeJpeg(0x01)],
    [ID_FLAVIO, makeJpeg(0x02)],
    [ID_ZEMA, makeJpeg(0x03)],
  ]),
  publicavel: new Map([
    [ID_LULA, true],
    [ID_FLAVIO, true],
    [ID_ZEMA, true],
  ]),
  requests: [],
});

/** Detalhe sintetizado a partir da captura real, trocando só id/foto. */
const detalhe = (state: ServerState, id: string): string => {
  const base = JSON.parse(fixtureText('candidato-detalhe-280002542548.json')) as Record<
    string,
    unknown
  >;
  return JSON.stringify({
    ...base,
    id: Number(id),
    fotoUrl: `https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/20322002026/${id}/BR`,
    fotoUrlPublicavel: state.publicavel.get(id) ?? false,
  });
};

type FetchResult = Awaited<ReturnType<RawFetch>>;

const makeFetch = (state: ServerState): RawFetch => {
  return (url) => {
    state.requests.push(url);
    const respond = (status: number, body: string | Uint8Array): Promise<FetchResult> => {
      const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
      return Promise.resolve({
        status,
        headers: new Headers(),
        url,
        arrayBuffer: (): Promise<ArrayBuffer> =>
          Promise.resolve(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          ),
        text: (): Promise<string> => Promise.resolve(new TextDecoder().decode(bytes)),
      });
    };

    if (url.includes('/eleicao/eleicao-atual')) {
      return respond(200, fixtureText('eleicao-atual.json'));
    }
    if (url.includes('/candidatura/listar/')) {
      return respond(200, fixtureText('candidatos-presidente-2026.json'));
    }
    const buscar = /\/candidato\/(\d+)$/.exec(url);
    if (buscar?.[1] !== undefined) return respond(200, detalhe(state, buscar[1]));
    const img = /\/arquivo\/img\/\d+\/(\d+)\/BR$/.exec(url);
    if (img?.[1] !== undefined) {
      const bytes = state.fotos.get(img[1]);
      if (bytes === undefined) return respond(404, '');
      return respond(200, bytes);
    }
    return respond(404, ''); // robots.txt inclusive ⇒ sem restrições
  };
};

const makeJob = (
  state: ServerState,
  photosDir: string,
  options: { now?: () => Date; force?: boolean } = {},
): CandidatePhotosJob =>
  new CandidatePhotosJob({
    repo,
    client: new TseCandidatosClient({
      http: new HttpClient({
        fetchImpl: createBase64Fetch(makeFetch(state)),
        clock: instantClock,
        rateLimiter: noWaitRateLimiter(),
      }),
    }),
    photosDir,
    ...options,
  });

/** Candidatos e aliases do seed real, garantidos sem apagar linha de ninguém. */
const ensureSeed = async (): Promise<void> => {
  const candidatos: Array<[string, string, string, number]> = [
    ['lula', 'Luiz Inácio Lula da Silva', 'PT', 1],
    ['tarcisio', 'Tarcísio de Freitas', 'Republicanos', 2],
    ['ratinho-junior', 'Ratinho Junior', 'PSD', 3],
    ['flavio-bolsonaro', 'Flávio Bolsonaro', 'PL', 4],
    ['ciro-gomes', 'Ciro Gomes', 'PDT', 5],
    ['simone-tebet', 'Simone Tebet', 'MDB', 6],
    ['zema', 'Romeu Zema', 'Novo', 7],
  ];
  for (const [id, displayName, party, slot] of candidatos) {
    await db.query(
      `INSERT INTO candidates (id, display_name, party, color_slot)
       VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
      [id, displayName, party, slot],
    );
  }
  const aliases: Array<[string, string]> = [
    ['Lula', 'lula'],
    ['Luiz Inácio Lula da Silva', 'lula'],
    ['Flávio Bolsonaro', 'flavio-bolsonaro'],
    ['Romeu Zema', 'zema'],
    ['Zema', 'zema'],
  ];
  for (const [alias, target] of aliases) {
    await db.query(
      `INSERT INTO candidate_aliases (alias, candidate_id) VALUES ($1,$2)
       ON CONFLICT (alias) DO NOTHING`,
      [alias, target],
    );
  }
};

const clearPhotos = async (): Promise<void> => {
  const rows = await db.query<{ id: string }>(`SELECT id FROM candidates`);
  for (const row of rows) await repo.clearPhoto(row.id);
};

let photosDir: string;

beforeAll(async () => {
  await ensureSeed();
});

beforeEach(async () => {
  await clearPhotos();
  photosDir = await mkdtemp(join(tmpdir(), 'election-pool-fotos-'));
});

afterAll(async () => {
  await clearPhotos();
  await db.end();
});

describe('CandidatePhotosJob — primeira execução', () => {
  it('casa, baixa e grava só as fotos dos candidatos com registro no TSE', async () => {
    const state = makeState();
    const result = await makeJob(state, photosDir).run();

    // A lista de candidaturas vem da fixture do TSE: número estável.
    expect(result.candidaturasTse).toBe(13);

    /**
     * As contagens GLOBAIS deixaram de ser asseridas contra número fixo, de
     * propósito. O job varre TODOS os candidatos da tabela de referência, e o
     * cadastro real cresceu de 7 para 22 quando as candidaturas oficiais de 2026
     * entraram — então `toBe(3)` era uma afirmação sobre o TAMANHO DO MUNDO, não
     * sobre o comportamento do job, e quebrava a cada cadastro novo.
     *
     * A invariante que este teste protege não depende do tamanho do cadastro: quem
     * casa com candidatura oficial recebe foto, quem não casa fica com `null`
     * (nunca chute). É isso que se afirma agora.
     */
    // Toda foto nova exigiu exatamente um download — nada gravado sem buscar.
    // (`casados` é MAIOR: casar candidatura não garante que a foto exista; a
    // fixture só tem bytes para três, e o resto responde 404, que é o caso real de
    // candidatura sem foto publicável.)
    expect(result.novas).toBe(result.downloads);
    expect(result.casados).toBeGreaterThanOrEqual(result.novas);

    // Os três de quem a fixture tem bytes de imagem precisam ter arquivo no disco…
    const arquivos = new Set(await readdir(photosDir));
    for (const esperado of ['lula.jpg', 'flavio-bolsonaro.jpg', 'zema.jpg']) {
      expect(arquivos.has(esperado)).toBe(true);
    }
    // …e nenhum arquivo de candidato que NÃO casou com candidatura.
    for (const naoEsperado of ['tarcisio.jpg', 'ciro-gomes.jpg', 'simone-tebet.jpg']) {
      expect(arquivos.has(naoEsperado)).toBe(false);
    }
  });

  it('grava caminho servido, proveniência e auditoria completos', async () => {
    await makeJob(makeState(), photosDir).run();
    const lula = await repo.findByCandidateId('lula');

    expect(lula?.photo?.photoPath).toBe('/candidatos/lula.jpg');
    expect(lula?.photo?.photoSourceUrl).toBe(
      'https://divulgacandcontas.tse.jus.br/divulga/#/candidato/BR/BR/20322002026/280002542548/2026/BR',
    );
    expect(lula?.photo?.tseCandidaturaId).toBe(ID_LULA);
    expect(lula?.photo?.format).toBe('jpeg');
    expect(lula?.photo?.widthPx).toBe(161);
    expect(lula?.photo?.heightPx).toBe(225);
    expect(lula?.photo?.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Data de captura em ISO-8601 com offset de São Paulo (CLAUDE.md).
    expect(lula?.photo?.capturedAt).toMatch(/-03:00$/);
  });

  it('candidato sem registro no TSE fica com foto null + alerta (nunca chute)', async () => {
    const result = await makeJob(makeState(), photosDir).run();

    for (const id of ['tarcisio', 'ratinho-junior', 'ciro-gomes', 'simone-tebet']) {
      const cand = await repo.findByCandidateId(id);
      expect(cand?.photo).toBeNull();
    }
    const semCandidatura = result.alerts
      .filter((a) => a.kind === 'sem_candidatura')
      .map((a) => a.candidateId)
      .sort();
    /**
     * SUPERCONJUNTO, não igualdade: a lista completa depende de quantos candidatos
     * o cadastro tem, e ele cresce a cada candidatura oficial nova. O que este
     * teste afirma é que os quatro pré-candidatos que NÃO registraram candidatura
     * em 2026 estão entre os alertados — igualdade exata voltaria a quebrar no
     * próximo cadastro, sem nada de errado ter acontecido.
     */
    for (const id of ['ciro-gomes', 'ratinho-junior', 'simone-tebet', 'tarcisio']) {
      expect(semCandidatura).toContain(id);
    }
    // Alerta de cadastro não é falha operacional.
    expect(semCandidatura.length).toBeGreaterThan(0);
    expect(result.alerts.filter((a) => a.isError)).toHaveLength(0);
  });

  it('o arquivo gravado tem exatamente os bytes que o TSE serviu', async () => {
    const state = makeState();
    await makeJob(state, photosDir).run();
    const gravado = await readFile(join(photosDir, 'lula.jpg'));
    expect([...gravado]).toEqual([...(state.fotos.get(ID_LULA) ?? [])]);
  });
});

describe('CandidatePhotosJob — idempotência', () => {
  it('segunda execução não baixa de novo nem rebaixa dado ou arquivo', async () => {
    const state = makeState();
    await makeJob(state, photosDir).run();
    const antes = await repo.findByCandidateId('lula');
    const mtimeAntes = (await stat(join(photosDir, 'lula.jpg'))).mtimeMs;
    const requestsAntes = state.requests.length;

    /** Candidaturas que ficaram COM foto no banco depois da primeira execução. */
    const fotografadas = new Set(
      (await repo.listCandidatesWithPhotos())
        .map((c) => c.photo?.tseCandidaturaId)
        .filter((id): id is string => id !== undefined),
    );

    const segunda = await makeJob(state, photosDir).run();

    expect(segunda.downloads).toBe(0);
    expect(segunda.novas).toBe(0);
    expect(segunda.atualizadas).toBe(0);
    expect(segunda.inalteradas).toBe(FOTOS_NA_FIXTURE);
    const novas = state.requests.slice(requestsAntes).filter((url) => !url.endsWith('/robots.txt'));

    /**
     * A invariante é sobre QUEM é reconsultado, não sobre o TOTAL de requisições.
     *
     * Dentro da janela de recheck, candidatura que JÁ rendeu foto não é tocada de
     * novo — nem o detalhe, nem a imagem. Candidatura que ainda NÃO tem foto
     * continua sendo consultada a cada ciclo, e isso é correto: não ter foto hoje
     * não significa não ter amanhã, e é justamente o detalhe que informa
     * `fotoUrlPublicavel`.
     *
     * A asserção anterior era "nenhuma requisição `/candidatura/buscar/`". Ela
     * valia por acidente, quando os únicos candidatos que casavam eram os três de
     * quem a fixture tem bytes: aí "nenhum detalhe" e "nenhum recheck" davam no
     * mesmo. Com o cadastro de 2026 casando 13 candidaturas e só 3 tendo imagem,
     * as duas coisas se separaram — e a asserção passou a proibir tráfego legítimo
     * em vez de proteger a idempotência.
     *
     * O conjunto `fotografadas` vem do BANCO, não de constante: o teste continua
     * valendo quando a fixture ou o cadastro mudarem de tamanho.
     */
    const detalhesPedidos = novas.filter((url) => url.includes('/candidatura/buscar/'));
    // Guarda contra invariante VAZIA: sem isto, um dia em que nada fosse
    // fotografado faria os laços abaixo passarem sem verificar coisa alguma.
    expect(fotografadas.size).toBe(FOTOS_NA_FIXTURE);
    for (const idCandidatura of fotografadas) {
      expect(novas.some((url) => url.includes(idCandidatura))).toBe(false);
    }
    // Zero imagem baixada: é o que `downloads=0` significa em termos de tráfego.
    expect(novas.some((url) => url.includes('/arquivo/img/'))).toBe(false);
    // Todo detalhe pedido é de candidatura AINDA SEM foto — nenhum é recheck.
    expect(detalhesPedidos.length).toBeGreaterThan(0);
    for (const url of detalhesPedidos) {
      expect([...fotografadas].some((id) => url.includes(id))).toBe(false);
    }
    // Amarra tráfego a estado sem depender do tamanho do cadastro: reconsultamos
    // exatamente os casados que não têm foto (`casados - inalteradas`).
    expect(detalhesPedidos).toHaveLength(segunda.casados - segunda.inalteradas);

    const depois = await repo.findByCandidateId('lula');
    expect(depois).toEqual(antes);
    expect((await stat(join(photosDir, 'lula.jpg'))).mtimeMs).toBe(mtimeAntes);
  });

  it('com --force e bytes iguais, confere mas não reescreve o arquivo', async () => {
    const state = makeState();
    await makeJob(state, photosDir).run();
    const antes = await repo.findByCandidateId('lula');
    const mtimeAntes = (await stat(join(photosDir, 'lula.jpg'))).mtimeMs;

    const segunda = await makeJob(state, photosDir, { force: true }).run();

    expect(segunda.downloads).toBe(FOTOS_NA_FIXTURE);
    expect(segunda.inalteradas).toBe(FOTOS_NA_FIXTURE);
    expect(segunda.atualizadas).toBe(0);
    expect(await repo.findByCandidateId('lula')).toEqual(antes);
    expect((await stat(join(photosDir, 'lula.jpg'))).mtimeMs).toBe(mtimeAntes);
  });

  it('bytes diferentes ⇒ troca o arquivo e REGISTRA a troca (nunca em silêncio)', async () => {
    const state = makeState();
    await makeJob(state, photosDir).run();
    const antes = await repo.findByCandidateId('lula');

    state.fotos.set(ID_LULA, makeJpeg(0x99));
    const segunda = await makeJob(state, photosDir, { force: true }).run();

    expect(segunda.atualizadas).toBe(1);
    const alerta = segunda.alerts.find((a) => a.kind === 'foto_alterada');
    expect(alerta?.candidateId).toBe('lula');
    expect(alerta?.detail).toContain(antes?.photo?.sha256.slice(0, 12) ?? 'x');

    const depois = await repo.findByCandidateId('lula');
    expect(depois?.photo?.sha256).not.toBe(antes?.photo?.sha256);
    expect([...(await readFile(join(photosDir, 'lula.jpg')))]).toEqual([
      ...(state.fotos.get(ID_LULA) ?? []),
    ]);
  });

  it('arquivo apagado do disco é regravado sem mexer no registro do banco', async () => {
    const state = makeState();
    await makeJob(state, photosDir).run();
    const antes = await repo.findByCandidateId('lula');
    await rm(join(photosDir, 'lula.jpg'));

    const segunda = await makeJob(state, photosDir).run();

    expect(segunda.inalteradas).toBe(FOTOS_NA_FIXTURE);
    expect(segunda.atualizadas).toBe(0);
    expect(await repo.findByCandidateId('lula')).toEqual(antes);
    expect(await readFile(join(photosDir, 'lula.jpg'))).toBeDefined();
  });
});

describe('CandidatePhotosJob — falha alta, sem rebaixar dado (R4)', () => {
  it('bytes inválidos viram erro registrado e NÃO apagam a foto que estava no ar', async () => {
    const state = makeState();
    await makeJob(state, photosDir).run();
    const antes = await repo.findByCandidateId('lula');

    state.fotos.set(ID_LULA, new TextEncoder().encode('<html>erro</html>'.repeat(50)));
    const segunda = await makeJob(state, photosDir, { force: true }).run();

    const erro = segunda.alerts.find((a) => a.kind === 'foto_invalida');
    expect(erro?.isError).toBe(true);
    expect(erro?.candidateId).toBe('lula');
    expect(await repo.findByCandidateId('lula')).toEqual(antes);
    expect([...(await readFile(join(photosDir, 'lula.jpg')))]).toEqual([...makeJpeg(0x01)]);
  });

  it('autorização revogada pelo TSE vira ERRO para revisão humana, sem apagar sozinho', async () => {
    const state = makeState();
    await makeJob(state, photosDir).run();
    const antes = await repo.findByCandidateId('lula');

    state.publicavel.set(ID_LULA, false);
    const segunda = await makeJob(state, photosDir, { force: true }).run();

    const alerta = segunda.alerts.find((a) => a.kind === 'autorizacao_revogada');
    expect(alerta?.isError).toBe(true);
    expect(await repo.findByCandidateId('lula')).toEqual(antes);
  });

  it('sem autorização e sem foto prévia: segue sem foto, sem erro', async () => {
    const state = makeState();
    state.publicavel.set(ID_LULA, false);
    const result = await makeJob(state, photosDir).run();

    expect(result.novas).toBe(2);
    expect((await repo.findByCandidateId('lula'))?.photo).toBeNull();
    expect(result.alerts.some((a) => a.kind === 'foto_nao_publicavel')).toBe(true);
    expect(result.alerts.filter((a) => a.isError)).toHaveLength(0);
  });

  it('o banco recusa meia foto (CHECK tudo-ou-nada da migration)', async () => {
    await expect(
      db.query(`UPDATE candidates SET photo_path = '/candidatos/x.jpg' WHERE id = 'lula'`),
    ).rejects.toThrow(/candidates_photo_all_or_nothing/);
  });

  it('uma candidatura do TSE não pode virar a foto de dois candidatos', async () => {
    await makeJob(makeState(), photosDir).run();
    await expect(
      db.query(`UPDATE candidates SET photo_tse_candidatura_id = $1 WHERE id = 'zema'`, [ID_LULA]),
    ).rejects.toThrow(/candidates_photo_tse_candidatura_id_unique/);
  });

  it('gravar foto de candidato inexistente lança (o job nunca cria candidato)', async () => {
    await expect(
      repo.setPhoto('nao-existe', {
        photoPath: '/candidatos/x.jpg',
        photoSourceUrl:
          'https://divulgacandcontas.tse.jus.br/divulga/#/candidato/BR/BR/1/2/2026/BR',
        tseCandidaturaId: '2',
        originUrl: 'https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/1/2/BR',
        sha256: 'a'.repeat(64),
        byteLength: 1024,
        format: 'jpeg',
        widthPx: 161,
        heightPx: 225,
        capturedAt: '2026-08-16T22:00:00-03:00',
        etag: null,
        lastModified: null,
      }),
    ).rejects.toThrow(/NÃO cria candidato/);
  });
});

describe('layout de publicação', () => {
  it('grava dentro de um diretório que o Astro copia para o build', async () => {
    // Prova de contrato com T-13: `apps/web/public/<X>` vira `/<X>` no site, e
    // é por isso que `photoPath` começa com `/candidatos/`.
    const publicDir = fileURLToPath(new URL('../../../web/public/', import.meta.url));
    await mkdir(publicDir, { recursive: true });
    expect((await stat(publicDir)).isDirectory()).toBe(true);

    await makeJob(makeState(), photosDir).run();
    const lula = await repo.findByCandidateId('lula');
    expect(lula?.photo?.photoPath).toBe(`/candidatos/lula.jpg`);
    // O arquivo físico tem o mesmo basename do caminho servido.
    await writeFile(join(photosDir, '.keep'), '');
    expect(await readdir(photosDir)).toContain('lula.jpg');
  });
});
