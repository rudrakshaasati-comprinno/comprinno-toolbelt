-- 004_gated_flow.sql — stage-gated review flow (Phase 4A).
--
-- The engagement progresses through gated stages:
--   Analysis  -> (mark complete) -> Recommendations -> (all decided) -> Proposal
--
-- Two pieces of state are added:
--   1. A HUMAN DECISION on each recommendation (accept/reject), kept SEPARATE
--      from the agent's `status` (applied/on_hold/override). `status` reflects
--      the agent's confidence-gated view; `decision` reflects the consultant's
--      choice. The proposal is built from ACCEPTED recommendations.
--   2. An analysis-complete gate on the engagement: the timestamp/actor of when
--      the consultant marked analysis done, which unlocks the Recommendations
--      stage. Null = analysis not yet marked complete.

BEGIN;

-- 1. Human decision on each recommendation.
ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS decision TEXT NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'accepted', 'rejected')),
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_recommendations_decision
  ON recommendations(engagement_id, decision);

-- 2. Analysis-complete gate on the engagement.
ALTER TABLE engagements
  ADD COLUMN IF NOT EXISTS analysis_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS analysis_completed_by UUID REFERENCES users(id);

COMMIT;
