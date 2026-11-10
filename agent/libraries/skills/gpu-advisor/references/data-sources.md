# Data Sources — Where Every Number Comes From

Every price and availability fact MUST come from a real source. Do not rely on
memorized pricing. Record the provenance of each figure (§24).

## AWS On-Demand pricing (authoritative)

Use the AWS Pricing API (`aws pricing get-products`, service `AmazonEC2`,
endpoint region `us-east-1`). Filter on:
- `instanceType`, `regionCode` (the target region), `operatingSystem=Linux`,
  `tenancy=Shared`, `capacitystatus=Used`, `preInstalledSw=NA`.

Extract `terms.OnDemand[*].priceDimensions[*].pricePerUnit.USD`.

- If the price is `$0`, null, or missing → the instance is not offered in that
  region. Exclude it and say so (§19). Never substitute a remembered value.
- Monthly = hourly × hours/mo (use the customer's utilization, not always 730h).

## Compute Savings Plans (authoritative)

Use the `savingsplans` API (`describe-savings-plans-offering-rates`) for the full
matrix: 1yr and 3yr × No/Partial/All-Upfront. Compute Savings Plans ONLY — never
Reserved Instances. See `savings-plans.md` for the six variants and the 730h note.

## Amazon Bedrock model selection + pricing

1. **List models first** — enumerate the models Bedrock actually offers in the
   region (`bedrock list-foundation-models` or the documentation source). Do NOT
   rely on whatever a pricing lookup returns first — it may surface an obsolete
   model (e.g. Llama 2 when Llama 3.3 exists).
2. **Pick the newest generation** matching the customer's family. For "Llama 70B"
   choose the highest available: Llama 3.3 70B → 3.1 70B → 3 70B — never Llama 2
   when a 3.x exists.
3. **Then fetch that model's** on-demand input/output per-1K-token price.
4. A family match is not a behavior/performance guarantee — state it, and name
   the exact model id you priced.

Compute Bedrock monthly cost from confirmed token volume:
`requests/mo = RPS × 3600 × hours` (or concurrency × 3600 × hours);
`monthly_input = requests/mo × input_tokens`; likewise output. If token or
throughput numbers are missing, that's a discovery question — not a reason to
mark Bedrock unavailable.

## Source-cloud baselines (Azure / GCP / other)

- Use the customer's ACTUAL cost when they provide it (confirm actual vs list —
  §6). Label `customer-provided`.
- Otherwise use a public list-price source and label it `list_price` /
  "indicative" (§23). State the source region; it may differ from the customer's.
- For uncovered clouds: try a pricing tool, then a cited public web source, then
  ask the customer — before ever writing "not retrieved".

## Provenance labels (§24)

Every material figure is tagged one of: `customer-provided`, `pricing-api`,
`documentation`, `advisor-estimate`. Record these in the report `sources` block.
