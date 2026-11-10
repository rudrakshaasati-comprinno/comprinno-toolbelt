-- 009_recommendation_depth.sql — analysis depth for the GPU-focused split.
--
-- Recommendations gain an optional `depth` marking how deeply the item was
-- analyzed, so the UI can render a dedicated, deeply-analyzed GPU section vs. a
-- high-level overview of the other AWS services (envelope
-- recommendations[].depth):
--   'deep'     — GPU / AI-ML workloads, sized/priced via the gpu-advisor
--                specialist (the focus section).
--   'overview' — every other AWS service, a high-level mapping (service + 7R +
--                short rationale, no deep sizing/cost).
--
-- Nullable with a default of 'overview', so existing rows and runs that omit
-- the field stay valid and are treated as high-level overviews.

BEGIN;

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS depth TEXT NOT NULL DEFAULT 'overview';

COMMIT;
