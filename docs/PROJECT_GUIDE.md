# Project Guide — AWS Pre-Sales AI Platform (v1)

An as-built guide to the codebase: what each part is, how the pieces talk to
each other, how to run it locally, and the key design decisions. For the
original design rationale (research-backed decisions, storage isolation proofs,
build sequence) see [`architecture-v1.md`](./architecture-v1.md); for the exact
agent output contract see [`agent-envelope.schema.json`](./agent-envelope.schema.json).

---

## 1. What this is

A multi-user web app for AWS pre-sales consultants to run a client engagement
from **discovery → AI analysis → AWS recommendations → proposal**, with a single
human approval gate before anything is client-facing. It is **GPU / AI-ML
migration focused**: the AI analysis maps the whole engagement to AWS but
analyzes GPU / AI-ML workloads in depth (sized and priced by a specialist
sub-agent) while giving every other service a high-level overview mapping.

The product's core behavior:

- **Directed, not turn-by-turn chat.** The consultant says *what* to do; the
  agent decides *how* and streams its activity.
- **Confidence-gated autonomy.** High-confidence mappings are applied; anything
  uncertain or missing information goes **on hold** with a stated reason.
- **Everything is cited** back to an engagement input or the specialist that
  produced it.
- **One human approval**, on the proposal.
- **Grounding lives in the agent** (skills / steering / knowledge), not a
  user-facing knowledge base. Real prices come from AWS pricing tools, never
  from memory.

---

## 2. Architecture at a glance

Four services + Postgres + object storage. The frontend talks **only** to the
backend; the backend is the only thing that talks to the agent; the agent never
touches the database or standing storage credentials.

```
┌──────────┐   SSE/HTTP    ┌─────────────────────┐   HTTP+SSE   ┌──────────────────┐
│ frontend │ ────────────▶ │ backend (Node/Express)│ ──────────▶ │ agent microservice│
│ Vite SPA │ ◀──────────── │  API · DB · S3 · auth │ ◀────────── │ kiro-cli ACP +    │
│  nginx   │               │  agent orchestration  │             │ orchestrator      │
└──────────┘               └─────────┬───────┬─────┘             │ single POST /agent│
                                     │       │                   └──────────────────┘
                              ┌──────▼──┐  ┌─▼──────┐
                              │ Postgres│  │ MinIO  │  (S3-compatible; real S3 by config)
                              └─────────┘  └────────┘
```

| Service | Tech | Responsibility |
|---|---|---|
| **frontend** | Vite + React SPA, served by nginx | The screens. Proxies `/api` to the backend. Talks to nothing else. |
| **backend** | Node / Express | The only thing the frontend talks to. Owns the REST + SSE API, the domain model (engagements, users, artifacts, proposals), Postgres + S3 persistence, auth/ownership, and **agent orchestration** (build inputs → call agent → validate + persist the envelope → relay progress). |
| **agent** | kiro-cli ACP + orchestrator bundles | A single endpoint `POST /agent`. Interprets an `instruction`, runs the work (reading engagement files, consulting specialists, calling AWS pricing/docs MCP tools), streams activity, and returns one self-describing **envelope**. Domain-agnostic: `engagementId` is an opaque correlation id. |
| **postgres** | Postgres 17 | Domain database — the source of truth. |
| **minio** | MinIO | S3-compatible object storage for uploaded documents and (future) exported proposals. |

The agent's ACP transcripts are disposable working memory; the backend Postgres
is authoritative.

---

## 3. Repository layout

