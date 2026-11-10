# AWS Pre-Sales AI Platform — v1 Architecture

> Status: draft for review. This is a planning document, not implemented code.
> It captures the decisions taken during design discussion and the contracts
> that must be agreed before implementation begins.

## 1. Scope (v1)

A multi-user web app for AWS pre-sales consultants to run client engagements
from discovery to an approved, exportable proposal. v1 covers the **pre-sales /
assessment slice** only (discovery -> analysis -> recommendations -> proposal ->
export), not migration execution.

**In v1**
- Dashboard (portfolio of engagements)
- New engagement (modal)
- Inputs & discovery (documents, questionnaire, notes, agent clarifying questions)
- AI analysis (requirements: sufficient vs needs-info, with citations)
- AWS recommendations (confidence-scored, 7R strategy, applied/on-hold/override)
- Proposal draft & export (single human approval gate)
- Agent workspace (goal / plan / activity timeline + directed instruction)
- Team & access (owner + collaborators; ownership transfer)
- Settings (minimal: org defaults, stub auth)

**Deferred to v2**
- Knowledge Base (agents are already grounded via skills/steering/knowledge)
- Real SSO (v1 stubs single-org auth)
- Proposal version history UI, live diagram editing, multi-format export
- Notifications, digests, battlecards
- Migration-execution features (landing zone, waves, cutover)

## 2. Agentic contract (the product's core behavior)

1. **Autonomous, directed, not turn-by-turn chat.** The consultant tells the
   agent *what* to do; the agent decides *how*. Interaction is a directed
   instruction box whose exchanges land on the activity timeline — not a
   separate chat thread.
2. **Confidence-gated autonomy.** High-confidence work is applied
   automatically; low-confidence or missing-info items go **on hold** with a
   stated reason. Anything applied is overridable.
3. **One human approval**, on the proposal. Nothing reaches the client before it.
4. **Everything cited** back to a source (engagement inputs in v1).
5. **Grounding lives in the agent** (skills/steering/knowledge), including the
   7 Rs, the AWS Cloud Value Framework (CVF) pillars, and Azure->AWS mapping
   guidance — not a user-facing Knowledge Base.

## 3. Architecture

Three containers + Postgres + object storage.

```
Frontend  <--SSE/HTTP-->  Backend service  <--HTTP/SSE-->  Agent microservice
(web UI)                  (Node/Express)                   (kiro-cli acp +
                          owns: frontend API, engagements,  orchestrator)
                          auth, DB, S3, agent orchestration  single /agent endpoint
                             |            |
                          Postgres     MinIO (S3-compatible)
```

### Responsibilities

**Frontend container** — the 8 screens. Talks *only* to the backend.

**Backend service** — the only thing the frontend talks to. Owns:
- Frontend REST + SSE.
- Domain model: engagements, users, artifacts, proposal versions, access.
- Persistence: Postgres (domain) + S3/MinIO (documents, generated artifacts).
- Agent orchestration: builds inputs from DB/S3, calls the agent, persists the
  returned envelope, relays progress to the frontend.
- Auth / ownership / access control.

**Agent microservice** — a **single endpoint** `POST /agent`. Wraps
`kiro-cli acp` + the orchestrator bundle. Interprets the `instruction`, runs the
work, streams activity, returns a self-describing structured envelope.
**Domain-agnostic**: `engagementId` is an opaque correlation id; the agent never
touches the DB or S3. ACP transcripts are its own re-derivable working memory;
the backend DB is the source of truth.

### Key decisions

| Decision | Choice |
|----------|--------|
| Backend <-> agent transport | HTTP + SSE |
| Agent API surface | single `POST /agent`, behavior driven by `instruction` |
| Inputs to agent | backend passes **extracted content** (not S3 URLs) |
| Agent domain knowledge | none; correlation id only |
| Source of truth | backend Postgres (agent ACP state is disposable) |
| Database | Postgres |
| Object storage | MinIO (S3-compatible) in v1 -> real S3 later via config |
| Agent brain | reuse existing orchestrator bundle as the instruction router |
| Auth | stub single-org in v1; model identity in schema from day one |

