-- 008_recommendation_cost.sql — structured cost estimate for charting.
--
-- Recommendations gain an optional estimated_cost JSONB column holding the
-- structured monthly cost ESTIMATE the agent emits (envelope
-- recommendations[].estimatedMonthlyCost): { amount, currency, basis,
-- confidence, source }. It is populated ONLY when a defensible figure was
-- grounded in a real source (e.g. the aws-pricing MCP); otherwise it stays
-- NULL and the directional text in `impact` is used instead. This enables
-- cost-comparison charts in the recommendations chatbot without turning a
-- directional estimate into a firm quote (the UI labels it an estimate).
--
-- Nullable + no default, so existing rows and runs that omit it stay valid.

BEGIN;

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS estimated_cost JSONB;

COMMIT;
