import * as THREE from 'three';
import { Panel, Ring, Frame, Arrow, CellGrid, Dots, Particles, label, cellGeo, fadeLine, disposeTree } from './core/kit.js';
import { COL, HEX, valColor } from './core/palette.js';
import { buildHBM } from './core/hbm.js';
import { Timeline } from './core/timeline.js';
import { bump, after, win, hash } from './core/util.js';
import { INFO } from './info.js';

// CTA tile 128×128 with a 64-wide K slice, in cells (1 cell = 8×8 elements).
const BM = 16;
const BN = 16;
const BK = 8;
const S = 0.1;
const LP = 0.072; // Tensor Core lattice pitch (8×8×8 nodes)

export const GPU_CODE = [
  '# grid = (M/128, N/128) CTAs, all resident at once',
  'cta (i, j) runs on its own SM:',
  '  acc = zeros((128, 128), f32)       # in registers',
  '  for k in range(K // 64):           # 2-stage pipeline',
  '    tma.load(A[i,k], B[k,j]) → SMEM  # HBM → L2 → SMEM',
  '    mbarrier.wait(stage)',
  '    for kk in range(4):              # k16 steps',
  '      wgmma.m64n128k16(acc, A, B)    # ×2 warpgroups',
  '  acc → bf16 → SMEM                  # epilogue, CUDA cores',
  '  tma.store(SMEM → C[i,j])           # SMEM → L2 → HBM',
];

const tag = (k, s) => `<b class="op-${k}">${s}</b>`;
// Rows (in cells) of the CTA tile owned by sub-partition w: warp w of each of the
// two warpgroups holds a 16-row strip (2 cells) → 4 interleaved cell rows.
const ROWS = (w) => [2 * w, 2 * w + 1, 8 + 2 * w, 9 + 2 * w];
const SPOTS = [[0, 10], [3, 3], [2, 17], [5, 8], [1, 20], [4, 13], [5, 1], [2, 6], [3, 19]];

