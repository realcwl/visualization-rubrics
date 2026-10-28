import * as THREE from 'three';
import { Panel, Ring, Frame, Arrow, CellGrid, Dots, Particles, label, cellGeo, disposeTree } from './core/kit.js';
import { COL, HEX, valColor } from './core/palette.js';
import { buildHBM } from './core/hbm.js';
import { Timeline } from './core/timeline.js';
import { clamp, bump, after } from './core/util.js';
import { INFO } from './info.js';

const T = 16; // tile edge in cells: 16 cells × 8 elements = 128
const S = 0.1; // on-chip cell pitch
const PE = 0.16; // MXU processing-element pitch (drawn 16×16; each square = 8×8 PEs)

export const TPU_CODE = [
  '# grid = (M/128, N/128, K/128), k innermost',
  'for i, j in tiles(C):                # one tile at a time',
  '  acc = zeros((128, 128), f32)       # lives in VMEM',
  '  for k in range(K // 128):',
  '    dma(A[i,k], B[k,j]) → VMEM       # double-buffered',
  '    mxu.load_weights(B[k,j])         # RHS, from the top',
  '    for r in range(16):              # 16 × (8×128) VREGs',
  '      mxu.push(A[i,k][8r:8r+8, :])   # LHS, from the left',
  '      acc[8r:8r+8] += mxu.pop()      # VPU add, f32',
  '  dma(acc → C[i,j])                  # VMEM → HBM',
];

const tag = (k, s) => `<b class="op-${k}">${s}</b>`;

