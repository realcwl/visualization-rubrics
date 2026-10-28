import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { arc, ease, lerp, hash, after } from './util.js';
import { HEX } from './palette.js';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const LIGHT = new THREE.Vector3(-0.35, 0.75, 0.6).normalize();

/** Bake a soft directional shade into vertex colors so unlit (glowable) meshes still read as 3-D. */
function bakeShade(geo, amb = 0.52, dif = 0.5, front = 0.1) {
  const n = geo.attributes.normal;
  const c = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const d = Math.max(0, n.getX(i) * LIGHT.x + n.getY(i) * LIGHT.y + n.getZ(i) * LIGHT.z);
    const s = amb + dif * d + front * Math.max(0, n.getZ(i));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

const geoCache = new Map();
export function cellGeo(depth = 0.3, radius = 0.14) {
  const key = `cell:${depth}:${radius}`;
  if (!geoCache.has(key)) {
    geoCache.set(key, bakeShade(new RoundedBoxGeometry(1, 1, depth, 2, Math.min(radius, depth / 2 - 1e-3))));
  }
  return geoCache.get(key);
}
export function ballGeo() {
  if (!geoCache.has('ball')) geoCache.set('ball', bakeShade(new THREE.IcosahedronGeometry(0.5, 2), 0.6, 0.45, 0.15));
  return geoCache.get('ball');
}

export function rrShape(w, h, r, s = new THREE.Shape()) {
  r = Math.max(0.001, Math.min(r, w / 2, h / 2));
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - r);
  s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false);
  s.lineTo(x + r, y + h);
  s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + r);
  s.absarc(x + r, y + r, r, Math.PI, 1.5 * Math.PI, false);
  return s;
}

export function ringGeo(w, h, r, t) {
  const outer = rrShape(w, h, r);
  outer.holes.push(rrShape(w - 2 * t, h - 2 * t, Math.max(0.001, r - t), new THREE.Path()));
  return new THREE.ShapeGeometry(outer, 8);
}

// ---------------------------------------------------------------------------
// Panel: a rounded slab with a luminous edge ring. Used for every hardware block.
// ---------------------------------------------------------------------------

export class Panel {
  constructor(parent, { w, h, d = 0.36, r = 0.22, color = HEX.panel, edge = HEX.mem, edgeOpacity = 0.4, ring = 0.016, opacity = 1, info = null }) {
    this.group = new THREE.Group();
    parent.add(this.group);
    const bevel = Math.min(0.05, d / 4);
    const shape = rrShape(w - 2 * bevel, h - 2 * bevel, Math.max(0.02, r - bevel));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: d - 2 * bevel,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: 3,
      curveSegments: 10,
    });
    geo.translate(0, 0, -(d - 2 * bevel) / 2);
    this.edgeColor = new THREE.Color(edge);
    this.mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.5,
      metalness: 0.0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.35,
      emissive: this.edgeColor,
      emissiveIntensity: 0,
      transparent: opacity < 1,
      opacity,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.group.add(this.mesh);
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.edgeColor.clone(), transparent: true, opacity: edgeOpacity, depthWrite: false });
    this.ring = new THREE.Mesh(ringGeo(w - 0.03, h - 0.03, Math.max(0.03, r - 0.015), ring), this.ringMat);
    this.ring.position.z = d / 2 + 0.003;
    this.group.add(this.ring);
    this.w = w;
    this.h = h;
    this.d = d;
    this.baseOpacity = edgeOpacity;
    this.glow = 0;
    if (info) this.mesh.userData.info = info;
  }
  at(x, y, z = 0) {
    this.group.position.set(x, y, z);
    return this;
  }
  get front() {
    return this.group.position.z + this.d / 2;
  }
  pulse(v) {
    if (v > this.glow) this.glow = v;
  }
  apply() {
    const g = Math.min(1.5, this.glow);
    this.mat.emissiveIntensity = g * 0.22;
    this.ringMat.color.copy(this.edgeColor).multiplyScalar(1 + g * 2.2);
    this.ringMat.opacity = Math.min(1, this.baseOpacity + (1 - this.baseOpacity) * g);
    this.glow = 0;
  }
}