```
comprinno-toolbelt/
├── docker-compose.yml        # the 4-service stack (+ postgres, minio)
├── .env.example                 # env template (copy to .env)
│
├── frontend/                    # Vite React SPA
│   ├── src/
│   │   ├── App.jsx  main.jsx  api.js  styles.css
│   │   └── components/
│   │       ├── Shell.jsx            # sidebar / app frame
│   │       ├── Dashboard.jsx        # portfolio of engagements + new-engagement modal
│   │       ├── Engagement.jsx       # one engagement; hosts the stage tabs
│   │       ├── EngagementTabs.jsx   # Recommendations/Proposal/Team tab wrappers
│   │       ├── Overview.jsx         # engagement details + inputs + run analysis
│   │       ├── Analysis.jsx         # AI analysis: requirements (sufficient / needs_info) + submit gate
│   │       ├── Recommendations.jsx  # recs chatbot: deep GPU section + overview section
│   │       ├── GpuDetail.jsx        # rich GPU-Advisor view (hero, confidence matrix, candidates, Bedrock, cost)
│   │       ├── Charts.jsx           # cost comparison chart helpers
│   │       └── common.jsx           # Markdown, Badge, Citations, Skeleton
│   ├── Dockerfile  nginx.conf  vite.config.js  index.html
│
├── backend/                     # Node/Express
│   └── src/
│       ├── server.js  config.js
│       ├── routes/
│       │   ├── engagements.js       # engagements, agent run (SSE relay), analysis-complete, finalize, decisions
│       │   └── documents.js         # document upload/list/download (S3)
│       ├── domain/                  # engagements, artifacts, chat, users, reference
│       │   └── artifacts.js         # persistEnvelope: writes requirements/recommendations/proposal
│       ├── agent/
│       │   ├── agentClient.js        # calls the agent microservice over HTTP+SSE
│       │   ├── orchestrate.js        # builds inputs, runs the agent, maps prior artifacts, persists
│       │   └── semanticValidation.js # business-rule checks before persistence
│       ├── db/
│       │   ├── pool.js  migrate.js
│       │   └── migrations/001_init … 010_recommendation_gpu_detail.sql
│       ├── http/  { auth.js, sse.js }
│       └── storage/ { storage.js, extract.js, sts.js }   # S3 client, text extract, STS credential minting
│
├── agent/                       # kiro-cli ACP orchestrator
│   ├── src/
│   │   ├── server.js  routes.js  runner.js  config.js  envelope.js
│   │   ├── AcpSession.js  sessionPool.js  storage.js
│   │   └── http/sse.js
│   ├── bundles/
│   │   ├── presales-analyst/    # the main agent
│   │   │   ├── agent.json  manifest.json
│   │   │   └── steering/  00-product · 10-method · 20-delegation · 30-output-contract · 40-guardrails
│   │   └── gpu-advisor/         # the GPU specialist sub-agent
│   │       ├── agent.json  manifest.json
│   │       ├── steering/  00-product · 10-guardrails · 30-data-sources · 90-attachments
│   │       ├── knowledge/  aws-gpu-reference.md + data/{aws-gpu-instances,bedrock-models}.json
│   │       └── samples/
│   ├── libraries/
│   │   ├── mcp-catalog/aws-pricing.json
│   │   └── skills/ { gpu-advisor/SKILL.md (+references), presales-analyst/SKILL.md }
│   └── Dockerfile
│
├── docs/
│   ├── PROJECT_GUIDE.md         # this file
│   ├── architecture-v1.md       # original design doc + decision rationale
│   ├── agent-envelope.schema.json  # the agent output contract (JSON Schema)
│   └── roadmap-interactive-workspace.md
│
└── design/                      # v1 wireframes (html + pdf)
```

---

## 4. The envelope contract (the linchpin)

Everything the agent produces is one **AgentEnvelope** — a self-describing JSON
object whose `resultType` tells the backend what to persist. The authoritative
definition is [`agent-envelope.schema.json`](./agent-envelope.schema.json); it
is intentionally Bedrock-structured-output compatible (every object sets
`additionalProperties:false`, constrained fields use `enum`, no recursion /
external `$ref` / numeric constraints).

Top level: `sessionId`, `resultType` (`analysis|recommendations|proposal|answer|mixed`),
`artifacts`, `activity`.

`artifacts` carries only what is relevant to the `resultType`:

