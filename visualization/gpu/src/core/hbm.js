import * as THREE from 'three';
import { Panel, CellGrid, Ring, label, rrShape } from './kit.js';
import { COL, HEX, valColor } from './palette.js';

/**
 * Off-chip HBM holding A, B and C. Shared by the TPU and GPU scenes so both
 * start from an identical picture.
 */
export function buildHBM(root, P, { title = 'HBM', sub = '', info = null } = {}) {
  const g = new THREE.Group();
  root.add(g);
  const gap = 0.75;
  const totalCells = P.kc + P.nc + P.nc;
  const hp = Math.min(0.1, (12.2 - 2 * gap) / totalCells);
  const matW = totalCells * hp + 2 * gap;
  const matH = Math.max(P.mc, P.kc) * hp;
  const W = Math.max(14, matW + 2.4);
  const padTop = 0.55;
  const H = padTop + matH + 0.6 + 1.2;
  const panel = new Panel(g, { w: W, h: H, d: 0.5, r: 0.4, color: HEX.panelDeep, edge: HEX.mem, edgeOpacity: 0.35, info }).at(0, H / 2, 0);
  const zF = panel.front + 0.012;

  const defs = [
    { key: 'A', rows: P.mc, cols: P.kc, color: COL.A, src: P.A, dims: `${P.M}×${P.K}` },
    { key: 'B', rows: P.kc, cols: P.nc, color: COL.B, src: P.B, dims: `${P.K}×${P.N}` },
    { key: 'C', rows: P.mc, cols: P.nc, color: COL.C, src: null, dims: `${P.M}×${P.N}` },
  ];
  const grids = {};
  let x = -matW / 2;
  const yTop = H - padTop;
  for (const d of defs) {
    const w = d.cols * hp;
    const h = d.rows * hp;
    const grid = new CellGrid(g, d.rows, d.cols, hp, { size: 0.8 });
    grid.position.set(x + w / 2, yTop - h / 2, zF);
    for (let r = 0; r < d.rows; r++) {
      for (let c = 0; c < d.cols; c++) {
        grid.setBase(grid.idx(r, c), d.src ? valColor(d.color, d.src[r][c]) : COL.empty);
      }
    }
    if (d.key === 'C') {
      // dashed outline: C is allocated but empty, as in the original figure
      const pts = rrShape(w + 0.16, h + 0.16, 0.1).getPoints(16);
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => new THREE.Vector3(p.x, p.y, 0)));
      const line = new THREE.LineLoop(geo, new THREE.LineDashedMaterial({ color: COL.C, dashSize: 0.09, gapSize: 0.07, transparent: true, opacity: 0.75 }));
      line.computeLineDistances();
      line.position.set(x + w / 2, yTop - h / 2, zF);
      g.add(line);
    } else {
      new Ring(g, w + 0.16, h + 0.16, { r: 0.1, color: d.color, opacity: 0.28 }).at(x + w / 2, yTop - h / 2, zF);
    }
    const kind = d.key === 'C' ? 'output' : d.key === 'A' ? 'LHS' : 'RHS';
    label(g, x + w / 2, yTop - matH - 0.32, zF, `<b class="op-${d.key}">${d.key}</b><span>${d.dims} · ${kind}</span>`, 'mat');
    grid.key = d.key;
    grids[d.key] = grid;
    x += w + gap;
  }
  label(g, -W / 2 + 0.45, 0.5, zF, `<div class="t">${title}</div>${sub ? `<div class="s">${sub}</div>` : ''}`, 'big left', 0, 0.5);

  return {
    group: g,
    panel,
    A: grids.A,
    B: grids.B,
    C: grids.C,
    pitch: hp,
    width: W,
    height: H,
    bake() {
      grids.A.bake();
      grids.B.bake();
      grids.C.bake();
    },
    reset() {
      grids.A.reset();
      grids.B.reset();
      grids.C.reset();
    },
    commit() {
      grids.A.commit();
      grids.B.commit();
      grids.C.commit();
      panel.apply();
    },
  };
}