## 4. The agent contract (`POST /agent`)

### Request

```jsonc
{
  "engagementId": "eng_123",      // opaque correlation id
  "sessionId": "acp_abc",         // continue an ACP session, or null to start
  "instruction": "Analyze these documents and extract requirements",
  "inputs": {
    "engagementType": "azure-to-aws-migration",
    "documents": [
      { "id": "doc_1", "name": "Current-State-Architecture.pdf", "text": "..." }
    ],
    "questionnaire": [
      { "q": "Which Azure services are in use?", "a": "App Service, SQL DB, Blob" }
    ],
    "notes": [
      "Treat the Q3 contract renewal as a hard migration deadline."
    ],
    "priorArtifacts": {
      "requirements": [ /* previously produced, for re-analysis/refinement */ ],
      "recommendations": [ /* ... */ ]
    }
  }
}
```

### Response: streamed events (SSE), then a final envelope

Streamed during the run (drives the activity timeline):
- `plan`     — `{ goal, steps: [ ... ] }`
- `activity` — `{ ts, phase, message }`
- `result`   — the final envelope (below), sent once at the end
- `error`    — `{ message }`

### Output envelope (the linchpin contract)

Self-describing: `resultType` tells the backend what was produced so it can
persist correctly. `artifacts` carries only the relevant sections.

```jsonc
{
  "sessionId": "acp_abc",
  "resultType": "analysis" | "recommendations" | "proposal" | "answer" | "mixed",
  "artifacts": {
    "requirements": [
      {
        "id": "req_1",
        "category": "COMPUTE & HOSTING",
        "text": "Customer portal runs on Azure App Service, autoscaling disabled.",
        "status": "sufficient" | "needs_info",
        "missing": "Protocol unknown — recommendation on hold until provided.",
        "citations": [
          { "source": "Current-State-Architecture.pdf", "locator": "p.2" },
          { "source": "Questionnaire", "locator": "Q1" }
        ]
      }
    ],
    "recommendations": [
      {
        "id": "rec_1",
        "requirementId": "req_1",
        "from": "Azure App Service",
        "awsService": "AWS Elastic Beanstalk + Application Auto Scaling",
        "strategy": "replatform",          // 7R: rehost|replatform|repurchase|refactor|retire|retain|relocate
        "confidence": "high" | "medium" | "low",
        "status": "applied" | "on_hold" | "override",
        "onHoldReason": "ERP integration protocol not confirmed.",
        "rationale": "Closest managed match; adds the autoscaling requested.",
        "impact": "Directional: lower off-peak compute spend. Not a priced quote.",
        "citations": [ { "source": "...", "locator": "..." } ]
      }
    ],
    "proposalSections": [
      {
        "id": "sec_exec",
        "title": "Executive summary",
        "content": "...",                   // markdown
        "status": "drafted" | "needs_review" | "reviewed"
      }
    ],
    "answer": "..."                          // for interrogation-style instructions
  },
  "activity": [
    { "ts": "...", "phase": "gather", "message": "Read 3 documents; extracted 12 requirements." }
  ]
}
```

**Notes**
- Monetary/impact fields are **directional only** in v1 (consistent with AWS
  Migration Evaluator framing). No priced quotes.
- Every requirement/recommendation carries `citations` referencing the
  engagement's own inputs.
- `strategy` encodes the 7R migration strategy — the vocabulary of AWS pre-sales.

### 4.1 Reliability of the envelope (research-backed)