/** A thin rounded outline (no slab) — slot wells, register capsules, tile highlights. */
export class Ring {
  constructor(parent, w, h, { r = 0.06, t = 0.012, color = HEX.mem, opacity = 0.35 } = {}) {
    this.color = new THREE.Color(color);
    this.mat = new THREE.MeshBasicMaterial({ color: this.color.clone(), transparent: true, opacity, depthWrite: false });
    this.mesh = new THREE.Mesh(ringGeo(w, h, r, t), this.mat);
    parent.add(this.mesh);
    this.base = opacity;
    this.glow = 0;
  }
  at(x, y, z) {
    this.mesh.position.set(x, y, z);
    return this;
  }
  pulse(v) {
    if (v > this.glow) this.glow = v;
  }
  apply() {
    const g = this.glow;
    this.mat.color.copy(this.color).multiplyScalar(1 + g * 2.5);
    this.mat.opacity = Math.min(1, this.base + (1 - this.base) * g);
    this.glow = 0;
  }
}

/** A movable glowing frame used to highlight the tile being read. */
export class Frame {
  constructor(parent, w, h, color) {
    this.color = new THREE.Color(color);
    this.mat = new THREE.MeshBasicMaterial({ color: this.color.clone(), transparent: true, opacity: 0, depthWrite: false });
    this.mesh = new THREE.Mesh(ringGeo(w, h, 0.07, 0.022), this.mat);
    this.mesh.visible = false;
    parent.add(this.mesh);
  }
  show(pos, k) {
    if (k <= 0.01) return;
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
    this.mesh.position.z += 0.03;
    this.mat.color.copy(this.color).multiplyScalar(1 + 1.8 * k);
    this.mat.opacity = Math.min(1, k * 1.4);
  }
  hide() {
    this.mesh.visible = false;
  }
}

/** Hollow double-headed arrow, like the ⇕ glyphs in the scaling-book figure. */
export class Arrow {
  constructor(parent, a, b, { width = 0.24, color = HEX.mem } = {}) {
    const L = a.distanceTo(b);
    const hw = width / 2;
    const sw = width * 0.18;
    const hl = Math.min(width * 0.75, L * 0.3);
    const pts = [
      [0, L / 2], [hw, L / 2 - hl], [sw, L / 2 - hl], [sw, -L / 2 + hl], [hw, -L / 2 + hl],
      [0, -L / 2], [-hw, -L / 2 + hl], [-sw, -L / 2 + hl], [-sw, L / 2 - hl], [-hw, L / 2 - hl],
    ];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    this.color = new THREE.Color(color);
    this.fillMat = new THREE.MeshBasicMaterial({ color: this.color.clone(), transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });
    this.lineMat = new THREE.LineBasicMaterial({ color: this.color.clone(), transparent: true, opacity: 0.55 });
    this.group = new THREE.Group();
    this.group.add(new THREE.Mesh(new THREE.ShapeGeometry(shape), this.fillMat));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts.map(([x, y]) => new THREE.Vector3(x, y, 0.001)));
    this.group.add(new THREE.LineLoop(lineGeo, this.lineMat));
    this.group.position.lerpVectors(a, b, 0.5);
    this.group.rotation.z = Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2;
    parent.add(this.group);
    this.glow = 0;
  }
  pulse(v) {
    if (v > this.glow) this.glow = v;
  }
  apply() {
    const g = Math.min(1, this.glow);
    this.lineMat.color.copy(this.color).multiplyScalar(1 + g * 2.5);
    this.lineMat.opacity = 0.55 + 0.45 * g;
    this.fillMat.color.copy(this.color).multiplyScalar(1 + g * 1.5);
    this.fillMat.opacity = 0.06 + 0.3 * g;
    this.glow = 0;
  }
}

// ---------------------------------------------------------------------------
// Instanced cells: memory tiles, PEs, lattice nodes. Colors are reset each frame
// from a base buffer, then painted by timeline segments.
// ---------------------------------------------------------------------------

