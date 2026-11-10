import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * config.js - Environment constants and paths for the agent microservice.
 *
 * The agent service is deliberately domain-agnostic: it knows nothing about
 * engagements, the DB, or S3. It receives instruction + inputs over POST /agent
 * and returns the structured envelope. All it needs from the environment is the
 * Kiro API key and where the agent bundle / workspace live.
 */

const AGENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PORT = Number(process.env.AGENT_PORT || 4000);
export const KIRO_API_KEY = process.env.KIRO_API_KEY;

// The agent the microservice launches by default. presales-analyst is the v1
// top-level analysis agent; it delegates to the gpu-advisor specialist via the
// subagent tool.
export const AGENT_NAME = process.env.AGENT_NAME || "presales-analyst";

// ACP session working directory. Must let the top-level agent's file:// resources
// (bundles/presales-analyst/steering/**, libraries/skills/**) resolve. bundles/
// and libraries/ live under agent/, so locally this defaults to the agent dir;
// in the container the Dockerfile sets WORKSPACE_DIR=/app (where they're copied).
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || AGENT_ROOT;

// Tool approval posture. This agent runs HEADLESS (a backend service): there is
// no human at the ACP permission prompt, so any non-trusted tool would emit
// session/request_permission and hang the run forever. We therefore auto-approve
// ALL tools by default (kiro's --trust-all-tools). Set AGENT_TRUST_ALL_TOOLS to a
// falsey value (0/false/no/off) to fall back to the explicit AGENT_TRUST_TOOLS
// allowlist instead.
export const TRUST_ALL_TOOLS = !(["0", "false", "no", "off"].includes(
  String(process.env.AGENT_TRUST_ALL_TOOLS ?? "true").trim().toLowerCase()
));

// The explicit allowlist used only when TRUST_ALL_TOOLS is disabled. Read-only
// discovery tools by default; everything else stays gated in that mode.
export const TRUST_TOOLS = (process.env.AGENT_TRUST_TOOLS || "fs_read,grep")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);

// Heartbeat interval for SSE keep-alive (defeats proxy idle timeouts, see 4.2).
export const SSE_HEARTBEAT_MS = Number(process.env.SSE_HEARTBEAT_MS || 30_000);

// Whether to log raw ACP JSON-RPC traffic for debugging.
export const DEBUG_ACP = !["", "0", "false", "no", "off"].includes(
  String(process.env.DEBUG_ACP || "").trim().toLowerCase()
);

/**
 * Fail fast if the required environment is missing. Called once at startup.
 *
 * Authentication: the agent uses whatever the kiro-cli is authenticated with.
 * If KIRO_API_KEY is set it is used; otherwise the CLI's interactive login
 * (Builder ID / IAM Identity Center via `kiro-cli login`) is used. We do NOT
 * require the key — an exhausted or absent key must not block an otherwise
 * valid interactive session.
 */
export function assertEnvironment() {
  try {
    const version = execSync("kiro-cli --version", { encoding: "utf-8" }).trim();
    console.log(`kiro-cli found: ${version}`);
  } catch {
    console.error("ERROR: kiro-cli not found in PATH");
    process.exit(1);
  }

  // Report the auth mode so a mis-set key is obvious in logs.
  if (KIRO_API_KEY) {
    console.log("Auth: using KIRO_API_KEY from environment.");
  } else {
    try {
      const who = execSync("kiro-cli whoami", { encoding: "utf-8" }).trim().split("\n")[0];
      console.log(`Auth: using kiro-cli interactive login (${who}).`);
    } catch {
      console.warn(
        "WARNING: no KIRO_API_KEY and `kiro-cli whoami` failed — the agent may " +
        "be unauthenticated. Run `kiro-cli login` or set KIRO_API_KEY."
      );
    }
  }
}
