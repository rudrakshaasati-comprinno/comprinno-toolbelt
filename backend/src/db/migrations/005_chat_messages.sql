-- 005_chat_messages.sql — persist the engagement chat conversation (Phase 3).
--
-- The analyst is a persistent per-engagement ACP session (Phase 2). Chat turns
-- (a question + the assistant's answer) are exploration on top of the analysis,
-- distinct from the analysis artifacts. We store them so the conversation
-- survives page reloads and the consultant can see the history.
--
-- role: 'user' (the consultant's message) or 'assistant' (the analyst's reply).
-- run_id correlates an assistant turn with the agent run that produced it.

BEGIN;

CREATE TABLE chat_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  role           TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content        TEXT NOT NULL,
  run_id         TEXT,
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_messages_engagement ON chat_messages(engagement_id, created_at);

COMMIT;