export class Dots {
  constructor(parent, positions, scale, geo = cellGeo()) {
    const n = positions.length;
    this.n = n;
    this.local = positions;
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true }), n);
    const m = new THREE.Matrix4();
    positions.forEach((p, i) => {
      m.makeScale(scale.x, scale.y, scale.z).setPosition(p);
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.col = this.mesh.instanceColor.array;
    this.base = new Float32Array(n * 3);
    this.world = [];
    parent.add(this.mesh);
  }
  /** Cache world-space positions (call once after layout). */
  bake() {
    this.mesh.updateWorldMatrix(true, false);
    this.world = this.local.map((p) => p.clone().applyMatrix4(this.mesh.matrixWorld));
    this.mesh.computeBoundingSphere();
  }
  setBase(i, c, k = 1) {
    const o = i * 3;
    this.base[o] = c.r * k;
    this.base[o + 1] = c.g * k;
    this.base[o + 2] = c.b * k;
  }
  fillBase(c, k = 1) {
    for (let i = 0; i < this.n; i++) this.setBase(i, c, k);
  }
  reset() {
    this.col.set(this.base);
  }
  set(i, c, k = 1) {
    const o = i * 3;
    this.col[o] = c.r * k;
    this.col[o + 1] = c.g * k;
    this.col[o + 2] = c.b * k;
  }
  /** Brighten whatever is currently there. */
  boost(i, k) {
    const o = i * 3;
    this.col[o] *= k;
    this.col[o + 1] *= k;
    this.col[o + 2] *= k;
  }
  /** Blend current color toward c·k by t. */
  mix(i, c, t, k = 1) {
    const o = i * 3;
    this.col[o] += (c.r * k - this.col[o]) * t;
    this.col[o + 1] += (c.g * k - this.col[o + 1]) * t;
    this.col[o + 2] += (c.b * k - this.col[o + 2]) * t;
  }
  commit() {
    this.mesh.instanceColor.needsUpdate = true;
  }
}

export class CellGrid extends Dots {
  constructor(parent, rows, cols, pitch, { pitchY = pitch, size = 0.82, depth = 0.3, geo } = {}) {
    const pos = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pos.push(new THREE.Vector3((c - (cols - 1) / 2) * pitch, ((rows - 1) / 2 - r) * pitchY, 0));
      }
    }
    const s = Math.min(pitch, pitchY) * size;
    super(parent, pos, new THREE.Vector3(pitch * size, pitchY * size, s), geo || cellGeo(depth));
    this.rows = rows;
    this.cols = cols;
    this.pitch = pitch;
    this.pitchY = pitchY;
    this.cell = s;
  }
  idx(r, c) {
    return r * this.cols + c;
  }
  pos(r, c) {
    return this.world[r * this.cols + c];
  }
  get position() {
    return this.mesh.position;
  }
  get width() {
    return this.cols * this.pitch;
  }
  get height() {
    return this.rows * this.pitchY;
  }
  /** World-space center of a rectangular block of cells. */
  blockCenter(r0, c0, rows, cols, out = new THREE.Vector3()) {
    return out.addVectors(this.pos(r0, c0), this.pos(r0 + rows - 1, c0 + cols - 1)).multiplyScalar(0.5);
  }
}

// ---------------------------------------------------------------------------
// Transient particles (data in flight). Rebuilt every frame.
// ---------------------------------------------------------------------------

class Pool {
  constructor(parent, geo, max, additive) {
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: additive,
      depthWrite: !additive,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (additive) this.mesh.renderOrder = 2;
    this.M = this.mesh.instanceMatrix.array;
    this.C = this.mesh.instanceColor.array;
    this.max = max;
    this.n = 0;
    parent.add(this.mesh);
  }
  add(p, sx, sy, sz, c, k) {
    if (this.n >= this.max) return;
    const o = this.n * 16;
    const M = this.M;
    M[o] = sx; M[o + 1] = 0; M[o + 2] = 0; M[o + 3] = 0;
    M[o + 4] = 0; M[o + 5] = sy; M[o + 6] = 0; M[o + 7] = 0;
    M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = sz; M[o + 11] = 0;
    M[o + 12] = p.x; M[o + 13] = p.y; M[o + 14] = p.z; M[o + 15] = 1;
    const q = this.n * 3;
    this.C[q] = c.r * k;
    this.C[q + 1] = c.g * k;
    this.C[q + 2] = c.b * k;
    this.n++;
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.n = 0;
  }
}

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

