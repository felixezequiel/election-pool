import { existsSync } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { publicDataSchema } from '@election-pool/contracts/public-data';
import type { PublishPaths } from './paths.js';

/**
 * Gates de publicação (docs/07 §6), TODOS bloqueantes. O `RenderJob` só executa o
 * swap atômico se cada um for verdade. Falhou qualquer um ⇒ aborta, mantém o
 * `dist/` atual, emite alerta (docs/07 §1: publicar dado velho é aceitável,
 * publicar dado errado não é).
 *
 * Os gates (docs/07 §6):
 *   1. model_runs.gates_passed = true no run mais recente
 *   2. data.json valida contra o schema Zod (public-data.ts)
 *   3. astro build terminou com código 0 e SEM warning
 *   4. dist-staging/index.html existe e tem > 10 KB
 *   5. dist-staging/data.json existe e é JSON parseável
 *   6. nenhum adapter em estado `suspeito` há mais de 3 ciclos
 *   7. generatedAt do novo build é mais recente que o do dist/ atual
 *
 * Esta função é PURA de I/O de rede: só lê arquivos e recebe os fatos de banco
 * (gatesPassed, suspectAdapterOverThreshold) de quem chama. Devolve o veredito
 * detalhado — o RenderJob loga cada gate e aborta se `passed = false`.
 */

const INDEX_HTML_MIN_BYTES = 10 * 1024; // docs/07 §6: index.html > 10 KB
const INDEX_HTML = 'index.html';
const DATA_JSON = 'data.json';

export interface GateInputs {
  paths: PublishPaths;
  /** docs/07 §6.1: gates_passed do run de modelo mais recente. */
  modelGatesPassed: boolean;
  /** docs/07 §6.3: astro build exit 0 e sem warning (o RenderJob apura). */
  astroBuildClean: boolean;
  /** docs/07 §6.2: o data.json já validou no montador (fronteira Zod). */
  dataJsonValidated: boolean;
  /**
   * docs/07 §6.6: existe adapter `suspeito` há mais de 3 ciclos? true = há ⇒
   * reprova. O RenderJob apura contra o estado operacional (T-14 fia a métrica).
   */
  suspectAdapterOverThreshold: boolean;
  /** generatedAt do artefato recém-montado (ISO -03:00). */
  newGeneratedAt: string;
}

export interface GateResult {
  name: string;
  ok: boolean;
  detail: string;
}

export interface GateVerdict {
  passed: boolean;
  results: GateResult[];
}

export const evaluatePublicationGates = async (input: GateInputs): Promise<GateVerdict> => {
  const results: GateResult[] = [];

  // 6.1 — gates do modelo.
  results.push({
    name: 'model_gates_passed',
    ok: input.modelGatesPassed,
    detail: input.modelGatesPassed
      ? 'run passou os gates de modelo'
      : 'run REPROVOU nos gates de modelo (docs/07 §3)',
  });

  // 6.2 — data.json valida (já validado no montador; reconfirmamos do disco).
  const stagingDataJson = join(input.paths.distStaging, DATA_JSON);
  const dataJsonParseable = await isParseablePublicData(stagingDataJson);
  results.push({
    name: 'data_json_validates',
    ok: input.dataJsonValidated && dataJsonParseable.ok,
    detail: dataJsonParseable.detail,
  });

  // 6.3 — astro build limpo.
  results.push({
    name: 'astro_build_clean',
    ok: input.astroBuildClean,
    detail: input.astroBuildClean
      ? 'astro build exit 0, sem warning'
      : 'astro build falhou ou emitiu warning',
  });

  // 6.4 — index.html existe e > 10 KB.
  const indexResult = await checkIndexHtml(join(input.paths.distStaging, INDEX_HTML));
  results.push(indexResult);

  // 6.5 — data.json parseável no staging (mesma checagem de 6.2, mas o gate é o de existência/parse).
  results.push({
    name: 'staging_data_json_parseable',
    ok: dataJsonParseable.ok,
    detail: dataJsonParseable.detail,
  });

  // 6.6 — nenhum adapter suspeito há > 3 ciclos.
  results.push({
    name: 'no_stale_suspect_adapter',
    ok: !input.suspectAdapterOverThreshold,
    detail: input.suspectAdapterOverThreshold
      ? 'há adapter suspeito há mais de 3 ciclos (docs/07 §6, docs/02 §5)'
      : 'nenhum adapter suspeito além do limiar',
  });

  // 6.7 — generatedAt novo é mais recente que o do dist atual.
  const freshness = await checkFreshness(join(input.paths.dist, DATA_JSON), input.newGeneratedAt);
  results.push(freshness);

  const passed = results.every((r) => r.ok);
  return { passed, results };
};

const isParseablePublicData = async (path: string): Promise<GateResult> => {
  if (!existsSync(path)) {
    return { name: 'data_json_parse', ok: false, detail: `${path} inexistente` };
  }
  try {
    const raw = await readFile(path, 'utf8');
    const json: unknown = JSON.parse(raw);
    publicDataSchema.parse(json);
    return {
      name: 'data_json_parse',
      ok: true,
      detail: 'data.json parseável e válido contra o schema',
    };
  } catch (err) {
    return {
      name: 'data_json_parse',
      ok: false,
      detail: `data.json inválido: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

const checkIndexHtml = async (path: string): Promise<GateResult> => {
  if (!existsSync(path)) {
    return { name: 'index_html_size', ok: false, detail: `${path} inexistente` };
  }
  const info = await stat(path);
  const ok = info.size > INDEX_HTML_MIN_BYTES;
  return {
    name: 'index_html_size',
    ok,
    detail: `index.html = ${String(info.size)} bytes (mínimo > ${String(INDEX_HTML_MIN_BYTES)})`,
  };
};

/**
 * generatedAt novo estritamente mais recente que o do dist atual (docs/07 §6.7).
 * Sem dist atual (primeira publicação) o gate PASSA — não há o que ficar mais
 * velho. ISO-8601 com o MESMO offset (-03:00) ⇒ comparação lexicográfica = ordem
 * temporal.
 */
const checkFreshness = async (
  currentDataJson: string,
  newGeneratedAt: string,
): Promise<GateResult> => {
  if (!existsSync(currentDataJson)) {
    return {
      name: 'newer_than_current',
      ok: true,
      detail: 'primeira publicação: sem dist/ atual para comparar',
    };
  }
  try {
    const raw = await readFile(currentDataJson, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const currentGeneratedAt = extractGeneratedAt(parsed);
    if (currentGeneratedAt === null) {
      // dist atual sem generatedAt legível: não podemos afirmar frescor ⇒ reprova
      // (na dúvida, aborta — docs/07 §1).
      return {
        name: 'newer_than_current',
        ok: false,
        detail: 'dist/ atual sem generatedAt legível; abortando por precaução',
      };
    }
    const ok = newGeneratedAt > currentGeneratedAt;
    return {
      name: 'newer_than_current',
      ok,
      detail: `novo generatedAt ${newGeneratedAt} ${ok ? '>' : '<='} atual ${currentGeneratedAt}`,
    };
  } catch (err) {
    return {
      name: 'newer_than_current',
      ok: false,
      detail: `falha ao ler generatedAt do dist atual: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
};

const extractGeneratedAt = (value: unknown): string | null => {
  if (typeof value === 'object' && value !== null && 'generatedAt' in value) {
    const g = (value as { generatedAt: unknown }).generatedAt;
    return typeof g === 'string' ? g : null;
  }
  return null;
};
