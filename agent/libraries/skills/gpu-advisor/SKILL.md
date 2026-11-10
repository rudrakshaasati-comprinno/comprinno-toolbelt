---
name: gpu-advisor
description: "Recommend the best-fit AWS GPU setup for an AI/ML or HPC workload: EC2 GPU instance selection (P5/P5e/P5en/P4d/P4de/G6/G6e/G5, and the underlying A10G/L4/L40S/A100/H100/H200/B200 GPUs), single-node vs multi-node sizing, training/inference/fine-tuning memory estimation, Compute Savings Plan comparison (1yr/3yr No/Partial/All-Upfront), and Amazon Bedrock managed-inference comparison for inference workloads. Runs interactive discovery (ask-never-assume) before a structured recommendation. Triggers on GPU recommendation, GPU sizing, which GPU for training/fine-tuning/inference, H100/A100/L40S/L4 on AWS, VRAM estimation, LLM training cost, inference cost, Bedrock vs EC2, Savings Plan for GPU."
version: 1
---

# GPU Advisor

## Overview

Recommend the best-fit AWS GPU setup for a customer's AI/ML or HPC workload, with
sizing math and reasoning that is always grounded — never fabricated. This skill
encodes the accuracy rules, discovery discipline, and reporting format that make
a GPU recommendation trustworthy in a pre-sales context.

The workflow is two phases:
1. **Discovery** — ask targeted clarifying questions (one at a time) until every
   decision-relevant input is confirmed. Never assume values.
2. **Recommendation** — produce a structured recommendation: ranked GPU options
   with a category (direct-equivalent / cost-optimized / experimental), split
   confidence, a Compute Savings Plan matrix, and a Bedrock comparison where the
   workload is inference.

This tool retrieves real pricing/spec facts from MCP tools — the AWS Pricing
MCP for EC2/Bedrock pricing, the AWS Documentation MCP for specs/availability,
and the cloud-cost MCP for Azure/GCP baselines — and grounds recommendations in
the bundled knowledge (`bundles/gpu-advisor/knowledge`). Never present a
memorized price as current; cite the tool source and timestamp for every figure,
and mark anything a tool could not return as "not retrieved."

## Usage

Use this skill when:
- Sizing AWS GPU instances for training, fine-tuning, or inference.
- Recommending a GPU family and count for a described workload.
- Comparing AWS On-Demand vs Compute Savings Plan pricing structure for GPU
  instances.
- Deciding between EC2 GPU instances and Amazon Bedrock managed inference.

Do NOT use this skill for:
- Non-GPU cost analysis (out of scope for this GPU specialist).
- General EC2 provisioning without a GPU angle.
- Building Bedrock applications.

## Critical Rules

These rules are non-negotiable. Full detail in `references/accuracy-rules.md`.

**Never fabricate pricing.** Every price must trace to a cited public source
(with a date) or a value the customer gave you. If a price can't be sourced,
exclude that option or label it "not retrieved" — do not substitute a remembered
or estimated value as if it were current. See `references/data-sources.md`.

**Ask — never assume.** If any decision-relevant input is missing (utilization,
GPU count, precision, region, purchasing model, request rate, tokens/request),
ask for it and wait. Never default, smooth, or invent a value. See
`references/discovery.md`.

**Confirm GPU count before choosing an instance size.** A 4-GPU box priced for a
1-GPU job overstates cost ~4x. Never infer GPU count from a source instance. See
`references/discovery.md` and `references/accuracy-rules.md`.

**Compute Savings Plans only — never Reserved Instances.** GPU commitment pricing
is compared using Compute Savings Plans (1yr/3yr x No/Partial/All-Upfront). Never
use or propose Reserved Instances. See `references/savings-plans.md`.

**Distinguish list-price from actual cost.** A public list-price estimate is
never labeled as the customer's actual billed cost. Cross-region or
mixed-purchasing comparisons are labeled "indicative." See
`references/accuracy-rules.md`.

**Split confidence into four dimensions** — hardware match, cost comparison,
performance, migration compatibility — never a single blanket label.

