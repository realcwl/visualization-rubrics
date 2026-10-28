// Choreography v2: Earth → dive → pause at every level → … one PE, then one unbroken pull-back to the whole Earth.
export const FPS = 60, DUR = 44;
const deg = Math.PI / 180;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Pauses: [tStart, tEnd, zStart, zEnd]. Between pauses, an eased dive (cubic Hermite, C1-continuous).
export const HOLDS = [
  [0.0, 2.3, -4.46, -4.38, 'Earth'],
  [4.7, 6.4, -2.28, -2.18, 'Central US'],
  [8.1, 9.8, -1.12, -1.02, 'Campus'],
  [11.5, 13.2, 0.00, 0.10, 'Data center'],
  [14.8, 16.5, 1.48, 1.56, 'Superpod'],
  [17.5, 19.2, 2.25, 2.33, 'Cube'],
  [20.3, 22.0, 3.20, 3.28, 'Tray'],
  [23.1, 24.8, 4.30, 4.38, 'Chip'],
  [25.9, 27.6, 5.28, 5.36, 'TensorCore'],
  [28.7, 30.4, 6.36, 6.44, 'MXU'],
  [31.9, 33.9, 8.00, 8.12, 'PE'],
];
export const OUT = [33.9, 42.2, -4.75];   // pull-back: start, end, final z (then hold to DUR)

const KN = [];
HOLDS.forEach(([t0, t1, z0, z1], i) => {
  const v = (z1 - z0) / (t1 - t0);
  KN.push([t0, z0, v], [t1, z1, i === HOLDS.length - 1 ? 0 : v]);
});
const herm = (t, [t0, z0, v0], [t1, z1, v1]) => {
  const h = t1 - t0, s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * z0 + (s3 - 2 * s2 + s) * h * v0 + (-2 * s3 + 3 * s2) * z1 + (s3 - s2) * h * v1;
};
// Pull-back speed: 0.6 s ramp-up, steady cruise, then a long smoothstep landing as the Earth recedes.
const T_IN = 0.6, T_LAND = 2.8;
function outDist(u, T) {
  const tc = T - T_IN - T_LAND, ss = x => x * x * x * (1 - x / 2);   // ∫ smoothstep
  if (u <= T_IN) return T_IN * ss(u / T_IN);
  if (u <= T_IN + tc) return T_IN / 2 + (u - T_IN);
  const w = Math.min(1, (u - T_IN - tc) / T_LAND);
  return T_IN / 2 + tc + T_LAND * (w - ss(w));
}
const outP = (u, T) => outDist(u, T) / outDist(T, T);

export function zAt(t) {
  const [o0, o1, zf] = OUT, zPE = KN[KN.length - 1][1];
  if (t >= o0) return zPE + (zf - zPE) * outP(Math.min(t, o1) - o0, o1 - o0);
  for (let i = 0; i < KN.length - 1; i++) if (t <= KN[i + 1][0]) return herm(t, KN[i], KN[i + 1]);
  return zPE;
}
// Orbit offsets (radians) on top of the page's guided angles: a slow drift for parallax during the pauses;
// while the Earth recedes the camera swings east and lower so the day–night line comes into view.
export function orbitAt(t, sign = 1) {
  const az = 0.25 * deg * (t - 17) + sign * 37 * deg * sstep(39.2, 44.9, t);
  const el = -12.5 * deg * sstep(39.6, 44.2, t);
  return [az, el];
}
