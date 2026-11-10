#!/usr/bin/env node
/**
 * gen-contract.mjs — single-source the AgentEnvelope contract.
 *
 * The JSON Schema at docs/agent-envelope.schema.json is the ONE source of
 * truth for the agent's output shape. This script derives, from that schema:
 *
 *   1. the sample envelope embedded in the presales-analyst output-contract
 *      steering (30-output-contract.md), between the AUTO-GENERATED markers, and
 *   2. a TypeScript type (docs/generated/AgentEnvelope.d.ts) that the frontend
 *      and backend can typecheck their envelope handling against.
 *
 * Run `npm run contract:gen` to regenerate both. Run `npm run contract:check`
 * (used in CI) to fail if the committed artifacts are stale — i.e. the schema
 * changed but the sample/types were not regenerated.
 *
 * The generated SAMPLE deliberately mirrors the pedagogical style the steering
 * used by hand: enum fields render as "a | b | c" hints, free-text strings as
 * "...", so the example teaches the model the same way while staying in sync.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_PATH = path.join(ROOT, "docs", "agent-envelope.schema.json");
const STEERING_PATH = path.join(
  ROOT, "agent", "bundles", "presales-analyst", "steering", "30-output-contract.md"
);
const TYPES_PATH = path.join(ROOT, "docs", "generated", "AgentEnvelope.d.ts");

const BEGIN = "<!-- AUTO-GENERATED:envelope-sample (do not edit; `npm run contract:gen`) -->";
const END = "<!-- END AUTO-GENERATED:envelope-sample -->";

const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));

// ─── Build a style-faithful sample value for a schema node ──────────────────
// Placeholder for a free-text string, keyed by property name so the example
// reads naturally (ids, timestamps, etc.).
function stringPlaceholder(key) {
  const k = (key || "").toLowerCase();
  if (k === "id") return "req_1";
  if (k === "sessionid") return "<echo the session id or leave empty>";
  if (k === "requirementid") return "req_1";
  if (k === "ts") return "ISO-8601";
  if (k === "source") return "file.pdf";
  if (k === "locator") return "p.4";
  if (k === "label") return "On-Demand";
  if (k === "currency") return "USD";
  if (k === "basis") return "On-Demand, 730h/mo, us-east-1, 1x instance";
  if (k === "region") return "us-east-1";
  if (k === "name") return "g6.xlarge";
  if (k === "category") return "COMPUTE & HOSTING";
  return "...";
}

function sampleFor(node, key, defs) {
  if (!node || typeof node !== "object") return "...";
  if (node.$ref) {
    const name = node.$ref.replace("#/$defs/", "");
    return sampleFor(defs[name], key, defs);
  }
  if (Array.isArray(node.enum)) return node.enum.join(" | ");
  const type = Array.isArray(node.type) ? node.type[0] : node.type;
  switch (type) {
    case "object": {
      const out = {};
      for (const [prop, sub] of Object.entries(node.properties || {})) {
        out[prop] = sampleFor(sub, prop, defs);
      }
      return out;
    }
    case "array":
      return [sampleFor(node.items, key, defs)];
    case "number":
    case "integer": {
      const k = (key || "").toLowerCase();
      if (k.includes("pct")) return 63.8;
      if (k === "hourly") return 0.8;
      if (k === "monthly" || k === "amount") return 289.73;
      return 0;
    }
    case "boolean":
      return true;
    case "string":
    default:
      return stringPlaceholder(key);
  }
}

function buildSample() {
  const defs = schema.$defs || {};
  const value = sampleFor(schema, "root", defs);
  // Pretty-print with the compact array-of-object style the hand-written
  // sample used (each artifacts array item on one line) is hard to reproduce
  // exactly; a stable 2-space pretty-print is clearer and still deterministic.
  return "```json\n" + JSON.stringify(value, null, 2) + "\n```";
}

// ─── Splice the sample between the markers in the steering file ─────────────
function renderSteering(currentText, sampleBlock) {
  const beginIdx = currentText.indexOf(BEGIN);
  const endIdx = currentText.indexOf(END);
  const region = `${BEGIN}\n\n${sampleBlock}\n\n${END}`;
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    return currentText.slice(0, beginIdx) + region + currentText.slice(endIdx + END.length);
  }
  // First run: markers not present yet. Replace the first ```json … ``` block
  // that follows the "```json" fence in the contract intro.
  const fence = currentText.indexOf("```json");
  if (fence === -1) throw new Error("Could not find a ```json block or markers in the steering file.");
  const close = currentText.indexOf("```", fence + "```json".length);
  const closeEnd = currentText.indexOf("\n", close) === -1 ? close + 3 : currentText.indexOf("\n", close);
  return currentText.slice(0, fence) + region + currentText.slice(closeEnd);
}

async function generate() {
  const sampleBlock = buildSample();
  const steeringNow = readFileSync(STEERING_PATH, "utf8");
  const steeringNext = renderSteering(steeringNow, sampleBlock);

  const types = await compile(schema, "AgentEnvelope", {
    bannerComment:
      "/* AUTO-GENERATED from docs/agent-envelope.schema.json by scripts/gen-contract.mjs.\n" +
      " * Do not edit by hand. Run `npm run contract:gen` after changing the schema. */",
    additionalProperties: false,
    style: { singleQuote: false },
  });

  return { steeringNext, types };
}

function readOr(p, fallback = "") {
  try { return readFileSync(p, "utf8"); } catch { return fallback; }
}

const isCheck = process.argv.includes("--check");
const { steeringNext, types } = await generate();

if (isCheck) {
  const steeringNow = readFileSync(STEERING_PATH, "utf8");
  const typesNow = readOr(TYPES_PATH);
  const drift = [];
  if (steeringNow !== steeringNext) drift.push("steering sample (30-output-contract.md)");
  if (typesNow !== types) drift.push("TypeScript types (docs/generated/AgentEnvelope.d.ts)");
  if (drift.length) {
    console.error(
      "✗ Contract artifacts are OUT OF SYNC with the schema:\n  - " +
      drift.join("\n  - ") +
      "\nRun `npm run contract:gen` and commit the result."
    );
    process.exit(1);
  }
  console.log("✓ Contract artifacts are in sync with the schema.");
} else {
  writeFileSync(STEERING_PATH, steeringNext);
  mkdirSync(path.dirname(TYPES_PATH), { recursive: true });
  writeFileSync(TYPES_PATH, types);
  console.log("✓ Regenerated:\n  - " + STEERING_PATH + "\n  - " + TYPES_PATH);
}
