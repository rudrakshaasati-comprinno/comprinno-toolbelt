-- 007_recommendations_finalize.sql — Recommendations stage v2 (chat-refine +
-- finalize-to-S3). The per-item accept/reject gate is replaced by a
-- collaborative chat-refinement stage that ends with an explicit "Finalize
-- recommendations" action. Finalizing writes an immutable JSON snapshot of the
-- recommendations to S3 and records the gate here.
--
-- The proposal stage now unlocks on recommendations_finalized_at (not on the
-- old allDecided decision gate). The decision columns from 004 remain in place
-- (harmless) but are no longer used by the UI.

BEGIN;

ALTER TABLE engagements
  ADD COLUMN IF NOT EXISTS recommendations_finalized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recommendations_finalized_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS recommendations_snapshot_key TEXT;  -- S3 key of the finalized snapshot

COMMIT;
