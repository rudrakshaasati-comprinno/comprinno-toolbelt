import { Router } from "express";
import { SseStream } from "../http/sse.js";
import { orchestrateAgentRun } from "../agent/orchestrate.js";
import {
  createEngagement, getEngagement, listEngagementsForUser, updateEngagementStage,
  updateEngagementFields, markAnalysisComplete,
  listQuestionnaire, addQuestionnaireAnswer, updateQuestionnaireAnswer, deleteQuestionnaireAnswer,
  listNotes, addNote, deleteNote, listCollaborators, addCollaborator, transferOwnership,
  userCanAccessEngagement, deleteEngagement, cloneEngagementOverview,
} from "../domain/engagements.js";
import { getUserByEmail, createUser } from "../domain/users.js";
import { listChatMessages } from "../domain/chat.js";
import { authorizeEngagement } from "../http/auth.js";
import { deleteObject, copyObject } from "../storage/storage.js";
import { listEngagementTypes, questionnaireTemplate } from "../domain/reference.js";
import {
  getRequirements, getRecommendations, getLatestProposal, approveProposal, getActivity,
  decideRecommendation, recommendationDecisionStatus, finalizeRecommendations,
} from "../domain/artifacts.js";

export const engagementsRouter = Router();

// Authorize every route that targets a specific engagement by :id. Express
// runs param middleware before the matching handlers, so a caller who is not
// the owner/collaborator is rejected (403) before any engagement data is read
// or mutated. Routes without :id (create, list, reference data, and the
// recommendation/proposal/questionnaire/notes sub-resource routes keyed by
// their own ids) are guarded separately where needed.
engagementsRouter.param("id", (req, res, next) => authorizeEngagement(req, res, next));

