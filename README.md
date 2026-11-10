# AWS Pre-Sales AI Platform (v1)

A multi-user web app for AWS pre-sales consultants to run a client engagement
end to end — **discovery → AI analysis → AWS recommendations → proposal** — with
a single human approval before anything is client-facing.

It is **GPU / AI-ML migration focused**: the AI analysis maps the whole
engagement to AWS but analyzes GPU / AI-ML workloads in depth (sized and priced
by a specialist sub-agent, using real AWS pricing) while giving every other
service a high-level overview mapping.

- **Directed, not turn-by-turn chat** — you say what to do; the agent decides how
  and streams its activity.
- **Confidence-gated** — high-confidence mappings are applied; uncertain or
  missing-info items go on hold with a reason.
- **Everything cited**, grounded in the engagement's own inputs and real pricing
  tools — never fabricated.

## Architecture

Four services behind Docker Compose. The frontend talks only to the backend; the
backend is the only thing that talks to the agent.

```
frontend (React SPA) ──▶ backend (Node/Express) ──▶ agent (kiro-cli ACP + orchestrator)
                              │        │
                          Postgres   MinIO (S3-compatible)
```

| Service | What it does |
|---|---|
| **frontend** | The screens (Vite React SPA, served by nginx; proxies `/api`). |
| **backend** | REST + SSE API, domain model, Postgres + S3, auth, and agent orchestration. |
| **agent** | Single `POST /agent`; runs the presales-analyst (+ gpu-advisor specialist) and returns one structured envelope. |
| **postgres / minio** | Domain database (source of truth) + object storage for documents. |

## Quickstart

Requires Docker + Docker Compose. For live agent runs you also need a
`KIRO_API_KEY` and AWS credentials for the pricing MCP.

**1. Export AWS credentials first.** Compose reads `${AWS_*}` from either `.env`
or the environment of the shell you run `docker compose` in, and the agent
container captures a **snapshot** of them at launch — so they must be present
*before* you bring the stack up. If you already have them exported (e.g. from
AWS SSO or `aws sso login`) they are passed through as-is; otherwise export them:

```bash
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_SESSION_TOKEN=...        # only for temporary/SSO/STS credentials
```

(Putting the `AWS_*` values in `.env` instead works too — Compose reads either.)

**2. Set your API key and start the stack.**

```bash
cp .env.example .env                 # fill KIRO_API_KEY
docker compose up -d --build         # build + start the stack
```

**3. Open the app in your browser:** **http://localhost:8000** (plain HTTP —
don't force HTTPS). The backend runs DB migrations on boot; services start in
dependency order, so give it a moment on first launch.

The container does not follow your shell after launch. Temporary (SSO/STS)
credentials expire, after which the pricing MCP starts failing. Refresh them in
your shell and recreate the agent to pick up the new values:

```bash
docker compose up -d --force-recreate agent
```

### Running without an API key (interactive login)

`KIRO_API_KEY` is optional. When it is empty or unset the agent falls back to an
interactive `kiro-cli login` (IAM Identity Center) — useful when you have no key
or the key is exhausted. Leave `KIRO_API_KEY` blank (or omit it) in `.env`,
start the stack, then log in once inside the agent container. The container has
no browser, so use the device flow: it prints a URL and a one-time code to open
on your own machine.

```bash
docker compose up -d --build
docker compose exec -it agent kiro-cli login --use-device-flow
docker compose exec agent kiro-cli whoami   # verify
```

The login token persists in the `kiro-auth` volume across rebuilds, so you only
do this once. A non-empty `KIRO_API_KEY` always takes precedence, so clear it to
use the login.

## Repository structure

```
frontend/   Vite React SPA (screens, GpuDetail, charts)
backend/    Node/Express API, domain, DB migrations, S3, agent orchestration
agent/      kiro-cli ACP orchestrator; presales-analyst + gpu-advisor bundles, skills, MCP catalog
docs/       PROJECT_GUIDE.md, architecture-v1.md, agent-envelope.schema.json, roadmap
design/     v1 wireframes
docker-compose.yml
```

## Documentation

- **[docs/PROJECT_GUIDE.md](docs/PROJECT_GUIDE.md)** — the detailed as-built
  guide: services, data flow, the envelope contract, the two agents, database,
  storage isolation, and how to run and extend it. **Start here.**
- **[docs/FILE_REFERENCE.md](docs/FILE_REFERENCE.md)** — a researched,
  file-by-file map of every source file in the repo.
- **[docs/DB_SCHEMA.md](docs/DB_SCHEMA.md)** — the as-built database schema:
  tables, columns, CHECK constraints (the truth layer), foreign keys, indexes.
- **[docs/architecture-v1.md](docs/architecture-v1.md)** — the original design
  doc and decision rationale (research-backed).
- **[docs/agent-envelope.schema.json](docs/agent-envelope.schema.json)** — the
  agent output contract (JSON Schema) that the frontend and DB derive from.

## Conventions

- **The envelope is the contract.** A new agent output field must be added to
  the schema, persisted in the backend, and read by the frontend — in that order.
- **Never fabricate pricing** — GPU/AI-ML prices come from the AWS pricing MCP
  with basis + source; otherwise the item is directional or `needs_info`.
- **Compute Savings Plans only** (no Reserved Instances); **Bedrock is
  inference-only**.