export function buildGPU(view, P) {
  const root = new THREE.Group();
  view.scene.add(root);
  const pick = (p) => view.pickables.push(p.mesh);
  const Mt = P.mc / BM;
  const Nt = P.nc / BN;
  const Ks = P.kc / BK;
  const nCTA = Mt * Nt;
  const panels = [];
  const grids = [];
  const P_ = (opts) => {
    const p = new Panel(root, opts);
    panels.push(p);
    if (opts.info) pick(p);
    return p;
  };
  const G_ = (g, base, k = 1) => {
    g.fillBase(base, k);
    grids.push(g);
    return g;
  };

  // ------------------------------------------------------------------ HBM
  const hbm = buildHBM(root, P, { title: 'HBM', sub: 'H100 · 80 GB · 3.35 TB/s', info: INFO.gpu_hbm });
  pick(hbm.panel);
  const yH = hbm.height;

  // ------------------------------------------------------------------ L2
  const yL2 = yH + 0.95 + 0.7;
  const l2 = P_({ w: hbm.width - 0.8, h: 1.4, color: HEX.panel, edge: HEX.mem, info: INFO.l2 }).at(0, yL2, 0);
  const zL = l2.front + 0.012;
  const tp = 0.15;
  const miniA = G_(new CellGrid(root, Mt, Ks, tp, { pitchY: (tp * BM) / BK, size: 0.8 }), COL.empty);
  miniA.position.set(hbm.A.position.x, yL2 + 0.06, zL);
  const miniB = G_(new CellGrid(root, Ks, Nt, (tp * BN) / BK, { pitchY: tp, size: 0.8 }), COL.empty);
  miniB.position.set(hbm.B.position.x, yL2 + 0.06, zL);
  const miniC = G_(new CellGrid(root, Mt, Nt, (tp * BN) / BK, { pitchY: (tp * BM) / BK, size: 0.8 }), COL.empty);
  miniC.position.set(hbm.C.position.x, yL2 + 0.06, zL);
  label(root, -l2.w / 2 + 0.45, yL2, zL, '<div class="t">L2 cache</div><div class="s">50 MB · shared by all SMs</div>', 'side-in', 0, 0.5);

  // ------------------------------------------------------------------ die (132 SMs)
  const yDie = yL2 + 0.7 + 0.95 + 1.3;
  const die = P_({ w: 8.4, h: 2.6, color: HEX.panelDeep, edge: HEX.mem, info: INFO.die }).at(0, yDie, 0);
  const zD = die.front + 0.012;
  const sms = G_(new CellGrid(root, 6, 22, 0.34, { size: 0.8, depth: 0.5 }), COL.mem, 0.15);
  sms.position.set(0, yDie, zD);
  label(root, -4.45, yDie, zD, '<div class="t">132 SMs</div><div class="s">H100 die · one CTA<br>per 128×128 C tile</div>', 'side', 1, 0.5);

  // ------------------------------------------------------------------ the zoomed-in SM
  const ySM = yDie + 1.3 + 1.15 + 3.0;
  const sm = P_({ w: 9.8, h: 6.0, color: HEX.panel, edge: HEX.mem, edgeOpacity: 0.45, info: INFO.sm }).at(0, ySM, 0);
  label(root, -4.9, ySM + 3.12, sm.front, '<div class="t">SM 0</div><div class="s">runs CTA (0,0) → C[0:128, 0:128]</div>', 'unit', 0, 1);
  const zIn = sm.front + 0.08;

  // SMEM band
  const smemP = P_({ w: 9.3, h: 2.3, d: 0.16, color: '#151c2b', edge: HEX.mem, edgeOpacity: 0.5, info: INFO.smem }).at(0, ySM + 1.68, zIn);
  const zS = smemP.front + 0.012;
  const yS = ySM + 1.8;
  const tma = P_({ w: 1.05, h: 0.85, d: 0.14, color: '#1c2333', edge: HEX.dma, edgeOpacity: 0.55, info: INFO.tma }).at(-3.95, yS, smemP.front + 0.07);
  label(root, -3.95, yS, tma.front, '<div class="t">TMA</div>', 'unit-in');
  const well = (x, y, w, h, color) => new Ring(root, w, h, { r: 0.08, color, opacity: 0.24 }).at(x, y, zS - 0.004);
  const mkA = (x, cap) => {
    well(x, yS, BK * S + 0.16, BM * S + 0.16, HEX.A);
    const g = G_(new CellGrid(root, BM, BK, S, { size: 0.8 }), COL.empty);
    g.position.set(x, yS, zS);
    label(root, x, yS - 0.98, zS, cap, 'cap');
    return g;
  };
  const mkB = (x, y, cap) => {
    well(x, y, BN * S + 0.16, BK * S + 0.12, HEX.B);
    const g = G_(new CellGrid(root, BK, BN, S, { size: 0.8 }), COL.empty);
    g.position.set(x, y, zS);
    label(root, x + 0.92, y, zS, cap, 'cap', 0, 0.5);
    return g;
  };
  const sA = [mkA(-2.75, 'A · stage 0'), mkA(-1.8, 'A · stage 1')];
  const sB = [mkB(-0.2, yS + 0.46, 'B · stage 0'), mkB(-0.2, yS - 0.46, 'B · stage 1')];
  well(2.3, yS, BN * S + 0.16, BM * S + 0.16, HEX.C);
  const sC = G_(new CellGrid(root, BM, BN, S, { size: 0.8 }), COL.empty);
  sC.position.set(2.3, yS, zS);
  label(root, 2.3, yS - 0.98, zS, 'C · epilogue', 'cap');
  label(root, 3.4, yS, zS, '<div class="t">SMEM</div><div class="s">shared memory<br>228 KB per SM</div>', 'side-in', 0, 0.5);

  // 4 sub-partitions
  const spX = [-3.5, -1.17, 1.17, 3.5];
  const ySP = ySM - 1.3;
  const scheds = [];
  const tcHouse = [];
  const lattice = [];
  const cuda = [];
  const regs = [];
  const tcC = [];
  for (let w = 0; w < 4; w++) {
    const x = spX[w];
    const sp = P_({ w: 2.22, h: 3.1, d: 0.16, color: '#121927', edge: HEX.mem, edgeOpacity: 0.3, info: INFO.smsp }).at(x, ySP, zIn);
    const zP = sp.front + 0.01;
    scheds.push(P_({ w: 1.95, h: 0.24, d: 0.08, r: 0.1, color: '#2a2413', edge: HEX.scalar, edgeOpacity: 0.6, info: INFO.sched }).at(x, ySP + 1.3, zP + 0.04));
    label(root, x, ySP + 1.3, zP + 0.09, 'warp scheduler', 'cap tiny');
    // Tensor Core: housing + 8×8×8 lattice of multiply-adds
    const cx = x - 0.5;
    const cy = ySP + 0.4;
    tcHouse.push(P_({ w: 0.86, h: 0.86, d: 0.1, r: 0.1, color: '#0f2321', edge: HEX.mxu, edgeOpacity: 0.6, info: INFO.tc }).at(cx, cy, zP + 0.05));
    const cz = zP + 0.1 + 0.32;
    tcC.push(new THREE.Vector3(cx, cy, cz));
    const lp = [];
    for (let m = 0; m < 8; m++) for (let n = 0; n < 8; n++) for (let kz = 0; kz < 8; kz++) lp.push(new THREE.Vector3((n - 3.5) * LP, (3.5 - m) * LP, (kz - 3.5) * LP));
    const lat = new Dots(root, lp, new THREE.Vector3(0.03, 0.03, 0.03), cellGeo(1, 0.3));
    lat.mesh.position.set(cx, cy, cz);
    G_(lat, COL.mxu, 0.16);
    lattice.push(lat);
    label(root, cx, cy - 0.56, zP + 0.1, 'Tensor Core', 'cap');
    // CUDA cores (32 FP32 lanes)
    P_({ w: 0.98, h: 0.58, d: 0.06, r: 0.08, color: '#17162b', edge: HEX.vpu, edgeOpacity: 0.4, info: INFO.cuda }).at(x + 0.52, cy, zP + 0.03);
    const cc = G_(new CellGrid(root, 4, 8, 0.105, { size: 0.62 }), COL.vpu, 0.2);
    cc.position.set(x + 0.52, cy, zP + 0.075);
    cuda.push(cc);
    label(root, x + 0.52, cy - 0.56, zP + 0.1, 'FP32 × 32', 'cap');
    // register file holding this SMSP's accumulator rows
    P_({ w: 1.95, h: 0.66, d: 0.08, r: 0.1, color: '#121a33', edge: HEX.vreg, edgeOpacity: 0.5, info: INFO.regs }).at(x, ySP - 0.72, zP + 0.04);
    const rg = G_(new CellGrid(root, 4, 16, S, { pitchY: 0.12, size: 0.8 }), COL.vreg, 0.1);
    rg.position.set(x, ySP - 0.72, zP + 0.095);
    regs.push(rg);
    label(root, x, ySP - 1.17, zP, 'registers · acc', 'cap');
    label(root, x, ySP - 1.39, zP, `SMSP ${w} · rows ${16 * w}–${16 * w + 15}, ${64 + 16 * w}–${79 + 16 * w}`, 'cap dim');
  }

  // magnifier from SM 0's square on the die up to the zoomed SM
  root.updateMatrixWorld(true);
  sms.bake();
  {
    const t0 = sms.pos(SPOTS[0][0], SPOTS[0][1]);
    const h = 0.14;
    fadeLine(root, new THREE.Vector3(t0.x - h, t0.y + h, zD + 0.02), new THREE.Vector3(-4.9, ySM - 3.0, sm.front), HEX.C, 0.9, 0.08);
    fadeLine(root, new THREE.Vector3(t0.x + h, t0.y + h, zD + 0.02), new THREE.Vector3(4.9, ySM - 3.0, sm.front), HEX.C, 0.9, 0.08);
  }

  // arrows between levels
  const V = (x, y) => new THREE.Vector3(x, y, 0.2);
  const ar = {
    hbmL2: new Arrow(root, V(-6.2, yH + 0.14), V(-6.2, yL2 - 0.7 - 0.14)),
    l2Die: new Arrow(root, V(-4.9, yL2 + 0.7 + 0.14), V(-4.9, yDie - 1.3 - 0.14)),
  };
  const arrows = Object.values(ar);

  const parts = new Particles(root, 2600);
  root.updateMatrixWorld(true);
  hbm.bake();
  grids.forEach((g) => g.bake());

  const spot = (c) => sms.pos(SPOTS[c][0], SPOTS[c][1]);
  const spotIdx = (c) => sms.idx(SPOTS[c][0], SPOTS[c][1]);
  const tcA = [];
  const tcB = [];
  const tcOut = [];
  for (let w = 0; w < 4; w++) {
    const c = tcC[w];
    const a = [];
    const b = [];
    const o = [];
    for (let ri = 0; ri < 4; ri++) for (let kc = 0; kc < 2; kc++) a.push(new THREE.Vector3(c.x - 0.34, c.y + (1.5 - ri) * 0.12, c.z + (kc - 0.5) * 0.2));
    for (let kc = 0; kc < 2; kc++) for (let n = 0; n < 16; n++) b.push(new THREE.Vector3(c.x + (n - 7.5) * 0.034, c.y + 0.34, c.z + (kc - 0.5) * 0.2));
    for (let n = 0; n < 16; n++) o.push(new THREE.Vector3(c.x + (n - 7.5) * 0.034, c.y - 0.05, c.z + 0.3));
    tcA.push(a);
    tcB.push(b);
    tcOut.push(o);
  }
  const hp = hbm.pitch;
  const frames = [];
  const frA = new Frame(root, BK * hp + 0.08, BM * hp + 0.08, HEX.A);
  const frB = new Frame(root, BN * hp + 0.08, BK * hp + 0.08, HEX.B);
  frames.push(frA, frB);
  const tmp = new THREE.Vector3();

  // ------------------------------------------------------------------ Tensor Core animation
  // q ∈ [0,1]: A sweeps in from the left (along n), B from the top (along m);
  // where both have arrived the node holds a product; then products reduce
  // along k toward the front face, which becomes the accumulator update.
  function tcAnim(w, q) {
    const lat = lattice[w];
    for (let m = 0; m < 8; m++) {
      for (let n = 0; n < 8; n++) {
        for (let kz = 0; kz < 8; kz++) {
          const i = (m * 8 + n) * 8 + kz;
          if (q < 0.42) {
            const a = (q / 0.42) * 1.15;
            const hasA = (n + 0.5) / 8 < a;
            const hasB = (m + 0.5) / 8 < a;
            if (hasA && hasB) lat.set(i, COL.mxu, 1.45);
            else if (hasA) lat.set(i, COL.A, 1.1);
            else if (hasB) lat.set(i, COL.B, 1.1);
          } else if (q < 0.8) {
            const zf = ((q - 0.42) / 0.38) * 9;
            if (kz < zf - 1.2) lat.set(i, COL.mxu, 0.22);
            else if (kz < zf) lat.set(i, COL.C, 2.0);
            else lat.set(i, COL.mxu, 1.2);
          } else {
            const f = 1 - (q - 0.8) / 0.2;
            if (kz === 7) lat.set(i, COL.C, 0.8 + 1.6 * f);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ timeline
  const tl = new Timeline();
  const D1 = 0.95;
  const D2 = 1.15;
  const T0 = 2.6;
  const ks = [];
  for (let s = 0; s < Ks; s++) {
    const prev = ks[s - 1];
    const st = { s, stage: s % 2, cad: s === 0 ? 2.3 : 1.45 };
    st.t0 = s === 0 ? T0 : prev.m0; // next stage loads while the previous one is consumed
    st.t1 = st.t0 + D1 + D2;
    st.m0 = Math.max(st.t1, prev ? prev.m1 : 0) + 0.12;
    st.m1 = st.m0 + 4 * st.cad;
    ks.push(st);
  }
  const e0 = ks.at(-1).m1 + 0.25;
  const e1 = e0 + 1.9;
  const x0 = e1 + 0.15;
  const x1 = x0 + 2.4;

  tl.add(0, T0, (p) => hbm.panel.pulse(0.25 * bump(p, 0, 1)));
  // the SMs that run this kernel stay lit for its whole lifetime
  tl.add(T0, x1 - T0, (p) => {
    for (let c = 0; c < nCTA; c++) sms.set(spotIdx(c), c === 0 ? COL.C : COL.mem, c === 0 ? 1.0 : 0.65);
    if (p >= 1) for (let c = 0; c < nCTA; c++) sms.set(spotIdx(c), COL.mem, 0.15);
  });

  const valA = (r, c) => valColor(COL.A, P.A[r][c]);
  const valB = (r, c) => valColor(COL.B, P.B[r][c]);

  function tmaSeg(st) {
    const { s, stage } = st;
    const kO = s * BK;
    const cA = hbm.A.blockCenter(0, kO, BM, BK);
    const cB = hbm.B.blockCenter(kO, 0, BK, BN);
    return (p, t) => {
      const tt = t - st.t0;
      const live = p < 1;
      // L2 keeps every tile it has seen (it is big enough for this whole problem)
      for (let i = 0; i < Mt; i++) miniA.set(miniA.idx(i, s), COL.A, live ? 0.9 + 1.6 * after(tt, D1, 0.5) * (tt >= D1) : 0.9);
      for (let j = 0; j < Nt; j++) miniB.set(miniB.idx(s, j), COL.B, live ? 0.9 + 1.6 * after(tt, D1, 0.5) * (tt >= D1) : 0.9);
      if (live && tt < D1) {
        for (let i = 0; i < Mt; i++) miniA.set(miniA.idx(i, s), COL.empty);
        for (let j = 0; j < Nt; j++) miniB.set(miniB.idx(s, j), COL.empty);
      }
      const sa = sA[stage];
      const sb = sB[stage];
      // SMEM stage contents (persistent once landed)
      const flowCells = (rows, cols, dst, val, srcPos, miniPos, r0, c0) => {
        const span = rows + cols - 2;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const sg = 0.85 * ((r + c) / span) + 0.15 * hash(r * 3.1, c * 7.7);
            const a1 = 0.22 * D1 * sg;
            const b1 = a1 + 0.78 * D1;
            const a2 = D1 + 0.2 * D2 * sg;
            const b2 = a2 + 0.38 * D2;
            const b3 = b2 + 0.42 * D2;
            const di = dst.idx(r, c);
            const col = val(r0 + r, c0 + c);
            if (!live || tt >= b3) {
              dst.set(di, col, 1 + (live ? 1.6 * after(tt, b3, 0.35) : 0));
              continue;
            }
            if (tt < a1) continue;
            const sp = srcPos(r, c);
            if (tt < b1) parts.fly(sp, miniPos, (tt - a1) / (b1 - a1), hbm.A.cell, 0.05, col, 2.2, 0.7);
            else if (tt < a2) parts.glow(miniPos, 0.08, col, 0.05);
            else if (tt < b2) parts.fly(miniPos, spot(0), (tt - a2) / (b2 - a2), 0.05, 0.05, col, 2.2, 0.5);
            else parts.fly(spot(0), dst.pos(r, c), (tt - b2) / (b3 - b2), 0.05, dst.cell, col, 2.2, 1.1);
          }
        }
      };
      flowCells(BM, BK, sa, valA, (r, c) => hbm.A.pos(r, kO + c), miniA.pos(0, s), 0, kO);
      flowCells(BK, BN, sb, valB, (r, c) => hbm.B.pos(kO + r, c), miniB.pos(s, 0), kO, 0);
      if (!live) return;

      // tiles needed only by the other CTAs travel as single packets
      for (let i = 1; i < Mt; i++) {
        const q = tt / (0.9 * D1);
        parts.fly(hbm.A.blockCenter(i * BM, kO, BM, BK, tmp), miniA.pos(i, s), q, 0.16, 0.1, COL.A, 2.4, 0.7, 'ball');
      }
      for (let j = 1; j < Nt; j++) {
        const q = tt / (0.9 * D1);
        parts.fly(hbm.B.blockCenter(kO, j * BN, BK, BN, tmp), miniB.pos(s, j), q, 0.16, 0.1, COL.B, 2.4, 0.7, 'ball');
      }
      for (let c = 1; c < nCTA; c++) {
        const i = Math.floor(c / Nt);
        const j = c % Nt;
        const q = (tt - D1 - 0.1 * c) / (0.55 * D2);
        parts.fly(miniA.pos(i, s), spot(c), q, 0.09, 0.07, COL.A, 2.4, 0.5, 'ball');
        parts.fly(miniB.pos(s, j), spot(c), q - 0.12, 0.09, 0.07, COL.B, 2.4, 0.5, 'ball');
        if (q > 1) sms.boost(spotIdx(c), 1 + 2.5 * after(q, 1, 0.6));
      }
      const fl = bump(tt, 0, D1 + D2);
      for (let r = 0; r < BM; r++) for (let c = 0; c < BK; c++) hbm.A.boost(hbm.A.idx(r, kO + c), 1 + 0.6 * bump(tt, 0, D1));
      for (let r = 0; r < BK; r++) for (let c = 0; c < BN; c++) hbm.B.boost(hbm.B.idx(kO + r, c), 1 + 0.6 * bump(tt, 0, D1));
      frA.show(cA, bump(tt, 0, D1 * 1.1));
      frB.show(cB, bump(tt, 0, D1 * 1.1));
      tma.pulse(bump(tt, 0, 0.5) + 0.6 * bump(tt, D1 + 0.4 * D2, D1 + D2));
      hbm.panel.pulse(0.25 * bump(tt, 0, D1));
      l2.pulse(0.45 * bump(tt, 0.5 * D1, D1 + 0.6 * D2));
      die.pulse(0.3 * bump(tt, D1, D1 + D2));
      smemP.pulse(0.45 * bump(tt, D1 + 0.4 * D2, D1 + D2 + 0.2));
      ar.hbmL2.pulse(bump(tt, 0, D1));
      ar.l2Die.pulse(bump(tt, D1, D1 + 0.7 * D2));
      sms.boost(spotIdx(0), 1 + 1.5 * fl);
    };
  }

  function kkSeg(st, kk) {
    const { s, stage, cad } = st;
    const k0 = st.m0 + kk * cad;
    const kTo = s * BK + 2 * kk + 2;
    const sa = sA[stage];
    const sb = sB[stage];
    return (p, t) => {
      const u = (t - k0) / cad;
      const live = p < 1;
      // accumulators in registers (persistent from the moment they land)
      for (let w = 0; w < 4; w++) {
        const rows = ROWS(w);
        for (let ri = 0; ri < 4; ri++) {
          for (let n = 0; n < 16; n++) {
            if (live && u < 0.9) continue;
            const f = live ? after(u, 0.9, 0.12) : 0;
            regs[w].set(regs[w].idx(ri, n), valColor(COL.C, P.c(rows[ri], n, kTo)), 1 + 1.8 * f);
          }
        }
      }
      if (!live) return;
      const issue = bump(u, 0, 0.2);
      scheds.forEach((sc) => sc.pulse(issue));
      for (let w = 0; w < 4; w++) {
        const rows = ROWS(w);
        // operands straight from SMEM (wgmma reads A and B descriptors from shared memory)
        for (let ri = 0; ri < 4; ri++) {
          for (let c = 0; c < 2; c++) {
            const r = rows[ri];
            const kc = 2 * kk + c;
            const q = (u - 0.04 - 0.025 * ri) / 0.26;
            if (q > -0.2 && q < 0.4) sa.boost(sa.idx(r, kc), 1.9);
            parts.fly(sa.pos(r, kc), tcA[w][ri * 2 + c], q, sa.cell, 0.05, valA(r, s * BK + kc), 2.3, 0.6);
          }
        }
        for (let c = 0; c < 2; c++) {
          for (let n = 0; n < 16; n++) {
            const kc = 2 * kk + c;
            const q = (u - 0.05 - 0.006 * n - 0.02 * w) / 0.26;
            if (w === 0 && q > -0.2 && q < 0.4) sb.boost(sb.idx(kc, n), 1.9);
            parts.fly(sb.pos(kc, n), tcB[w][c * 16 + n], q, sb.cell, 0.04, valB(s * BK + kc, n), 2.3, 0.6);
          }
        }
        const q = (u - 0.3) / 0.52;
        if (q > 0 && q < 1) tcAnim(w, q);
        tcHouse[w].pulse(bump(u, 0.25, 0.88));
        // accumulate: products land in this sub-partition's registers
        for (let n = 0; n < 16; n++) {
          const qq = (u - 0.76 - 0.004 * n) / 0.14;
          parts.fly(tcOut[w][n], regs[w].pos(1 + (n % 2), n), qq, 0.05, regs[w].cell, COL.C, 2.4, 0.3, 'ball');
        }
      }
      for (let c = 1; c < nCTA; c++) sms.boost(spotIdx(c), 1 + 1.4 * bump(u, 0.25, 0.85));
      smemP.pulse(0.4 * bump(u, 0, 0.35));
    };
  }

  function epiSeg() {
    return (p) => {
      const live = p < 1;
      for (let w = 0; w < 4; w++) {
        const rows = ROWS(w);
        if (live) {
          for (let i = 0; i < 32; i++) cuda[w].set(i, COL.vpu, 0.2 + 3.0 * bump(p, 0.05 + 0.006 * i, 0.55 + 0.006 * i));
        }
        for (let ri = 0; ri < 4; ri++) {
          for (let n = 0; n < 16; n++) {
            const d = 0.22 + 0.3 * (n / 15) + 0.04 * ri;
            const q = (p - d) / 0.3;
            const r = rows[ri];
            const col = valColor(COL.C, P.c(r, n, P.kc));
            if (!live || q >= 1) {
              sC.set(sC.idx(r, n), col, 1 + (live ? 1.6 * after(q, 1, 0.3) : 0));
              continue;
            }
            if (q > 0) parts.fly(regs[w].pos(ri, n), sC.pos(r, n), q, regs[w].cell, sC.cell, col, 2.2, 0.8);
          }
        }
      }
      if (live) smemP.pulse(0.5 * bump(p, 0.3, 1));
    };
  }

  function storeSeg() {
    const cen = [];
    for (let c = 0; c < nCTA; c++) {
      const i = Math.floor(c / Nt);
      const j = c % Nt;
      cen.push(hbm.C.blockCenter(i * BM, j * BN, BM, BN));
    }
    return (p) => {
      const live = p < 1;
      // CTA 0: cell by cell
      for (let r = 0; r < BM; r++) {
        for (let n = 0; n < BN; n++) {
          const sg = 0.85 * ((r + n) / 30) + 0.15 * hash(r * 5.3, n * 1.7);
          const a1 = 0.12 * sg;
          const b1 = a1 + 0.26;
          const a2 = 0.4 + 0.1 * sg;
          const b2 = a2 + 0.2;
          const a3 = 0.72 + 0.08 * sg;
          const b3 = a3 + 0.2;
          const col = valColor(COL.C, P.c(r, n, P.kc));
          const hi = hbm.C.idx(r, n);
          if (!live || p >= b3) {
            hbm.C.set(hi, col, 1 + (live ? 1.6 * after(p, b3, 0.08) : 0));
            continue;
          }
          if (p < a1) continue;
          if (p < b1) parts.fly(sC.pos(r, n), spot(0), (p - a1) / (b1 - a1), sC.cell, 0.05, col, 2.2, 0.9);
          else if (p < a2) parts.glow(spot(0), 0.07, col, 0.04);
          else if (p < b2) parts.fly(spot(0), miniC.pos(0, 0), (p - a2) / (b2 - a2), 0.05, 0.05, col, 2.2, 0.5);
          else if (p < a3) parts.glow(miniC.pos(0, 0), 0.07, col, 0.04);
          else parts.fly(miniC.pos(0, 0), hbm.C.pos(r, n), (p - a3) / (b3 - a3), 0.05, hbm.C.cell, col, 2.2, 0.8);
        }
      }
      // other CTAs: one packet each, then the whole tile lands with a ripple
      for (let c = 1; c < nCTA; c++) {
        const i = Math.floor(c / Nt);
        const j = c % Nt;
        if (live) {
          parts.fly(spot(c), miniC.pos(i, j), (p - 0.42) / 0.2, 0.09, 0.1, COL.C, 2.4, 0.5, 'ball');
          parts.fly(miniC.pos(i, j), cen[c], (p - 0.72) / 0.2, 0.1, 0.18, COL.C, 2.4, 0.8, 'ball');
        }
        for (let r = 0; r < BM; r++) {
          for (let n = 0; n < BN; n++) {
            const land = 0.92 + 0.06 * (Math.hypot(r - 7.5, n - 7.5) / 10.6);
            if (live && p < land) continue;
            const R = i * BM + r;
            const N = j * BN + n;
            hbm.C.set(hbm.C.idx(R, N), valColor(COL.C, P.c(R, N, P.kc)), 1 + (live ? 1.6 * after(p, land, 0.06) : 0));
          }
        }
      }
      for (let i = 0; i < Mt; i++) for (let j = 0; j < Nt; j++) if (!live || p > 0.6) miniC.set(miniC.idx(i, j), COL.C, 0.9);
      if (!live) return;
      tma.pulse(bump(p, 0, 0.35));
      die.pulse(0.3 * bump(p, 0.2, 0.6));
      l2.pulse(0.45 * bump(p, 0.45, 0.85));
      hbm.panel.pulse(0.3 * bump(p, 0.7, 1));
      ar.l2Die.pulse(bump(p, 0.35, 0.65));
      ar.hbmL2.pulse(bump(p, 0.65, 0.98));
    };
  }

  ks.forEach((st) => {
    tl.add(st.t0, st.t1 - st.t0, tmaSeg(st));
    tl.span(st.t0, st.t1, 'mem', 'dma', `TMA A[i,${st.s}] · B[${st.s},j] → SMEM stage ${st.stage}`);
    for (let kk = 0; kk < 4; kk++) {
      tl.add(st.m0 + kk * st.cad, st.cad, kkSeg(st, kk));
      tl.span(st.m0 + kk * st.cad, st.m0 + (kk + 1) * st.cad - 0.04, 'cmp', 'mxu', `wgmma k-slice ${st.s}.${kk}`);
    }
  });
  tl.add(e0, e1 - e0, epiSeg());
  tl.span(e0, e1, 'cmp', 'acc', 'epilogue: registers → SMEM');
  tl.add(x0, x1 - x0, storeSeg());
  tl.span(x0, x1, 'mem', 'store', 'TMA store C → HBM');

  // ------------------------------------------------------------------ narration
  tl.mark(0, {
    title: 'C = A · B on a GPU',
    body:
      nCTA > 1
        ? `Same matrices, same HBM. The kernel splits ${tag('C', 'C')} into 128×128 tiles and launches one thread block (CTA) per tile. All ${nCTA} CTAs run <i>at the same time</i>, each on its own SM; an H100 has 132. We zoom into SM 0, which computes ${tag('C', 'C[0,0]')}.`
        : `Same matrices, same HBM. The kernel launches one thread block (CTA) per 128×128 tile of ${tag('C', 'C')}. This problem has a single tile, so one CTA runs on one SM out of 132. We zoom into it.`,
    line: 0,
    shot: 'overview',
  });
  ks.forEach((st) => {
    const { s } = st;
    const ks0 = `k = ${s * 64}…${s * 64 + 63}`;
    if (s === 0) {
      tl.mark(st.t0, {
        title: 'TMA: HBM → L2 → SMEM',
        body:
          `The Tensor Memory Accelerator copies a 128×64 slice of ${tag('A', 'A')} and a 64×128 slice of ${tag('B', 'B')} into shared memory. ` +
          (Nt > 1
            ? `${tag('A', 'A[0,·]')} is also needed by CTA (0,1), so it comes from HBM once and the second request is served by the 50 MB L2. The mini-maps show what L2 holds.`
            : `Everything passes through the 50 MB L2; the mini-maps show what it holds. With more CTAs, tiles they share would be read from HBM only once.`),
        line: 4,
        shot: 'memory',
      });
      tl.mark(st.m0, {
        title: 'wgmma: one warpgroup, 4 Tensor Cores',
        body: `A warpgroup is 4 warps, one per sub-partition. It issues <code>wgmma.m64n128k16</code>, and each Tensor Core reads its rows of ${tag('A', 'A')} plus the shared 16-row slice of ${tag('B', 'B')} directly from SMEM.`,
        line: 7,
        shot: 'sm',
      });
      tl.mark(st.m0 + st.cad, {
        title: 'Inside a Tensor Core',
        body: `${tag('A', 'A')} sweeps in from the left and ${tag('B', 'B')} from the top. Where they meet, a product forms, and the products are summed along k toward the front face. That is roughly 8×8×8 multiply-adds per cycle on H100: a small 3-D block, where the MXU is one big 2-D wave of 128×128.`,
        line: 7,
        shot: 'tc',
      });
      tl.mark(st.m0 + 2 * st.cad, {
        title: 'Accumulators live in registers',
        body: `The 128×128 f32 accumulator (64 KB) is spread over the 4 register files and stays there for the whole K loop. Each sub-partition owns interleaved 16-row strips: warp w of each warpgroup holds rows 16w…16w+15.`,
        line: 2,
        shot: 'sm',
      });
      tl.mark(st.m0 + 3 * st.cad, {
        title: 'Pipelining',
        body: `While the Tensor Cores work on stage 0, TMA is already filling stage 1 with the next K slice, so the math never waits for memory.`,
        line: 3,
        shot: 'sm',
      });
    } else {
      tl.mark(st.m0, {
        title: `K slice ${s + 1} of ${Ks} (${ks0})`,
        body: `mbarrier.wait until stage ${st.stage} has landed, then 4 more <code>wgmma</code> k16 steps accumulate into the same registers.${nCTA > 1 ? ` The other ${nCTA - 1} SM${nCTA > 2 ? 's are' : ' is'} doing exactly the same for ${nCTA > 2 ? 'their tiles' : 'its tile'}.` : ''}`,
        line: 6,
        shot: s % 2 ? 'overview' : 'sm',
      });
    }
  });
  tl.mark(e0, {
    title: 'Epilogue: registers → SMEM',
    body: `The K loop is done. CUDA cores convert the f32 accumulators to bf16 and store them to SMEM. Note how each sub-partition’s rows interleave in the tile.`,
    line: 8,
    shot: 'sm',
  });
  tl.mark(x0, {
    title: 'TMA store → HBM',
    body: nCTA > 1
      ? `TMA copies the finished tiles SMEM → L2 → HBM. All ${nCTA} CTAs finish together, because they ran in parallel on different SMs.`
      : `TMA copies the finished tile SMEM → L2 → HBM.`,
    line: 9,
    shot: 'overview',
  });
  tl.mark(x1 + 0.5, {
    title: 'Done: C = A · B',
    body: `${nCTA} CTA${nCTA > 1 ? 's' : ''} × ${Ks} K slices × 4 k16 steps. On a real H100 this problem would leave ${132 - nCTA} of the 132 SMs idle. Production kernels use bigger problems, persistent CTAs and thread-block clusters (TMA multicast) to share tiles across SMs.`,
    line: 1,
    shot: 'overview',
  });
  tl.done();

  // ------------------------------------------------------------------ camera shots
  const top = ySM + 3.5;
  const shots = {
    overview: { target: new THREE.Vector3(0, top / 2, 0), dir: new THREE.Vector3(0.3, 0.2, 1), w: 15.6, h: top + 0.8 },
    memory: { target: new THREE.Vector3(0, (yH * 0.4 + yDie + 1.3) / 2, 0), dir: new THREE.Vector3(0.24, 0.3, 1), w: 15, h: yDie + 2.6 },
    sm: { target: new THREE.Vector3(0, ySM - 0.05, 0), dir: new THREE.Vector3(0.24, 0.16, 1), w: 10.8, h: 7.0 },
    tc: { target: new THREE.Vector3((spX[0] + spX[1]) / 2, ySP + 0.75, 0.3), dir: new THREE.Vector3(0.18, 0.2, 1), w: 7.6, h: 5.4 },
  };

  return {
    name: 'gpu',
    tl,
    code: GPU_CODE,
    shots,
    shotNames: [['overview', 'Overview'], ['memory', 'Memory'], ['sm', 'SM'], ['tc', 'Tensor Core']],
    evaluate(t) {
      hbm.reset();
      grids.forEach((g) => g.reset());
      frames.forEach((f) => f.hide());
      tl.apply(t);
      hbm.commit();
      grids.forEach((g) => g.commit());
      panels.forEach((p) => p.apply());
      arrows.forEach((a) => a.apply());
      parts.end();
    },
    setTrails(on) {
      parts.trails = on;
    },
    dispose() {
      disposeTree(root);
      view.pickables.length = 0;
    },
  };
}
