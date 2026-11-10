# syntax=docker/dockerfile:1
# Backend service image: Node + pg + S3 SDK + text extraction. Owns the domain,
# Postgres, S3, and agent orchestration.

FROM node:22-slim AS deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime
# curl for the compose healthcheck.
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY backend/ ./

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
# Run migrations, then start the server. Migrations are idempotent
# (schema_migrations tracking), so this is safe on every boot.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]
