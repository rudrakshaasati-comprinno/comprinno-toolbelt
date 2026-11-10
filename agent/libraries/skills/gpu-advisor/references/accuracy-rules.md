# Accuracy Rules (§1–§26)

Permanent accuracy rules for GPU migration recommendations. These take
precedence over convenience or brevity. When in doubt, lower confidence and
state what is missing rather than guessing.

## §1 — Parameter count
Never infer parameter count from a base model name alone. Distinguish base-model
params from a custom/fine-tuned model. If dense vs Mixture-of-Experts (MoE) is
ambiguous, ASK — active vs. total params change the memory math materially.

## §2 — Memory equivalence ≠ performance equivalence
Same GPU count or aggregate memory does not imply same throughput. Performance
depends on GPU architecture/generation, tensor cores, memory bandwidth,
inter-GPU bandwidth (NVLink/PCIe), and network fabric (EFA). State memory
equivalence and performance non-equivalence separately.

## §3 — Training memory is an approximation
Baseline: BF16 weights ≈ 2 B/param + gradients ≈ 2 B/param + Adam optimizer
state (FP32) ≈ 8 B/param. Actual footprint changes with ZeRO/FSDP, activation
checkpointing, and CPU/NVMe offload. Always label as an approximation, not a fit
guarantee. See `memory-sizing.md`.

## §4 — Categorize every recommendation
Each option MUST carry a category in the JSON:
- **direct-equivalent** — same GPU class as the source.
- **cost-optimized** — different GPU generation, lower cost.
- **experimental** — architecture change (e.g. Trainium/Inferentia) needing validation.

## §5 / §17 — Rank by cost-to-complete, not hourly price
Rank by cost-to-complete, not hourly price. Do NOT lead with the priciest or
newest GPU; lead with the cost-optimized viable option. Without benchmarks,
state "performance-adjusted cost not determined without benchmarking."

## §6 — Customer-actual vs. list-price cost
Distinguish `customer_actual` from `list_price`. Never label a list price as the
customer's actual cost. Each cost-comparison row carries a `cost_type`:
`customer_actual`, `list_price`, or `tool_retrieved`.

## §7 — Regions
Always show both the source region and the target region. Do not imply a
cross-region list-price equals the customer's actual cost.

## §8 — Savings Plans
Don't assume Savings Plans make AWS competitive. Show SP figures only when
actually retrieved; when not retrieved, say so explicitly. Never invent a
discount %. See `savings-plans.md`.

## §9 — Capacity & quota
Flag that capacity/quota verification is needed. Never claim an instance/GPU is
available without verification. Use "verify quota / capacity".

## §10 — Multi-node training caveats
Call out EFA, NCCL, placement groups, and checkpoint performance. Warn that
theoretical equivalence ≠ distributed performance. Recommend a benchmark/POC on
any GPU architecture change.

## §11 — Storage separate from GPU memory
Report as distinct items: GPU HBM, system RAM, local NVMe, and persistent
storage (EBS/FSx/S3). Never claim equivalent storage because GPU memory matches.

## §12 — Bedrock scope
Amazon Bedrock is inference-only. Never propose it for distributed training or
fine-tuning. (It can host the resulting model for inference — a separate workload.)

## §13 — Split confidence into four dimensions
Report confidence as four separate levels, not one blanket label:
- **hardware_match** — High / Medium / Low
- **cost_comparison** — High / Medium / Low
- **performance** — Low unless benchmarked
- **migration_compatibility** — Medium unless validated

## §14 — Softer, precise language
Avoid "best", "guaranteed", "will reduce costs". Prefer "direct hardware
equivalent", "lower-cost candidate", "requires benchmarking".

## §16 — Never hide missing info
Never hide missing information. Ask for it or lower the relevant confidence
dimension, and list what is missing.

## §18 — Precision / architecture compatibility gate
Before ranking, reason about whether the target GPU architecture natively
supports the customer's precision. Do NOT hardcode — verify at reasoning time
(docs, EC2/Bedrock describe, web). If a precision (FP8, FP4, INT4…) is not
natively supported, that option's `migration_compatibility` is Low and an
explicit risk line names the unsupported precision and the required fallback.
(Example: A100/Ampere has no native FP8; H100/Hopper does.)

## §19 — Price verification gate
Every price must come from a verifiable source (Pricing API / `aws pricing
get-products`). If the API returns $0/null/missing, do NOT fabricate — re-query
or exclude the instance and state "price could not be retrieved for [instance]
in [region]". If a price came only from web search, mark it `web_estimate` and
treat the comparison as indicative.

## §20 — Savings Plan table utilization note
SP monthly figures are at 730 hrs/mo (AWS standard). When utilization ≠ 730h,
state it, and use the customer's actual hours for the authoritative cost
comparison. Never present the 730h figure as the customer's expected monthly
cost when their utilization is lower.

## §21 — Candidate vs. recommendation
A candidate is not automatically a recommendation. Don't label an option
"recommended"/"top pick"/"best" unless hardware, compatibility, capacity, and
verified-cost evidence all support it. Otherwise it's a sizing candidate
(`is_recommended: false`).

## §22 — Benchmark gate (reconciled with §5)
Without workload-specific performance data, don't rank by cost-to-complete. Rank
by hardware suitability (memory fit, architecture, precision), On-Demand cost as
tiebreaker, and state ranking is by fit + indicative cost, not proven economics.

## §23 — Pricing comparability
Compare costs quantitatively only when source and target use comparable regions,
utilization, purchasing models, and billing bases. Otherwise label the
comparison "indicative" / "list-price only" and state which assumptions differ.

## §24 — Provenance
Every material input identifies its source: `customer-provided`, `pricing-api`,
`documentation`, or `advisor-estimate`. Never present an advisor estimate as
customer-provided or measured. If provenance is unknown, mark it and lower
confidence.

## §25 — Multi-node scaling
Don't assume linear cost scaling across nodes. State the assumed scaling
efficiency and its source; typical real-world efficiency is 80–95% per added
node. If none is available: "multi-node cost-to-complete assumes linear scaling;
actual cost may be higher due to communication overhead."

## §26 — Instance size class requires confirmed GPU count
Never select an instance size class without a confirmed GPU count. Wrong choice
multiplies cost (4-GPU box for a 1-GPU job = 4×; 8-GPU = 8×). Ask; never infer
from the source instance.
