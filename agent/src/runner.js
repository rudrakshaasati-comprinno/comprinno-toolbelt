import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { AcpSession } from "./AcpSession.js";
import { AGENT_NAME } from "./config.js";
import { validateEnvelope } from "./envelope.js";
import { downloadEngagementFiles } from "./storage.js";
import { acquire, withTurnLock } from "./sessionPool.js";

const execFileAsync = promisify(execFile);

// How many times to re-prompt the model to fix an envelope that failed schema
// validation before falling back to a plain answer. Capped to avoid loops.
const MAX_REPAIRS = 2;

// Extensions readable as UTF-8 text directly (no conversion needed).
const TEXT_LIKE = new Set([
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml",
  ".log", ".xml", ".html", ".htm",
]);

/**
 * Turn the files downloaded for an engagement into readable text, keyed by the
 * file's object key RELATIVE to the engagement prefix (which is how the backend
 * manifest identifies each document — the bare basename is ambiguous because
 * the stored object name embeds the docId). PDFs are converted with pdftotext;
 * text-like files and backend-produced `.txt` sidecars are read directly.
 * Returns a Map<relativeKey, text>.
 */
async function extractDownloadedText(files, prefix) {
  const byKey = new Map();
  for (const f of files) {
    // f.key is the absolute object key; strip the engagement prefix to get the
    // relative key the manifest uses.
    const relKey = prefix && f.key && f.key.startsWith(prefix) ? f.key.slice(prefix.length) : (f.key || f.name);
    const ext = path.extname(f.name).toLowerCase();
    try {
      if (ext === ".pdf") {
        // pdftotext <in> - => stdout; -layout keeps tabular structure readable.
        const { stdout } = await execFileAsync("pdftotext", ["-layout", f.path, "-"], {
          maxBuffer: 20 * 1024 * 1024,
        });
        byKey.set(relKey, stdout.trim());
      } else if (TEXT_LIKE.has(ext) || ext === ".txt" || ext === "") {
        byKey.set(relKey, (await readFile(f.path, "utf8")).trim());
      } else {
        // xlsx/docx raw etc.: the readable form is the sibling .txt sidecar the
        // backend produced (a separate downloaded file, keyed <relKey>.txt).
        byKey.set(relKey, "(binary file; see any accompanying .txt extraction)");
      }
    } catch (e) {
      byKey.set(relKey, `(could not read: ${e.message})`);
    }
  }
  return byKey;
}

/**
 * Merge extracted text into the document manifest, matching by the document's
 * object key (relative to the engagement prefix). A source file and its
 * backend-produced "<key>.txt" sidecar can both be present; prefer the raw
 * file's own extraction, else fall back to the "<key>.txt" sidecar text.
 */
function attachTextToDocuments(documents, textByKey) {
  return (documents || []).map((d) => {
    const key = d.key || d.name || "";
    let text = textByKey.get(key);
    if (!text || text.startsWith("(binary")) {
      const sidecar = textByKey.get(`${key}.txt`);
      if (sidecar) text = sidecar;
    }
    return { ...d, text: text || "(content unavailable)" };
  });
}

/**
 * runner.js - Turn a single POST /agent request into an ACP run, streaming
 * layered events (4.2) and returning a validated AgentEnvelope (4.1).
 *
 * RELIABILITY (Kiro-only, no Bedrock). Constrained decoding is not available
 * over ACP, so the envelope shape is made reliable by three cooperating means:
 *   1. A STRICT output contract in the prompt (one fenced ```json envelope,
 *      fields + enums spelled out).
 *   2. Tolerant extraction (extractEnvelopeFromText) that finds the envelope
 *      even if the model wraps prose around it.
 *   3. A REPAIR LOOP: on shape-validation failure, the same ACP session is
 *      re-prompted with the specific validator errors, capped at MAX_REPAIRS
 *      retries; if still invalid, we fall back to a plain "answer" envelope
 *      with the failure surfaced in the activity timeline (never a dead screen).
 * Semantic/business rules (a recommendation references a real requirement, an
 * on_hold item has a reason, applied requires high confidence) are enforced in
 * the BACKEND (see architecture-v1.md 4.1), not here — this module guarantees
 * the shape contract at the agent boundary.
 */