/** POST /api/engagements — create an engagement. */
engagementsRouter.post("/engagements", async (req, res) => {
  const { name, clientName, engagementType, customType, useCase, goal } = req.body || {};
  const ownerId = req.userId;   // owner is the authenticated caller, never client-supplied
  if (!ownerId) return res.status(401).json({ error: "authentication required" });
  if (!name || !clientName || !engagementType) {
    return res.status(400).json({ error: "name, clientName, engagementType are required" });
  }
  if (engagementType === "custom" && (!customType || !customType.trim())) {
    return res.status(400).json({ error: "customType is required when engagementType is custom" });
  }
  if (!useCase || !useCase.trim()) {
    return res.status(400).json({ error: "useCase (use case description) is required" });
  }
  // goal is optional at creation — it can be set on the Overview before running analysis.
  // For custom, persist the user's custom type text as the engagement type.
  const effectiveType = engagementType === "custom" ? customType.trim() : engagementType;
  try {
    const e = await createEngagement({ name, clientName, engagementType: effectiveType, ownerId, useCase, goal });
    res.status(201).json(e);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/engagements — list engagements for the authenticated caller. */
engagementsRouter.get("/engagements", async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "authentication required" });
  try {
    res.json({ engagements: await listEngagementsForUser(String(userId)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/engagements/:id — engagement + its artifacts (for the screens). */
engagementsRouter.get("/engagements/:id", async (req, res) => {
  try {
    const engagement = await getEngagement(req.params.id);
    if (!engagement) return res.status(404).json({ error: "engagement not found" });
    const [requirements, recommendations, proposal, activity, decisionStatus] = await Promise.all([
      getRequirements(engagement.id),
      getRecommendations(engagement.id),
      getLatestProposal(engagement.id),
      getActivity(engagement.id),
      recommendationDecisionStatus(engagement.id),
    ]);
    res.json({ engagement, requirements, recommendations, proposal, activity, decisionStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/engagements/:id/agent — run an agent instruction (SSE relay).
 * Body: { instruction, userId?, documentText? }
 * Streams the agent's events to the frontend and persists the envelope.
 */
engagementsRouter.post("/engagements/:id/agent", async (req, res) => {
  const { instruction, mode = "analysis", stage = null, refine = false } = req.body || {};
  const userId = req.userId;   // the authenticated caller
  if (!userId) return res.status(401).json({ error: "authentication required" });
  if (!instruction || typeof instruction !== "string" || !instruction.trim()) {
    return res.status(400).json({ error: "instruction is required" });
  }

  const stream = new SseStream(res);
  // Frontend disconnect -> abort the upstream agent call (chains to the ACP run).
  const controller = new AbortController();
  res.on("close", () => { controller.abort(); stream.close(); });

  try {
    await orchestrateAgentRun({
      engagementId: req.params.id,
      instruction,
      userId,
      mode,
      stage,
      refine,
      signal: controller.signal,
      onFrontendEvent: (event, data) => stream.send(event, data),
    });
  } catch (err) {
    stream.send("error", { message: err.message });
  } finally {
    stream.close();
  }
});

/** PATCH /api/engagements/:id — edit engagement details (from Overview). */
engagementsRouter.patch("/engagements/:id", async (req, res) => {
  const { useCase, goal, clientName, engagementType, name } = req.body || {};
  try {
    const e = await updateEngagementFields(req.params.id, { useCase, goal, clientName, engagementType, name });
    if (!e) return res.status(404).json({ error: "engagement not found" });
    res.json(e);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * DELETE /api/engagements/:id — permanently delete an engagement and ALL of its
 * data: the DB rows cascade (documents, notes, questionnaire, requirements,
 * recommendations, proposals, collaborators) and the document objects are purged
 * from storage. authorizeEngagement (router.param) has already confirmed the
 * caller owns/collaborates on it.
 */
engagementsRouter.delete("/engagements/:id", async (req, res) => {
  try {
    const { deleted, s3Keys } = await deleteEngagement(req.params.id);
    if (!deleted) return res.status(404).json({ error: "engagement not found" });
    // Purge storage after the row is gone (best-effort; DB is the source of truth).
    await Promise.all((s3Keys || []).map((k) => deleteObject(k)));
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/engagements/:id/clone — duplicate ONLY the Overview inputs into a
 * new engagement owned by the caller: metadata, documents (objects copied),
 * notes, and questionnaire answers. Analysis, recommendations, and proposal are
 * NOT copied. Returns the new engagement.
 */
engagementsRouter.post("/engagements/:id/clone", async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "authentication required" });
  try {
    const clone = await cloneEngagementOverview(req.params.id, userId, copyObject);
    if (!clone) return res.status(404).json({ error: "engagement not found" });
    res.status(201).json(clone);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/engagements/:id/analysis/complete — mark analysis done (the gate
 * that unlocks the Recommendations stage). Body: { userId? }
 */
engagementsRouter.post("/engagements/:id/analysis/complete", async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "authentication required" });
  try {
    const e = await markAnalysisComplete(req.params.id, userId);
    if (!e) return res.status(404).json({ error: "engagement not found" });
    res.json(e);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/engagements/:id/recommendations/finalize — finalize the
 * recommendations (Recommendations stage v2 gate): snapshot the current recs to
 * S3 and stamp the engagement. Unlocks the Proposal stage. Body: { userId? }
 */
engagementsRouter.post("/engagements/:id/recommendations/finalize", async (req, res) => {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "authentication required" });
  try {
    const e = await finalizeRecommendations(req.params.id, userId);
    if (!e) return res.status(404).json({ error: "engagement not found" });
    res.json(e);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/**
 * POST /api/recommendations/:id/decision — accept/reject a recommendation (the
 * Recommendations-stage gate). Body: { decision: 'accepted'|'rejected'|'pending', reason?, userId? }
 */
engagementsRouter.post("/recommendations/:recId/decision", async (req, res) => {
  const { decision, reason = null } = req.body || {};
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: "authentication required" });
  if (!decision) return res.status(400).json({ error: "decision is required" });
  try {
    const rec = await decideRecommendation(req.params.recId, { decision, reason, userId });
    if (!rec) return res.status(404).json({ error: "recommendation not found" });
    // Defense-in-depth: the recommendation must belong to an engagement the
    // caller can access.
    const { allowed } = await userCanAccessEngagement(rec.engagement_id, userId);
    if (!allowed) return res.status(403).json({ error: "not authorized for this engagement" });
    res.json(rec);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

/** POST /api/engagements/:id/stage — update stage. */
engagementsRouter.post("/engagements/:id/stage", async (req, res) => {
  const { stage } = req.body || {};
  if (!stage) return res.status(400).json({ error: "stage is required" });
  try {
    const e = await updateEngagementStage(req.params.id, stage);
    if (!e) return res.status(404).json({ error: "engagement not found" });
    res.json(e);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/proposals/:versionId/approve — the single human approval gate. */
engagementsRouter.post("/proposals/:versionId/approve", async (req, res) => {
  const { approvedBy } = req.body || {};
  try {
    const v = await approveProposal(req.params.versionId, approvedBy || null);
    if (!v) return res.status(404).json({ error: "proposal version not found" });
    res.json(v);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Inputs & Discovery: questionnaire + notes ─────────────────────────────
engagementsRouter.get("/engagements/:id/questionnaire", async (req, res) => {
  try { res.json({ questionnaire: await listQuestionnaire(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.post("/engagements/:id/questionnaire", async (req, res) => {
  const { question, answer, updatedBy } = req.body || {};
  if (!question) return res.status(400).json({ error: "question is required" });
  try { res.status(201).json(await addQuestionnaireAnswer({ engagementId: req.params.id, question, answer, updatedBy })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.patch("/questionnaire/:answerId", async (req, res) => {
  const { answer } = req.body || {};
  try {
    const row = await updateQuestionnaireAnswer(req.params.answerId, answer);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.get("/engagements/:id/notes", async (req, res) => {
  try { res.json({ notes: await listNotes(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

/** GET /api/engagements/:id/chat — chat history for the engagement. */
engagementsRouter.get("/engagements/:id/chat", async (req, res) => {
  try { res.json({ messages: await listChatMessages(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.post("/engagements/:id/notes", async (req, res) => {
  const { text, createdBy, kind } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required" });
  try { res.status(201).json(await addNote({ engagementId: req.params.id, text, createdBy, kind })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.delete("/notes/:noteId", async (req, res) => {
  try { await deleteNote(req.params.noteId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.delete("/questionnaire/:answerId", async (req, res) => {
  try { await deleteQuestionnaireAnswer(req.params.answerId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reference data (DB-driven) ────────────────────────────────────────────
engagementsRouter.get("/engagement-types", async (req, res) => {
  try { res.json({ types: await listEngagementTypes() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.get("/questionnaire-templates/:type", async (req, res) => {
  try { res.json({ questions: await questionnaireTemplate(req.params.type) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Seed an engagement's questionnaire from its type's template.
engagementsRouter.post("/engagements/:id/questionnaire/seed", async (req, res) => {
  try {
    const engagement = await getEngagement(req.params.id);
    if (!engagement) return res.status(404).json({ error: "engagement not found" });
    const existing = await listQuestionnaire(req.params.id);
    if (existing.length) return res.json({ questionnaire: existing }); // already seeded
    const questions = await questionnaireTemplate(engagement.engagement_type);
    for (const q of questions) await addQuestionnaireAnswer({ engagementId: req.params.id, question: q });
    res.status(201).json({ questionnaire: await listQuestionnaire(req.params.id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Team & Access: collaborators + ownership transfer ─────────────────────
engagementsRouter.get("/engagements/:id/team", async (req, res) => {
  try {
    const engagement = await getEngagement(req.params.id);
    if (!engagement) return res.status(404).json({ error: "engagement not found" });
    const collaborators = await listCollaborators(req.params.id);
    res.json({ ownerId: engagement.owner_id, collaborators });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.post("/engagements/:id/collaborators", async (req, res) => {
  // Invite by email: create/find the user, then add as collaborator.
  const { email, name } = req.body || {};
  if (!email) return res.status(400).json({ error: "email is required" });
  try {
    let u = await getUserByEmail(email);
    if (!u) u = await createUser({ email, name: name || email.split("@")[0] });
    await addCollaborator(req.params.id, u.id);
    res.status(201).json(u);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
engagementsRouter.post("/engagements/:id/transfer", async (req, res) => {
  const { newOwnerId } = req.body || {};
  if (!newOwnerId) return res.status(400).json({ error: "newOwnerId is required" });
  try {
    const e = await transferOwnership(req.params.id, newOwnerId);
    if (!e) return res.status(404).json({ error: "engagement not found" });
    res.json(e);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
