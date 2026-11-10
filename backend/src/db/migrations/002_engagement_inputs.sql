-- 002_engagement_inputs.sql — capture use-case, goal, and document kind.
--
-- New Engagement now captures a mandatory use-case description and a mandatory
-- analysis goal/target up front (they flow into every agent run as context).
-- Documents gain a `kind` so meeting MoM vs source docs are distinguishable.

BEGIN;

ALTER TABLE engagements
  ADD COLUMN IF NOT EXISTS use_case TEXT,
  ADD COLUMN IF NOT EXISTS goal     TEXT;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'source'
    CHECK (kind IN ('source', 'meeting_mom', 'questionnaire'));

COMMIT;