export function buildTPU(view, P) {
  const root = new THREE.Group();
  view.scene.add(root);
  const pick = (p) => view.pickables.push(p.mesh);
  const Mt = P.mc / T;
  const Nt = P.nc / T;
  const Kt = P.kc / T;

  // ------------------------------------------------------------------ HBM
  const hbm = buildHBM(root, P, { title: 'HBM', sub: 'TPU v5p · 96 GiB · 2.8 TB/s', info: INFO.tpu_hbm });
  pick(hbm.panel);
  const yH = hbm.height;

  // ------------------------------------------------------------------ layout
  const xM = -1.6; // VMEM column
  const xR = 5.45; // scalar column
  const xVR = -1.75; // VREGs
  const xMX = -3.55; // MXU
  const xVP = 0.6; // VPU
  const yVM = yH + 1.0 + 1.35;
  const yVR = yVM + 1.35 + 0.95 + 0.875;
  const yMX = yVR + 0.875 + 1.3 + 1.55;

  const panels = [];
  const P_ = (opts) => {
    const p = new Panel(root, opts);
    panels.push(p);
    if (opts.info) pick(p);
    return p;
  };

  // ------------------------------------------------------------------ VMEM
  const vmem = P_({ w: 10.0, h: 2.7, color: HEX.panel, edge: HEX.mem, info: INFO.vmem }).at(xM, yVM, 0);
  const zV = vmem.front + 0.012;
  const slotY = yVM + 0.27;
  const sx = [];
  {
    let x = xM - 4.73 + 0.8;
    const gaps = [0.18, 0.55, 0.18, 0.55, 0];
    for (let i = 0; i < 5; i++) {
      sx.push(x);
      x += 1.6 + gaps[i];
    }
  }
  const grids = [];
  const mkSlot = (x, color, cap) => {
    new Ring(root, 1.76, 1.76, { r: 0.1, color, opacity: 0.24 }).at(x, slotY, zV - 0.004);
    const g = new CellGrid(root, T, T, S, { size: 0.8 });
    g.position.set(x, slotY, zV);
    g.fillBase(COL.empty);
    grids.push(g);
    label(root, x, slotY - 1.02, zV, cap, 'cap');
    return g;
  };
  const slotA = [mkSlot(sx[0], HEX.A, 'A · buffer 0'), mkSlot(sx[1], HEX.A, 'A · buffer 1')];
  const slotB = [mkSlot(sx[2], HEX.B, 'B · buffer 0'), mkSlot(sx[3], HEX.B, 'B · buffer 1')];
  const acc = mkSlot(sx[4], HEX.C, 'acc · f32');
  label(root, xM, yVM - 1.04, zV, '<div class="t">VMEM</div>', 'big');

  // ------------------------------------------------------------------ VREGs
  const vregP = P_({ w: 2.5, h: 1.75, color: HEX.panel, edge: HEX.vreg, edgeOpacity: 0.45, info: INFO.vreg }).at(xVR, yVR, 0);
  const zR = vregP.front + 0.012;
  const vreg = new CellGrid(root, 8, 16, S, { pitchY: 0.18, size: 0.78 });
  vreg.position.set(xVR, yVR, zR);
  vreg.fillBase(COL.vreg, 0.12);
  grids.push(vreg);
  for (let r = 0; r < 8; r++) new Ring(root, 1.76, 0.16, { r: 0.075, color: HEX.vreg, opacity: 0.2 }).at(xVR, yVR + (3.5 - r) * 0.18, zR - 0.004);
  label(root, xVR - 1.45, yVR, zR, '<div class="t">VREGs</div><div class="s">8 of 32 shown<br>each 8 × 128 × 32-bit</div>', 'side', 1, 0.5);

  // ------------------------------------------------------------------ MXU (+ 3 ghosts: 4 per TensorCore on v5p)
  for (let g = 3; g >= 1; g--) {
    new Panel(root, { w: 3.1, h: 3.1, d: 0.26, color: HEX.panelDeep, edge: HEX.mxu, edgeOpacity: 0.32 - g * 0.06, opacity: 0.85 }).at(xMX + 0.17 * g, yMX + 0.17 * g, -0.4 * g);
  }
  const mxu = P_({ w: 3.1, h: 3.1, color: '#0f2321', edge: HEX.mxu, edgeOpacity: 0.6, info: INFO.mxu }).at(xMX, yMX, 0);
  const zM = mxu.front + 0.07;
  const pePos = [];
  for (let k = 0; k < T; k++) for (let n = 0; n < T; n++) pePos.push(new THREE.Vector3((n - 7.5) * PE, (7.5 - k) * PE, 0));
  const pe = new Dots(root, pePos, new THREE.Vector3(0.122, 0.122, 0.1), cellGeo(0.7, 0.2));
  pe.mesh.position.set(xMX, yMX, zM - 0.03);
  pe.fillBase(COL.pe);
  grids.push(pe);
  const colX = (c) => xMX + (c - 7.5) * PE;
  const rowY = (r) => yMX + (7.5 - r) * PE;
  const zTok = zM + 0.05;
  label(root, xMX - 1.8, yMX + 1.05, zM, '<div class="t">MXU</div><div class="s">128×128 systolic<br>array · ×4 per core</div>', 'side', 1, 0.5);
  label(root, xMX - 1.62, yMX + 0.0, zM, '<span class="flow op-A">A →</span>', 'flowtag', 1, 0.5);
  label(root, xMX + 1.75, yMX + 1.22, zM, '<span class="flow op-B">B ↓ weights</span>', 'flowtag', 0, 0.5);
  label(root, xMX + 1.75, yMX - 1.25, zM, '<span class="flow op-C">↓ results</span>', 'flowtag', 0, 0.5);

  // ------------------------------------------------------------------ VPU
  const vpu = P_({ w: 2.8, h: 1.6, color: '#17162b', edge: HEX.vpu, edgeOpacity: 0.55, info: INFO.vpu }).at(xVP, yMX + 0.1, 0);
  const vpuDots = new CellGrid(root, 8, 16, 0.13, { pitchY: 0.085, size: 0.6 });
  vpuDots.position.set(xVP, yMX + 0.02, vpu.front + 0.012);
  vpuDots.fillBase(COL.vpu, 0.14);
  grids.push(vpuDots);
  label(root, xVP, yMX + 0.66, vpu.front, '<div class="t">Vector</div>', 'unit-in');
  label(root, xVP, yMX - 0.49, vpu.front, '(8, 128) SIMD lanes', 'cap');

  // ------------------------------------------------------------------ scalar side
  const scalar = P_({ w: 2.6, h: 1.4, color: '#2a2413', edge: HEX.scalar, edgeOpacity: 0.55, info: INFO.scalar }).at(xR, yMX + 0.1, 0);
  label(root, xR, yMX + 0.22, scalar.front, '<div class="t">Scalar</div>', 'unit-in');
  label(root, xR, yMX - 0.25, scalar.front, 'loop control · issues DMAs', 'cap');
  const sregs = [];
  for (let i = 2; i >= 0; i--) {
    sregs.push(P_({ w: 2.1, h: 0.78, d: 0.2, color: '#2b1825', edge: HEX.sreg, edgeOpacity: 0.5 - i * 0.12, info: i === 0 ? INFO.sreg : null }).at(xR - 0.12 * i, yVR + 0.12 * i, -0.28 * i));
  }
  label(root, xR + 1.2, yVR, 0.2, '<div class="t">SREGs</div>', 'side', 0, 0.5);
  const smem = P_({ w: 2.6, h: 1.5, color: HEX.panel, edge: HEX.mem, info: INFO.tpu_smem }).at(xR, yVM, 0);
  label(root, xR, yVM, smem.front, '<div class="t">SMEM</div>', 'unit-in');

  // ------------------------------------------------------------------ arrows (the ⇕ glyphs of the original)
  const V = (x, y) => new THREE.Vector3(x, y, 0.2);
  const ar = {
    hbmVm: new Arrow(root, V(xM, yH + 0.14), V(xM, yVM - 1.35 - 0.14)),
    vmVr: new Arrow(root, V(xVR, yVM + 1.35 + 0.14), V(xVR, yVR - 0.875 - 0.14)),
    vrMx: new Arrow(root, V(xVR - 0.75, yVR + 0.875 + 0.14), V(xMX + 0.95, yMX - 1.55 - 0.14)),
    vrVp: new Arrow(root, V(xVR + 0.8, yVR + 0.875 + 0.14), V(xVP - 0.35, yMX + 0.1 - 0.8 - 0.14)),
    scSr: new Arrow(root, V(xR, yMX + 0.1 - 0.7 - 0.14), V(xR, yVR + 0.39 + 0.3)),
    srSm: new Arrow(root, V(xR, yVR - 0.39 - 0.14), V(xR, yVM + 0.75 + 0.14)),
    smHb: new Arrow(root, V(xR, yVM - 0.75 - 0.14), V(xR, yH + 0.14)),
  };
  const arrows = Object.values(ar);

  // ------------------------------------------------------------------ frames + particles
  const hp = hbm.pitch;
  const frA = new Frame(root, T * hp + 0.1, T * hp + 0.1, HEX.A);
  const frB = new Frame(root, T * hp + 0.1, T * hp + 0.1, HEX.B);
  const frC = new Frame(root, T * hp + 0.1, T * hp + 0.1, HEX.C);
  const frames = [frA, frB, frC];
  const parts = new Particles(root, 2600);

  root.updateMatrixWorld(true);
  hbm.bake();
  grids.forEach((g) => g.bake());

  const entry = [];
  const exitP = [];
  const formIn = [];
  for (let n = 0; n < T; n++) {
    entry.push(new THREE.Vector3(colX(n), rowY(-1), zTok));
    exitP.push(new THREE.Vector3(colX(n), rowY(16), zTok));
    formIn.push(new THREE.Vector3(colX(-2), rowY(n), zTok));
  }
  const fpos = new THREE.Vector3();
  const wcol = new THREE.Color();
  const weightCol = (v) => wcol.copy(COL.pe).lerp(COL.B, 0.22 + 0.5 * v);

  // ------------------------------------------------------------------ timeline
  const tl = new Timeline();
  const steps = [];
  for (let i = 0; i < Mt; i++) for (let j = 0; j < Nt; j++) for (let k = 0; k < Kt; k++) steps.push({ i, j, k, slot: steps.length % 2 });
  const DMA = 1.8;
  const WB = 1.8;
  const T0 = 2.6;
  steps.forEach((st, s) => {
    const prev = steps[s - 1];
    st.tick = s === 0 ? 0.085 : s === 1 ? 0.065 : 0.05;
    st.d0 = s === 0 ? T0 : prev.w0; // prefetch while the previous step computes
    st.d1 = st.d0 + DMA;
    st.w0 = Math.max(st.d1, prev ? prev.s1 + (prev.b0 != null ? 1.5 : 0) : 0) + 0.15;
    st.w1 = st.w0 + 41 * st.tick;
    st.s0 = st.w1 + 0.1;
    st.s1 = st.s0 + 66 * st.tick;
    if (st.k === Kt - 1) {
      st.b0 = st.s1 + 0.05;
      st.b1 = st.b0 + WB;
    }
  });

  // intro: a gentle breath on A and B
  tl.add(0, T0, (p) => hbm.panel.pulse(0.25 * bump(p, 0, 1)));

  function issue(p) {
    const k = bump(p, 0, 0.22);
    scalar.pulse(k);
    sregs[2].pulse(k * 0.8);
    smem.pulse(k * 0.5);
    ar.scSr.pulse(k);
    ar.srSm.pulse(k * 0.6);
  }

  function dmaSeg(st) {
    const { i, j, k, slot } = st;
    const sa = slotA[slot];
    const sb = slotB[slot];
    const cA = hbm.A.blockCenter(i * T, k * T, T, T);
    const cB = hbm.B.blockCenter(k * T, j * T, T, T);
    return (p) => {
      if (p >= 1) {
        // persistent: both buffers filled
        for (let r = 0; r < T; r++) {
          for (let c = 0; c < T; c++) {
            sa.set(sa.idx(r, c), valColor(COL.A, P.A[i * T + r][k * T + c]));
            sb.set(sb.idx(r, c), valColor(COL.B, P.B[k * T + r][j * T + c]));
          }
        }
        return;
      }
      issue(p);
      const flow = bump(p, 0.02, 0.98);
      ar.hbmVm.pulse(flow);
      hbm.panel.pulse(flow * 0.25);
      vmem.pulse(flow * 0.3);
      frA.show(cA, flow);
      frB.show(cB, flow);
      for (let r = 0; r < T; r++) {
        for (let c = 0; c < T; c++) {
          hbm.A.boost(hbm.A.idx(i * T + r, k * T + c), 1 + 0.6 * flow);
          hbm.B.boost(hbm.B.idx(k * T + r, j * T + c), 1 + 0.6 * flow);
        }
      }
      parts.swarm(p, T, T, {
        from: (r, c) => hbm.A.pos(i * T + r, k * T + c),
        to: (r, c) => sa.pos(r, c),
        s0: hbm.A.cell, s1: sa.cell,
        color: (r, c) => valColor(COL.A, P.A[i * T + r][k * T + c]),
        land: (r, c, f) => sa.set(sa.idx(r, c), valColor(COL.A, P.A[i * T + r][k * T + c]), 1 + 1.6 * f),
      });
      parts.swarm(p, T, T, {
        from: (r, c) => hbm.B.pos(k * T + r, j * T + c),
        to: (r, c) => sb.pos(r, c),
        s0: hbm.B.cell, s1: sb.cell,
        color: (r, c) => valColor(COL.B, P.B[k * T + r][j * T + c]),
        land: (r, c, f) => sb.set(sb.idx(r, c), valColor(COL.B, P.B[k * T + r][j * T + c]), 1 + 1.6 * f),
      });
    };
  }

  // Weights shift in from the top: row 15 enters first; column n lags by n cycles.
  function weightSeg(st) {
    const sb = slotB[st.slot];
    const kO = st.k * T;
    const jO = st.j * T;
    return (p, t) => {
      const tau = (t - st.w0) / st.tick - 9;
      const live = p < 1;
      let leg1 = 0;
      let leg2 = 0;
      let inside = 0;
      for (let k = 0; k < T; k++) {
        for (let n = 0; n < T; n++) {
          const v = P.B[kO + k][jO + n];
          const te = 15 + n - k;
          const settle = te + 1 + k;
          if (!live || tau >= settle) {
            pe.set(k * T + n, weightCol(v), 1 + (live ? 1.6 * after(tau, settle, 3) : 0));
            continue;
          }
          if (tau < te - 9) continue;
          const col = valColor(COL.B, v);
          const vi = vreg.idx(k % 8, n);
          if (tau < te - 5) {
            const q = (tau - te + 9) / 4;
            if (q < 0.3) sb.boost(sb.idx(k, n), 1.8);
            if (q > 0.85) vreg.set(vi, col, 2.0);
            parts.fly(sb.pos(k, n), vreg.pos(k % 8, n), q, sb.cell, vreg.cell, col, 2.2, 0.5);
            leg1++;
          } else if (tau < te) {
            const q = (tau - te + 5) / 5;
            if (q < 0.15) vreg.set(vi, col, 2.0);
            parts.fly(vreg.pos(k % 8, n), entry[n], q, vreg.cell, 0.1, col, 2.2, 1.7);
            leg2++;
          } else {
            const rho = -1 + (tau - te);
            fpos.set(colX(n), rowY(rho), zTok);
            parts.slide(fpos, 0.1, col, 2.4, (d, out) => {
              if (rho - d < -1) return false;
              out.set(colX(n), rowY(rho - d), zTok);
              return true;
            });
            inside++;
          }
        }
      }
      if (!live) return;
      ar.vmVr.pulse(Math.min(1, leg1 / 24));
      ar.vrMx.pulse(Math.min(1, leg2 / 24));
      vregP.pulse(Math.min(0.7, (leg1 + leg2) / 40));
      mxu.pulse(Math.min(0.8, 0.15 + inside / 60));
      vmem.pulse(Math.min(0.4, leg1 / 40));
    };
  }

  // Inputs flow right, partial sums flow down, results leave at the bottom.
  function streamSeg(st) {
    const sa = slotA[st.slot];
    const iO = st.i * T;
    const kO = st.k * T;
    const jO = st.j * T;
    const pre = new Float32Array(T * T * (T + 1));
    let tmax = 1e-6;
    for (let r = 0; r < T; r++) {
      for (let n = 0; n < T; n++) {
        let s = 0;
        for (let kk = 0; kk < T; kk++) {
          s += P.A[iO + r][kO + kk] * P.B[kO + kk][jO + n];
          pre[(r * T + n) * (T + 1) + kk + 1] = s;
        }
        tmax = Math.max(tmax, s);
      }
    }
    return (p, t) => {
      const tau = (t - st.s0) / st.tick - 10;
      const live = p < 1;
      let nA1 = 0;
      let nA2 = 0;
      let nR1 = 0;
      let nR2 = 0;
      let band = 0;

      // processing elements: stationary weight + a pulse each time a MAC fires
      for (let kk = 0; kk < T; kk++) {
        for (let n = 0; n < T; n++) {
          const i = kk * T + n;
          pe.set(i, weightCol(P.B[kO + kk][jO + n]));
          const u = tau - kk - n;
          if (live && u > -0.5 && u < 15.5) {
            const f = 1 - Math.min(1, 2 * Math.abs(u - Math.round(u)));
            pe.mix(i, COL.mxu, 0.55 + 0.3 * f, 1.3 + 1.9 * f);
            band++;
          }
        }
      }

      if (live) {
        // A: VMEM → VREG → left edge, then one PE to the right per cycle
        for (let r = 0; r < T; r++) {
          for (let kk = 0; kk < T; kk++) {
            const td = r + kk - 10;
            if (tau < td) continue;
            const col = valColor(COL.A, P.A[iO + r][kO + kk]);
            const vi = vreg.idx(r % 8, kk);
            if (tau < td + 4) {
              const q = (tau - td) / 4;
              if (q < 0.3) sa.boost(sa.idx(r, kk), 1.9);
              if (q > 0.85) vreg.set(vi, col, 2.0);
              parts.fly(sa.pos(r, kk), vreg.pos(r % 8, kk), q, sa.cell, vreg.cell, col, 2.2, 0.5);
              nA1++;
            } else if (tau < td + 8) {
              const q = (tau - td - 4) / 4;
              if (q < 0.15) vreg.set(vi, col, 2.0);
              parts.fly(vreg.pos(r % 8, kk), formIn[kk], q, vreg.cell, 0.088, col, 2.2, 0.9);
              nA2++;
            } else {
              const c = tau - r - kk;
              if (c > 16.3) continue;
              const s = 0.088 * (c > 15.6 ? clamp((16.3 - c) / 0.7) : 1);
              fpos.set(colX(c), rowY(kk), zTok);
              parts.slide(fpos, s, col, 2.3, (d, out) => {
                if (c - d < -2) return false;
                out.set(colX(c - d), rowY(kk), zTok);
                return true;
              });
            }
          }
        }
        // partial sums: one PE down per cycle, growing as they accumulate
        for (let r = 0; r < T; r++) {
          for (let n = 0; n < T; n++) {
            const rho = tau - r - n;
            if (rho < 0 || rho >= 16) continue;
            const kk = Math.min(15, Math.floor(rho));
            const val = pre[(r * T + n) * (T + 1) + kk + 1] / tmax;
            fpos.set(colX(n), rowY(rho), zTok + 0.07);
            parts.slide(
              fpos, 0.045 + 0.06 * val, COL.C, 1.7 + 1.5 * val,
              (d, out) => {
                if (rho - d < 0) return false;
                out.set(colX(n), rowY(rho - d), zTok + 0.07);
                return true;
              },
              'ball'
            );
          }
        }
      }

      // results: bottom of the MXU → VREG (pop) → VPU add → accumulator in VMEM
      for (let r = 0; r < T; r++) {
        for (let n = 0; n < T; n++) {
          const tx = r + n + 16;
          const ai = acc.idx(r, n);
          const full = P.c(iO + r, jO + n, kO + T);
          if (live && tau < tx + 8) {
            if (st.k === 0) acc.set(ai, COL.empty);
            if (tau < tx) continue;
            const col = valColor(COL.C, full);
            const vi = vreg.idx(r % 8, n);
            if (tau < tx + 4) {
              const q = (tau - tx) / 4;
              if (q > 0.85) vreg.set(vi, COL.C, 2.2);
              parts.fly(exitP[n], vreg.pos(r % 8, n), q, 0.095, vreg.cell, col, 2.2, 0.6, 'ball');
              nR1++;
            } else {
              const q = (tau - tx - 4) / 4;
              if (q < 0.3) {
                vreg.set(vi, COL.C, 2.2);
                vpuDots.set(vpuDots.idx(r % 8, n), COL.vpu, 3.4);
              }
              parts.fly(vreg.pos(r % 8, n), acc.pos(r, n), q, vreg.cell, acc.cell, col, 2.2, 0.7);
              nR2++;
            }
          } else {
            acc.set(ai, valColor(COL.C, full), 1 + (live ? 1.5 * after(tau, tx + 8, 3) : 0));
          }
        }
      }

      if (!live) return;
      mxu.pulse(band ? 0.6 : 0.1);
      ar.vmVr.pulse(Math.min(1, (nA1 + nR2) / 24));
      ar.vrMx.pulse(Math.min(1, (nA2 + nR1) / 24));
      ar.vrVp.pulse(Math.min(1, nR2 / 10));
      vpu.pulse(Math.min(1, nR2 / 10));
      vregP.pulse(Math.min(0.7, (nA1 + nA2 + nR1 + nR2) / 50));
      vmem.pulse(Math.min(0.4, (nA1 + nR2) / 40));
    };
  }

  function wbSeg(st) {
    const r0 = st.i * T;
    const c0 = st.j * T;
    const cen = hbm.C.blockCenter(r0, c0, T, T);
    const fin = (r, c) => valColor(COL.C, P.c(r0 + r, c0 + c, P.kc));
    return (p) => {
      if (p >= 1) {
        for (let r = 0; r < T; r++) for (let c = 0; c < T; c++) hbm.C.set(hbm.C.idx(r0 + r, c0 + c), fin(r, c));
        return;
      }
      issue(p);
      const flow = bump(p, 0.02, 0.98);
      ar.hbmVm.pulse(flow);
      vmem.pulse(flow * 0.3);
      hbm.panel.pulse(flow * 0.25);
      frC.show(cen, flow);
      for (let r = 0; r < T; r++) for (let c = 0; c < T; c++) acc.boost(acc.idx(r, c), 1 + 0.7 * flow);
      parts.swarm(p, T, T, {
        from: (r, c) => acc.pos(r, c),
        to: (r, c) => hbm.C.pos(r0 + r, c0 + c),
        s0: acc.cell, s1: hbm.C.cell,
        color: fin,
        land: (r, c, f) => hbm.C.set(hbm.C.idx(r0 + r, c0 + c), fin(r, c), 1 + 1.6 * f),
        lift: 1.2,
      });
    };
  }

  steps.forEach((st) => {
    const { i, j, k } = st;
    tl.add(st.d0, DMA, dmaSeg(st));
    tl.add(st.w0, st.w1 - st.w0, weightSeg(st));
    tl.add(st.s0, st.s1 - st.s0, streamSeg(st));
    tl.span(st.d0, st.d1, 'mem', 'dma', `DMA A[${i},${k}] · B[${k},${j}] → VMEM`);
    tl.span(st.w0, st.w1, 'cmp', 'weights', `load weights B[${k},${j}]`);
    tl.span(st.s0, st.s1, 'cmp', 'mxu', `stream A[${i},${k}] through the MXU`);
    if (st.b0 != null) {
      tl.add(st.b0, WB, wbSeg(st));
      tl.span(st.b0, st.b1, 'mem', 'store', `C[${i},${j}] → HBM`);
    }
  });

  // ------------------------------------------------------------------ narration
  tl.mark(0, {
    title: 'C = A · B on a TPU TensorCore',
    body: `${tag('A', 'A')} and ${tag('B', 'B')} (bf16, ${P.M}×${P.K} and ${P.K}×${P.N}) start in HBM. The TensorCore computes one 128×128 output tile at a time: for each ${tag('C', 'C[i,j]')} it loops over k and accumulates ${tag('A', 'A[i,k]')} · ${tag('B', 'B[k,j]')}. Each small square is an 8×8 block of numbers.`,
    line: 0,
    shot: 'overview',
  });
  steps.forEach((st, s) => {
    const { i, j, k } = st;
    const Aik = tag('A', `A[${i},${k}]`);
    const Bkj = tag('B', `B[${k},${j}]`);
    const Cij = tag('C', `C[${i},${j}]`);
    if (s === 0) {
      tl.mark(st.d0, {
        title: 'DMA: HBM → VMEM',
        body: `The scalar unit issues two DMAs that copy ${Aik} and ${Bkj} (128×128 each) from HBM into VMEM, the on-chip scratchpad. Nothing is cached automatically; the program decides what lives in VMEM.`,
        line: 4,
        shot: 'memory',
      });
      tl.mark(st.w0, {
        title: 'Weights enter the MXU from the top',
        body: `${Bkj} (the right-hand side) passes through the vector registers and is shifted into the systolic array from above, one diagonal at a time, until every processing element holds a weight. At the same time, DMA is already prefetching the next pair into buffer 1.`,
        line: 5,
        shot: 'mxu',
      });
      tl.mark(st.s0, {
        title: 'A streams in from the left',
        body: `Rows of ${Aik} go VMEM → VREG → MXU and enter from the left, each row one cycle behind the previous. Every PE multiplies the passing input by its stationary weight and adds the product to the partial sum flowing down (blue beads).`,
        line: 7,
        shot: 'mxu',
      });
      tl.mark(st.s0 + 27 * st.tick, {
        title: 'Results drop out of the bottom',
        body: `After all 128 PE rows, each column emits a finished dot product. Results are popped into VREGs, and the VPU adds them into the f32 accumulator in VMEM. This is the same dot-wise path as the original pointwise animation.`,
        line: 8,
        shot: 'core',
      });
    } else if (s === 1 && k === 1) {
      tl.mark(st.w0, {
        title: `Next k: weights ${Bkj}`,
        body: `${Bkj} was prefetched while the MXU was busy (double buffering), so it shifts in right away. A real MXU even loads the next weights while the current ones are still in use.`,
        line: 5,
        shot: 'mxu',
      });
      tl.mark(st.s0, {
        title: 'Accumulate over K',
        body: `acc += ${Aik} · ${Bkj}. The accumulator gets brighter because the colors show the actual partial sums.`,
        line: 8,
        shot: 'core',
      });
    } else {
      tl.mark(st.w0, {
        title: `${Cij} · k = ${k}`,
        body: k === 0
          ? `Fresh accumulator for ${Cij}. Same loop as before: load weights ${Bkj}, stream ${Aik}, accumulate, while DMA prefetches the next pair.`
          : `Load weights ${Bkj}, stream ${Aik}, and accumulate into ${Cij}.`,
        line: k === 0 ? 2 : 5,
        shot: 'overview',
      });
    }
    if (st.b0 != null) {
      tl.mark(st.b0, {
        title: `Write ${Cij} back to HBM`,
        body: `All of K has been summed for this tile. The accumulator is cast to bf16 and DMA’d VMEM → HBM.`,
        line: 9,
        shot: 'overview',
      });
    }
  });
  const end = steps.at(-1).b1 + 0.5;
  tl.mark(end, {
    title: 'Done: C = A · B',
    body: `${steps.length} MXU passes, each 128×128×128 multiply-adds (≈ 4.2 MFLOP). A v5p TensorCore has 4 MXUs and overlaps weight loading with streaming, so the real hardware has no gaps between passes.`,
    line: 1,
    shot: 'overview',
  });
  tl.done();

  // ------------------------------------------------------------------ camera shots
  const top = yMX + 1.9;
  const shots = {
    overview: { target: new THREE.Vector3(-0.2, top / 2 + 0.1, 0), dir: new THREE.Vector3(0.3, 0.2, 1), w: 15.6, h: top + 1.1 },
    memory: { target: new THREE.Vector3(-0.4, (yH * 0.45 + yVM) / 2 + 0.2, 0), dir: new THREE.Vector3(0.22, 0.32, 1), w: 15, h: yVM + 2.4 },
    mxu: { target: new THREE.Vector3(xMX + 0.9, yMX - 0.55, 0), dir: new THREE.Vector3(0.3, 0.12, 1), w: 7.6, h: 5.4 },
    core: { target: new THREE.Vector3(xMX + 2.4, (yVM + yMX) / 2 + 0.2, 0), dir: new THREE.Vector3(0.26, 0.14, 1), w: 11.6, h: yMX - yVM + 4.4 },
  };

  return {
    name: 'tpu',
    tl,
    code: TPU_CODE,
    shots,
    shotNames: [['overview', 'Overview'], ['memory', 'Memory'], ['core', 'Core'], ['mxu', 'MXU']],
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
