# Compute Savings Plans

GPU commitment pricing is always compared using **Compute Savings Plans** — never
Reserved Instances. Rates come from the AWS `savingsplans` API
(`describe-savings-plans-offering-rates`), never estimated.

## The six variants (always show the full matrix)

| Term | Payment |
|------|---------|
| 1 year | No Upfront |
| 1 year | Partial Upfront |
| 1 year | All Upfront |
| 3 years | No Upfront |
| 3 years | Partial Upfront |
| 3 years | All Upfront |

For each, report the effective $/hr (amortizing any upfront) and the monthly cost.

## The 730h basis note (§20)

Monthly figures in the SP table are computed at **730 hrs/mo** (AWS standard full
month). When the customer's utilization differs (e.g. 500 hrs/mo):
- State that the SP table is at 730h.
- Use the customer's actual hours for the authoritative cost comparison.
- Never present the 730h figure as their expected monthly cost when utilization
  is lower.

## Rules

- Show SP figures ONLY when actually retrieved. If retrieval fails (e.g. expired
  credentials), state "Savings Plan pricing not retrieved; final AWS TCO cannot
  yet be determined" (§8) — do not guess a discount %.
- Effective hourly amortizes upfront; monthly = effective hourly × hours.
- Never substitute a Reserved Instance rate as a proxy for a Savings Plan.
- The cheapest overall AWS option is often 3yr All-Upfront — but present it as one
  point on the full matrix so the customer sees the commitment/flexibility tradeoff.