/**
 * Compose the prompt sent to the agent from the instruction + inputs.
 * Deterministic, labeled sections so the agent has clear structure. The agent
 * is domain-agnostic: engagementId is only echoed for correlation.
 */
function composeAgentPrompt({ instruction, inputs, mode, stage }) {
  const parts = [];
  if (mode === "chat") {
    parts.push(
      "# Chat turn\n" +
      "This is a follow-up QUESTION about the engagement you already analyzed in " +
      "this session, not a new analysis. Answer it concisely in artifacts.answer " +
      'with resultType "answer". Do NOT re-run the analysis or change ' +
      "requirements/recommendations unless the user explicitly asks you to. Use " +
      "the conversation and prior artifacts you already have."
    );
  } else if (stage === "requirements") {
    parts.push(
      "# Stage: REQUIREMENTS ONLY\n" +
      "Produce ONLY the requirements for this engagement (resultType \"analysis\"). " +
      "Do NOT produce recommendations or proposalSections — leave those arrays " +
      "empty; they are generated in later, separately-gated stages after the " +
      "human resolves open questions. Mark each requirement sufficient or " +
      "needs_info with citations."
    );
  } else if (stage === "recommendations") {
    parts.push(
      "# Stage: RECOMMENDATIONS (conversational)\n" +
      "The analysis is finalized and the recommendations already exist (see prior " +
      "artifacts). You are now the consultant's AWS advisor in a CHAT about those " +
      "recommendations. Behave like a knowledgeable research assistant (think " +
      "ChatGPT/Claude): answer questions, explain a recommendation, compare options, " +
      "research a service, weigh trade-offs, and pull real facts/prices via your " +
      "tools (web-search, aws-pricing, aws-documentation) or the gpu-advisor " +
      "specialist when useful. Be genuinely helpful and substantive in " +
      "artifacts.answer — that text is the chat reply the user reads.\n" +
      "TWO kinds of turn:\n" +
      "1) A QUESTION / discussion / research request (the common case, e.g. \"explain " +
      "rec_3\", \"compare the cost\", \"which is cheaper\", \"show the comparison\"): " +
      "just answer it well in artifacts.answer and RETURN THE RECOMMENDATIONS " +
      "UNCHANGED (same ids, same fields). Do NOT tack on a ritual notice that you " +
      "changed nothing, and do NOT end every reply by inviting the user to change a " +
      "service — reply naturally, the way an assistant would.\n" +
      "2) An explicit CHANGE request (e.g. \"switch training to p4d\", \"drop the " +
      "SageMaker option\", \"mark the inference recommendation applied\"): apply exactly that change, PRESERVE " +
      "the other recommendations unchanged with ids stable, and briefly say what you " +
      "changed and why in artifacts.answer.\n" +
      "NAMING: in artifacts.answer (the human-facing chat), refer to a recommendation " +
      "by its AWS service or role — e.g. \"the P4de training cluster\" or \"the real-time " +
      "inference recommendation\" — NOT by its internal id (rec_1, rec_2, ...). The ids " +
      "are internal plumbing the user never sees; keep them in the structured records " +
      "but never surface them in prose.\n" +
      "Either way, resultType is \"recommendations\" and you return the COMPLETE " +
      "current recommendation set (it replaces the stored set). Do NOT re-derive " +
      "requirements and do NOT draft proposalSections — leave those empty.\n" +
      "CHARTS: the app renders charts itself from the structured recommendation " +
      "fields (7R strategy, confidence, status) and from estimatedMonthlyCost. So " +
      "NEVER say you 'cannot render charts' or that you 'only work in text' — when " +
      "the user asks to see a comparison/graph, answer the substance in words AND " +
      "make sure the relevant structured data is present (e.g. attach " +
      "estimatedMonthlyCost so a cost chart can draw) so the UI can visualize it.\n" +
      "COST: for a recommendation where you can obtain a defensible monthly figure " +
      "from aws-pricing or gpu-advisor, include the optional estimatedMonthlyCost " +
      "{ amount, currency, basis, confidence, source } so it can be charted; if you " +
      "have no grounded number, OMIT that field (never guess) and keep directional " +
      "wording in impact.\n" +
      "FOLLOW-UPS: also set artifacts.followups to 2-3 SHORT follow-up questions " +
      "the consultant would naturally ask next, phrased from THEIR point of view " +
      "and specific to what you just discussed (e.g. \"How does P4de compare to P5 " +
      "on cost?\", \"What's needed to take the inference GPU off hold?\"). They are " +
      "shown as clickable chips under your reply. Keep each under ~10 words; omit " +
      "the field only if truly nothing sensible follows."
    );
  } else if (stage === "proposal") {
    parts.push(
      "# Stage: PROPOSAL ONLY\n" +
      "The recommendations have been reviewed; build the proposal ONLY from the " +
      "ACCEPTED recommendations provided (resultType \"proposal\"). Produce " +
      "proposalSections only; do NOT re-derive requirements or recommendations — " +
      "leave those empty."
    );
  }
  parts.push(`# Instruction\n${instruction}`);

  if (inputs && typeof inputs === "object") {
    if (inputs.engagementType) parts.push(`# Engagement type\n${inputs.engagementType}`);
    if (inputs.useCase) parts.push(`# Use case\n${inputs.useCase}`);
    if (inputs.goal) parts.push(`# Goal / target to achieve\n${inputs.goal}`);

    const docs = Array.isArray(inputs.documents) ? inputs.documents : [];
    const mom = docs.filter((d) => d.kind === "meeting_mom");
    const sources = docs.filter((d) => d.kind !== "meeting_mom");
    if (sources.length) {
      parts.push(`# Source documents\n` + sources
        .map((d) => `## ${d.name || d.id}\n${d.text || "(content unavailable)"}`).join("\n\n"));
    }
    if (mom.length) {
      parts.push(`# Meeting minutes (MoM)\n` + mom
        .map((d) => `## ${d.name || d.id}\n${d.text || "(content unavailable)"}`).join("\n\n"));
    }
    if (Array.isArray(inputs.questionnaire) && inputs.questionnaire.length) {
      const q = inputs.questionnaire
        .map((item) => `- Q: ${item.q}\n  A: ${item.a ?? "(unanswered)"}`)
        .join("\n");
      parts.push(`# Discovery questionnaire\n${q}`);
    }
    if (Array.isArray(inputs.notes) && inputs.notes.length) {
      parts.push(`# Notes & instructions (treat as explicit cited input)\n` +
        inputs.notes.map((n) => `- ${n}`).join("\n"));
    }
    if (inputs.priorArtifacts && typeof inputs.priorArtifacts === "object") {
      parts.push(`# Prior artifacts (for refinement / re-analysis)\n` +
        "```json\n" + JSON.stringify(inputs.priorArtifacts, null, 2) + "\n```");
    }
  }

  parts.push(
    `# Output contract (STRICT)\n` +
    `Return ONLY a single fenced code block \`\`\`json ... \`\`\` containing one JSON ` +
    `object and NOTHING else — no prose before or after the block. The object ` +
    `is the AgentEnvelope:\n` +
    "```json\n" +
    `{\n` +
    `  "sessionId": "<echo the session id or leave empty>",\n` +
    `  "resultType": "analysis | recommendations | proposal | answer | mixed",\n` +
    `  "artifacts": {\n` +
    `    "requirements": [{ "id": "req_1", "category": "COMPUTE & HOSTING", "text": "...", "status": "sufficient | needs_info", "missing": "", "citations": [{ "source": "file.pdf", "locator": "p.4" }] }],\n` +
    `    "recommendations": [{ "id": "rec_1", "requirementId": "req_1", "from": "", "awsService": "...", "strategy": "rehost | replatform | repurchase | refactor | retire | retain | relocate", "confidence": "high | medium | low", "status": "applied | on_hold | override", "onHoldReason": "", "rationale": "...", "impact": "", "citations": [] }],\n` +
    `    "proposalSections": [{ "id": "sec_exec", "title": "Executive summary", "content": "markdown", "status": "drafted | needs_review | reviewed" }],\n` +
    `    "answer": ""\n` +
    `  },\n` +
    `  "activity": [{ "ts": "ISO-8601", "label": "<short label of what you did, e.g. Read inventory.txt>", "message": "..." }]\n` +
    `}\n` +
    "```\n" +
    `Rules that MUST hold:\n` +
    `- Populate only the artifacts relevant to resultType; others may be empty arrays / "".\n` +
    `- Every recommendation.requirementId MUST reference an existing requirements[].id.\n` +
    `- status "applied" is allowed ONLY when confidence is "high"; otherwise use "on_hold".\n` +
    `- Any "on_hold" recommendation MUST have a non-empty onHoldReason.\n` +
    `- Any "needs_info" requirement MUST have a non-empty missing.\n` +
    `- Cite the source documents / questionnaire for every requirement and recommendation.\n` +
    `- Use the 7R strategy enum exactly. Cost/impact must be directional, never a priced quote.\n` +
    `- Enums must match exactly (lowercase where shown). No extra fields.`
  );

  return parts.join("\n\n");
}

