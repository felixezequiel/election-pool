/**
 * `no-directional-bias.spec.ts` — o gate de viés do modelo (docs/07 §5.1, R2 do
 * CLAUDE.md).
 *
 * Lê TODO arquivo `.ts` de `packages/model` (exceto testes) e FALHA se encontrar:
 *
 *   1. Nome próprio de candidato ou partido brasileiro (lista-fixture abaixo).
 *   2. Termo de espectro político (`esquerda`, `direita`, `left`, `right`,
 *      `centro`).
 *   3. Constante numérica NÃO declarada: só `0` e `1` são permitidos inline;
 *      qualquer outro número precisa (a) vir de `@election-pool/contracts/
 *      constants` (importado por símbolo, então não aparece como literal) ou
 *      (b) ser o inicializador de uma declaração `const NOME = <número>` — o
 *      formato sancionado pelo CLAUDE.md ("nenhum valor mágico: constantes vão
 *      para ... com comentário explicando a origem"). Literal solto numa
 *      expressão (ex.: `x + 2`, `value += 2`) é reprovado.
 *
 * O modelo tem que ser INCAPAZ de saber de quem está falando (docs/07 §5.1). Se
 * ele precisar saber, o design está errado.
 *
 * Nota sobre datas: a aritmética de calendário (índices de fatia de `YYYY-MM-DD`,
 * época UTC `1970`, radix `10`) vive em `calendar.ts` e em consts nomeadas — NÃO
 * é parâmetro de modelo. O grep não é enfraquecido para tolerá-la: ela passa
 * honestamente porque cada número está DECLARADO com nome (regra 3b).
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, '..');

// --- Fixture: nomes que o modelo JAMAIS pode referenciar --------------------
// Sobrenomes de presidenciáveis recorrentes e siglas de partido. Não é
// exaustivo por design: a defesa real é o grep de literais + a arquitetura pura.
// Casadas como palavra inteira, case-insensitive.
const CANDIDATE_AND_PARTY_NAMES = [
  'lula',
  'bolsonaro',
  'haddad',
  'ciro',
  'marina',
  'tebet',
  'alckmin',
  'doria',
  'moro',
  'pt',
  'pl',
  'psdb',
  'mdb',
  'pdt',
  'psol',
  'podemos',
  'republicanos',
  'psb',
  'uniao',
];

const SPECTRUM_TERMS = ['esquerda', 'direita', 'left', 'right', 'centro'];

// --- Coleta de arquivos-fonte (exclui testes) -------------------------------

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '__tests__') continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (
      extname(entry) === '.ts' &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

// --- Remoção de comentários e strings ---------------------------------------
// Documentação (JSDoc, comentários) e strings PODEM conter números e até nomes:
// são texto explicativo, não código. Zeramos comentários e literais de string/
// template antes de aplicar as regras, para que o grep incida só sobre CÓDIGO.

function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  type Mode = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let mode: Mode = 'code';
  while (i < n) {
    const c = src[i] ?? '';
    const next = src[i + 1] ?? '';
    if (mode === 'code') {
      if (c === '/' && next === '/') {
        mode = 'line';
        i += 2;
      } else if (c === '/' && next === '*') {
        mode = 'block';
        i += 2;
      } else if (c === "'") {
        mode = 'single';
        i += 1;
      } else if (c === '"') {
        mode = 'double';
        i += 1;
      } else if (c === '`') {
        mode = 'template';
        i += 1;
      } else {
        out += c;
        i += 1;
      }
    } else if (mode === 'line') {
      if (c === '\n') {
        mode = 'code';
        out += c;
      }
      i += 1;
    } else if (mode === 'block') {
      if (c === '*' && next === '/') {
        mode = 'code';
        i += 2;
      } else {
        if (c === '\n') out += c;
        i += 1;
      }
    } else {
      // dentro de string/template: pula, respeitando escape
      if (c === '\\') {
        i += 2;
        continue;
      }
      const closer = mode === 'single' ? "'" : mode === 'double' ? '"' : '`';
      if (c === closer) mode = 'code';
      i += 1;
    }
  }
  return out;
}

// --- Regra 3: literais numéricos --------------------------------------------
// Um literal permitido é `0` ou `1`, OU o inicializador de uma declaração
// `const NOME [= | :type=] <número>`. Removemos as linhas de declaração de const
// que atribuem um único literal, depois procuramos QUALQUER número remanescente:
// se sobrar algo diferente de 0/1, é literal solto ⇒ reprovado.

// Declaração de const cujo RHS é um único literal numérico (com sinal/expoente).
const CONST_NUM_DECL =
  /\bconst\s+[A-Za-z_$][\w$]*\s*(?::\s*[\w<>[\]| ]+\s*)?=\s*-?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\s*;/g;

// Qualquer literal numérico (inteiro/real/expoente/hex/bin), como token isolado —
// não precedido nem seguido de caractere de identificador (evita casar `ES2022`,
// `col1`, `0x`, `latin1` etc. que são partes de identificadores/strings — strings
// já foram removidas).
const NUMERIC_TOKEN = /(?<![\w$.])-?(?:0[xXbBoO][0-9a-fA-F]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

function findIllegalNumericLiterals(code: string): string[] {
  // Remove as declarações de const-com-literal (regra 3b).
  const withoutDecls = code.replace(CONST_NUM_DECL, ' ');
  const illegal: string[] = [];
  let m: RegExpExecArray | null;
  NUMERIC_TOKEN.lastIndex = 0;
  while ((m = NUMERIC_TOKEN.exec(withoutDecls)) !== null) {
    const raw = m[0];
    const normalized = raw.replace(/_/g, '');
    if (normalized === '0' || normalized === '1') continue; // permitidos
    illegal.push(raw);
  }
  return illegal;
}

// ---------------------------------------------------------------------------

describe('no-directional-bias (docs/07 §5.1, R2)', () => {
  const files = collectSourceFiles(packageRoot);

  it('scans at least the known model source files', () => {
    // Sanidade: garante que o coletor está de fato lendo o código do modelo.
    // Normaliza a barra antes de cortar o prefixo: no Windows `join` produz `\`
    // e o corte silenciosamente não acontecia, deixando o teste passar por
    // acidente (ou falhar, como falhava) em vez de checar o que promete.
    const names = files.map((f) =>
      f.replace(/\\/g, '/').replace(`${packageRoot.replace(/\\/g, '/')}/`, ''),
    );
    expect(names).toContain('index.ts');
    expect(names).toContain('house-effects.ts');
    expect(names).toContain('kalman.ts');
    expect(names).toContain('calendar.ts');
    expect(names).toContain('linalg.ts');
    expect(names).toContain('transitions.ts');
  });

  it('contains no Brazilian candidate or party proper name', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8').toLowerCase();
      for (const name of CANDIDATE_AND_PARTY_NAMES) {
        const re = new RegExp(`\\b${name}\\b`);
        expect(re.test(src), `forbidden name '${name}' found in ${file}`).toBe(false);
      }
    }
  });

  it('contains no political-spectrum term', () => {
    for (const file of files) {
      const src = readFileSync(file, 'utf8').toLowerCase();
      for (const term of SPECTRUM_TERMS) {
        const re = new RegExp(`\\b${term}\\b`);
        expect(re.test(src), `forbidden spectrum term '${term}' found in ${file}`).toBe(false);
      }
    }
  });

  it('contains no undeclared numeric literal (only 0/1 inline; else named const or from contracts)', () => {
    for (const file of files) {
      const raw = readFileSync(file, 'utf8');
      const code = stripCommentsAndStrings(raw);
      const illegal = findIllegalNumericLiterals(code);
      expect(
        illegal,
        `undeclared numeric literal(s) ${JSON.stringify(illegal)} in ${file}`,
      ).toEqual([]);
    }
  });
});
