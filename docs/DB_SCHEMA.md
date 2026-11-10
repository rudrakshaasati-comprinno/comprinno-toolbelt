# Database Schema (as-built)

The real Postgres schema, read from the running database — 16 tables built by
migrations `001`–`010` (`backend/src/db/migrations/`), applied on backend boot
by `db/migrate.js`. This supersedes the earlier schema sketch in
[`architecture-v1.md §5`](./architecture-v1.md), which predates several columns.

Conventions: all primary keys are `uuid` defaulting to `gen_random_uuid()`
(except the two reference tables, which use text ids); all timestamps are
`timestamptz` defaulting to `now()`; everything under an engagement cascades on
delete.

---

## Design principles visible in the schema

- **The truth layer is enforced in the DB, not just app code.** CHECK
  constraints encode the product's confidence-gating rules (see
  `recommendations` below), so an invalid row cannot be persisted even if the
  agent or a code path tries.
- **Referential integrity with intentional cascade semantics.** Engagement
  children are `ON DELETE CASCADE`; a recommendation's requirement link is
  `ON DELETE SET NULL` (a rec survives re-analysis that drops its requirement);
  user references are `RESTRICT` (a referenced user can't be deleted).
- **Hybrid storage.** Structured/queryable/gated data is relational; JSONB holds
  semi-structured blobs (`citations`, `estimated_cost`, `gpu_detail`, the raw
  `envelope`); large binaries live in S3, referenced here by key.
- **Indexed for the real query paths** — engagement foreign keys, the gated
  `status`/`decision` filters, and ordered chat history.

---

## Identity & access

### `users`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| email | text | **unique**, not null |
| name | text | not null |
| role | text | not null, default `consultant` |
| created_at | timestamptz | |

Referenced by nearly every table (owner, added_by, created_by, decided_by,
approved_by, updated_by). v1 uses stub auth; identity is modeled from day one.

### `engagements`
The first-class entity everything hangs off.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name, client_name, engagement_type | text | not null |
| stage | text | not null, default `discovery` |
| owner_id | uuid → users | not null |
| agent_session_id | text | current ACP session (nullable) |
| use_case, goal | text | nullable (set on Overview) |
| analysis_completed_at / _by | timestamptz / uuid → users | analysis gate |
| recommendations_finalized_at / _by | timestamptz / uuid → users | recs gate |
| recommendations_snapshot_key | text | S3 key of a finalized snapshot |
| created_at, updated_at | timestamptz | |

- **CHECK** `stage ∈ {discovery, analysis, recommendations, proposal, sent, closed}`
- **Indexes:** `owner_id`, `stage`
- **FKs:** `owner_id`, `analysis_completed_by`, `recommendations_finalized_by` → `users`

### `engagement_collaborators`
Many-to-many share list. PK `(engagement_id, user_id)`; both FKs
`ON DELETE CASCADE`. (Empty in v1 — the collaboration UI isn't exercised yet.)

---

## Inputs

### `documents`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| engagement_id | uuid → engagements (CASCADE) | not null |
| name | text | not null |
| s3_key | text | not null — raw upload |
| text_s3_key | text | nullable — extracted `.txt` sidecar |
| mime | text | |
| status | text | not null, default `processing` |
| kind | text | not null, default `source` |
| added_by | uuid → users | |
| created_at | timestamptz | |

- **CHECK** `status ∈ {processing, processed, failed}`, `kind ∈ {source, meeting_mom, questionnaire}`
- **Index:** `engagement_id`

### `notes`
`id, engagement_id (CASCADE), text, created_by → users, created_at, kind`.
CHECK `kind ∈ {note, meeting_mom}`; index on `engagement_id`.

### `questionnaire_answers`
`id, engagement_id (CASCADE), question, answer, updated_by → users, updated_at`.
Index on `engagement_id`.

---

## Agent artifacts (mirror the AgentEnvelope)

### `requirements`
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| engagement_id | uuid → engagements (CASCADE) | not null |
| external_id | text | the envelope's `req_N` id |
| category, text, status | text | not null |
| missing | text | nullable (why needs_info) |
| citations | jsonb | not null, default `[]` |
| created_at | timestamptz | |

- **CHECK** `status ∈ {sufficient, needs_info}`
- **Indexes:** `engagement_id`, `status`
- Referenced by `recommendations.requirement_id` (**ON DELETE SET NULL**)

### `recommendations`
The richest table — carries the confidence-gating truth layer and the
GPU-focused fields.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| engagement_id | uuid → engagements (CASCADE) | not null |
| external_id | text | the envelope's `rec_N` id |
| requirement_id | uuid → requirements (SET NULL) | nullable |
| from_service | text | current-state service |
| aws_service | text | not null |
| strategy | text | not null — 7R |
| confidence | text | not null |
| status | text | not null |
| on_hold_reason | text | required when on_hold (CHECK) |
| rationale | text | not null |
| impact | text | directional, nullable |
| decision | text | not null, default `pending` — human accept/reject |
| decision_reason, decided_by → users, decided_at | | the decision record |
| citations | jsonb | not null, default `[]` |
| estimated_cost | jsonb | nullable — grounded monthly estimate (008) |
| depth | text | not null, default `overview` (009) |
| gpu_detail | jsonb | nullable — rich GPU-Advisor block (010) |
| created_at | timestamptz | |

- **CHECK (the truth layer):**
  - `applied_requires_high_confidence` — `status <> 'applied' OR confidence = 'high'`
  - `on_hold_requires_reason` — on_hold ⇒ non-empty `on_hold_reason`
  - `strategy ∈ {rehost, replatform, repurchase, refactor, retire, retain, relocate}`
  - `confidence ∈ {high, medium, low}`
  - `status ∈ {applied, on_hold, override}`
  - `decision ∈ {pending, accepted, rejected}`
- **Indexes:** `engagement_id`, `status`, `(engagement_id, decision)`
- `estimated_cost`, `depth`, `gpu_detail` all reach the frontend via `SELECT *`.

### `proposal_versions`
`id, engagement_id (CASCADE), version int, created_by → users, created_at,
approved_at, approved_by → users`. **Unique** `(engagement_id, version)`; index
on `engagement_id`. `approved_at` is the single human approval gate.

### `proposal_sections`
`id, proposal_version_id → proposal_versions (CASCADE), external_id, title,
content, status, sort_order int, created_at`. CHECK
`status ∈ {drafted, needs_review, reviewed}`; index on `proposal_version_id`.

---

## Agent runtime

### `agent_activity`
The activity timeline. `id, engagement_id (CASCADE), run_id, ts, label, message,
instruction, agent_session_id`. Index on `engagement_id`. (`label` added in 006.)

### `agent_runs`
Per-run audit record. `id, engagement_id (CASCADE), run_id (not null),
result_type, envelope jsonb, created_at`. Index on `engagement_id`. The raw
envelope is kept here for audit; it is unbounded-growth and a candidate for a
retention/archival policy later.

### `chat_messages`
Exploration turns on top of analysis. `id, engagement_id (CASCADE), role,
content, run_id, created_by → users, created_at`. CHECK
`role ∈ {user, assistant}`; index `(engagement_id, created_at)` for ordered
history.

---

## Reference / seed data

### `engagement_types`
`id text PK, label, sort_order`. Drives the new-engagement type dropdown.

### `questionnaire_templates`
`id text PK, engagement_type → engagement_types (CASCADE), question,
sort_order`. Per-type default discovery questions. Index on `engagement_type`.

---

## Meta

### `schema_migrations`
`filename, applied_at` — the migration tracker written by `db/migrate.js`.
Migrations `001`–`010` applied.

---

## Migration history

| # | File | Adds |
|---|---|---|
| 001 | init | users, engagements, artifacts, proposals, activity, base schema |
| 002 | engagement_inputs | documents, notes, questionnaire_answers |
| 003 | reference_data | engagement_types + questionnaire_templates (seeded) |
| 004 | gated_flow | stage gating; analysis/recommendations finalize columns; snapshot key |
| 005 | chat_messages | chat_messages table |
| 006 | activity_label | agent_activity.label |
| 007 | recommendations_finalize | recommendations decision columns (decision/reason/by/at) |
| 008 | recommendation_cost | recommendations.estimated_cost jsonb |
| 009 | recommendation_depth | recommendations.depth (deep/overview) |
| 010 | recommendation_gpu_detail | recommendations.gpu_detail jsonb |

Migrations are additive and idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE …
IF NOT EXISTS`) and run on backend boot. There are currently no down/rollback
migrations — a recommended SDLC hardening (see PROJECT_GUIDE conventions).

---

## Regenerating this doc

This was captured from the live DB. To refresh it against a running stack:

```bash
docker compose \
  exec -T postgres psql -U presales -d presales -c "\d+ <table>"
```

(or `pg_dump --schema-only` for the full DDL).
