-- 010_recommendation_gpu_detail.sql — rich GPU/AI-ML detail for the deep section.
--
-- Deep GPU recommendations gain an optional gpu_detail JSONB column holding the
-- structured GPU-advisor findings the agent folds into the envelope
-- (recommendations[].gpuDetail): the recommended instance + specs, a
-- four-dimension confidence matrix (hardware / cost / performance / migration),
-- a ranked candidate-instance shortlist with grounded pricing, the Bedrock
-- verdict, and a current-vs-AWS cost comparison. It is populated ONLY for
-- depth:'deep' recs and ONLY with grounded figures; otherwise it stays NULL and
-- the flat card is shown. This lets the frontend render the full GPU-Advisor
-- experience without inventing data.
--
-- Nullable + no default, so existing rows and runs that omit it stay valid.

BEGIN;

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS gpu_detail JSONB;

COMMIT;