/**
 * Best-effort extraction of a JSON envelope from the assistant's text output.
 * Kiro/ACP cannot constrain decoding, so the model is *asked* (strict output
 * contract) to emit one fenced ```json envelope. This parser is tolerant:
 *   1. try every ```json fenced block (last one wins if several),
 *   2. then any generic fenced block,
 *   3. then the widest {...} span,
 * and accepts the first candidate that parses AND looks envelope-shaped
 * (has resultType or artifacts). Shape is then validated by the schema; this
 * only has to *find* the object, not trust it.
 */
function extractEnvelopeFromText(text, sessionId) {
  if (typeof text !== "string" || !text.trim()) return null;

  const candidates = [];
  // All ```json ... ``` blocks (prefer these; later blocks first, as a model
  // that "thinks then answers" tends to put the final envelope last).
  const jsonFences = [...text.matchAll(/```json\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  candidates.push(...jsonFences.reverse());
  // Any generic ``` ... ``` block.
  const anyFences = [...text.matchAll(/```\s*([\s\S]*?)```/g)].map((m) => m[1]);
  candidates.push(...anyFences.reverse());
  // Widest brace span as a last resort.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));

  for (const raw of candidates) {
    if (!raw || !raw.trim()) continue;
    let obj;
    try { obj = JSON.parse(raw.trim()); } catch { continue; }
    if (obj && typeof obj === "object" && !Array.isArray(obj) &&
        ("resultType" in obj || "artifacts" in obj)) {
      if (!obj.sessionId) obj.sessionId = sessionId;
      return obj;
    }
  }
  return null;
}

/**
 * Execute one agent run.
 *
 * @param {object} params
 * @param {object} params.body - the POST /agent request body
 * @param {SseStream} params.stream - SSE writer
 * @param {AbortSignal} params.signal - aborts when the client disconnects
 * @returns {Promise<void>}
 */
export async function runAgent({ body, stream, signal }) {
  const runId = randomUUID();
  const { engagementId = null, sessionId: existingSessionId = null } = body || {};

  await stream.send("run_started", { runId, engagementId, ts: new Date().toISOString() });

  const activity = [];
  const chunks = [];

  // One-time (cold) warm-up for a pooled session: download this engagement's
  // source files with the scoped creds, extract their text, and initialize/load
  // the ACP session. On WARM reuse this whole callback is skipped, so a
  // chat/refinement turn pays none of it — no re-download, no session/load.
  const warm = async (session) => {
    let downloadDir = null;
    let docText = null; // key -> extracted text, cached on the entry for warm reuse
    if (body?.storage && body?.inputs) {
      try {
        const { dir, files } = await downloadEngagementFiles(body.storage);
        downloadDir = dir;
        docText = await extractDownloadedText(files, body.storage.prefix);
        await stream.send("activity", {
          ts: new Date().toISOString(), label: "Download files",
          message: `Downloaded ${files.length} engagement file(s) from storage.`,
        }).catch(() => {});
      } catch (err) {
        await stream.send("activity", {
          ts: new Date().toISOString(), label: "Download files",
          message: `Could not download engagement files: ${err.message}`,
        }).catch(() => {});
      }
    }
    // Initialize or load the session ONCE for this pooled process.
    let info;
    if (existingSessionId) {
      try {
        info = await session.load(existingSessionId);
        await stream.send("activity", {
          ts: new Date().toISOString(), label: "Resume session",
          message: "Resumed the engagement's agent session.",
        }).catch(() => {});
      } catch {
        info = await session.initialize();
        await stream.send("activity", {
          ts: new Date().toISOString(), label: "Start session",
          message: "Previous agent session unavailable; started a fresh one.",
        }).catch(() => {});
      }
    } else {
      info = await session.initialize();
    }
    return { downloadDir, docText, info, modes: info?.modes };
  };

  // Acquire a warm pooled session keyed by engagement (fall back to the ACP
  // session id, then the runId, so a keyless run still works).
  const poolKey = engagementId || existingSessionId || runId;
  const makeSession = () => new AcpSession({ agent: AGENT_NAME, trustTools: undefined });

  let acquired;
  try {
    acquired = await acquire(poolKey, makeSession, warm);
  } catch (err) {
    await stream.send("run_error", { runId, message: `session warm-up failed: ${err.message}` }).catch(() => {});
    return;
  }
  const { entry } = acquired;
  const session = entry.session;

  // Attach the (already-extracted) document text to this run's inputs. On a cold
  // start the text came from warm(); on warm reuse we reuse what the entry
  // cached, so we never re-download. Warm reuse is intentionally SILENT (no
  // per-turn activity step) so a chat turn just answers without narrating setup.
  if (body?.inputs && entry.docText) {
    body.inputs.documents = attachTextToDocuments(body.inputs.documents, entry.docText);
  }

  // If the client disconnects, cancel the CURRENT prompt so it doesn't run
  // forever burning credits (4.2 cancellation) — but DO NOT close the session;
  // the pool owns its lifecycle and keeps it warm for the next turn.
  const onAbort = () => { session.cancel?.().catch(() => {}); };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }

  // Relay ACP events -> layered SSE + collect activity/text for the envelope.
  const unsubscribe = session.addListener((event, data) => {
    if (event === "chunk" && data.origin !== "subagent") {
      chunks.push(data.text || "");
    } else if (event === "tool") {
      // Emergent activity: the label is the REAL tool the agent invoked
      // (title/toolName from ACP), not a fixed phase. Only emit on tool start
      // so the timeline reads as a list of actions taken.
      if (data.phase === "start") {
        const entry = {
          ts: new Date().toISOString(),
          label: data.toolName || data.title || "tool",
          message: data.title || data.toolName || "tool call",
        };
        activity.push(entry);
        stream.send("activity", entry).catch(() => {});
      }
    } else if (event === "subagent") {
      // A delegated specialist is real, high-value activity to surface.
      const names = (data.subagents || []).map((s) => s.name).filter(Boolean);
      if (names.length) {
        const entry = {
          ts: new Date().toISOString(),
          label: "Consult " + names.join(", "),
          message: "Delegated to specialist: " + names.join(", "),
        };
        activity.push(entry);
        stream.send("activity", entry).catch(() => {});
      }
    } else if (event === "status") {
      stream.send("activity", {
        ts: new Date().toISOString(), label: "Status", message: data.message || "",
      }).catch(() => {});
    }
  });

  try {
    // The session was initialized/loaded exactly once during warm-up (cold
    // start) and is reused warm thereafter, so there is no per-turn session
    // load here anymore. Use the modes cached on the pool entry for the plan.
    await stream.send("plan", {
      goal: (body?.instruction || "").slice(0, 200),
      steps: ["gather", "analyze", "reason", "report"],
      agents: entry.modes || [],
    });

    const prompt = composeAgentPrompt(body);
    const sid = () => session.acpSessionId || runId;

    // Run one prompt turn: send text, honor the stopReason guard, and return
    // the collected assistant text (chunks accumulate via the listener).
    const runTurn = async (text) => {
      chunks.length = 0; // only care about the latest turn's text
      // Serialize against other turns for this same pooled session (one child
      // process == one conversation): a concurrent turn waits its turn.
      const result = await withTurnLock(entry, () => session.prompt(text));
      const stopReason = result?.stopReason || "end_turn";
      return { stopReason, text: chunks.join("") };
    };

    // Initial turn.
    let turn = await runTurn(prompt);
    if (turn.stopReason === "refusal" || turn.stopReason === "max_tokens") {
      await stream.send("run_error", {
        runId,
        message: `agent stopped with reason "${turn.stopReason}"; result not usable`,
        stopReason: turn.stopReason,
      });
      return;
    }

    let envelope = extractEnvelopeFromText(turn.text, sid());
    let validation = envelope ? validateEnvelope(envelope) : { valid: false, errors: ["no JSON envelope found in the output"] };

    // REPAIR LOOP: re-prompt the SAME session with the specific errors, so the
    // model corrects only what's wrong. Capped at MAX_REPAIRS.
    let repairs = 0;
    while (!validation.valid && repairs < MAX_REPAIRS) {
      repairs++;
      const errList = validation.errors.map((e) => `- ${e}`).join("\n");
      await stream.send("activity", {
        ts: new Date().toISOString(), label: "Repair output",
        message: `Envelope failed validation; requesting correction (attempt ${repairs}/${MAX_REPAIRS}).`,
      }).catch(() => {});
      const repairPrompt =
        `Your previous response did not satisfy the output contract. ` +
        `Fix ONLY these problems and return the corrected AgentEnvelope as a ` +
        `single \`\`\`json fenced block with no other text:\n${errList}`;
      turn = await runTurn(repairPrompt);
      if (turn.stopReason === "refusal" || turn.stopReason === "max_tokens") break;
      const repaired = extractEnvelopeFromText(turn.text, sid());
      if (repaired) {
        envelope = repaired;
        validation = validateEnvelope(envelope);
      }
    }

    // FALLBACK (a): after exhausting repairs, never leave a dead screen — return
    // a plain "answer" envelope, but SURFACE the degradation in the activity
    // timeline so a low-quality result is clearly labeled, not silent.
    if (!validation.valid) {
      activity.push({
        ts: new Date().toISOString(), label: "Best-effort answer",
        message: `Structured extraction failed after ${repairs} repair attempt(s); returning best-effort answer. (${validation.errors.slice(0, 3).join("; ")})`,
      });
      envelope = {
        sessionId: sid(),
        resultType: "answer",
        artifacts: { answer: turn.text.trim() || "(no output)" },
        activity,
      };
    } else if (!Array.isArray(envelope.activity) || !envelope.activity.length) {
      envelope.activity = activity.length ? activity : [
        { ts: new Date().toISOString(), label: "Complete", message: "Completed." },
      ];
    }

    // Final shape check on whatever we ended with (the fallback is valid by
    // construction, but this guards against a bad repaired envelope slipping
    // through the loop's last iteration).
    const finalCheck = validateEnvelope(envelope);
    if (!finalCheck.valid) {
      await stream.send("run_error", {
        runId,
        message: "agent produced an envelope that failed schema validation",
        errors: finalCheck.errors,
      });
      return;
    }

    await stream.send("result", envelope);
    await stream.send("run_finished", { runId, sessionId: envelope.sessionId, ts: new Date().toISOString() });
  } catch (err) {
    await stream.send("run_error", { runId, message: err.message }).catch(() => {});
  } finally {
    // The session stays WARM in the pool for the next turn: do NOT close it and
    // do NOT clean its download dir here (the pool evicts + cleans up on idle
    // TTL or when the process dies). Only detach this run's listener/abort hook.
    unsubscribe();
    if (signal) signal.removeEventListener?.("abort", onAbort);
  }
}
