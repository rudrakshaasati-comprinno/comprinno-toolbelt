# GPU Memory Sizing (Approximation Guide)

These heuristics estimate GPU memory footprint to shortlist instances. They are
**approximations, not fit guarantees** (§3). Always label them as estimates and
recommend a benchmark/POC before committing (§10, §22).

## Training (full fine-tune / pre-train), dense model, Adam

Per parameter, first-order:
- Weights: 2 bytes (BF16/FP16) — or 1 byte if FP8 weights
- Gradients: 2 bytes (BF16)
- Adam optimizer state (FP32 master + m + v): ~12 bytes (often quoted ~8 for m+v
  only; include the FP32 master copy for a safer estimate)

Rough total ≈ **16 bytes/param** for BF16 + Adam (weights+grads+optimizer),
before activations and overhead. Example: 70B → ~1.1 TB — far beyond one 80GB
GPU, so multi-GPU/multi-node with ZeRO/FSDP is required.

Reducers to account for: ZeRO-1/2/3 or FSDP sharding, activation checkpointing,
CPU/NVMe optimizer offload, tensor/pipeline parallelism. These change the
per-GPU footprint substantially — state which levers apply.

## Fine-tuning (parameter-efficient)

LoRA/QLoRA train a small adapter, so optimizer/gradient memory is tiny relative
to the base weights:
- QLoRA (4-bit base) of a 7B model fits comfortably on a single 24GB GPU.
- LoRA on a BF16 base of a 7B model may need ~24–48GB depending on context/batch.
Confirm the method (§ discovery) — it changes the instance class dramatically.

## Inference

Approx per-GPU: quantized weights + KV cache.
- Weights: params × bytes/param (INT4 ≈ 0.5, INT8 ≈ 1, FP16 ≈ 2).
- KV cache grows with context length × batch/concurrency × layers × hidden — can
  dominate at long context; ask for context length and concurrency.

Example: 70B INT4 ≈ ~35GB weights + KV cache; often fits a single 48–80GB GPU or
a small multi-GPU box depending on context/concurrency.

## Activation memory (long context)

For training/fine-tuning at ≥4K context, activation memory scales with
batch × sequence length. Ask for batch size and sequence length before asserting
fit at long context.

## What to report

- GPU HBM required (estimate) vs available (per instance) — separately from
  system RAM and storage (§11).
- The memory-optimization strategy assumed (sharding/offload/checkpointing).
- An explicit "estimate, not a benchmark" note.
