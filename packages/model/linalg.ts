/**
 * Álgebra linear para matrizes pequenas (2–10 dimensões), sem dependência
 * externa (T-03: `packages/model` é biblioteca pura, só Node stdlib + contracts).
 *
 * Matrizes são `number[][]` densas, linha-maior; vetores são `number[]`. As
 * rotinas são escritas para tamanhos pequenos — clareza e determinismo importam
 * mais que constante assintótica. Toda operação é pura (não muta a entrada).
 *
 * Nada aqui usa RNG nem depende de ordem de `Map`/`Object`: dado o mesmo input,
 * o output é bit a bit idêntico (docs/01 §9).
 */

export type Matrix = readonly (readonly number[])[];
export type Vector = readonly number[];

const ZERO = 0;
const ONE = 1;
// Divisor da média de dois valores ((a+b)/2). Aritmética estrutural, não é
// parâmetro de modelo — nomeada para o gate de viés (docs/07 §5.1) passar honesto.
const PAIR_MEAN_DIVISOR = 2;

/** Constrói uma matriz `rows × cols` preenchida com `fill` (padrão 0). */
export function zeros(rows: number, cols: number, fill = ZERO): number[][] {
  const out: number[][] = [];
  for (let r = ZERO; r < rows; r++) {
    const row: number[] = [];
    for (let c = ZERO; c < cols; c++) row.push(fill);
    out.push(row);
  }
  return out;
}

/** Matriz identidade `n × n`. */
export function identity(n: number): number[][] {
  const out = zeros(n, n);
  for (let i = ZERO; i < n; i++) {
    const row = out[i];
    if (row) row[i] = ONE;
  }
  return out;
}

/** Cópia profunda (nova matriz mutável). */
export function clone(a: Matrix): number[][] {
  return a.map((row) => row.slice());
}

/** Número de linhas. */
export function rows(a: Matrix): number {
  return a.length;
}

/** Número de colunas (0 se a matriz for vazia). */
export function cols(a: Matrix): number {
  const first = a[ZERO];
  return first ? first.length : ZERO;
}

/** Transposta. */
export function transpose(a: Matrix): number[][] {
  const nr = rows(a);
  const nc = cols(a);
  const out = zeros(nc, nr);
  for (let r = ZERO; r < nr; r++) {
    const arow = a[r];
    if (!arow) continue;
    for (let c = ZERO; c < nc; c++) {
      const orow = out[c];
      if (orow) orow[r] = arow[c] ?? ZERO;
    }
  }
  return out;
}

/** Soma elemento a elemento (dimensões devem casar). */
export function add(a: Matrix, b: Matrix): number[][] {
  const nr = rows(a);
  const nc = cols(a);
  if (rows(b) !== nr || cols(b) !== nc) {
    throw new Error(`add: dimension mismatch ${nr}x${nc} vs ${rows(b)}x${cols(b)}`);
  }
  const out = zeros(nr, nc);
  for (let r = ZERO; r < nr; r++) {
    const arow = a[r];
    const brow = b[r];
    const orow = out[r];
    if (!arow || !brow || !orow) continue;
    for (let c = ZERO; c < nc; c++) orow[c] = (arow[c] ?? ZERO) + (brow[c] ?? ZERO);
  }
  return out;
}

/** Subtração elemento a elemento (dimensões devem casar). */
export function sub(a: Matrix, b: Matrix): number[][] {
  const nr = rows(a);
  const nc = cols(a);
  if (rows(b) !== nr || cols(b) !== nc) {
    throw new Error(`sub: dimension mismatch ${nr}x${nc} vs ${rows(b)}x${cols(b)}`);
  }
  const out = zeros(nr, nc);
  for (let r = ZERO; r < nr; r++) {
    const arow = a[r];
    const brow = b[r];
    const orow = out[r];
    if (!arow || !brow || !orow) continue;
    for (let c = ZERO; c < nc; c++) orow[c] = (arow[c] ?? ZERO) - (brow[c] ?? ZERO);
  }
  return out;
}

/** Multiplicação de matrizes (`a` é `m×k`, `b` é `k×n`). */
export function matmul(a: Matrix, b: Matrix): number[][] {
  const m = rows(a);
  const k = cols(a);
  const k2 = rows(b);
  const n = cols(b);
  if (k !== k2) {
    throw new Error(`matmul: inner dimension mismatch ${m}x${k} · ${k2}x${n}`);
  }
  const out = zeros(m, n);
  for (let i = ZERO; i < m; i++) {
    const arow = a[i];
    const orow = out[i];
    if (!arow || !orow) continue;
    for (let p = ZERO; p < k; p++) {
      const aip = arow[p] ?? ZERO;
      if (aip === ZERO) continue;
      const brow = b[p];
      if (!brow) continue;
      for (let j = ZERO; j < n; j++) orow[j] = (orow[j] ?? ZERO) + aip * (brow[j] ?? ZERO);
    }
  }
  return out;
}

