import { zAt, FPS, DUR, HOLDS } from './curve.mjs';
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
function peActJS(k, n, cyc) { let a = 0; for (let i = 0; i < 3; i++) { const tile = Math.floor(cyc / 512) - i, d0 = cyc - tile * 512 - 260 - (k + n), j = Math.floor(d0 / 24), w = d0 - j * 24; if (j >= 0 && j < 12) a = Math.max(a, sstep(0, 1.2, w) * (1 - sstep(6.8, 8, w))); } return a; }
let vmax = 0, vmin = 0, amax = 0, pv = null;
for (let i = 1; i <= DUR * FPS; i++) { const v = (zAt(i / FPS) - zAt((i - 1) / FPS)) * FPS; vmax = Math.max(vmax, v); vmin = Math.min(vmin, v); if (pv !== null) amax = Math.max(amax, Math.abs(v - pv) * FPS); pv = v; }
console.log(`dz/dt range ${vmin.toFixed(2)} .. ${vmax.toFixed(2)}   max |accel| ${amax.toFixed(1)} z/s²`);
const ST = [[-9, 'Earth'], [-3.3, 'US'], [-1.45, 'Campus'], [-0.62, 'DC'], [0.95, 'Pod'], [2, 'Cube'], [3, 'Tray'], [4, 'Chip'], [5, 'Core'], [6, 'MXU'], [7.6, 'PE']];
let s = -1, line = '';
for (let i = 0; i <= DUR * FPS; i++) { const z = zAt(i / FPS); let k = 0; ST.forEach((x, j) => { if (z >= x[0]) k = j; }); if (k !== s) { s = k; line += `${(i / FPS).toFixed(2)}→${ST[k][1]}  `; } }
console.log('HUD stage switches:', line);
console.log('pull-back z at t=', [33.9, 35, 36, 37, 38, 39, 40, 41, 42.2].map(t => `${t}:${zAt(t).toFixed(2)}`).join(' '));
function cycles(pre) { let c = 300 + 110 * pre, out = []; for (let i = 0; i <= DUR * FPS; i++) { c += (1 / FPS) * lerp(110, 22, sstep(6.9, 7.6, zAt(i / FPS))); out.push(c); } return out; }
for (let pre = 0; pre <= 4.6; pre += 0.2) {
  const c = cycles(pre); let row = '';
  for (let t = 31.4; t <= 34.4; t += 0.125) row += peActJS(200, 180, c[Math.round(t * FPS)]) > 0.5 ? '█' : '·';
  console.log(`pre ${pre.toFixed(1)}s  PE(200,180) t31.4→34.4 ${row}`);
}