> **DECISION (implemented, 2026-09-24): Kiro-only. Bedrock is NOT used.** The
> Bedrock structured-output hybrid described below was evaluated and explicitly
> rejected for v1 (the team is not adopting Bedrock; the API-key path expires
> and testing uses interactive kiro-cli login). Because constrained decoding is
> therefore unavailable, envelope reliability is achieved WITHOUT Bedrock, by
> three cooperating means, now implemented in `agent/src/runner.js`:
> 1. **A strict prompt output contract** — the model is instructed to return a
>    single fenced ```json envelope with all fields and enums spelled out.
> 2. **Tolerant extraction** — `extractEnvelopeFromText` scans fenced blocks
>    (and, as a last resort, the widest brace span) and accepts the first that
>    parses into an envelope-shaped object, so prose around the block is fine.
> 3. **A repair loop** — on schema-validation failure the SAME ACP session is
>    re-prompted with the specific validator errors, capped at 2 retries; if
>    still invalid, the run falls back to a plain `answer` envelope with the
>    degradation surfaced in the activity timeline (never a dead screen).
>
> The **semantic/business rules** below (referential integrity, applied=>high
> confidence, on_hold=>reason, needs_info=>missing) are implemented in the
> BACKEND at `backend/src/agent/semanticValidation.js`, run before persistence
> in `orchestrate.js`, and surfaced as an advisory `semantic_warning` event
> (the real truth gate remains confidence-gating + the single human proposal
> approval). The subsection below is retained for historical context on why
> constrained decoding is the ideal when a compatible model host is available.


Research (AWS Bedrock structured outputs, Feb 2026; "Function-Calling vs
Structured Outputs for Agent Design in 2026") converges on a clear pattern.

**Use structured outputs (constrained decoding) to guarantee the envelope
shape.** As of early 2026, Amazon Bedrock enforces JSON Schema at the sampling
level via constrained decoding (compiled grammar, cached 24h) for Anthropic,
OpenAI, Google and others. Because the agent is AWS-centric, the agent service
should emit the envelope via Bedrock's `json_schema` output format (Converse /
ConverseStream) so the envelope parses by construction — no regex, no fallback
parsing. Internally the agent still uses tool calling (the ACP/orchestrator loop
reading docs, observing state); the FINAL envelope is a structured output. This
is the recommended 2026 "hybrid": structured plan -> tool calls -> structured
verification -> render.

**Schema rules this forces on the envelope (mandatory):**
- `additionalProperties: false` on every object (required, or Bedrock rejects
  the schema).
- Descriptive field names + `description` on each field (the model uses them).
- `enum` for constrained fields — `status`, `confidence`, and `strategy` (7R)
  must be enums; this measurably improves accuracy.
- Avoid unsupported JSON Schema features: no recursive schemas, no external
  `$ref`, no numeric/length constraints (`minimum`, `maxLength`), `minItems`
  only 0 or 1.
- Reuse one stable schema (24h grammar cache = faster, cheaper). Changing only
  `name`/`description` does not invalidate the cache; changing structure does.
- Check `stopReason` on every response: a refusal or a `max_tokens` cutoff
  produces a non-conforming/truncated result — handle both explicitly.

**A schema guarantees shape, NOT truth.** Constrained decoding guarantees the
envelope parses; it does not guarantee the requirements/recommendations are
correct. So the backend keeps two more layers:
1. **Semantic validators in backend code** (business rules: e.g. a
   recommendation must reference an existing requirement; an `on_hold` item must
   carry an `onHoldReason`; `applied` requires `confidence: high`).
2. **Confidence-gating + one human approval** — the product's truth layer. Low
   confidence / missing info -> `on_hold`; nothing client-facing without the
   single proposal approval.

**Repair strategy:** on validation failure, regenerate only the failed fields
(field-wise), including the validator error, rather than re-running the whole
envelope. Cap retries (e.g. 2) and surface a clear error rather than looping.

### 4.2 Streaming & reliability design (research-backed)

Research ("The Streaming Infrastructure Behind Real-Time Agent UIs", 2026; and
the SSE-for-LLM consensus) identifies failure modes that have no working
defaults and fail *silently*. The agent microservice and the backend relay must
design for them explicitly.

**SSE is correct; signals go out-of-band.** Every major LLM API chose SSE over
WebSocket for progress/token delivery (proxy-friendly, stateless scaling, free
reconnection). Client-to-server signals (cancel, approve) use separate HTTP POST
endpoints, never the stream — this matches the existing `/approve` and
`/cancel` design.

**Layered event model (aligns with the AG-UI protocol).** The `POST /agent`
stream emits three layers so each consumer subscribes to what it needs:
- lifecycle: `run_started`, `run_finished`, `run_error`
- semantic: `plan`, `activity` (tool_called / tool_result equivalents)
- result: the final `result` envelope

**Decouple "agent is working" from "someone is watching" (three-tier).** The
agent process writes events to a per-run buffer **regardless of whether a client
is connected**; the SSE endpoint is a *pure relay*. Mapped to our two services:
- The **agent microservice** runs the ACP work and emits events to a run buffer
  keyed by a `runId` (a UUID minted at run start — not a message id assigned at
  the end).
- The **backend** relays that buffer to the frontend over SSE and can replay it
  on reconnect (page refresh mid-run) via `Last-Event-ID`.
- Run lifecycle state: `pending -> ongoing -> complete`.

**Mandatory infrastructure guards:**
- `res.flushHeaders()` before the first chunk; set `X-Accel-Buffering: no`;
  send a heartbeat comment (`: heartbeat\n\n`) every ~30s to defeat proxy idle
  timeouts and buffering.
- **Backpressure**: honor `res.write()` returning `false` by awaiting the
  `drain` event before continuing — never buffer unboundedly.
- **Cancellation / disconnect**: on `req.on('close')`, forward an abort to the
  agent and cancel the in-flight ACP run so an abandoned request does not run
  forever burning credits. (This is the gap already noted in the current
  chat.js review.)
- **`stopReason` before parsing** (reinforces 4.1): a `max_tokens` cutoff or a
  refusal yields truncated/malformed output; validate before parsing, route to
  a recovery path, do not blindly `JSON.parse`.
- **Atomic persistence**: the backend writes an assistant turn and its artifacts
  in a single transaction so a crash never leaves an orphaned partial state.

**Instrument**: TTFT, stream completion rate (split abort vs error vs normal),
connection duration P99 (set infra timeouts above it), chunk-gap time, and
(once resumable) reconnection success rate. Log every stream lifecycle event
with a common `runId`.

## 5. Postgres schema (derived from the envelope)

```sql
-- identity (stub auth in v1, real SSO later)
users(id, email, name, role, created_at)

