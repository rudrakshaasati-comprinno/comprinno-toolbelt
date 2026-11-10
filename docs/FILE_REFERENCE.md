# File Reference — every file in the codebase

A researched, file-by-file map of the repository (104 tracked files, excluding
`package-lock.json` and `node_modules/`). Grouped by area. For how the pieces
fit together see [`PROJECT_GUIDE.md`](./PROJECT_GUIDE.md).

---

## Root

| File | Purpose |
|---|---|
| `README.md` | Concise entry point: what the platform is, quickstart, structure, doc links. |
| `docker-compose.yml` | The base stack: all five services (frontend, backend, agent, postgres, minio) — builds, ports, volumes, healthchecks, dependency order. |
| `.env.example` | Env template (copy to `.env`): `KIRO_API_KEY`. AWS creds for the pricing MCP are supplied via `.env` or the shell (see README). |
| `.gitignore` | Ignores node_modules, `.env`, `.DS_Store`, logs, scratch `*.mjs`, `.chat.json`, `*.bak`, agent workspace contents. |
| `.dockerignore` | Excludes host `.kiro`, node_modules, etc. from Docker build context (agent config is provided at runtime, not baked from host). |

---

## frontend/ — Vite React SPA (served by nginx)

| File | Purpose |
|---|---|
| `index.html` | Vite HTML entry; mounts the React root. |
| `vite.config.js` | Vite build/dev config. |
| `nginx.conf` | Production nginx: serves the built SPA and proxies `/api` to the backend (`proxy_buffering off`, `proxy_read_timeout 3600s` for long SSE runs). |
| `Dockerfile` | Multi-stage: Vite build → static assets served by nginx. |
| `.gitignore` | Ignores `dist/`, `node_modules/`. |
| `package.json` | Frontend deps (React, react-markdown, recharts) and scripts. |
| `src/main.jsx` | React bootstrap — mounts `<App/>` into `#root`, imports `styles.css`. |
| `src/App.jsx` | Top-level shell; sign-in gate + routing between Dashboard, an Engagement (tabbed), and Settings; sidebar collapse state. |
| `src/api.js` | The API client — every backend REST call, plus `streamSse` (fetch + ReadableStream reader) for the agent run stream, and the `X-User-Id` header injection. |
| `src/styles.css` | All styling + design tokens (`--navy`, `--tint-*`, type scale), including the recs sections, charts, and GPU-detail styles. |
| `src/components/Shell.jsx` | Sidebar, SignIn (stub auth: name/email), and Settings screens. |
| `src/components/Dashboard.jsx` | Portfolio of engagements + the new-engagement modal; per-stage counts. |
| `src/components/Engagement.jsx` | One engagement; owns the stage tabs (`Overview`, `AI Analysis`, `Recommendations`, `Proposal`, `Team & Access`) and the auto-run-analysis handoff. |
| `src/components/Overview.jsx` | Engagement details (editable), inputs, and the run-analysis trigger. |
| `src/components/Analysis.jsx` | AI Analysis screen: requirements as a live node flow, split into `sufficient` / `needs_info`, with the **submit gate** (disabled until every open item is answered) and the targeted re-run. |
| `src/components/Recommendations.jsx` | Recommendations as a single-chat presentation: summary strip + **deep GPU section** (rich `GpuDetail`) + **overview section** (compact cards) + freeform conversation. |
| `src/components/GpuDetail.jsx` | The rich GPU-Advisor view for a deep rec's `gpu_detail`: hero instance + four-dimension confidence matrix, candidate comparison table, Bedrock verdict panel, cost-comparison bars. |
| `src/components/Charts.jsx` | Cost-comparison chart helpers (`costOf`, `SummaryCharts`, `ChartsForIntent`, `hasCostData`) — grounded monthly cost bars only. |
| `src/components/EngagementTabs.jsx` | Re-exports `Recommendations`; hosts the `Proposal` (approval gate) and `Team` tab components. |
| `src/components/common.jsx` | Shared UI: `Markdown`, `Badge` (self-explaining, tooltip), `Citations`, `Skeleton`/`SkeletonCard`. |

---

## backend/ — Node/Express (API · domain · DB · S3 · orchestration)