/** Multiplicação matriz × vetor (`a` é `m×n`, `x` tem comprimento `n`). */
export function matvec(a: Matrix, x: Vector): number[] {
  const m = rows(a);
  const n = cols(a);
  if (x.length !== n) {
    throw new Error(`matvec: dimension mismatch ${m}x${n} · ${x.length}`);
  }
  const out: number[] = new Array<number>(m).fill(ZERO);
  for (let i = ZERO; i < m; i++) {
    const arow = a[i];
    if (!arow) continue;
    let acc = ZERO;
    for (let j = ZERO; j < n; j++) acc += (arow[j] ?? ZERO) * (x[j] ?? ZERO);
    out[i] = acc;
  }
  return out;
}

/** Multiplicação escalar. */
export function scale(a: Matrix, s: number): number[][] {
  return a.map((row) => row.map((v) => v * s));
}

/**
 * Força simetria: `(P + Pᵀ) / 2`. Aplicada a cada passo do filtro para conter
 * erro de arredondamento que quebraria a simetria da covariância (T-03,
 * armadilhas). Não muta a entrada.
 */
export function symmetrize(a: Matrix): number[][] {
  const n = rows(a);
  if (cols(a) !== n) throw new Error(`symmetrize: matrix must be square, got ${n}x${cols(a)}`);
  const out = zeros(n, n);
  for (let i = ZERO; i < n; i++) {
    const ai = a[i];
    const oi = out[i];
    if (!ai || !oi) continue;
    for (let j = ZERO; j < n; j++) {
      const aij = ai[j] ?? ZERO;
      const arow = a[j];
      const aji = arow ? (arow[i] ?? ZERO) : ZERO;
      oi[j] = (aij + aji) / PAIR_MEAN_DIVISOR;
    }
  }
  return out;
}

/**
 * Inversa por eliminação de Gauss-Jordan com pivoteamento parcial. Para matrizes
 * pequenas SPD (covariâncias) isso é estável o suficiente. Lança se singular.
 */
export function inverse(a: Matrix): number[][] {
  const n = rows(a);
  if (cols(a) !== n) throw new Error(`inverse: matrix must be square, got ${n}x${cols(a)}`);
  const m = clone(a);
  const inv = identity(n);
  for (let col = ZERO; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(m[col]?.[col] ?? ZERO);
    for (let r = col + ONE; r < n; r++) {
      const v = Math.abs(m[r]?.[col] ?? ZERO);
      if (v > pivotAbs) {
        pivotAbs = v;
        pivotRow = r;
      }
    }
    if (pivotAbs === ZERO || !Number.isFinite(pivotAbs)) {
      throw new Error('inverse: matrix is singular or non-finite');
    }
    if (pivotRow !== col) {
      swapRows(m, col, pivotRow);
      swapRows(inv, col, pivotRow);
    }
    const pivRowM = m[col];
    const pivRowInv = inv[col];
    if (!pivRowM || !pivRowInv) throw new Error('inverse: internal row access');
    const piv = pivRowM[col] ?? ZERO;
    for (let c = ZERO; c < n; c++) {
      pivRowM[c] = (pivRowM[c] ?? ZERO) / piv;
      pivRowInv[c] = (pivRowInv[c] ?? ZERO) / piv;
    }
    for (let r = ZERO; r < n; r++) {
      if (r === col) continue;
      const rowM = m[r];
      const rowInv = inv[r];
      if (!rowM || !rowInv) continue;
      const factor = rowM[col] ?? ZERO;
      if (factor === ZERO) continue;
      for (let c = ZERO; c < n; c++) {
        rowM[c] = (rowM[c] ?? ZERO) - factor * (pivRowM[c] ?? ZERO);
        rowInv[c] = (rowInv[c] ?? ZERO) - factor * (pivRowInv[c] ?? ZERO);
      }
    }
  }
  return inv;
}

function swapRows(m: number[][], i: number, j: number): void {
  const tmp = m[i];
  const other = m[j];
  if (tmp && other) {
    m[i] = other;
    m[j] = tmp;
  }
}