engagements(
  id, name, client_name, engagement_type, stage,
  owner_id -> users.id, created_at, updated_at
)
engagement_collaborators(engagement_id, user_id)   -- many-to-many

-- inputs
documents(
  id, engagement_id, name, s3_key, mime, status,      -- processing|processed
  added_by -> users.id, created_at
)
questionnaire_answers(id, engagement_id, question, answer, updated_by, updated_at)
notes(id, engagement_id, text, created_by, created_at)

-- agent artifacts (mirror the envelope)
requirements(
  id, engagement_id, category, text, status,           -- sufficient|needs_info
  missing, citations jsonb, created_at
)
recommendations(
  id, engagement_id, requirement_id -> requirements.id,
  from_service, aws_service, strategy, confidence, status,  -- applied|on_hold|override
  on_hold_reason, rationale, impact, citations jsonb, created_at
)
proposal_versions(id, engagement_id, version, created_by, created_at, approved_at, approved_by)
proposal_sections(
  id, proposal_version_id -> proposal_versions.id,
  title, content, status                               -- drafted|needs_review|reviewed
)

-- agent activity timeline (the "conversation")
agent_activity(
  id, engagement_id, ts, phase, message, instruction,  -- instruction that triggered it
  acp_session_id
)
```

## 6. S3 / MinIO layout

```
s3://presales/
  engagements/<engagementId>/
    sources/<docId>-<filename>          # uploaded documents (raw)
    sources/<docId>-<filename>.txt      # extracted text sidecar (xlsx/docx/pdf)
    proposals/<versionId>.pdf           # exported proposal artifacts
    proposals/<versionId>.docx
