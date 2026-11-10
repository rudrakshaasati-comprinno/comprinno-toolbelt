import { callAgent } from "./agentClient.js";
import { validateEnvelopeSemantics } from "./semanticValidation.js";
import { mintEngagementCredentials } from "../storage/sts.js";
import {
  getEngagement, listDocuments, listQuestionnaire, listNotes, setAgentSession,
} from "../domain/engagements.js";
import { persistEnvelope, getRequirements, getRecommendations } from "../domain/artifacts.js";
import { addChatMessage } from "../domain/chat.js";

/**
 * orchestrate.js - The backend's agent-orchestration layer (task #4/#5).
 *
 * Flow:
 *   1. Build the agent `inputs` from the engagement's stored data (documents,
 *      questionnaire, notes). Document TEXT is fetched from S3 (the extracted
 *      sidecar). The agent is domain-agnostic — it receives extracted content,
 *      not DB rows or S3 handles (architecture decision).
 *   2. Call the agent microservice over HTTP+SSE (agentClient).
 *   3. Relay each event to the frontend live (onFrontendEvent).
 *   4. Capture the final `result` envelope and persist it atomically
 *      (persistEnvelope) — the backend is the source of truth (4.2).
 */

async function buildInputs(engagement) {
  const [docs, questionnaire, notes] = await Promise.all([
    listDocuments(engagement.id),
    listQuestionnaire(engagement.id),
    listNotes(engagement.id),
  ]);

  // The agent downloads the raw source files itself from object storage using
  // engagement-scoped credentials (see orchestrateAgentRun), so we no longer
  // fetch document TEXT here. We pass only the file MANIFEST (id, name, kind,
  // and the object key relative to the engagement prefix) so the agent knows
  // what it will find, plus the non-file inputs (questionnaire, notes, use
  // case, goal) which never lived in S3.
  const prefix = `engagements/${engagement.id}/`;
  const documents = docs.map((d) => ({
    id: d.id,
    name: d.name,
    kind: d.kind || "source",
    // Key relative to the engagement prefix; the agent joins it to what it
    // downloads. Absolute key kept for clarity but scoped creds confine it.
    key: d.s3_key && d.s3_key.startsWith(prefix) ? d.s3_key.slice(prefix.length) : d.s3_key,
  }));

  // Prior artifacts (Phase 4A preserve-on-re-analysis): if this engagement was
  // already analyzed, pass the existing requirements + recommendations back so
  // the agent PRESERVES the well-supported ones and only revisits the gaps that
  // new answers address — localized repair, not a full regenerate. Mapped back
  // to the envelope's external-id shape the agent emitted.
  const [priorReqs, priorRecs] = await Promise.all([
    getRequirements(engagement.id),
    getRecommendations(engagement.id),
  ]);
  let priorArtifacts;
  if (priorReqs.length || priorRecs.length) {
    // Map requirement DB uuid -> the external id (req_N) the agent uses, so a
    // recommendation's requirementId lines up with the prior requirements.
    const reqExtById = new Map(priorReqs.map((r) => [r.id, r.external_id || r.id]));
    priorArtifacts = {
      requirements: priorReqs.map((r) => ({
        id: r.external_id || r.id, category: r.category, text: r.text,
        status: r.status, missing: r.missing || "", citations: r.citations || [],
      })),
      recommendations: priorRecs.map((r) => ({
        id: r.external_id || r.id,
        requirementId: r.requirement_id ? (reqExtById.get(r.requirement_id) || "") : "",
        from: r.from_service || "", awsService: r.aws_service, strategy: r.strategy,
        confidence: r.confidence, status: r.status, onHoldReason: r.on_hold_reason || "",
        rationale: r.rationale, impact: r.impact || "", depth: r.depth || "overview",
        ...(r.gpu_detail ? { gpuDetail: r.gpu_detail } : {}),
        citations: r.citations || [],
      })),
    };
  }

  return {
    engagementType: engagement.engagement_type,
    useCase: engagement.use_case || "",
    goal: engagement.goal || "",
    documents,
    questionnaire: questionnaire.map((q) => ({ q: q.question, a: q.answer })),
    notes: notes.map((n) => n.text),
    ...(priorArtifacts ? { priorArtifacts } : {}),
  };
}

/**
 * Run one agent instruction against an engagement, streaming to the frontend
 * and persisting the result.
 *
 * @param {object} params
 * @param {string} params.engagementId
 * @param {string} params.instruction
 * @param {string|null} params.userId
 * @param {(event:string,data:any)=>void} params.onFrontendEvent
 * @param {AbortSignal} [params.signal]
 */