**Memory equivalence != performance equivalence.** Same GPU count or aggregate
HBM does not imply equal throughput. State them separately. See
`references/memory-sizing.md`.

**Bedrock is inference-only.** Never propose Bedrock as a substitute for training
or fine-tuning.

## Decision Guide

| Question | Where to look |
|----------|---------------|
| What questions must I ask before recommending? | `references/discovery.md` |
| How do I size GPU memory for training/inference/fine-tuning? | `references/memory-sizing.md` |
| Where do the pricing/spec facts come from and how are they cited? | `references/data-sources.md` |
| Which Compute Savings Plan variants to show, and how? | `references/savings-plans.md` |
| What is the exact accuracy rule for X? | `references/accuracy-rules.md` |
| What shape should the final recommendation take? | `references/report-format.md` |

## Discovery Workflow

Before any recommendation, reason: *"What decisions am I about to make, and what
inputs do those decisions require that I have not yet confirmed?"* Ask for each
missing input, one question at a time, highest-impact first, each with an
`Options:` line and a genuine "Skip" choice.

Always-required gates before recommending:
1. **Workload type** — training / fine-tuning / inference / other.
2. **Model + parameters + dense-vs-MoE** — never infer params from a base name.
3. **Precision** — BF16 / FP16 / FP8 / INT8 / INT4 / FP32.
4. **GPU count / parallelism** — single-GPU vs multi-GPU; single-node vs multi-node.
5. **Region** (target) and, if a baseline is given, source region.
6. **Utilization** — hours/month; never assume 730h/100%.
7. **Purchasing model** — offer "All options" (On-Demand + 1yr & 3yr SP).
8. **Cost baseline type** — if a cost figure is given, confirm actual vs list price.
9. **For Bedrock** — request rate AND tokens/request (two separate questions).

Full rules and phrasing: `references/discovery.md`.

## Recommendation Workflow

1. Identify candidate instances by hardware fit (memory + architecture +
   precision support) for the confirmed workload.
2. Estimate GPU memory footprint (`references/memory-sizing.md`) — label it an
   approximation, not a fit guarantee.
3. Rank candidates by hardware fit first, then cost. Do NOT lead with the
   priciest/newest GPU. Categorize each as direct-equivalent / cost-optimized /
   experimental.
4. Lay out the Compute Savings Plan matrix (`references/savings-plans.md`),
   citing sources for any price figures.
5. Evaluate Bedrock only for inference, with the newest matching model.
6. If a current-cloud baseline was given, build the comparison, labeling
   list-price vs actual.
7. Assign split confidence and present the recommendation per
   `references/report-format.md`.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Recommendation leads with the most expensive instance | Ranked by GPU class, not fit+cost | Rank by hardware fit then cost; categorize options |
| Cost overstated ~4x or ~8x | Multi-GPU instance chosen for a single-GPU job | Confirm GPU count first; size the matching class |
| Bedrock priced far too high | Matched an obsolete model | Pick the newest matching family (data-sources.md) |
| A price shows as $0 or unknown | Instance not offered in that region | Exclude it; state it's unavailable there |
| Single blanket "High confidence" | Not using split confidence | Use four dimensions: hardware / cost / performance / migration |
| FP8 workload recommended on A100 without warning | Architecture/precision mismatch not checked | A100 has no native FP8; lower migration confidence + explicit risk |
| "current cost" is actually a list price | Baseline mislabeled | Confirm actual vs list; label indicative comparisons |

## Additional Resources

- AWS EC2 P5 instances: https://aws.amazon.com/ec2/instance-types/p5/
- AWS EC2 P4 instances: https://aws.amazon.com/ec2/instance-types/p4/
- AWS EC2 G6/G6e instances: https://aws.amazon.com/ec2/instance-types/g6/
- AWS Compute Savings Plans: https://aws.amazon.com/savingsplans/compute-savings-plans/
- Amazon Bedrock pricing: https://aws.amazon.com/bedrock/pricing/
- EC2 Capacity Blocks for ML: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-capacity-blocks.html