```

Backend owns the standing S3 credentials. The AGENT downloads an engagement's
source files itself using short-lived, engagement-scoped credentials the backend
mints per run (see 6.1) — it never holds the standing credentials and can only
reach the one engagement it was invoked for.

### 6.1 Engagement-scoped agent storage access (enforced isolation)

> **DECISION (implemented, 2026-09-24).** The agent accesses object storage
> directly and downloads the engagement's files itself; the backend no longer
> pre-extracts document text. Cross-engagement isolation is ENFORCED AT THE
> STORAGE LAYER, not by trusting the agent. Researched against AWS's multi-tenant
> guidance (the "token vending machine" pattern: per-tenant prefix + short-lived,
> scoped STS credentials); MinIO implements the same STS AssumeRole protocol, so
> the design ports to real S3 by configuration alone.

**Flow (per run):**
1. The backend calls MinIO STS `AssumeRole` (`backend/src/storage/sts.js`,
   `mintEngagementCredentials`) with an inline **session policy** that allows
   only `s3:GetObject` on `engagements/{id}/*` and `s3:ListBucket` restricted to
   that prefix (via an `s3:prefix` condition). No Put/Delete, no other prefix,
   no bucket-root listing. Duration 900s (the minimum).
2. The backend passes the resulting temporary `{accessKeyId, secretAccessKey,
   sessionToken, endpoint, bucket, prefix}` to the agent in the run payload's
   `storage` block (`orchestrate.js`). The agent never receives the backend's
   standing credentials.
3. The agent (`agent/src/storage.js`, `downloadEngagementFiles`) builds an S3
   client from those scoped creds, lists + downloads the prefix into a per-run
   temp dir, and the runner extracts text (`pdftotext` for PDFs — closing the
   earlier gap where PDF content never reached the agent). The temp dir is
   removed in a `finally`.
4. MinIO enforces the boundary: even a buggy or compromised agent asking for
   another engagement's key is denied, because the session policy does not grant
   it (MinIO effective permission = intersection of the caller's policy and the
   session policy — it can only narrow).

**Verified (2026-09-24), 5/5, against live MinIO with the real minting code:**
A's scoped creds read A's object; are AccessDenied on B's object; are
AccessDenied listing B's prefix; list A's prefix and see only A's object; are
AccessDenied listing the bucket root.

**Upgrade path to real AWS S3:** identical pattern — replace the MinIO STS
endpoint with AWS STS and the assuming user with a dedicated IAM role, or adopt
**S3 Access Grants** (purpose-built for exactly this prefix-scoped, credential-
vending model). No change to the agent-side download code. A longer-term
hardening is to vend from a least-privilege IAM role rather than the storage
admin identity.

### 6.2 Storage design decision: what lives in Postgres vs S3 (research-backed)

> **DECISION (documented 2026-09-25).** Structured, queryable artifacts live in
> Postgres; large unstructured files live in S3/MinIO. This is the canonical
> hybrid pattern ("store data in the database, store files in blob storage,
> reference files from the DB by key"), confirmed across ~20 sources.

| Artifact | Store | Rationale |
|---|---|---|
| Requirements (analysis) | **Postgres** (`requirements`) | Queried, filtered, and GATED on (stage transitions are SQL conditions); CHECK constraints enforce the truth layer; joins to engagement/user; changes on re-analysis. |
| Recommendations | **Postgres** (`recommendations`) | Same: queried, accept/reject decisions, `applied=>high confidence` CHECK, joins. |
| Proposal content | **Postgres** (`proposal_versions` / `proposal_sections`) | Structured, versioned, human-approved records. |
| Raw agent envelope | **Postgres** (`agent_runs.envelope` JSONB) | Small per-run audit record; kept transactional and co-located. Could move to S3 if it ever grows large/high-volume, but the size does not justify the split now. |
| Uploaded source documents + extracted text | **S3/MinIO** (`engagements/<id>/sources/...`) | Large unstructured binaries; wrong to put in SQL (bloats storage, slows queries, inflates backups). |
| **Exported** proposal PDF/DOCX | **S3/MinIO** (`engagements/<id>/proposals/<versionId>.pdf`) | The RENDERED document is a large binary — belongs in blob storage, not the DB. The `keys.proposal(...)` helper already provides for this; write exports to S3 when the export feature is built. |

**Rule:** structured/queryable/gated/audited data → database; large opaque
files → object storage; the DB references the file by key. Putting
analysis/recommendations/proposal content in S3 would make them un-queryable
(no SQL gating, no CHECK enforcement, no joins) and is explicitly the wrong
choice per the research.

## 7. Compose topology (v1)

> STATUS (implemented): `docker-compose.yml` at the repo root builds and runs
> all five services. Dockerfiles: `agent/Dockerfile` (kiro-cli + uv + MiniLM
> model + bundles/libraries + envelope schema), `backend/Dockerfile` (node + pg
> + S3 SDK; runs migrations then serves), `frontend/Dockerfile` (Vite build ->
> nginx static serve + `/api` proxy to the backend). Startup ordering uses
> healthchecks + `depends_on: condition: service_healthy`; the backend runs the
> idempotent DB migration on boot. Frontend published on host port 8000
> (`http://localhost:8000`, plain HTTP — the browser must not force HTTPS).
> Verified: all services come up healthy in order; the SPA loads and `/api`
> proxies through nginx to the backend, which reaches Postgres, MinIO and the
> agent (create user/engagement works end to end through the frontend
> container).
>
> OPEN ITEM — container agent auth: in a container the agent authenticates with
> `KIRO_API_KEY` (interactive login is local-only). A live agent RUN therefore
> needs a working key supplied via `.env`. With no/exhausted key the agent
> container still starts and is healthy, but `POST /agent` runs fail to
> authenticate. Everything else in the stack is verified independent of this.


```
services:
  frontend    -> serves the web UI; proxies /api to backend
  backend     -> Node/Express; depends_on: postgres, minio, agent
  agent       -> kiro-cli acp + orchestrator; single POST /agent (HTTP+SSE)
  postgres    -> domain database
  minio       -> S3-compatible object storage

volumes:
  pgdata      -> postgres
  miniodata   -> minio
  agent-acp   -> agent's ACP transcripts (disposable working memory)
```

## 8. Existing code -> target mapping

| Today | v1 destination |
|-------|----------------|
| `src/acp/AcpSession.js` | **Agent microservice** (wrapped behind `POST /agent`) |
| orchestrator + specialist bundles | **Agent microservice** (the brain) |
| `src/routes/chat.js` (SSE) | **Backend** — reworked to orchestrate the agent, not spawn ACP |
| `src/upload/extract.js` | **Backend** — extract text before sending to agent |
| `src/sessions/*`, `store.js` (flat JSON) | **Backend** — replaced by Postgres domain model |
| `src/registry/`, `src/materializer/` | **Agent microservice** (bundles run here) |
| `public/index.html` | **Frontend container** (evolves toward the 8 screens) |

## 9. Recommended build sequence

Build **one vertical slice end-to-end** (engagement type: Azure->AWS) rather than
all screens breadth-first.

1. Agree the **output envelope + `POST /agent` contract** (this doc, section 4).
2. **Agent microservice**: extract `AcpSession` + orchestrator behind `POST /agent`.
3. **Postgres schema + backend domain layer** (engagements/artifacts/users).
4. **Backend orchestration**: build inputs from DB/S3, call agent, persist envelope, stream to frontend.
5. **MinIO** wiring for uploads/artifacts.
6. **Frontend** vertical slice: New engagement -> Inputs -> Analysis -> Recommendations -> Proposal -> approve -> export.
7. **Compose topology** tying it together.

## 10. Open items to confirm

- Output envelope schema (section 4) — sign-off needed; everything derives from it.
- Auth mechanism for v1 stub (simple email login? seeded users?).
- Export formats for v1 (recommend: PDF only to start).
- Whether the agent service runs a single orchestrator agent or keeps the
  multi-bundle specialist set behind the orchestrator (recommend: keep the
  orchestrator + specialists; the single endpoint hides that from the backend).
