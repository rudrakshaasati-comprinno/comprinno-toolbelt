import express from "express";
import { PORT, AGENT_NAME, WORKSPACE_DIR, assertEnvironment } from "./config.js";
import { agentRouter } from "./routes.js";

/**
 * server.js - Agent microservice bootstrap.
 *
 * A single POST /agent endpoint (HTTP + SSE) wrapping kiro-cli acp + the
 * top-level agent. Domain-agnostic: no DB, no S3, no engagement knowledge.
 */

assertEnvironment();

const app = express();
// Envelopes and document text can be large; allow a generous JSON body.
app.use(express.json({ limit: "25mb" }));

app.get("/health", (req, res) => {
  res.json({ status: "ok", agent: AGENT_NAME, workspace: WORKSPACE_DIR });
});

app.use("/", agentRouter);

app.listen(PORT, () => {
  console.log(`Agent microservice running on http://localhost:${PORT}`);
  console.log(`  POST /agent   - single instruction-driven endpoint (SSE)`);
  console.log(`  GET  /health  - health check`);
  console.log(`  Agent: ${AGENT_NAME}   Workspace: ${WORKSPACE_DIR}`);
});
