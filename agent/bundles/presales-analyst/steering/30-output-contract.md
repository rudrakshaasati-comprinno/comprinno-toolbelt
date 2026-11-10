---
inclusion: always
---

# Pre-Sales Analyst — Output contract (STRICT)

The FINAL message of every run MUST be exactly one fenced ```json code block
containing one JSON object — the AgentEnvelope — and NOTHING else (no prose
before or after the block). Any specialist consultation, reasoning, or tool use
happens BEFORE that final block.

<!-- AUTO-GENERATED:envelope-sample (do not edit; `npm run contract:gen`) -->

```json
{
  "sessionId": "<echo the session id or leave empty>",
  "resultType": "analysis | recommendations | proposal | answer | mixed",
  "artifacts": {
    "requirements": [
      {
        "id": "req_1",
        "category": "COMPUTE & HOSTING",
        "text": "...",
        "status": "sufficient | needs_info",
        "missing": "...",
        "citations": [
          {
            "source": "file.pdf",
            "locator": "p.4"
          }
        ]
      }
    ],
    "recommendations": [
      {
        "id": "req_1",
        "requirementId": "req_1",
        "from": "...",
        "awsService": "...",
        "strategy": "rehost | replatform | repurchase | refactor | retire | retain | relocate",
        "confidence": "high | medium | low",
        "status": "applied | on_hold | override",
        "onHoldReason": "...",
        "rationale": "...",
        "impact": "...",
        "estimatedMonthlyCost": {
          "amount": 289.73,
          "currency": "USD",
          "basis": "On-Demand, 730h/mo, us-east-1, 1x instance",
          "confidence": "high | medium | low",
          "source": "file.pdf",
          "period": "monthly | per_run"
        },
        "citations": [
          {
            "source": "file.pdf",
            "locator": "p.4"
          }
        ],
        "depth": "deep | overview",
        "gpuDetail": {
          "instance": {
            "name": "g6.xlarge",
            "gpu": "...",
            "gpuMem": "...",
            "vcpu": "...",
            "ram": "...",
            "region": "us-east-1"
          },
          "confidenceMatrix": {
            "hardware": {
              "rating": "high | medium | low",
              "note": "..."
            },
            "cost": {
              "rating": "high | medium | low",
              "note": "..."
            },
            "performance": {
              "rating": "high | medium | low",
              "note": "..."
            },
            "migration": {
              "rating": "high | medium | low",
              "note": "..."
            }
          },
          "candidates": [
            {
              "name": "g6.xlarge",
              "tag": "...",
              "gpu": "...",
              "gpuMem": "...",
              "vcpu": "...",
              "ram": "...",
              "fit": "...",
              "region": "us-east-1",
              "availability": "...",
              "pricing": [
                {
                  "label": "On-Demand",
                  "monthly": 289.73,
                  "hourly": 0.8,
                  "currency": "USD"
                }
              ]
            }
          ],
          "bedrock": {
            "status": "applicable | not_applicable | partial",
            "reason": "..."
          },
          "costComparison": {
            "sourceCloud": {
              "name": "g6.xlarge",
              "monthly": 289.73,
              "currency": "USD"
            },
            "options": [
              {
                "label": "On-Demand",
                "monthly": 289.73,
                "currency": "USD",
                "lowest": true
              }
            ],
            "savingsPct": 63.8,
            "provenance": "..."
          },
          "summary": "..."
        }
      }
    ],
    "proposalSections": [
      {
        "id": "req_1",
        "title": "...",
        "content": "...",
        "status": "drafted | needs_review | reviewed"
      }
    ],
    "answer": "...",
    "followups": [
      "..."
    ]
  },
  "activity": [
    {
      "ts": "ISO-8601",
      "label": "On-Demand",
      "message": "..."
    }
  ]
}
```

<!-- END AUTO-GENERATED:envelope-sample -->

## Rules that MUST hold

- Populate only the artifacts relevant to `resultType`; others may be empty
  arrays or `""`.
- Every `recommendations[].requirementId` MUST reference an existing
  `requirements[].id` in the same envelope.
- `status: "applied"` is allowed ONLY when `confidence: "high"`; otherwise use
  `on_hold`.
- Any `on_hold` recommendation MUST have a non-empty `onHoldReason`.
- Any `needs_info` requirement MUST have a non-empty `missing`.
- Cite the source for every requirement and recommendation (an input document /
  questionnaire / note, or a specialist you consulted).
- Use the 7R `strategy` enum exactly. Cost/impact in `impact` is directional,
  never a priced quote.
- Set each recommendation's `depth`: `deep` for GPU / AI-ML workloads (the
  dedicated, fully-analyzed section — with gpu-advisor sizing/cost folded in and
  usually an `estimatedMonthlyCost`), or `overview` for every other AWS service
  (a high-level mapping — service + 7R + a short rationale, no deep sizing, no
  cost estimate). Every GPU / AI-ML recommendation MUST be `deep`. If omitted it
  defaults to `overview`.
- `estimatedMonthlyCost` is OPTIONAL and for charting. Include it ONLY when you
  have a defensible monthly figure grounded in a real source — a number from the
  aws-pricing tool or a specialist you consulted (gpu-advisor). When you include
  it, ALL of amount (number), currency, basis (what it assumes, e.g. "On-Demand,
  730h/mo, us-east-1, 1x instance"), confidence, and source are required, and
  `source` names where the figure came from. If you do NOT have a grounded
  number, OMIT the field entirely and keep the directional wording in `impact`
  — never invent or guess a figure to fill it. Set `period` to `per_run` when
  the figure is per execution (e.g. a training run priced per representative
  run) rather than a recurring monthly cost; omit it (or use `monthly`) for
  ongoing monthly spend. This keeps per-run and monthly costs from being
  compared against each other.
- `gpuDetail` is OPTIONAL and applies ONLY to a `depth: "deep"` GPU / AI-ML
  recommendation. When you consulted the gpu-advisor specialist, FOLD its
  findings into `gpuDetail` so the UI can render the full advisor experience
  instead of a flat card. Map the specialist's report into: `instance` (the
  single recommended AWS GPU instance + its GPU/mem/vCPU/RAM/region for the hero
  card); `summary` (a one/two-sentence plain-English recommendation);
  `confidenceMatrix` with the FOUR independent dimensions — `hardware`, `cost`,
  `performance`, `migration` — each a `{ rating, note }` where the note carries
  the qualifier the advisor gives (e.g. "Benchmark required",
  "Validation required") and is `""` when none; `candidates` (the ranked
  shortlist, typically up to 3, each with specs, a `fit` sentence, `region`,
  `availability` like "verify quota / capacity", an optional `tag` such as
  "Direct equivalent"/"Cost-optimized", and grounded `pricing` tiers);
  `bedrock` (`status` = applicable | not_applicable | partial, with the `reason`
  — Bedrock is inference-only and evaluated separately); and `costComparison`
  (the current source-cloud `sourceCloud` baseline, the AWS `options` to compare
  with the cheapest marked `lowest:true`, the `savingsPct`, and a `provenance`
  note stating how each figure was derived and its source). GROUNDED-ONLY: every
  spec, price, availability and baseline MUST come from a real source
  (aws-pricing / aws-documentation / cloud-cost, or the specialist's report).
  OMIT any sub-object or field you cannot ground — never invent instances,
  numbers, benchmarks or availability to fill it. Do NOT populate `gpuDetail`
  for `overview` recs. This is IN ADDITION to `estimatedMonthlyCost`, which
  stays the single headline monthly figure used for the summary charts.
- Enums must match exactly (lowercase where shown). No extra fields.

## resultType guidance

- A full analysis run → `analysis` (or `mixed` if you also drafted proposal
  sections).
- A proposal draft/refine run → `proposal`.
- A chat/interrogation turn → `answer` (put the reply in `artifacts.answer`;
  leave requirements/recommendations untouched unless explicitly asked to
  change them).
