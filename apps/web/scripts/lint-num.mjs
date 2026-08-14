#!/usr/bin/env node
/**
 * lint-num — proíbe dígito solto em texto de template (.astro) fora de
 * <Num> / <AnimatedNum> (docs/05 §3.1).
 *
 *   FALHA:   <p>São 40 pesquisas</p>
 *   PASSA:   <p>São <Num>40</Num> pesquisas</p>
 *
 * É um linter heurístico (não um parser AST completo): opera sobre o TEXTO
 * renderizado do template, ignorando regiões onde dígitos são legítimos:
 *   - frontmatter (--- ... ---): é TS/JS
 *   - <script> e <style>: código, não texto de dado
 *   - comentários HTML <!-- -->
 *   - conteúdo de tags <...> (atributos, nomes, class="col-span-6", etc.)
 *   - expressões {...}: são JS (value={40.8}) — o valor não é texto literal
 *   - o conteúdo de <Num>...</Num> e <AnimatedNum>...</AnimatedNum>
 *
 * O que sobra é texto que o usuário lê como prosa. Qualquer dígito ali é solto.
 *
 * Regras de exclusão adicionais (não são "número de dado"):
 *   - entidades numéricas (&#39;, &#x2014;)
 *   - dígitos dentro de palavras/identificadores (h1, col-span-6 já caem no
 *     stripping de tag; mas ex.: "COVID19" em prosa também é ignorado)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');
const ROOT = join(__dirname, '..');

/** Substitui uma faixa [start,end) por espaços, preservando quebras de linha
 * (para manter número de linha/coluna nos relatórios). */
function blankRange(str, start, end) {
  let out = '';
  for (let i = start; i < end; i++) out += str[i] === '\n' ? '\n' : ' ';
  return str.slice(0, start) + out + str.slice(end);
}

/** Remove todas as ocorrências de um regex global, preservando linhas. */
function blankAll(text, re) {
  let result = text;
  let m;
  re.lastIndex = 0;
  const ranges = [];
  while ((m = re.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) re.lastIndex++;
  }
  // Aplica de trás para frente para não deslocar índices.
  for (let i = ranges.length - 1; i >= 0; i--) {
    result = blankRange(result, ranges[i][0], ranges[i][1]);
  }
  return result;
}

/** Remove o conteúdo de um par de tags nomeadas (inclusive as tags), aninhamento
 * simples não suportado — <Num>/<AnimatedNum> não aninham. */
function blankTagContent(text, tagNames) {
  let result = text;
  for (const tag of tagNames) {
    const re = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, 'g');
    result = blankAll(result, re);
  }
  return result;
}

/** Extrai só a parte de template do .astro (após o segundo '---'). Se não houver
 * frontmatter, o arquivo inteiro é template. */
function stripFrontmatter(text) {
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3);
    if (end !== -1) {
      const after = text.indexOf('\n', end + 1);
      const cut = after === -1 ? text.length : after + 1;
      return blankRange(text, 0, cut);
    }
  }
  return text;
}

function sanitize(text) {
  let t = stripFrontmatter(text);
  // <script> e <style> (com atributos), incluindo is:inline.
  t = blankAll(t, /<script\b[\s\S]*?<\/script>/gi);
  t = blankAll(t, /<style\b[\s\S]*?<\/style>/gi);
  // Comentários HTML e comentários de bloco JS eventuais.
  t = blankAll(t, /<!--[\s\S]*?-->/g);
  // Conteúdo dos números permitidos.
  t = blankTagContent(t, ['Num', 'AnimatedNum']);
  // Expressões {...} (JS): não são texto literal. Faz várias passadas para
  // lidar com pares simples; chaves aninhadas são raras em texto de template.
  for (let i = 0; i < 5; i++) t = blankAll(t, /\{[^{}]*\}/g);
  // Conteúdo de qualquer tag <...> (atributos, nomes, class, etc.).
  t = blankAll(t, /<[^>]*>/g);
  // Entidades numéricas (&#39; &#x2014;).
  t = blankAll(t, /&#x?[0-9a-f]+;/gi);
  return t;
}

function findAstroFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...findAstroFiles(full));
    else if (name.endsWith('.astro')) out.push(full);
  }
  return out;
}

const files = findAstroFiles(SRC);
const violations = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const cleaned = sanitize(text);
  const lines = cleaned.split('\n');
  const origLines = text.split('\n');
  lines.forEach((line, i) => {
    const m = /\d/.exec(line);
    if (m) {
      violations.push({
        file: relative(ROOT, file),
        line: i + 1,
        col: m.index + 1,
        text: origLines[i]?.trim() ?? '',
      });
    }
  });
}

if (violations.length > 0) {
  console.error('\nlint-num: dígito solto fora de <Num>/<AnimatedNum>:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}:${v.col}  ${v.text}`);
  }
  console.error(
    `\n${violations.length} violação(ões). Envolva o numeral: <Num>40</Num> ou <AnimatedNum value={40} />.\n`,
  );
  process.exit(1);
}

console.log(`lint-num: OK — ${files.length} arquivo(s) .astro, nenhum dígito solto.`);
