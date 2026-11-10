/**
 * api.js - Backend API client. The SPA talks ONLY to the backend.
 *
 * The agent-run endpoint streams SSE; browsers' EventSource can't POST a body,
 * so we consume it with fetch + a ReadableStream reader (the researched
 * pattern), which also gives us AbortController for cancellation.
 */

const BASE = "/api";

// Auth: the session lives in an HttpOnly cookie the browser sends automatically
// (we cannot read it from JS — that's the point). We keep only the CSRF token
// in memory and echo it on mutating requests (double-submit). On 401 the app
// clears state and shows sign-in.
let csrfToken = null;
let onUnauthorized = null;
export function setCsrfToken(t) { csrfToken = t || null; }
export function setOnUnauthorized(fn) { onUnauthorized = fn; }

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
function authHeaders(method, extra) {
  const h = { ...(extra || {}) };
  if (!SAFE.has(method) && csrfToken) h["X-CSRF-Token"] = csrfToken;
  return h;
}

async function json(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: "include",
    headers: authHeaders(method, body ? { "Content-Type": "application/json" } : undefined),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && onUnauthorized) onUnauthorized();
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${method} ${path} -> ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  // auth (session-cookie)
  register: (email, name, password) => json("POST", "/auth/register", { email, name, password }),
  login: (email, password) => json("POST", "/auth/login", { email, password }),
  setPassword: (email, password) => json("POST", "/auth/set-password", { email, password }),
  changePassword: (currentPassword, newPassword) => json("POST", "/auth/change-password", { currentPassword, newPassword }),
  logout: () => json("POST", "/auth/logout"),
  me: () => json("GET", "/auth/me"),

  // users
  createUser: (u) => json("POST", "/users", u),
  listUsers: () => json("GET", "/users"),

  // engagements
  createEngagement: (e) => json("POST", "/engagements", e),
  listEngagements: (userId) => json("GET", `/engagements?userId=${encodeURIComponent(userId)}`),
  getEngagement: (id) => json("GET", `/engagements/${id}`),
  updateEngagement: (id, fields) => json("PATCH", `/engagements/${id}`, fields),
  deleteEngagement: (id) => json("DELETE", `/engagements/${id}`),
  cloneEngagement: (id) => json("POST", `/engagements/${id}/clone`),
  setStage: (id, stage) => json("POST", `/engagements/${id}/stage`, { stage }),

  // documents
  listDocuments: (id) => json("GET", `/engagements/${id}/documents`),
  uploadDocuments: async (id, files, addedBy, kind) => {
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    if (addedBy) fd.append("addedBy", addedBy);
    if (kind) fd.append("kind", kind);
    const res = await fetch(`${BASE}/engagements/${id}/documents`, { method: "POST", body: fd, credentials: "include", headers: authHeaders("POST") });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "upload failed");
    return res.json();
  },

  // questionnaire + notes (Inputs & Discovery)
  listQuestionnaire: (id) => json("GET", `/engagements/${id}/questionnaire`),
  addQuestion: (id, q) => json("POST", `/engagements/${id}/questionnaire`, q),
  seedQuestionnaire: (id) => json("POST", `/engagements/${id}/questionnaire/seed`),
  answerQuestion: (answerId, answer) => json("PATCH", `/questionnaire/${answerId}`, { answer }),
  listNotes: (id) => json("GET", `/engagements/${id}/notes`),
  addNote: (id, text, createdBy, kind) => json("POST", `/engagements/${id}/notes`, { text, createdBy, kind }),
  deleteNote: (noteId) => json("DELETE", `/notes/${noteId}`),
  deleteQuestion: (answerId) => json("DELETE", `/questionnaire/${answerId}`),
  deleteDocument: (docId) => json("DELETE", `/documents/${docId}`),

  // reference data (DB-driven)
  listEngagementTypes: () => json("GET", "/engagement-types"),
  questionnaireTemplate: (type) => json("GET", `/questionnaire-templates/${type}`),

  // team & access
  getTeam: (id) => json("GET", `/engagements/${id}/team`),
  invite: (id, email, name) => json("POST", `/engagements/${id}/collaborators`, { email, name }),
  transfer: (id, newOwnerId) => json("POST", `/engagements/${id}/transfer`, { newOwnerId }),
  listUsersAll: () => json("GET", "/users"),

  // proposal
  approveProposal: (versionId, approvedBy) =>
    json("POST", `/proposals/${versionId}/approve`, { approvedBy }),

  // gated review flow (Phase 4A)
  markAnalysisComplete: (id, userId) =>
    json("POST", `/engagements/${id}/analysis/complete`, { userId }),
  decideRecommendation: (recId, decision, reason, userId) =>
    json("POST", `/recommendations/${recId}/decision`, { decision, reason, userId }),
  finalizeRecommendations: (id, userId) =>
    json("POST", `/engagements/${id}/recommendations/finalize`, { userId }),

  // chat (Phase 3/4)
  listChat: (id) => json("GET", `/engagements/${id}/chat`),

  // agent run (SSE over fetch). onEvent(event, data) per streamed event.
  // opts: { instruction, userId, mode?, stage?, refine? } — mode 'analysis'|'chat',
  // stage 'requirements'|'recommendations'|'proposal' (staged gated flow).
  // refine=true marks a recommendations-stage run as a chat refinement turn
  // (persists the user + analyst dialogue as well as revising the recs).
  runAgent(engagementId, { instruction, userId, mode = "analysis", stage = null, refine = false }, onEvent, signal) {
    return streamSse(`${BASE}/engagements/${engagementId}/agent`, { instruction, userId, mode, stage, refine }, onEvent, signal);
  },
};

async function streamSse(url, body, onEvent, signal) {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: authHeaders("POST", { "Content-Type": "application/json", Accept: "text/event-stream" }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `agent run failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      parseFrame(buffer.slice(0, sep), onEvent);
      buffer = buffer.slice(sep + 2);
    }
  }
  if (buffer.trim()) parseFrame(buffer, onEvent);
}

function parseFrame(frame, onEvent) {
  let event = "message";
  const data = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  if (!data.length) return;
  let parsed;
  try { parsed = JSON.parse(data.join("\n")); } catch { parsed = { raw: data.join("\n") }; }
  onEvent(event, parsed);
}