- **requirements[]** — extracted requirements, each `{ id, category, text,
  status (sufficient|needs_info), missing, citations[] }`.
- **recommendations[]** — AWS mappings, each `{ id, requirementId, from,
  awsService, strategy (7R), confidence, status (applied|on_hold|override),
  onHoldReason, rationale, impact, estimatedMonthlyCost?, depth?, gpuDetail?,
  citations[] }`.
- **proposalSections[]** — drafted proposal sections.
- **answer** — for chat/interrogation turns.
- **followups[]** — optional suggested next questions (chips in the UI).

Two recommendation fields drive the GPU-focused experience:

- **`depth`** — `"deep"` for GPU / AI-ML workloads (the dedicated, fully
  analyzed section), `"overview"` for every other service (high-level mapping,
  no deep sizing). Defaults to `overview`.
- **`gpuDetail`** — the rich GPU-Advisor block on a deep rec, folded in from the
  gpu-advisor specialist: the recommended `instance` + specs, a four-dimension
  `confidenceMatrix` (hardware / cost / performance / migration, each rated with
  a "Benchmark/Validation required" note), a ranked `candidates[]` comparison
  (specs, fit, availability, grounded pricing tiers), a `bedrock` verdict
  (inference-only), and a `costComparison` (source-cloud baseline vs AWS options,
  savings %, provenance). Populated only for deep GPU recs and only with grounded
  figures.

**Reliability of the envelope (no Bedrock in v1).** The team runs kiro-cli, not
Bedrock, so constrained decoding is unavailable. Envelope shape is achieved by
three cooperating means in `agent/src/runner.js`: a strict prompt output
contract; tolerant extraction (`extractEnvelopeFromText` scans fenced blocks,
then the widest brace span); and a repair loop (re-prompt the same ACP session
with the validator errors, capped retries, then a safe `answer` fallback). The
**business rules** (referential integrity, `applied ⇒ high` confidence,
`on_hold ⇒ reason`, `needs_info ⇒ missing`) run in the backend
(`semanticValidation.js`) before persistence and surface as advisory warnings —
the real truth gate is confidence-gating plus the single human approval.

---

## 5. Data flow (one analysis run)

