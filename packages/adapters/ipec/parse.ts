/**
 * Parser do release do Ipec (docs/04 §1, nível 2 — site do próprio instituto).
 *
 * ORDEM DE TRABALHO (a lição da Q-09): este parser foi escrito DEPOIS de capturar
 * dois releases REAIS do Ipec e congelá-los como fixture. Cada regra abaixo
 * descreve algo observado no documento real, com o exemplo ao lado. Nada aqui foi
 * inferido de como o Ipec "deveria" publicar.
 *
 * O que o release do Ipec realmente é: um PDF de 4–6 páginas com prosa,
 * um gráfico, e um punhado de TABELAS "<rótulo> <valor> [<valor>…]". Extraímos
 * só as tabelas (números e rótulos — fato, docs/08 §2); a prosa é ignorada e o
 * PDF bruto vira `raw_documents` como prova de proveniência (R3).
 *
 * As cinco armadilhas do formato, todas reais e todas cobertas por teste:
 *
 * 1. **Duas colunas de data.** As tabelas comparam a rodada ANTERIOR com a
 *    ATUAL: `15/08 29/08` no cabeçalho e `Lula – 13 – PT 51% 50%` na linha. A
 *    coluna atual é a ÚLTIMA. Ler a primeira importaria, em silêncio, os números
 *    da rodada passada sob o `tse_id` desta — e o V6 não pegaria, porque é o
 *    mesmo documento. Por isso o número de colunas é lido do cabeçalho e a
 *    contagem de valores de cada linha tem de casar com ele: divergência LANÇA,
 *    nunca "escolhe uma".
 *
 * 2. **Tabelas que NÃO são intenção de voto.** O mesmo release traz "Rejeição",
 *    "Expectativa de vitória", "Potencial de voto", "Avaliação" e "Aprovação".
 *    A de rejeição soma bem mais de 100% (o entrevistado cita vários nomes). Por
 *    isso o reconhecimento é por ALLOWLIST de título: o que não está na lista não
 *    abre cenário.
 *
 * 3. **Dois cargos no mesmo PDF.** Release estadual traz governador e presidente
 *    juntos. As tabelas são escopadas ao cargo presidente pela seção corrente.
 *
 * 4. **`*` e `-` não são zero.** `*` = "Não foi citado", `-` = "não foi testado
 *    nesta rodada" (as duas legendas estão no rodapé do release real). Candidato
 *    com marcador simplesmente NÃO ENTRA no cenário — "ausência ≠ zero" (R4,
 *    docs/04 §4.1). `0%` é diferente: é número publicado e entra como 0.
 *
 * 5. **O 1º turno estimulado não está no texto.** É gráfico. Ver
 *    `IPEC_ESTIMULADO_NOTE` em `constants.ts`. Não o inventamos a partir da prosa.
 */

// `SCENARIO_KIND` (o objeto const) e não `scenarioKindSchema.enum`: o `.enum` de
// um `z.enum([...])` é indexado pelos VALORES ('t1_espontaneo'), então
// `.enum.t1Espontaneo` seria `undefined` — um cenário sem `kind`, pego só lá no
// Zod do `BaseAdapter`. O const é indexado por nome e o typecheck garante.
import { SCENARIO_KIND } from '@election-pool/contracts/enums';
import type { ScenarioKind } from '@election-pool/contracts/enums';
import { ParseError } from '../poll-source-adapter.js';
import { applyLine, categorizeLine } from '../base/scenario-lines.js';
import type { LineCategory, ScenarioAccumulator } from '../base/scenario-lines.js';
import type { RawScenario } from '../base/base-adapter.js';
import { parsePtBrPercent } from '../parse-ptbr-number.js';
import {
  IPEC_AGGREGATE_LABELS,
  IPEC_BLANK_NULL_LABELS,
  IPEC_CARGO_OUTROS,
  IPEC_CARGO_PRESIDENTE,
  IPEC_TABLE_TITLE_ESPONTANEA,
  IPEC_TABLE_TITLE_T2,
  IPEC_TABLE_TITLE_T2_SINGULAR,
  IPEC_UNDECIDED_LABELS,
} from './constants.js';

