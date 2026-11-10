/**
 * config.js - Backend service environment configuration.
 */

export const PORT = Number(process.env.PORT || 3000);

// Postgres connection. Prefer a single DATABASE_URL; fall back to discrete vars
// so local dev and compose both work.
export const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://${process.env.PGUSER || "presales"}:${process.env.PGPASSWORD || "presales"}` +
  `@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || "presales"}`;

// Connection pool sizing (one Pool per process, reused for every request).
export const PG_POOL_MAX = Number(process.env.PG_POOL_MAX || 10);

// The agent microservice base URL (used by the orchestration layer, task #4).
export const AGENT_URL = process.env.AGENT_URL || "http://localhost:4000";

// ── Object storage (S3-compatible; MinIO in v1, real S3 later via config) ──
// To switch to real AWS S3: unset S3_ENDPOINT and S3_FORCE_PATH_STYLE, and set
// standard AWS credentials/region. No code change required.
export const S3_ENDPOINT = process.env.S3_ENDPOINT || "http://localhost:9000";
export const S3_REGION = process.env.S3_REGION || "us-east-1";
export const S3_BUCKET = process.env.S3_BUCKET || "presales";
// Use explicit S3_* credentials. Do NOT fall back to ambient AWS_* env vars:
// those may be a real IAM/SSO session (used for Bedrock) that MinIO would
// reject. For real S3 later, set S3_ACCESS_KEY/S3_SECRET_KEY explicitly (or
// adapt this to use the AWS default credential chain intentionally).
export const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "minioadmin";
export const S3_SECRET_KEY = process.env.S3_SECRET_KEY || "minioadmin";
// MinIO requires path-style addressing; real S3 uses virtual-hosted by default.
export const S3_FORCE_PATH_STYLE =
  process.env.S3_FORCE_PATH_STYLE ? process.env.S3_FORCE_PATH_STYLE === "true" : true;
