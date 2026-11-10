import express from "express";
import { Router } from "express";
import cookieParser from "cookie-parser";
import { PORT, AGENT_URL } from "./config.js";
import { pool } from "./db/pool.js";
import { engagementsRouter } from "./routes/engagements.js";
import { documentsRouter } from "./routes/documents.js";
import { authRouter } from "./routes/auth.js";
import { createUser, listUsers } from "./domain/users.js";
import { ensureBucket } from "./storage/storage.js";
import { identity, requireCsrf } from "./http/auth.js";

/**
 * server.js - Backend service bootstrap. The only service the frontend talks
 * to: owns the domain, Postgres, (later) S3, and agent orchestration.
 */

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());
// Establish the caller (verify the session cookie -> req.userId + req.csrfToken)
// for every request.
app.use(identity);

// Auth endpoints (register/login/logout/me) are mounted BEFORE the CSRF guard:
// login/register legitimately have no session/CSRF token yet.
app.use("/api", authRouter);

// From here on, reject mutating requests that lack the session's CSRF token
// (double-submit). Safe methods and unauthenticated requests pass through.
app.use(requireCsrf);

// Minimal users route (stub auth for v1: seed/list users).
const usersRouter = Router();
usersRouter.post("/users", async (req, res) => {
  const { email, name, role } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: "email and name required" });
  try { res.status(201).json(await createUser({ email, name, role })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
usersRouter.get("/users", async (req, res) => {
  try { res.json({ users: await listUsers() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/health", async (req, res) => {
  let db = "down";
  try { await pool.query("SELECT 1"); db = "ok"; } catch { /* db down */ }
  res.json({ status: "ok", db, agentUrl: AGENT_URL });
});

app.use("/api", usersRouter);
app.use("/api", engagementsRouter);
app.use("/api", documentsRouter);

// Ensure the object-storage bucket exists before serving (non-fatal if the
// storage backend is briefly unavailable at boot; uploads will retry).
ensureBucket().then(
  () => console.log("Object storage bucket ready."),
  (err) => console.warn(`WARNING: could not ensure S3 bucket at startup: ${err.message}`)
);

app.listen(PORT, () => {
  console.log(`Backend service running on http://localhost:${PORT}`);
  console.log(`  POST /api/users                        - create/seed a user`);
  console.log(`  POST /api/engagements                  - create an engagement`);
  console.log(`  GET  /api/engagements?userId=          - list engagements`);
  console.log(`  GET  /api/engagements/:id              - engagement + artifacts`);
  console.log(`  POST /api/engagements/:id/agent        - run agent (SSE relay)`);
  console.log(`  POST /api/engagements/:id/documents    - upload documents (S3)`);
  console.log(`  GET  /api/engagements/:id/documents    - list documents`);
  console.log(`  GET  /api/documents/download?key=      - download a stored object`);
  console.log(`  POST /api/proposals/:versionId/approve - approve a proposal`);
  console.log(`  GET  /api/health                       - health check`);
  console.log(`  Agent URL: ${AGENT_URL}`);
});