/**
 * Normaliza para comparação de rótulo: sem acento, minúsculo, espaços colapsados.
 * `º`/`ª`/`°` viram `o`/`a` porque o Ipec escreve "1º Turno" e queremos casar
 * "1o turno" sem depender do indicador ordinal.
 */
const normalize = (line: string): string =>
  line
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[º°]/g, 'o')
    .replace(/ª/g, 'a')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Um token de valor. O `%` é OBRIGATÓRIO nos numéricos: sem ele, `13` do rótulo
 * "Lula – 13 – PT" (o número de urna do candidato!) seria confundido com um
 * valor e a contagem de colunas daria errado. Aceita `*` e `-`, os dois
 * marcadores de ausência do release, e vírgula decimal caso o Ipec algum dia
 * publique com casa decimal.
 */
const VALUE_TOKEN = /^(?:\*|-|\d{1,3}(?:,\d+)?%)$/;

/** Marcadores de ausência: "Não foi citado" (`*`) e "não foi testado" (`-`). */
const ABSENCE_TOKENS: readonly string[] = ['*', '-'];

/**
 * Cabeçalho de colunas: SÓ datas `dd/mm`, uma por rodada comparada.
 * Real: `15/08 29/08` (duas rodadas) e `19/10` (uma). Uma linha como
 * `Avaliação 15/08 29/08` NÃO casa (tem rótulo antes) — e não deve, porque
 * pertence a uma tabela que não é intenção de voto.
 */
const DATE_HEADER = /^\d{2}\/\d{2}(?:\s+\d{2}\/\d{2})*$/;

/**
 * Sufixo de urna/partido no rótulo do candidato: `Lula – 13 – PT`. O separador é
 * travessão EN DASH (U+2013) no documento real; aceitamos também `—` e `-`.
 * O alias é só o NOME — é ele que o seed cadastra.
 */
const BALLOT_SUFFIX = /^(.+?)\s*[–—-]\s*\d{1,3}\s*[–—-]\s*\S+$/;

/** Turno do documento, lido do cabeçalho: `Brasil – 1º Turno – 2ª Rodada`. */
const DOC_TURNO = /\b([12])o turno\b/;

type Cargo = 'presidente' | 'outro' | 'indefinido';

interface Building {
  kind: ScenarioKind;
  label: string;
  /** Quantas colunas de rodada a tabela tem. A ATUAL é a última. */
  columns: number;
  acc: ScenarioAccumulator;
  /** Aliases na ordem de aparição, para montar o par de 2º turno. */
  candidateOrder: string[];
}

/** O que uma linha de tabela virou depois de lida. */
type TableLine =
  | { kind: 'value'; label: string; rawValue: string }
  | { kind: 'absent'; label: string }
  | { kind: 'notATable' };

/**
 * Lê uma linha DENTRO de uma tabela aberta. LANÇA em vez de devolver
 * `notATable` sempre que a linha PARECE dado e não pôde ser lida — é a diferença
 * entre "acabou a tabela" e "não consegui ler um valor" (R4).
 */
