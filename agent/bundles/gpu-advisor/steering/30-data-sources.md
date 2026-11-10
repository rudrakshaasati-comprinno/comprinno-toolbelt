---
inclusion: always
---

# GPU Advisor — Tool & Knowledge Map (bundle-specific)

This file maps the general sourcing discipline in the `gpu-advisor` skill
(`libraries/skills/gpu-advisor/references/data-sources.md`) to the concrete tools
and files THIS bundle provides. Follow the skill for the rules (what counts as a
valid source, provenance tags, the $0/null handling, Savings-Plans-only,
Bedrock-newest-model, source-cloud labeling); use the names below to act on them.

## Your MCP tools
- `@aws-pricing` — authoritative AWS pricing (EC2 On-Demand, Compute Savings
  Plan rates, Bedrock token pricing). AWS figures in the final recommendation
  ALWAYS come from here.
- `@aws-documentation` — AWS service/spec/availability documentation. Use it to
  validate specs and to pick the newest matching Bedrock model.
- `@cloud-cost` — real multi-cloud pricing (Azure + GCP baselines and
  cross-cloud comparison) from public APIs, no key required.

## Bundled knowledge (specs only, never pricing)
- `bundles/gpu-advisor/knowledge/aws-gpu-reference.md` — GPU families, sizing
  heuristics, purchasing options, and the citation link set.
- `bundles/gpu-advisor/knowledge/data/aws-gpu-instances.json` — EC2 GPU instance
  specs (GPU model/arch/count, per-GPU memory, vCPU/RAM/network). SPECS ONLY.
- `bundles/gpu-advisor/knowledge/data/bedrock-models.json` — Bedrock foundation
  model catalog for family matching. METADATA ONLY.

## How they fit together
Shortlist candidate instances from the specs JSON (memory fit + ~15% headroom),
price them via `@aws-pricing`, validate specs/availability and select the newest
Bedrock model via `@aws-documentation`, and get Azure/GCP baselines via
`@cloud-cost`. Apply the skill's data-sources rules to every figure.