1. **Inputs.** Consultant creates an engagement and uploads documents. Uploads
   go to S3/MinIO under `engagements/<id>/sources/…`; the backend records a
   `documents` row (text extracted for formats the agent can't parse natively).
2. **Run.** Consultant triggers analysis. The backend
   (`orchestrate.js`) mints **short-lived, engagement-scoped** MinIO STS
   credentials (`storage/sts.js`), builds the run payload (instruction + prior
   artifacts + the scoped `storage` block), and calls the agent over HTTP+SSE
   (`agentClient.js`).
3. **Agent works.** The agent downloads only its engagement's files with the
   scoped creds (`agent/src/storage.js`), extracts text, reads the inputs,
   consults the **gpu-advisor** specialist for GPU workloads (real pricing +
   sizing), and streams `run_started → plan → activity… → result → run_finished`.
4. **Validate + persist.** The backend validates the envelope (schema + semantic
   rules) and `persistEnvelope` (`domain/artifacts.js`) writes requirements /
   recommendations (with `estimated_cost`, `depth`, `gpu_detail`) in a
   transaction. Re-runs map prior DB rows back into the envelope so nothing is
   lost.
5. **Read.** `getRecommendations` does `SELECT *`, so `depth` and `gpu_detail`
   reach the frontend as `r.depth` / `r.gpu_detail`. The Recommendations screen
   splits them into the deep GPU section (rich `GpuDetail` cards) and the
   compact overview section.

---

## 6. The two agents

### presales-analyst (the main agent)

Steering in `agent/bundles/presales-analyst/steering/`:

- **00-product** — what it is and the depth split (GPU deep, the rest overview).
- **10-method** — the run method: extract requirements across the whole
  engagement; map to AWS at two depths; consult the gpu-advisor for GPU work and
  fold its report into `gpuDetail`; re-analysis rules. Includes the
  **assumption-resolution rule**: a `needs_info` gap answered with a clearly
  **labeled assumption** (from the client/consultant note) resolves to a mapped
  `on_hold` rec (medium/low confidence, the assumption + what to validate in
  `onHoldReason`) instead of looping — the normal presales first pass — while
  the agent inventing facts itself stays forbidden.
- **20-delegation** — gpu-advisor is the specialist for the deep GPU section;
  non-GPU services are mapped directly at `overview` depth.
- **30-output-contract** — the strict single-envelope output contract, incl. how
  to populate `depth` and `gpuDetail`.
- **40-guardrails** — no Reserved Instances (Compute Savings Plans only), Bedrock
  is inference-only, never fabricate, no priced quotes (directional impact +
  grounded `estimatedMonthlyCost` only), stay within the engagement, confidence
  honesty, one envelope out.

### gpu-advisor (the specialist sub-agent)

Produces the evidence-based AWS GPU recommendation the analyst folds into
`gpuDetail`. Its disciplines (in `bundles/gpu-advisor/steering` and
`libraries/skills/gpu-advisor`): real pricing only (from the `@aws-pricing` MCP,
never memorized), rank by cost-to-complete not hourly price, treat
availability/quota separately from technical suitability, four-dimension
confidence, Bedrock inference-only with newest-model selection, and full
provenance on every figure. Bundled knowledge is **specs only**
(`aws-gpu-instances.json`, `bedrock-models.json`) — pricing is always fetched
live so it can't go stale.

### MCP tools

Declared in the bundles and pre-pulled in `agent/Dockerfile`:
`@aws-pricing` (EC2 On-Demand / Compute Savings Plan / Bedrock token pricing),
`@aws-documentation` (specs / availability / newest model), `@cloud-cost`
(Azure/GCP baselines), and a web-search fallback. AWS figures in a final
recommendation always come from `@aws-pricing`.

---

## 7. Database

Postgres, migrated on backend boot (`db/migrate.js`, idempotent). Core tables
(full column-level detail, CHECK constraints, FKs and indexes are in
[`DB_SCHEMA.md`](./DB_SCHEMA.md) — the as-built reference read from the live DB):
`users`, `engagements`
(+ `engagement_collaborators`), `documents`, `questionnaire_answers`, `notes`,
`requirements`, `recommendations`, `proposal_versions` / `proposal_sections`,
`agent_activity`, `chat_messages`.

Migration history (`backend/src/db/migrations/`):

| # | Adds |
|---|---|
| 001 | initial schema |
| 002 | engagement inputs (documents/questionnaire/notes) |
| 003 | reference data |
| 004 | gated flow (stage transitions) |
| 005 | chat messages |
| 006 | activity label |
| 007 | recommendations finalize |
| 008 | `recommendations.estimated_cost` JSONB (grounded cost estimate) |
| 009 | `recommendations.depth` (deep / overview) |
| 010 | `recommendations.gpu_detail` JSONB (rich GPU-Advisor block) |

`estimated_cost` and `gpu_detail` are nullable JSONB (populated only when
grounded); `depth` defaults to `overview`. All three reach the frontend
untouched via `SELECT *` and are preserved across re-runs by the orchestrate
mapper.

---

## 8. Storage isolation (enforced, not trusted)

The agent reads engagement files directly, but cross-engagement isolation is
enforced **at the storage layer**. Per run, the backend mints MinIO STS
`AssumeRole` credentials with an inline session policy allowing only
`s3:GetObject` on `engagements/{id}/*` and a prefix-scoped `s3:ListBucket` — no
Put/Delete, no other prefix, 900s lifetime. The agent gets only these scoped
creds; MinIO denies any request outside the one engagement. This is the AWS
"token vending machine" pattern and ports to real S3 (or S3 Access Grants) by
configuration alone. See `architecture-v1.md §6.1` (verified 5/5 against live
MinIO).

---

## 9. Running it locally

**Prerequisites:** Docker + Docker Compose. For live agent runs, either a
`KIRO_API_KEY` or an interactive kiro-cli login inside the agent container, plus
AWS credentials for the pricing MCP.

```bash
cp .env.example .env          # then fill KIRO_API_KEY and AWS_* (see below)

# Build and start the whole stack:
docker compose up -d --build

# The SPA is at http://localhost:8000  (plain HTTP — do not force HTTPS).
# MinIO console at http://localhost:9001, Postgres on 127.0.0.1:5432.
```

The backend runs DB migrations on boot; services start in dependency order via
healthchecks.

### Agent authentication

In a container the agent authenticates with `KIRO_API_KEY`, set as a variable in
`.env`. `AcpSession.js` injects it into the kiro-cli child only when it is set
and non-empty; an empty or unset key makes the CLI fall back to its interactive
IAM Identity Center login (`kiro-cli login`), whose token persists in the
`kiro-auth` volume across rebuilds.

### AWS credentials (for the pricing MCP)

The gpu-advisor's real-pricing lookups need AWS credentials with `pricing:*`
(and, for Savings Plans / live specs, the corresponding read permissions). Set
`AWS_REGION` and either static keys or temporary STS credentials in `.env`
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`). Without them
the docs MCP still works but pricing lookups are disabled.

### Rebuilding one service

```bash
docker compose up -d --build frontend   # or backend / agent
```

### Frontend dev build (outside Docker)

```bash
cd frontend && npm install && npm run build   # or `npm run dev` for the Vite dev server
```

---

## 10. Key screens and flow

1. **Dashboard** — portfolio of engagements; create a new one (owner + client +
   type + use case).
2. **Overview** — engagement details, inputs (documents / questionnaire / notes),
   and the button to run AI analysis.
3. **AI Analysis** — requirements as a live node flow, split into `sufficient`
   and `needs_info`. Open items show an input; **"Submit inputs" stays disabled
   until every open item has an answer** (`Analysis.jsx`), then a targeted re-run
   resolves the gaps and advances to recommendations.
4. **Recommendations** — a single-chat presentation: a summary strip, the
   **deep GPU / AI-ML section** (rich `GpuDetail` cards + cost chart), the
   **overview section** (compact per-service cards), and a freeform conversation
   to explain / compare / refine.
5. **Proposal** — drafted sections; the single human approval gate.
6. **Team & Access** — owner + collaborators; ownership transfer.

---

## 11. Conventions & guardrails (for contributors)

- **The envelope is the contract.** The frontend and DB depend on its shape.
  Any new agent output field must be declared in `agent-envelope.schema.json`
  (schema objects are `additionalProperties:false`), persisted in the backend,
  and read by the frontend — in that order.
- **Never fabricate pricing.** GPU/AI-ML prices come from the `@aws-pricing` MCP
  with basis + source; a directional statement or `needs_info`/`on_hold` is the
  correct fallback when a figure isn't grounded.
- **Compute Savings Plans only** for committed pricing — never Reserved
  Instances. **Bedrock is inference-only.**
- **Grounded-or-omitted `gpuDetail`.** Every spec/price/availability must be
  sourced; omit any field you can't ground.
- **Confidence honesty.** `applied` requires `high` confidence; otherwise
  `on_hold` with a reason. A client/consultant-stated assumption resolves a gap
  to an assumption-flagged `on_hold` rec, not a confirmed fact.
- **Migrations are additive and idempotent** (`ADD COLUMN IF NOT EXISTS`), run
  on backend boot.

---

## 12. Deferred to later

Knowledge Base UI, real SSO (v1 stubs single-org auth), proposal version-history
UI and multi-format export, notifications, and migration-execution features
(landing zone, waves, cutover). See `architecture-v1.md §1` and
`roadmap-interactive-workspace.md`.
