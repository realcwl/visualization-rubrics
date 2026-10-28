import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** Normalized position of x inside [a, b], clamped to [0, 1]. */
export const win = (x, a, b) => clamp((x - a) / (b - a));

/** Smooth 0 → 1 → 0 hump over [a, b]; 0 outside. */
export const bump = (x, a, b) => {
  if (x <= a || x >= b) return 0;
  return Math.sin(Math.PI * ((x - a) / (b - a)));
};

/** 1 right at an event, decaying linearly to 0 after `len`. */
export const after = (x, at, len) => (x < at ? 0 : clamp(1 - (x - at) / len));

const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/**
 * Cubic bezier from a to b that bulges toward the camera (+z) by `lift`.
 * `out` must not alias a or b.
 */
export function arc(a, b, p, lift, out) {
  _c1.lerpVectors(a, b, 0.22);
  _c1.z += lift;
  _c2.lerpVectors(a, b, 0.78);
  _c2.z += lift;
  const u = 1 - p;
  out.set(0, 0, 0)
    .addScaledVector(a, u * u * u)
    .addScaledVector(_c1, 3 * u * u * p)
    .addScaledVector(_c2, 3 * u * p * p)
    .addScaledVector(b, p * p * p);
  return out;
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap stable hash → [0, 1). */
export const hash = (a, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