export async function orchestrateAgentRun({
  engagementId, instruction, userId = null, mode = "analysis", stage = null, refine = false, onFrontendEvent, signal,
}) {
  const engagement = await getEngagement(engagementId);
  if (!engagement) throw new Error(`engagement not found: ${engagementId}`);

  const isChat = mode === "chat";
  // A recommendations-stage run flagged refine=true is a collaborative chat
  // turn: it persists the dialogue (user + analyst) AND revises the
  // recommendation set. (An unflagged recommendations run — e.g. the initial
  // auto-advance generation — persists only the recommendations.)
  const isRecoRefinement = refine && stage === "recommendations" && !isChat;

  // In CHAT mode, record the consultant's message up front so it survives even
  // if the run is interrupted. For a REFINEMENT turn we defer persisting the
  // user message until the run succeeds (paired with the analyst reply below),
  // so an aborted/failed refinement leaves no orphaned user bubble with no
  // answer. The optimistic bubble in the UI covers the in-flight window.
  if (isChat) {
    await addChatMessage({ engagementId, role: "user", content: instruction, createdBy: userId }).catch(() => {});
  }

  const inputs = await buildInputs(engagement);

  // Mint engagement-scoped, read-only, short-lived storage credentials so the
  // agent can download THIS engagement's source files and no others. Isolation
  // is enforced by the storage layer via the session policy, not by trust in
  // the agent. If minting fails, fail the run rather than fall back to broad
  // creds.
  const storage = await mintEngagementCredentials(engagementId);

  const body = {
    engagementId,
    sessionId: engagement.agent_session_id || null,
    instruction,
    inputs,
    storage,
    mode,
    stage,
  };

  let finalEnvelope = null;
  let runId = null;

  await callAgent({
    body,
    signal,
    onEvent: (event, data) => {
      // Capture what the backend needs to persist.
      if (event === "run_started" && data.runId) runId = data.runId;
      if (event === "result") finalEnvelope = data;
      // Relay everything to the frontend live.
      onFrontendEvent(event, data);
    },
  });

  // Persist the result. Chat turns save the assistant's answer as a chat
  // message and never overwrite analysis artifacts; analysis runs persist the
  // full envelope as the source of truth (atomic). If the run errored or the
  // client disconnected before a result, there's nothing to persist.
  if (finalEnvelope && isChat) {
    const answer = (finalEnvelope.artifacts && finalEnvelope.artifacts.answer) ||
      "(the analyst returned no answer text)";
    try {
      await addChatMessage({ engagementId, role: "assistant", content: answer, runId: runId || null, createdBy: null });
      if (finalEnvelope.sessionId) await setAgentSession(engagementId, finalEnvelope.sessionId);
      onFrontendEvent("persisted", { engagementId, runId, mode });
    } catch (err) {
      onFrontendEvent("persist_error", { message: err.message });
    }
  } else if (finalEnvelope) {
    // Truth-layer (4.1): the agent guaranteed SHAPE; the backend checks the
    // business rules the schema cannot express. Advisory — we surface
    // violations (the real gate is confidence-gating + the human proposal
    // approval) rather than dropping an otherwise-usable result.
    const semantic = validateEnvelopeSemantics(finalEnvelope);
    if (!semantic.valid) {
      onFrontendEvent("semantic_warning", {
        engagementId,
        violations: semantic.violations,
      });
    }
    try {
      await persistEnvelope({ engagementId, runId: runId || "unknown", envelope: finalEnvelope, userId, stage });
      if (finalEnvelope.sessionId) await setAgentSession(engagementId, finalEnvelope.sessionId);
      // On a refinement turn, also persist the analyst's conversational reply as
      // an assistant chat message so the dialogue (the audit trail of WHY the
      // recommendations changed) survives reloads.
      if (isRecoRefinement) {
        // Pair the user message with the reply, only now that the run
        // succeeded. The dedupe window guards against a rapid double-submit
        // persisting the same turn twice.
        await addChatMessage({ engagementId, role: "user", content: instruction, createdBy: userId, dedupeWindowMs: 60000 }).catch(() => {});
        const answer = (finalEnvelope.artifacts && finalEnvelope.artifacts.answer) ||
          "Updated the recommendations as requested.";
        await addChatMessage({ engagementId, role: "assistant", content: answer, runId: runId || null, createdBy: null }).catch(() => {});
      }
      onFrontendEvent("persisted", { engagementId, runId });
    } catch (err) {
      // Envelope was schema-valid at the agent but violated a DB truth-layer
      // constraint (4.1) — surface it rather than silently drop.
      onFrontendEvent("persist_error", { message: err.message });
    }
  }

  return { runId, envelope: finalEnvelope };
}