const readTableLine = (line: string, columns: number, tableLabel: string): TableLine => {
  const tokens = line.split(/\s+/).filter((t) => t.length > 0);
  const peeled: string[] = [];
  let i = tokens.length;
  while (i > 0) {
    const token = tokens[i - 1];
    if (token === undefined || !VALUE_TOKEN.test(token)) break;
    peeled.unshift(token);
    i -= 1;
  }

  if (peeled.length === 0) {
    // Nada de valor no fim da linha. Ou a tabela acabou (rodapé, próximo título),
    // ou o valor está ILEGÍVEL. Distinguimos pelo `%`: uma linha que termina em
    // "%" é claramente uma linha de dado, e se não pôde ser tokenizada é lixo —
    // LANÇA em vez de sumir com o candidato em silêncio.
    const last = tokens[tokens.length - 1];
    if (last !== undefined && last.endsWith('%')) {
      throw new ParseError(
        `Valor ilegível em "${tableLabel}": "${last}" na linha "${line}" ` +
          `(não é percentual pt-BR válido; nunca vira 0 — R4)`,
      );
    }
    return { kind: 'notATable' };
  }

  if (peeled.length !== columns) {
    // Ambiguidade de coluna é o pior caso silencioso deste formato: não há como
    // saber qual valor é o da rodada ATUAL. Recusamos.
    throw new ParseError(
      `Linha "${line}" em "${tableLabel}" tem ${String(peeled.length)} valores, ` +
        `mas o cabeçalho declara ${String(columns)} coluna(s) de rodada. ` +
        `Não adivinhamos qual é a rodada atual (R4).`,
    );
  }

  const label = tokens.slice(0, i).join(' ').trim();
  if (label.length === 0) {
    throw new ParseError(`Linha de valor sem rótulo em "${tableLabel}": "${line}"`);
  }

  // A rodada ATUAL é sempre a ÚLTIMA coluna (o release compara anterior→atual).
  const current = peeled[peeled.length - 1];
  if (current === undefined) {
    throw new ParseError(`Linha de valor sem coluna atual em "${tableLabel}": "${line}"`);
  }
  if (ABSENCE_TOKENS.includes(current)) {
    return { kind: 'absent', label };
  }
  return { kind: 'value', label, rawValue: current };
};

/** Extrai o alias do candidato do rótulo, tirando o sufixo `– 13 – PT`. */
const candidateAlias = (label: string): string => {
  const m = BALLOT_SUFFIX.exec(label.trim());
  const name = m?.[1];
  return (name ?? label).trim();
};

/**
 * Classifica um rótulo do Ipec. Os rótulos do Ipec vêm primeiro (a grafia real
 * "Branco ou nulo" / "Não sabem ou preferem não opinar" não está nas listas
 * compartilhadas); o que não for do Ipec cai no helper comum
 * `categorizeLine`, que também é quem converte o número (helper único de
 * docs/04 §4.1 — não replicamos a conversão aqui).
 *
 * Devolve `null` para rótulo AGREGADOR ("Outros"), que é dado publicado sem
 * lugar no `ParsedPoll` — exclusão declarada, ver `IPEC_AGGREGATE_LABELS`.
 */
const classifyIpecLine = (label: string, rawValue: string): LineCategory | null => {
  const normalized = normalize(label);
  if (IPEC_AGGREGATE_LABELS.includes(normalized)) return null;
  if (IPEC_BLANK_NULL_LABELS.includes(normalized)) {
    return { kind: 'blankNull', valuePct: parsePtBrPercent(rawValue) };
  }
  if (IPEC_UNDECIDED_LABELS.includes(normalized)) {
    return { kind: 'undecided', valuePct: parsePtBrPercent(rawValue) };
  }
  const categorized = categorizeLine(label, rawValue);
  if (categorized.kind !== 'candidate') return categorized;
  // Só o nome vira alias; `– 13 – PT` é metadado de urna, não identidade.
  return {
    kind: 'candidate',
    alias: candidateAlias(categorized.alias),
    valuePct: categorized.valuePct,
  };
};

/** Uma linha em CAIXA ALTA é cabeçalho de seção no release do Ipec. */
const isSectionHeader = (line: string): boolean =>
  /\p{Lu}/u.test(line) && line === line.toUpperCase();

/**
 * Cargo anunciado por uma linha, ou `null` se a linha não anuncia cargo.
 *
 * Só DUAS classes de linha mudam o cargo corrente, e a restrição é deliberada:
 * o cabeçalho de seção em caixa alta ("INTENÇÃO DE VOTO PARA PRESIDENTE",
 * "OUTRAS INFORMAÇÕES DA PESQUISA PARA GOVERNADOR") e a linha "Pergunta:", que
 * enuncia o cargo da tabela seguinte. Se qualquer menção a "presidente" mudasse
 * o cargo, um marcador de análise dentro da seção do governador ("a gestão do
 * presidente Jair Bolsonaro") viraria o escopo e a tabela do governador seria
 * importada como se fosse de presidente.
 */
