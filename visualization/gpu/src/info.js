// Facts shown when you click a hardware block. Numbers follow "How to Scale Your
// Model" (jax-ml.github.io/scaling-book) unless noted.

export const INFO = {
  // ------------------------------------------------------------------ TPU
  tpu_hbm: {
    title: 'HBM',
    tag: 'High Bandwidth Memory · off-chip',
    analog: 'GPU: HBM — same role',
    specs: [
      ['Capacity', '96 GiB (v5p) · 192 GiB (TPU7x)'],
      ['Bandwidth', '2.8 TB/s (v5p) · 7.4 TB/s (TPU7x)'],
    ],
    body: 'A, B and C live here. Every byte has to be DMA’d into VMEM before the TensorCore can use it, so HBM bandwidth is the bound for small or skinny matmuls.',
  },
  vmem: {
    title: 'VMEM',
    tag: 'Vector memory · on-chip scratchpad',
    analog: 'GPU: shared memory (SMEM), but much larger',
    specs: [
      ['Capacity', '128 MiB per chip (TPU7x)'],
      ['Bandwidth to MXU', '≈ 7× HBM (TPU7x)'],
      ['Managed by', 'the program / compiler, not a cache'],
    ],
    body: 'A and B tiles are double-buffered here: while the MXU works on one buffer, DMA fills the other. The f32 accumulator also lives here.',
  },
  vreg: {
    title: 'VREGs',
    tag: 'Vector registers',
    analog: 'GPU: register file',
    specs: [
      ['Count', '32 (v4) · 64 (TPU7x) per core'],
      ['Shape', '8 sublanes × 128 lanes × 32 bit = 4 KiB'],
      ['Total', '≈ 256 KiB per core (TPU7x)'],
    ],
    body: 'Everything moving between VMEM and the MXU or VPU goes through VREGs: rows of A on the way in, weights being pushed, and results popped back out.',
  },
  mxu: {
    title: 'MXU',
    tag: 'Matrix multiply unit · systolic array',
    analog: 'GPU: Tensor Core (but 2-D and ~32× bigger)',
    specs: [
      ['Array', '128×128 (≤ v5) · 256×256 (v6e, TPU7x)'],
      ['Per TensorCore', '4 (v4, v5) · 2 (v6e, TPU7x)'],
      ['Work per cycle', '16,384 bf16 multiply-adds (128×128)'],
    ],
    body: 'Weights (RHS) shift in from the top and stay put. Inputs (LHS) flow left → right and partial sums flow top → bottom, so each PE does one multiply-add per cycle and passes its result down. Finished results leave at the bottom. Drawn here as 16×16; each square stands for 8×8 PEs.',
  },
  vpu: {
    title: 'Vector unit (VPU)',
    tag: 'SIMD ALUs',
    analog: 'GPU: CUDA cores',
    specs: [
      ['Shape', '(8, 128): sublanes × lanes'],
      ['Used for', 'elementwise math, reductions, f32 accumulation'],
    ],
    body: 'In this matmul the VPU adds each result popped from the MXU into the f32 accumulator. This is the same dot-wise path as the scaling-book animation this view expands.',
  },
  scalar: {
    title: 'Scalar unit',
    tag: 'Control core',
    analog: 'GPU: warp scheduler / instruction issue',
    specs: [
      ['Role', 'runs the loop, issues instructions and DMAs'],
      ['Threads', '1 (single-threaded)'],
    ],
    body: 'One scalar core drives the VPU, the MXUs and several DMA engines. It can issue one DMA request per cycle.',
  },
  sreg: {
    title: 'SREGs',
    tag: 'Scalar registers',
    specs: [['Hold', 'loop indices, addresses, DMA descriptors']],
    body: 'Small, fast registers for the scalar unit.',
  },
  tpu_smem: {
    title: 'SMEM',
    tag: 'Scalar memory',
    specs: [['Used for', 'control flow and scalar data']],
    body: 'Not the same thing as GPU “SMEM” (shared memory). The GPU counterpart of that is VMEM.',
  },

  // ------------------------------------------------------------------ GPU
  gpu_hbm: {
    title: 'HBM (global memory)',
    tag: 'off-chip',
    analog: 'TPU: HBM — same role',
    specs: [
      ['Capacity', '80 GB (H100) · 192 GB (B200)'],
      ['Bandwidth', '3.35 TB/s (H100) · 8 TB/s (B200)'],
    ],
    body: 'Same matrices as on the TPU. Each CTA reads only the tiles it needs: a 128-row slice of A and a 128-column slice of B.',
  },
  l2: {
    title: 'L2 cache',
    tag: 'Hardware-managed · shared by all SMs',
    analog: 'TPU: no equivalent (VMEM is programmer-managed)',
    specs: [
      ['Capacity', '50 MB (H100) · 126 MB (B200)'],
      ['Bandwidth', '≈ 5.5 TB/s (H100, measured)'],
    ],
    body: 'If several CTAs need the same tile, it is read from HBM once and then served from L2. The mini-maps show which tiles of A, B and C are in the cache.',
  },
  die: {
    title: 'Streaming Multiprocessors',
    tag: 'H100 SXM die',
    analog: 'TPU: TensorCores (2 per v5p chip)',
    specs: [
      ['SMs', '132'],
      ['Tensor Cores', '4 per SM → 528'],
      ['bf16 dense', '≈ 990 TFLOP/s'],
    ],
    body: 'A GPU is many small cores. Each CTA (thread block) runs on one SM, so different C tiles are computed in parallel. Lit squares are the SMs running this kernel.',
  },
  sm: {
    title: 'SM',
    tag: 'Streaming multiprocessor',
    analog: 'TPU: TensorCore',
    specs: [
      ['Sub-partitions', '4 (SMSPs)'],
      ['Register file', '256 KB'],
      ['L1 / SMEM', '256 KB (up to 228 KB as SMEM)'],
    ],
    body: 'This one runs CTA (0,0), which computes C[0:128, 0:128]. Its 4 sub-partitions each hold a Tensor Core, a warp scheduler, 32 FP32 lanes and 64 KB of registers.',
  },
  smem: {
    title: 'Shared memory (SMEM)',
    tag: 'On-chip · per SM · programmer-managed',
    analog: 'TPU: VMEM',
    specs: [
      ['Capacity', 'up to 228 KB per SM'],
      ['Across chip', '≈ 33 MB (132 SMs)'],
      ['Here', '2 stages × (A 128×64 + B 64×128) bf16 = 64 KB'],
    ],
    body: 'Holds the A/B pipeline stages that feed the Tensor Cores, and the C tile during the epilogue.',
  },
  tma: {
    title: 'TMA',
    tag: 'Tensor Memory Accelerator (Hopper+)',
    analog: 'TPU: DMA engines',
    specs: [['Moves', 'whole tiles global ↔ SMEM, asynchronously']],
    body: 'One thread issues a bulk tile copy and TMA does the address math. Completion signals an mbarrier that the compute warps wait on.',
  },
  smsp: {
    title: 'Sub-partition (SMSP)',
    tag: '1 of 4 per SM',
    specs: [
      ['Warp scheduler', '1'],
      ['Register file', '64 KB (16,384 × 32 bit)'],
      ['FP32 lanes', '32'],
      ['Tensor Core', '1'],
    ],
    body: 'A warpgroup is 4 warps, one per sub-partition, so a single wgmma keeps all 4 Tensor Cores busy.',
  },
  tc: {
    title: 'Tensor Core',
    tag: 'Matrix unit, one per sub-partition',
    analog: 'TPU: MXU (but small and 3-D)',
    specs: [
      ['Per SM', '4'],
      ['Throughput', '≈ 1024 bf16 FLOP/cycle ≈ an 8×8×8 matmul (scaling-book estimate)'],
      ['Instructions', 'wgmma.m64nNk16 (Hopper) · mma.sync.m16n8k16 (Ampere)'],
    ],
    body: 'Each cycle it multiplies a small 3-D block of the problem (m × n × k) and reduces along k into the accumulator. The MXU instead streams a 2-D 128×128 wave.',
  },
  regs: {
    title: 'Register file',
    tag: 'Per sub-partition',
    analog: 'TPU: VREGs (but far larger in total)',
    specs: [
      ['Per SMSP', '64 KB'],
      ['Per SM', '256 KB'],
      ['Accumulator', '128×128 f32 = 64 KB, split over 4 SMSPs'],
    ],
    body: 'The f32 accumulators stay in registers for the whole K loop. Each SMSP owns interleaved 16-row strips: warp w of each warpgroup holds rows 16w…16w+15.',
  },
  cuda: {
    title: 'CUDA cores',
    tag: '32 FP32 lanes per sub-partition',
    analog: 'TPU: VPU ALUs',
    specs: [['Per SM', '128 FP32 lanes']],
    body: 'General SIMT math. Mostly idle in a matmul’s main loop; the epilogue uses them to convert f32 → bf16 (and to apply bias or activations).',
  },
  sched: {
    title: 'Warp scheduler',
    tag: 'Instruction issue',
    analog: 'TPU: scalar unit',
    specs: [['Issue', 'one warp-instruction per cycle per SMSP']],
    body: 'All 4 schedulers issue the warpgroup’s wgmma together.',
  },
};
