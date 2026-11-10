# Report Format — Final JSON Schema

The final recommendation is a single JSON object (no markdown prose around it).
It renders as compact recommendation cards. Every number must trace to a real
source (see `data-sources.md`) with provenance (§24).

## Workflow (do this in order, behind the scenes)

1. Extract the workload profile: customer, source environment, workload,
   requirements.
2. Classify each critical field as Confirmed / Provided-by-tool / Missing.
   Critical fields: workload type, parameter count, precision/quantization,
   context length, concurrency, request rate + tokens/request (for Bedrock),
   target region, purchasing model, utilization, current monthly cost.
3. If any field needed for a calculation or the recommendation is missing, STOP
   and ASK for it (see `discovery.md`), one question at a time. Do NOT proceed
   with assumed/default/estimated values. Continue only once you have the real
   input (or the user explicitly skipped it, which excludes the dependent option).
4. Compute required GPU memory from the CONFIRMED precision/params/context/
   concurrency (see `memory-sizing.md`). Label it an engineering estimate, not a
   benchmark — the only "estimate" allowed, and it uses given inputs.
5. Shortlist candidate instances from the spec knowledge that can hold the
   workload (memory fit + ~15% headroom). Filter unsuitable ones first (e.g.
   Inferentia for training). Do NOT default to the biggest/newest GPU.
6. For the target region, retrieve On-Demand pricing for each candidate, and
   Savings Plan rates if applicable; retrieve specs/availability as needed.
7. Rank remaining candidates on technical fit, memory fit, cost efficiency,
   availability, and workload-type alignment. Pick the top 3 (fewer if fewer
   valid; never invent a third).
8. For inference workloads, evaluate Bedrock ONLY with a confirmed request rate
   AND tokens/request; match the newest equivalent model and price it. If the
   volume was skipped, set `bedrock.fits=false` with that reason.
9. Build the baseline comparison (Azure/GCP tool result or customer-provided).
10. Compute On-Demand and (if available) Savings Plan costs over the REAL prices,
    using the CONFIRMED utilization (never assume 730h/100%).
11. Write `sources` (with timestamps) and the four-dimension `confidence` object
    plus `confidence_summary`. The only permissible `assumptions` entries are
    inputs the user explicitly chose to skip.

## Schema

```json
{
  "summary": "one-sentence recommendation",
  "source_region": "azure-eastus",
  "target_region": "us-west-2",
  "confidence": {
    "hardware_match": "High",
    "cost_comparison": "Medium",
    "performance": "Low - benchmark required",
    "migration_compatibility": "Medium - validation required"
  },
  "confidence_summary": "High on hardware, Medium on cost, Low on performance",
  "confidence_reason": "why",
  "workload": {
    "model": "Mistral 7B", "parameters": "7B", "precision": "BF16",
    "workload_type": "Fine-tuning (LoRA)", "context_length": "8K",
    "gpu_count": "1", "source": "Azure NC24ads A100 v4 (1x A100 80GB)",
    "est_gpu_memory_gb": 40, "est_note": "estimate, not a benchmark"
  },
  "recommendations": [
    {
      "rank": 1, "instance": "g6.xlarge", "gpu": "1x NVIDIA L4",
      "category": "cost-optimized",
      "is_recommended": true,
      "gpu_memory_gb": 24, "vcpu": 4, "ram_gb": 16,
      "region": "us-west-2", "availability": "verify quota / capacity",
      "hourly_usd": 0.8048, "monthly_usd": 587.5,
      "price_source": "pricing-api",
      "savings_plan_monthly_usd": null, "savings_plan_note": "1yr No Upfront",
      "why": "single-GPU L4 fits QLoRA of a 7B model at lowest cost",
      "source": "AWS Pricing API, us-west-2, <timestamp>"
    }
  ],
  "bedrock": {
    "fits": false,
    "note": "Fine-tuning is a training workload; Bedrock is inference-only."
  },
  "cost_comparison": {
    "rows": [
      {"env": "Azure (current)", "monthly_usd": 2680, "cost_type": "customer_actual", "source": "customer-provided"},
      {"env": "AWS On-Demand (g6.xlarge)", "monthly_usd": 587.5, "cost_type": "tool_retrieved", "source": "AWS Pricing API"},
      {"env": "AWS Savings Plan (3yr All Upfront)", "monthly_usd": 372.0, "cost_type": "tool_retrieved", "source": "savingsplans API"}
    ],
    "monthly_difference_usd": -2308.0,
    "annual_difference_usd": -27696.0,
    "savings_pct": 86.1,
    "note": "vs best AWS option; customer's stated actual Azure cost; assumes X hrs/mo"
  },
  "assumptions": ["us-west-2", "X hrs/mo", "single GPU confirmed", "taxes/support excluded"],
  "sources": ["AWS Pricing API @ <ts>", "savingsplans API @ <ts>", "https://aws.amazon.com/ec2/instance-types/g6/"],
  "risks": ["verify EC2 quota", "benchmark LoRA throughput on L4 vs A100"]
}
```

## Field rules

- **recommendations**: 1–3 items. Rank by hardware fit + memory fit + cost +
  availability (§5, §22). Never invent filler options. Each MUST have `category`
  (direct-equivalent / cost-optimized / experimental) and `is_recommended` (§4,
  §21). Include `price_source` for each (§19, §24).
- **confidence**: the four-dimension object (§13), plus a one-line
  `confidence_summary`.
- **cost_comparison.rows[]**: each carries `cost_type`
  (`customer_actual` / `list_price` / `tool_retrieved`) and a `source` (§6, §24).
  Label cross-region/mixed-purchasing comparisons "indicative" in the note (§23).
- **savings_plan_monthly_usd**: `null` when the SP purchasing model is chosen —
  the backend injects the real value from the `savingsplans` API. If it stays
  null, it genuinely was not retrieved (§8) — never fill with a Reserved Instance.
- **bedrock**: set `fits=false` with a real reason when it doesn't apply
  (training/fine-tuning) or when throughput was skipped (§12).
- **bedrock.calc (when fits=true)**: always include the `calc` object and keep it
  internally consistent — `input_tokens_total = requests_per_month x
  input_tokens_per_req`; `input_cost_usd = input_tokens_total / 1000 x
  input_per_1k_usd`; `est_monthly_usd = input_cost_usd + output_cost_usd`.
- **One total everywhere**: `bedrock.est_monthly_usd`, the value implied by
  `calc`, and the Bedrock row in `cost_comparison.rows` MUST all be the SAME
  number. Never show two different Bedrock monthly figures in one report.
- **Request volume is one clean number**: `requests_per_month` is a SINGLE value
  from a SINGLE explicit formula using the user-provided request rate, and
  `requests_basis` states exactly that formula (e.g. "2 req/s x 3600 x 730h").
  Never show competing derivations ("upper bound vs conservative vs final") and
  never assume a rate — if you did not get one, set `bedrock.fits=false` with note
  "request volume not provided — cannot size Bedrock".
- **workload**: include `gpu_count` (confirmed, §26) and an `est_note` marking
  the memory figure an estimate (§3).
- **sources**: include the grounding documentation URLs and tool timestamps.
- Include the pricing-source disclaimer: AWS pricing from the pricing API; any
  third-party (source-cloud) cost is public list price and may differ from actual.