const cargoFromLine = (line: string): Cargo | null => {
  const normalized = normalize(line);
  const announces = normalized.startsWith('pergunta:') || isSectionHeader(line);
  if (!announces) return null;
  // Cargo não-presidencial primeiro: numa linha que cite os dois, o mais
  // restritivo ganha e a tabela fica de fora (preferimos perder dado a misturar).
  if (IPEC_CARGO_OUTROS.some((cargo) => normalized.includes(cargo))) return 'outro';
  if (normalized.includes(IPEC_CARGO_PRESIDENTE)) return 'presidente';
  return null;
};

/**
 * Título de tabela de intenção de voto (allowlist). `null` = não é tabela nossa.
 * O casamento é por substring porque num release real o título vem TRUNCADO:
 * "Intenção de voto espontânea (sem a apresentação dos nomes dos candidatos"
 * (sem fechar o parêntese).
 */
type TitleMatch = { kind: ScenarioKind } | { unrepresentable: string };

const tableTitle = (line: string, docTurno: '1' | '2'): TitleMatch | null => {
  const normalized = normalize(line);
  if (
    normalized.includes(IPEC_TABLE_TITLE_T2) ||
    normalized.includes(IPEC_TABLE_TITLE_T2_SINGULAR)
  ) {
    return { kind: SCENARIO_KIND.t2 };
  }
  if (normalized.includes(IPEC_TABLE_TITLE_ESPONTANEA)) {
    // Num release de 2º TURNO, a tabela espontânea é o voto espontâneo do
    // SEGUNDO turno — e `SCENARIO_KIND` (docs/03 §2.4) não tem 't2_espontaneo'.
    // Chamá-la de `t1_espontaneo` seria rotular a rodada errada. Não é
    // representável: reconhecemos e recusamos, em vez de emitir com kind errado.
    if (docTurno === '2') {
      return {
        unrepresentable:
          'voto espontâneo de 2º turno não tem kind em SCENARIO_KIND (não há t2_espontaneo)',
      };
    }
    return { kind: SCENARIO_KIND.t1Espontaneo };
  }
  return null;
};

const finalize = (b: Building): RawScenario => {
  if (b.acc.values.length === 0) {
    throw new ParseError(
      `Tabela "${b.label}" abriu com cabeçalho de rodada mas não produziu nenhum ` +
        `valor de candidato (estrutura mudou?)`,
    );
  }
  const base: RawScenario = {
    kind: b.kind,
    label: b.label,
    values: b.acc.values,
    ...(b.acc.blankNullPct === undefined ? {} : { blankNullPct: b.acc.blankNullPct }),
    ...(b.acc.undecidedPct === undefined ? {} : { undecidedPct: b.acc.undecidedPct }),
  };
  if (b.kind !== SCENARIO_KIND.t2) return base;

  if (b.candidateOrder.length !== 2) {
    throw new ParseError(
      `Cenário de 2º turno "${b.label}" com ${String(b.candidateOrder.length)} candidatos ` +
        `(esperado exatamente 2 — V3, docs/04 §5)`,
    );
  }
  const [a, c] = b.candidateOrder;
  if (a === undefined || c === undefined) {
    throw new ParseError(`Cenário de 2º turno "${b.label}" com par incompleto`);
  }
  return { ...base, t2Pair: [a, c] };
};

/**
 * Turno do documento, do cabeçalho real (`Brasil – 1º Turno – 2ª Rodada`).
 * LANÇA se não achar: sem saber o turno não há como classificar a tabela
 * espontânea sem risco de rotular a rodada errada, e chutar é pior que falhar.
 */
const documentTurno = (lines: readonly string[]): '1' | '2' => {
  for (const line of lines) {
    const m = DOC_TURNO.exec(normalize(line));
    const turno = m?.[1];
    if (turno === '1' || turno === '2') return turno;
  }
  throw new ParseError(
    'Release do Ipec sem indicação de turno no cabeçalho (esperado "1º Turno"/"2º Turno"). ' +
      'Sem o turno não classificamos os cenários — estrutura mudou?',
  );
};