| File | Purpose |
|---|---|
| `Dockerfile` | Node image (pg + S3 SDK); runs migrations then serves. |
| `.gitignore` | Ignores `node_modules/`. |
| `package.json` | Backend deps (express, pg, @aws-sdk/*, multer) and scripts. |
| `src/server.js` | Bootstrap: express app, `identity` middleware, mounts the users/engagements/documents routers, `/api/health`, ensures the S3 bucket. |
| `src/config.js` | Env config: `PORT`, `DATABASE_URL`, PG pool size, `AGENT_URL`, and the S3/MinIO settings (endpoint, bucket, path-style, creds). |
| **routes/** | |
| `src/routes/engagements.js` | Engagement CRUD, the agent-run SSE relay (`POST /engagements/:id/agent`), analysis-complete, recommendations finalize, decisions, stage, proposals, questionnaire. |
| `src/routes/documents.js` | Document upload (multer → S3), list, download. |
| **domain/** (repositories) | |
| `src/domain/engagements.js` | Engagement repository + inputs accessors (documents/questionnaire/notes) used to build the agent payload. |
| `src/domain/artifacts.js` | `persistEnvelope` — writes requirements / recommendations (incl. `estimated_cost`, `depth`, `gpu_detail`) / proposal sections in a transaction; `getRequirements`/`getRecommendations` reads. |
| `src/domain/chat.js` | Engagement chat-message repository (exploration turns on top of analysis), with optional dedupe. |
| `src/domain/reference.js` | DB-driven reference data: engagement types + per-type questionnaire templates (so dropdowns/questions come from the DB). |
| `src/domain/users.js` | User repository (stub auth; identity carried so ownership is real). |
| **agent/** (orchestration) | |
| `src/agent/orchestrate.js` | Orchestrates a run: mints scoped storage creds, builds inputs + prior artifacts, calls the agent, validates, persists the envelope; maps prior DB rows back into the envelope for re-runs (carries `depth`/`gpuDetail`). |
| `src/agent/agentClient.js` | Calls the agent's `POST /agent` and consumes its SSE stream server-side (the backend is an SSE relay). |
| `src/agent/semanticValidation.js` | Business-rule checks before persistence (referential integrity, `applied⇒high`, `on_hold⇒reason`, `needs_info⇒missing`, `estimatedMonthlyCost` shape) surfaced as advisory warnings. |
| **db/** | |
| `src/db/pool.js` | One pg `Pool` per process; `query()` + transaction helper. |
| `src/db/migrate.js` | Applies pending `.sql` migrations in filename order, tracked in `schema_migrations`; runs on boot. |
| `src/db/migrations/001_init.sql` | Initial schema (users, engagements, artifacts, proposals, activity). |
| `…/002_engagement_inputs.sql` | Documents / questionnaire / notes. |
| `…/003_reference_data.sql` | Engagement types + questionnaire templates (seed reference data). |
| `…/004_gated_flow.sql` | Stage-transition / gating columns. |
| `…/005_chat_messages.sql` | Chat message table. |
| `…/006_activity_label.sql` | Activity `label` column. |
| `…/007_recommendations_finalize.sql` | Recommendations finalize marker. |
| `…/008_recommendation_cost.sql` | `recommendations.estimated_cost` JSONB (grounded cost estimate). |
| `…/009_recommendation_depth.sql` | `recommendations.depth` (deep / overview). |
| `…/010_recommendation_gpu_detail.sql` | `recommendations.gpu_detail` JSONB (rich GPU-Advisor block). |
| **http/** | |
| `src/http/auth.js` | `identity` (resolve `X-User-Id` → `req.userId`) + engagement authorization (owner/collaborator). Stub auth; only `identity` changes when real auth arrives. |
| `src/http/sse.js` | Backend-side SSE writer used to relay agent events to the browser. |
| **storage/** | |
| `src/storage/storage.js` | S3-compatible client (MinIO in v1, real S3 by config): put/get/head/create-bucket/delete + key helpers. Backend owns all standing S3 access. |
| `src/storage/extract.js` | Classifies an uploaded file (native vs extracted) and produces a `.txt` sidecar for Office formats the agent's `fs_read` can't parse. |
| `src/storage/sts.js` | Token vending machine: mints short-lived, engagement-scoped MinIO STS credentials (read-only, `engagements/{id}/*`) so the agent can only reach its own engagement's files. |

---

## agent/ — kiro-cli ACP orchestrator (single POST /agent)

### Runtime source (`agent/src/`)

| File | Purpose |
|---|---|
| `server.js` | Bootstrap: `POST /agent` + `/health`; domain-agnostic (no DB/S3). |
| `routes.js` | The `POST /agent` handler: validates the instruction, opens an `SseStream`, aborts the run on client disconnect, delegates to `runAgent`. |
| `config.js` | Env + paths: `AGENT_NAME` (default `presales-analyst`), `WORKSPACE_DIR` (where bundle `file://` resources resolve), tool-trust posture (headless ⇒ trust-all by default), SSE heartbeat, and `assertEnvironment` (kiro-cli present + auth mode). |
| `runner.js` | The heart of a run: warms/reuses a pooled ACP session, downloads + extracts engagement files, prompts the agent, extracts the envelope from the reply (tolerant), runs the schema-validation **repair loop** (capped retries → safe `answer` fallback), emits layered SSE. |
| `AcpSession.js` | Wraps one `kiro-cli acp` child process; speaks ACP JSON-RPC over stdio; one instance per conversation. |
| `sessionPool.js` | Keeps ACP sessions **warm** per engagement (avoids cold-start re-spawn + re-download each turn), with per-key turn serialization and an idle-TTL sweeper. |
| `envelope.js` | Loads `docs/agent-envelope.schema.json` and validates envelope **shape** (Ajv) at the agent boundary. Shape only — truth is the backend's job. |
| `storage.js` | Downloads the engagement's files using the scoped creds from the run payload into a per-run temp dir (can't reach another engagement — enforced by the creds). |
| `http/sse.js` | SSE writer with the reliability guards (flush headers, `X-Accel-Buffering: no`, heartbeats, backpressure, resumable event ids). |

### Bundles (`agent/bundles/`)

**presales-analyst** (the main agent):

| File | Purpose |
|---|---|
| `agent.json` | The Kiro agent config: prompt, `resources` (steering + skill globs), tools (incl. `@aws-pricing`, `@aws-documentation`, subagent). |
| `manifest.json` | Portal/UI metadata + declared inputs for the bundle. |
| `steering/00-product.md` | Product identity + the GPU-deep / rest-overview depth split. |
| `steering/10-method.md` | The run method (extract → map at two depths → consult gpu-advisor → re-analysis), incl. the **assumption→on_hold** rule. |
| `steering/20-delegation.md` | When/how to delegate to gpu-advisor; non-GPU mapped directly. |
| `steering/30-output-contract.md` | The strict single-envelope output contract (incl. how to populate `depth` and `gpuDetail`). |
| `steering/40-guardrails.md` | No RIs (Compute SP only), Bedrock inference-only, never fabricate, no priced quotes, confidence honesty, one envelope out. |

**gpu-advisor** (the GPU specialist sub-agent):

| File | Purpose |
|---|---|
| `agent.json` | Agent config: discovery-first prompt, `resources` (steering + knowledge `**/*.md` + `knowledge/data/*.json` + skill), tools (`@aws-pricing`, `@aws-documentation`, `@cloud-cost`). |
| `manifest.json` | Portal/UI metadata + inputs. |
| `steering/00-product.md` | Product identity (the GPU Advisor). |
| `steering/10-guardrails.md` | Real-pricing-only, cost-to-complete ranking, availability separate, no fabrication, Bedrock inference-only; references the bundled knowledge. |
| `steering/30-data-sources.md` | The tool/knowledge map: which MCP tool for which fact + the knowledge files. |
| `steering/90-attachments.md` | How to handle attachments/inputs. |
| `knowledge/aws-gpu-reference.md` | GPU families, sizing heuristics, purchasing options, citation links (reference, not pricing). |
| `knowledge/data/aws-gpu-instances.json` | EC2 GPU instance **specs** (GPU model/count, memory, vCPU/RAM/network). Specs only — pricing is fetched live. |
| `knowledge/data/bedrock-models.json` | Bedrock foundation-model catalog for family matching. Metadata only. |
| `samples/sample-inputs.md` · `sample-mom.txt` · `sample-workload-brief.txt` | Example inputs for testing/authoring the advisor. |

### Libraries (`agent/libraries/`)

| File | Purpose |
|---|---|
| `mcp-catalog/aws-pricing.json` | MCP server definition for the AWS Pricing MCP (command + args + env, secrets stripped). |
| `skills/presales-analyst/SKILL.md` | The analyst's skill (loaded on demand): its discipline and method summary. |
| `skills/gpu-advisor/SKILL.md` | The advisor's skill: overview + which references to load. |
| `skills/gpu-advisor/references/discovery.md` | The one-question-at-a-time discovery protocol. |
| `…/references/accuracy-rules.md` | Accuracy rules (grounded-only, provenance, $0/null handling). |
| `…/references/data-sources.md` | Where each number comes from (pricing API filters, SP API, Bedrock, source-cloud). |
| `…/references/memory-sizing.md` | VRAM / memory-fit sizing heuristics. |
| `…/references/savings-plans.md` | Compute Savings Plan variants + the 730h note. |
| `…/references/report-format.md` | The exact final-report shape the advisor must output. |

### Container

| File | Purpose |
|---|---|
| `agent/Dockerfile` | Builds the agent image: kiro-cli + uv + the MiniLM model + copies bundles/libraries + the envelope schema; stages each bundle's `agent.json` into `/root/.kiro/agents/`. |
| `agent/.gitignore` | Ignores `node_modules/`, workspace scratch. |
| `agent/package.json` | Agent deps (express, @aws-sdk/client-s3, ajv) and scripts. |

---

## docs/

| File | Purpose |
|---|---|
| `PROJECT_GUIDE.md` | The detailed as-built guide (architecture, contract, data flow, agents, DB, run, conventions). |
| `architecture-v1.md` | Original design doc + decision rationale (research-backed). |
| `agent-envelope.schema.json` | The AgentEnvelope JSON Schema — the linchpin output contract. |
| `roadmap-interactive-workspace.md` | Forward plan: evolving v1 into a persistent interactive analysis workspace. |
| `FILE_REFERENCE.md` | This file. |

---

## design/

| File | Purpose |
|---|---|
| `AWS Pre-Sales AI Platform — Wireframes v1.html` / `.pdf` | v1 UI wireframes. |
