# Matmul on Silicon

A three.js visualization of how a **TPU** and a **GPU** compute `C = A · B`, side by side. It expands the pointwise HBM → VMEM → VREG → VPU animation from [How to Scale Your Model: TPUs](https://jax-ml.github.io/scaling-book/tpus/) in two directions:

1. **TPU matmul through the MXU.** A Pallas-style blocked matmul on a v5p-like TensorCore. DMAs copy tiles from HBM into double-buffered VMEM. The weights (B) shift into the 128×128 systolic array from the top. Rows of A stream in from the left with a one-cycle skew, and partial sums flow down. Results drop out of the bottom into VREGs, and the VPU adds them into the f32 accumulator, which is written back to HBM.
2. **The same matmul on an H100.** One CTA runs per 128×128 C tile, and all CTAs run in parallel on separate SMs. TMA moves tiles from HBM through L2 into 2-stage SMEM. A warpgroup issues `wgmma.m64n128k16` across 4 Tensor Cores, drawn as 8×8×8 multiply-add lattices. Accumulators stay in registers, with each sub-partition owning interleaved rows. In the epilogue, values go from registers to SMEM and a TMA store writes them to HBM.

The colors are the actual partial sums of a random A and B, so the accumulators visibly fill up. Units that play the same role share a color: MXU and Tensor Core, VMEM and SMEM, VPU and CUDA cores, the scalar unit and the warp scheduler.

## Run

```bash
npm install
npm run dev        # → http://localhost:5173
```

## Using it

| | |
|---|---|
| `Space` | play / pause |
| `←` `→` | previous / next narrated step |
| `1` `2` `3` | TPU only / side by side / GPU only |
| `C` | toggle the auto camera (it follows the action) |
| `K` / `L` | toggle the code panel / labels |
| drag, scroll | orbit, zoom (turns off the auto camera) |
| click a block | specs, role, and the matching unit on the other chip |
| dock lanes | scrub. The top row of each lane is memory traffic and the bottom row is compute, so double-buffering shows up as overlapping bars |

Use ⚙ to change the problem size (M, N, K ∈ {128, 256, 384}) and to turn motion trails and glow on or off.

## Scale and simplifications

- 1 drawn cell = an 8×8 block of elements. The MXU is drawn as 16×16, so each square stands for 8×8 PEs.
- Animation time is illustrative and not to scale.
- The TPU runs weight loading and streaming one after the other for clarity. Real MXUs overlap them. Only one of the 4 MXUs per v5p TensorCore is animated.
- The GPU shows one SM in detail. The other active SMs light up on the die map. The Tensor Core throughput (≈ 8×8×8 MACs/cycle) is the scaling book's estimate.

## Code map

```
src/core/timeline.js   seekable timeline: reset + re-apply segments each frame (scrubbing is exact)
src/core/view.js       renderer, bloom, CSS labels, orbit camera + "director" shots
src/core/kit.js        panels, instanced cell grids, particles, arrows, labels
src/core/hbm.js        shared HBM with A, B, C
src/core/problem.js    random A, B and prefix sums for true partial-sum colors
src/tpu.js             TPU scene + timeline (DMA, weight shift-in, systolic stream, VPU accumulate)
src/gpu.js             GPU scene + timeline (TMA via L2, wgmma, Tensor Core lattice, epilogue)
src/info.js            click-through facts
```
