-- 001_init.sql — initial schema for the AWS Pre-Sales AI Platform (v1).
--
-- Derived from docs/agent-envelope.schema.json and architecture-v1.md section 5.
-- Design decisions (research-backed, see task #3 notes):
--   * Normalize entities we query/filter/join (engagements, requirements,
--     recommendations, proposal sections, users) into typed columns with
--     B-tree indexes.
--   * Use JSONB (not json) only for read-as-a-blob values: citations, and a
--     raw-envelope archive for audit/repair.
--   * Constrained fields use CHECK constraints mirroring the envelope enums
--     (status, confidence, 7R strategy) — the DB is the last line of the
--     "shape" contract before data is trusted.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ── Identity ────────────────────────────────────────────────────────────────
-- Stub auth in v1 (seeded users / simple login); real SSO later. Identity is
-- modeled from day one so ownership/collaboration never needs a retrofit.
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'consultant',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Engagements ───────────────────────────────────────────────────────────
CREATE TABLE engagements (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  client_name      TEXT NOT NULL,
  engagement_type  TEXT NOT NULL,   -- e.g. azure-to-aws-migration
  stage            TEXT NOT NULL DEFAULT 'discovery'
                     CHECK (stage IN ('discovery','analysis','recommendations','proposal','sent','closed')),
  owner_id         UUID NOT NULL REFERENCES users(id),
  agent_session_id TEXT,            -- the agent's ACP session for continuity
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_engagements_owner ON engagements(owner_id);
CREATE INDEX idx_engagements_stage ON engagements(stage);

CREATE TABLE engagement_collaborators (
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (engagement_id, user_id)
);

-- ── Inputs ────────────────────────────────────────────────────────────────
CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  s3_key        TEXT NOT NULL,          -- raw object in object storage
  text_s3_key   TEXT,                   -- extracted-text sidecar, if any
  mime          TEXT,
  status        TEXT NOT NULL DEFAULT 'processing'
                  CHECK (status IN ('processing','processed','failed')),
  added_by      UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_engagement ON documents(engagement_id);

CREATE TABLE questionnaire_answers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,
  answer        TEXT,
  updated_by    UUID REFERENCES users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_questionnaire_engagement ON questionnaire_answers(engagement_id);

CREATE TABLE notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notes_engagement ON notes(engagement_id);

-- ── Agent artifacts (mirror the envelope) ────────────────────────────────
CREATE TABLE requirements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  external_id     TEXT,                 -- the envelope's req_N id (for rec linkage)
  category        TEXT NOT NULL,
  text            TEXT NOT NULL,
  status          TEXT NOT NULL
                    CHECK (status IN ('sufficient','needs_info')),
  missing         TEXT,
  citations       JSONB NOT NULL DEFAULT '[]',   -- [{source, locator}]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_requirements_engagement ON requirements(engagement_id);
CREATE INDEX idx_requirements_status ON requirements(status);

CREATE TABLE recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id   UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  external_id     TEXT,
  requirement_id  UUID REFERENCES requirements(id) ON DELETE SET NULL,
  from_service    TEXT,
  aws_service     TEXT NOT NULL,
  strategy        TEXT NOT NULL
                    CHECK (strategy IN ('rehost','replatform','repurchase','refactor','retire','retain','relocate')),
  confidence      TEXT NOT NULL
                    CHECK (confidence IN ('high','medium','low')),
  status          TEXT NOT NULL
                    CHECK (status IN ('applied','on_hold','override')),
  on_hold_reason  TEXT,
  rationale       TEXT NOT NULL,
  impact          TEXT,
  citations       JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Semantic rule from 4.1: an applied recommendation must be high confidence;
  -- an on_hold one must state a reason. The DB enforces the truth layer.
  CONSTRAINT applied_requires_high_confidence
    CHECK (status <> 'applied' OR confidence = 'high'),
  CONSTRAINT on_hold_requires_reason
    CHECK (status <> 'on_hold' OR (on_hold_reason IS NOT NULL AND on_hold_reason <> ''))
);
CREATE INDEX idx_recommendations_engagement ON recommendations(engagement_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);

-- ── Proposal (versioned; one human approval) ──────────────────────────────
CREATE TABLE proposal_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at   TIMESTAMPTZ,
  approved_by   UUID REFERENCES users(id),
  UNIQUE (engagement_id, version)
);
CREATE INDEX idx_proposal_versions_engagement ON proposal_versions(engagement_id);

CREATE TABLE proposal_sections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_version_id UUID NOT NULL REFERENCES proposal_versions(id) ON DELETE CASCADE,
  external_id         TEXT,
  title               TEXT NOT NULL,
  content             TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'drafted'
                        CHECK (status IN ('drafted','needs_review','reviewed')),
  sort_order          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_proposal_sections_version ON proposal_sections(proposal_version_id);

-- ── Agent activity timeline (the "conversation") ──────────────────────────
CREATE TABLE agent_activity (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  run_id         TEXT,                  -- correlates with the agent run
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  phase          TEXT NOT NULL
                   CHECK (phase IN ('goal','gather','analyze','reason','report','draft','answer')),
  message        TEXT NOT NULL,
  instruction    TEXT,                  -- the instruction that triggered this run
  agent_session_id TEXT
);
CREATE INDEX idx_agent_activity_engagement ON agent_activity(engagement_id);

-- ── Raw envelope archive (audit + repair; read-as-blob -> JSONB) ──────────
CREATE TABLE agent_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id  UUID NOT NULL REFERENCES engagements(id) ON DELETE CASCADE,
  run_id         TEXT NOT NULL,
  result_type    TEXT,
  envelope       JSONB,                 -- the full validated envelope, as returned
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_runs_engagement ON agent_runs(engagement_id);

COMMIT;
