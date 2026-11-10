import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

/**
 * envelope.js - Load and validate the AgentEnvelope against the shared schema
 * (docs/agent-envelope.schema.json). This is the syntactic "shape" check.
 *
 * IMPORTANT (see architecture-v1.md 4.1): a schema guarantees SHAPE, not TRUTH.
 * Semantic validation (business rules) and confidence-gating live in the
 * backend. This module only enforces the shape contract at the agent boundary,
 * so the agent never emits a structurally-invalid envelope to the backend.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCHEMA_PATH = path.join(REPO_ROOT, "docs", "agent-envelope.schema.json");

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(schema);

/**
 * Validate an envelope object against the schema.
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateEnvelope(envelope) {
  const valid = validateFn(envelope);
  if (valid) return { valid: true, errors: [] };
  const errors = (validateFn.errors || []).map(
    (e) => `${e.instancePath || "(root)"} ${e.message}`
  );
  return { valid: false, errors };
}

/** The loaded schema (exposed for Bedrock structured-output wiring later). */
export const ENVELOPE_SCHEMA = schema;
