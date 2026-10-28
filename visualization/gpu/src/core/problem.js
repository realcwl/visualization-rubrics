import { rng } from './util.js';

/**
 * The matmul being visualized, at "cell" resolution: 1 cell = an 8×8 block of
 * elements. Values are smooth-ish random numbers in (0, 1] so that partial sums
 * grow monotonically and the accumulator visibly "fills up".
 */
export function makeProblem(M = 256, N = 256, K = 256, seed = 11) {
  const mc = M / 8;
  const nc = N / 8;
  const kc = K / 8;
  const r = rng(seed);
  const field = (rows, cols, fx, fy, ph) => {
    const a = [];
    for (let i = 0; i < rows; i++) {
      const row = new Float32Array(cols);
      for (let j = 0; j < cols; j++) {
        const s = 0.5 + 0.22 * Math.sin(i * fx + ph) * Math.cos(j * fy - ph * 0.7) + 0.18 * Math.sin((i + j) * 0.11 + ph);
        row[j] = Math.min(1, Math.max(0.08, s + (r() - 0.5) * 0.42));
      }
      a.push(row);
    }
    return a;
  };
  const A = field(mc, kc, 0.23, 0.17, 1.3);
  const B = field(kc, nc, 0.19, 0.29, 4.1);

  // prefix sums over k: pre[k][m*nc+n] = Σ_{k'<k} A[m][k'] B[k'][n]
  const pre = [new Float32Array(mc * nc)];
  for (let k = 0; k < kc; k++) {
    const prev = pre[k];
    const cur = new Float32Array(mc * nc);
    for (let m = 0; m < mc; m++) {
      const a = A[m][k];
      const Bk = B[k];
      for (let n = 0; n < nc; n++) cur[m * nc + n] = prev[m * nc + n] + a * Bk[n];
    }
    pre.push(cur);
  }
  let max = 0;
  for (const v of pre[kc]) max = Math.max(max, v);

  return {
    M, N, K, mc, nc, kc, A, B,
    /** Normalized partial sum of C[m][n] using the first kUpTo cells of K. */
    c: (m, n, kUpTo) => pre[kUpTo][m * nc + n] / max,
  };
}
