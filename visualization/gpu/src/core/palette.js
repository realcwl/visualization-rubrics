import { Color } from 'three';

// Operand colors follow the scaling-book figure: A pink, B green, C blue.
// Analogous units on TPU and GPU share a hue (MXU ≈ Tensor Core, VPU ≈ CUDA cores, …).
export const HEX = {
  A: '#ff8fab',
  B: '#6fe3b0',
  C: '#7cb9ff',

  mxu: '#4fd6c8', // MXU  ≈ Tensor Core
  vpu: '#ab9cff', // VPU  ≈ CUDA cores
  scalar: '#ffcf6b', // Scalar unit ≈ warp scheduler
  sreg: '#ff9fcf',
  vreg: '#7fa6ff', // VREGs ≈ register file
  mem: '#93a4c3', // VMEM ≈ SMEM
  dma: '#c9d4ea', // DMA ≈ TMA

  panel: '#141a27',
  panelDeep: '#10151f',
  well: '#0c111a',
  empty: '#1b2232',
  pe: '#16302f',
  ink: '#e8eef8',
  muted: '#8a97ad',
};

export const COL = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, new Color(v)]));

// Bright "hot" color used when a processing element fires.
export const HOT = new Color(1.0, 1.0, 1.0);

const _tmp = new Color();

/** Fill color for a data cell carrying a value v ∈ [0, 1]. */
export function valColor(base, v, out = _tmp) {
  return out.copy(COL.empty).lerp(base, 0.32 + 0.68 * v);
}