/**
 * Extrai os cenários de intenção de voto do texto de um release do Ipec.
 * Devolve pelo menos um cenário ou LANÇA — nunca lista vazia, nunca parcial.
 */
export const parseIpecReleaseText = (text: string): RawScenario[] => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const docTurno = documentTurno(lines);

  const scenarios: RawScenario[] = [];
  let cargo: Cargo = 'indefinido';
  let current: Building | null = null;
  /** Título aberto, à espera do cabeçalho de datas na linha seguinte. */
  let pendingTitle: { kind: ScenarioKind; label: string } | null = null;
  /** Diagnóstico: tabelas reconhecidas mas descartadas, e por quê. */
  const skipped: string[] = [];

  const flush = (): void => {
    if (current !== null) scenarios.push(finalize(current));
    current = null;
  };

  for (const line of lines) {
    // 1. Um título de tabela nossa sempre fecha a anterior e abre a próxima.
    const title = tableTitle(line, docTurno);
    if (title !== null) {
      flush();
      if ('unrepresentable' in title) {
        skipped.push(`"${line}" (${title.unrepresentable})`);
        pendingTitle = null;
        continue;
      }
      if (cargo !== 'presidente') {
        // Tabela de outro cargo (ou de cargo indefinido): fora de escopo. Não é
        // erro — é um release estadual trazendo governador junto.
        skipped.push(`"${line}" (cargo ${cargo}, não presidente)`);
        pendingTitle = null;
        continue;
      }
      pendingTitle = { kind: title.kind, label: line };
      continue;
    }

    // 2. Logo depois do título vem o cabeçalho de datas, que define as colunas.
    if (pendingTitle !== null) {
      if (!DATE_HEADER.test(line)) {
        throw new ParseError(
          `Tabela "${pendingTitle.label}" não é seguida por cabeçalho de datas ` +
            `(esperado "dd/mm [dd/mm…]", veio "${line}"). Estrutura mudou?`,
        );
      }
      const columns = line.split(/\s+/).filter((t) => t.length > 0).length;
      current = {
        kind: pendingTitle.kind,
        label: pendingTitle.label,
        columns,
        acc: { values: [] },
        candidateOrder: [],
      };
      pendingTitle = null;
      continue;
    }

    // 3. Dentro de uma tabela: linha de valor, ou fim da tabela.
    if (current !== null) {
      const read = readTableLine(line, current.columns, current.label);
      if (read.kind === 'absent') {
        // "Não foi citado" / "não foi testado": o candidato NÃO entra. Ausência
        // não é zero (R4, docs/04 §4.1).
        continue;
      }
      if (read.kind === 'value') {
        const categorized = classifyIpecLine(read.label, read.rawValue);
        if (categorized === null) continue; // agregador "Outros": exclusão declarada
        if (categorized.kind === 'candidate') {
          current.candidateOrder.push(categorized.alias);
        }
        applyLine(current.acc, categorized);
        continue;
      }
      flush();
      // A linha que fechou a tabela ainda pode anunciar um cargo (cai abaixo).
    }

    // 4. Fora de tabela: só o cargo corrente muda.
    const announced = cargoFromLine(line);
    if (announced !== null) cargo = announced;
  }
  flush();

  if (scenarios.length === 0) {
    // Zero cenário é resultado legítimo do formato (release estadual de 2º turno,
    // por exemplo: governador fora de escopo + espontânea de 2º turno não
    // representável + estimulado só no gráfico). Mas é ERRO para o chamador, que
    // pediu os números desta rodada. Falhamos alto, dizendo o que foi visto.
    throw new ParseError(
      `Nenhum cenário de intenção de voto representável no release do Ipec ` +
        `(documento de ${docTurno}º turno). ` +
        (skipped.length > 0
          ? `Tabelas vistas e descartadas: ${skipped.join('; ')}. `
          : 'Nenhuma tabela reconhecida. ') +
        `Lembrete: o 1º turno estimulado do Ipec é publicado como gráfico e não ` +
        `tem camada de texto — não é extraível na v1.`,
    );
  }
  return scenarios;
};