export class Particles {
  constructor(parent, max = 2600) {
    this.cubes = new Pool(parent, cellGeo(0.45, 0.2), max, false);
    this.balls = new Pool(parent, ballGeo(), max, false);
    this.glows = new Pool(parent, ballGeo(), max * 2, true);
    this.trails = true;
  }
  end() {
    this.cubes.end();
    this.balls.end();
    this.glows.end();
  }
  cube(p, s, c, k = 2) {
    this.cubes.add(p, s, s, s * 0.6, c, k);
  }
  ball(p, s, c, k = 2) {
    this.balls.add(p, s, s, s, c, k);
  }
  glow(p, s, c, k = 1) {
    this.glows.add(p, s, s, s, c, k);
  }
  /**
   * A cell flying from a to b along a lifted arc. q ∈ (0, 1) is raw progress;
   * size interpolates s0 → s1. Draws a short additive trail behind it.
   */
  fly(a, b, q, s0, s1, c, k = 2.2, lift = 0.8, shape = 'cube') {
    if (q <= 0 || q >= 1) return;
    const e = ease(q);
    arc(a, b, e, lift, _p);
    const s = lerp(s0, s1, e);
    if (shape === 'ball') this.ball(_p, s, c, k);
    else this.cube(_p, s, c, k);
    if (!this.trails) return;
    for (let i = 1; i <= 3; i++) {
      const q2 = q - i * 0.035;
      if (q2 <= 0) break;
      arc(a, b, ease(q2), lift, _q);
      this.glow(_q, s * (0.95 - i * 0.14), c, k * (0.42 - i * 0.1));
    }
  }
  /**
   * Move a rows×cols block of cells from `from(r,c)` to `to(r,c)` as a staggered
   * swarm. `land(r, c, flash)` is called for cells that have arrived.
   */
  swarm(p, rows, cols, { from, to, s0, s1, color, land, lift = 1.0, spread = 0.4 }) {
    const span = Math.max(1, rows + cols - 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = spread * (0.85 * ((r + c) / span) + 0.15 * hash(r * 7.1, c * 3.3));
        const q = (p - d) / (1 - spread);
        if (q <= 0) continue;
        if (q >= 1) {
          land(r, c, p < 1 ? after(q, 1, 0.35) : 0);
          continue;
        }
        this.fly(from(r, c), to(r, c), q, s0, s1, color(r, c), 2.2, lift * (0.8 + 0.5 * hash(c, r)));
      }
    }
  }
  /** A cell moving in a straight line; `back(d, out)` gives where it was d ago. */
  slide(p, s, c, k, back, shape = 'cube') {
    if (shape === 'ball') this.ball(p, s, c, k);
    else this.cube(p, s, c, k);
    if (!this.trails) return;
    for (let i = 1; i <= 3; i++) {
      if (!back(i * 0.22, _q)) break;
      this.glow(_q, s * (0.95 - i * 0.14), c, k * (0.4 - i * 0.1));
    }
  }
}

// ---------------------------------------------------------------------------
// Labels (crisp HTML via CSS2DRenderer)
// ---------------------------------------------------------------------------

export function label(parent, x, y, z, html, cls = '', cx = 0.5, cy = 0.5) {
  const el = document.createElement('div');
  el.className = `lbl ${cls}`;
  el.innerHTML = html;
  const o = new CSS2DObject(el);
  o.position.set(x, y, z);
  o.center.set(cx, cy);
  parent.add(o);
  return o;
}

/** Fading line, e.g. the magnifier between a die tile and the zoomed-in SM. */
export function fadeLine(parent, a, b, color, o0 = 0.0, o1 = 0.5) {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const c = new THREE.Color(color);
  geo.setAttribute('color', new THREE.Float32BufferAttribute([c.r * o0, c.g * o0, c.b * o0, c.r * o1, c.g * o1, c.b * o1], 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  parent.add(line);
  return line;
}

/** Dispose everything under a group, including CSS2D label elements. */
export function disposeTree(root) {
  root.traverse((o) => {
    if (o.isCSS2DObject && o.element) o.element.remove();
    if (o.geometry && !o.geometry.parameters?.cached) {
      let shared = false;
      for (const g of geoCache.values()) if (g === o.geometry) shared = true;
      if (!shared) o.geometry.dispose();
    }
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
  root.removeFromParent();
}
