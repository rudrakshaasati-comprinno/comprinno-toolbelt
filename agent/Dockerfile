# syntax=docker/dockerfile:1
# Agent microservice image: kiro-cli + uv + the MiniLM model + the presales-analyst
# bundle, wrapping POST /agent.

# --- Stage 1: tools (kiro-cli, uv, MiniLM model) ---------------------------
FROM node:22-slim AS tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates unzip git && \
    rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://cli.kiro.dev/install | bash
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
# Pre-seed the semantic-search embedding model so session/new doesn't stall on a
# slow runtime download. Retries guard against transient Hugging Face resets.
RUN mkdir -p /models/all-MiniLM-L6-v2 && \
    curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
      -o /models/all-MiniLM-L6-v2/model.safetensors \
      https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/model.safetensors && \
    curl -fsSL --retry 5 --retry-delay 2 --retry-all-errors \
      -o /models/all-MiniLM-L6-v2/tokenizer.json \
      https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json

# --- Stage 2: deps (agent node_modules) ------------------------------------
FROM node:22-slim AS deps
WORKDIR /app/agent
COPY agent/package.json agent/package-lock.json ./
RUN npm ci --omit=dev

# --- Stage 3: runtime ------------------------------------------------------
FROM node:22-slim AS runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates git poppler-utils && \
    rm -rf /var/lib/apt/lists/*

COPY --from=tools /root/.local/bin/ /root/.local/bin/
ENV PATH="/root/.local/bin:${PATH}"
RUN mkdir -p /root/.kiro/agents /root/.kiro/skills /root/.kiro/settings

# Pre-warm the MCP server packages so a fresh container does NOT pay a
# first-use download stall mid-run (the aws-* servers pull CPython + botocore,
# ~50MB+, on first launch). Same rationale as the MiniLM pre-seed above. Each
# command downloads the package into the uv/npm cache and exits; the populated
# caches are baked into this image layer. Failures are tolerated (|| true) so a
# transient registry hiccup doesn't break the build — worst case it downloads
# at runtime as before.
RUN uvx --with "botocore[crt]" awslabs.aws-pricing-mcp-server@latest --help >/dev/null 2>&1 || true; \
    uvx awslabs.aws-documentation-mcp-server@latest --help >/dev/null 2>&1 || true; \
    printf '' | timeout 60 uvx duckduckgo-mcp-server >/dev/null 2>&1 || true; \
    npx -y cloud-cost-mcp --help >/dev/null 2>&1 || true; \
    echo "MCP packages pre-warmed"
COPY --from=tools /models/all-MiniLM-L6-v2/ \
     /root/.semantic_search/models/all-MiniLM-L6-v2/

WORKDIR /app
# Agent deps.
COPY --from=deps /app/agent/node_modules ./agent/node_modules
# The agent service reads docs/agent-envelope.schema.json (2 levels up from
# agent/src) and launches the presales-analyst bundle, whose file:// resources
# resolve against WORKSPACE_DIR=/app (bundles/, libraries/). bundles/ and
# libraries/ live under agent/ in the repo but are copied to /app/{bundles,
# libraries} so the in-container file:// paths stay the same.
COPY agent/ ./agent/
COPY agent/bundles/ ./bundles/
COPY agent/libraries/ ./libraries/
COPY docs/agent-envelope.schema.json ./docs/agent-envelope.schema.json

# Register each bundle as a kiro agent. kiro-cli resolves `acp --agent <name>`
# from ~/.kiro/agents/<name>.json (and <workspace>/.kiro/agents), NOT from
# /app/bundles — so without this install step `--agent presales-analyst`
# silently falls back to the built-in kiro_default and none of the bundle
# config (steering resources, trustedAgents, MCP servers) is applied. Copy each
# bundle's agent.json to ~/.kiro/agents/<bundle>.json; its file:// resources
# still resolve against WORKSPACE_DIR=/app (bundles/, libraries/) at runtime.
RUN for d in ./bundles/*/; do \
      name=$(basename "$d"); \
      [ -f "$d/agent.json" ] && cp "$d/agent.json" "/root/.kiro/agents/$name.json"; \
    done && ls -1 /root/.kiro/agents/

EXPOSE 4000
ENV NODE_ENV=production
ENV AGENT_PORT=4000
# ACP session cwd = /app so the agent bundle's file:// resources resolve.
ENV WORKSPACE_DIR=/app
# KIRO_API_KEY is supplied via compose env. (Interactive login is local-only;
# in a container the agent authenticates with the API key.)

WORKDIR /app/agent
CMD ["node", "src/server.js"]
