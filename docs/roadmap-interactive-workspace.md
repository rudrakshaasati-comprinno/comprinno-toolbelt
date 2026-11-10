# v1 → Interactive Analysis Workspace — Plan

> Status: planning document (for review). Captures the agreed direction and a
> phased, testable roadmap. No code changes are implied by this document itself.
> Companion to `architecture-v1.md` (the v1 design) — this file is the forward
> plan built on top of the reviewed codebase.

## 1. Goal

Evolve the v1 Pre-Sales Platform from a one-shot "run analysis → envelope"
tool into an **interactive analysis workspace**: a persistent AI analyst per
engagement that

1. runs the initial **analysis** (requirements → AWS 7R recommendations →
   proposal draft, returned as the `AgentEnvelope`),
2. stays available for **chat** — the consultant asks follow-ups, clarifies,
   explores "what if" scenarios in the same conversation, and
3. **delegates to specialist sub-agents** (TCO, SOW, GPU, and future ones) both
   automatically **during analysis** when a requirement needs specialist depth,
   and on request as **chat** follow-on actions.

Constraints carried from earlier decisions:
- **Kiro-only. No Bedrock.** Envelope reliability comes from a strict prompt
  contract + tolerant extraction + a repair loop (already implemented).
- **Per-engagement storage isolation** (scoped MinIO STS credentials) is already
  in place and applies to every run, including chat.
- **Extensibility is a first-class requirement** — "add more agents later" must
  be a drop-in-a-bundle operation, not a code change.

## 2. Chosen architecture (Path A)

**One persistent `presales-analyst` top-level agent per engagement**, which owns
analysis + chat and **delegates** to specialist sub-agents. New capabilities are
added as specialists the analyst can call.

```
                         ┌─────────────────────────────────────────┐
  engagement (chat/      │  presales-analyst  (one ACP session per   │
  analysis run)  ───────▶│  engagement, reused across runs)          │
                         │   • analysis  → AgentEnvelope             │
                         │   • chat      → answer / mixed            │
                         │   • delegates via `subagent` to:          │
                         │        gpu-advisor · tco-calculator ·     │
                         │        sow-generator · (future agents)    │
                         └─────────────────────────────────────────┘
```

Why Path A (vs. multiple peer top-level agents):
- Chat needs **one coherent brain** holding the engagement conversation — the
  analyst, as a persistent ACP session.
- Everything else you named (TCO, SOW, further exploration) is something the
  analyst **invokes mid-conversation** — i.e. a specialist. So "add more agents"
  usually means "add a specialist," which the bundle + `subagent` model already
  supports cleanly.

## 3. Where the codebase stands (review findings)

Reviewed the whole repo. Two systems coexist: the original Toolbelt
(`src/`, `bundles/`, `libraries/`, root Dockerfile/compose, `public/`) and the
v1 platform (`agent/`, `backend/`, `frontend/`, `docs/`, `docker-compose.yml`).

**Solid in v1 (reuse as-is):**
- `backend/src/db/migrations/001_init.sql` — schema is envelope-aligned;
  DB CHECK constraints already enforce the truth layer (applied⇒high confidence,
  on_hold⇒reason, 7R enum). `engagements.agent_session_id` already exists for
  continuity.
- `backend/src/domain/artifacts.js` — atomic `persistEnvelope`, external-id→UUID
  mapping, proposal versioning.
- Agent reliability: strict contract + repair loop + backend semantic validation.
- Storage isolation: per-engagement scoped STS creds; agent downloads its own
  files; verified 5/5.
- Frontend: componentized, wireframe-matched, staged inputs with explicit save.

**Gaps this plan closes:**
1. **Persona mismatch** — the top-level agent is `orchestrator` (routes to
   GPU/TCO/SOW); no `presales-analyst` exists that owns the envelope/7R job.
2. **One-shot only** — `/agent` takes a single `instruction`; no chat, no `mode`.
3. **Session not reused** — `agent_session_id` is stored but not passed back on
   the next run, so every run is fresh (no memory).
4. **No chat persistence** — no user-message/turn model.
5. **TCO/SOW not wired** as follow-on actions; specialist outputs have no
   artifact home.
6. **Single hardcoded top-level agent** (`AGENT_NAME`); no per-run selection or
   registry for "add more agents."
7. Minor/deferred: `documents.status` "processing" vestige; ownership
   authorization (#2); CORS not applied (#3).

## 4. Phased roadmap

Each phase is independently testable and committable on `v1-architecture`. The
critical path to "analysis + chat working" is Phases 1 → 2 → 4A → 3 → 4.

> **PRIORITY UPDATE (2026-09-25): the gated review flow (Phase 4A below) comes
> BEFORE chat.** The consultant's core workflow is a stage-gated pipeline, not
> free chat; chat is exploration layered on top. See section 4A.

## 4A. Gated review flow (stage-gated HITL) — canonical UX

> **REVISION (2026-09-25, research-backed): separate gated runs + submit-once
> clarification.** The flow below is refined into THREE separate, gated agent
> runs with no manual "Re-analyse". See 4A.1 for the authoritative spec; the
> original prose in this section is retained as background.

## 4A.2 Recommendations stage v2 — collaborative chat refinement (authoritative, supersedes accept/reject)

> **REVISION (2026-09-25, research-backed).** The per-item accept/reject gate
> (commits 8920ae3, fb777b3) is REPLACED by a collaborative chat-refinement
> stage. Rationale: the consultant should discuss and refine the AWS mappings
> WITH the agent until both are satisfied, then finalize — not tick a checkbox
> per item. Research: CHAP (Collaborative Human-Agent Protocol, arXiv
> 2606.09751) — refinement should be captured as structured, confirmed revisions
> (diff + rationale), not lost in a chat thread; S3 WORM / immutable-snapshot
> guidance for the finalized record.

**Flow:**
```
Recommendations run (stage=recommendations) -> recommendations (as before)
  - The tab shows the recommendation list + a CHAT interface.
  - The consultant discusses/refines with the agent. When a change is agreed,
    the agent REVISES the recommendation records (a recommendations-stage run
    that replaces the set); the live list reflects the current state.
  - NO per-item accept/reject, no batch-accept, no decisionStatus gate.
  - [Finalize recommendations] (human decides when both are satisfied):
    writes an IMMUTABLE JSON snapshot of the current recommendations to S3
    (engagements/<id>/recommendations/finalized-<ts>.json) and stamps
    engagements.recommendations_finalized_at/by + recommendations_snapshot_key.
    Postgres remains the working + gating source of truth (per 6.2); S3 holds
    the signed-off record.
  - [Proceed to proposal] (enabled once finalized): runs stage=proposal from
    the FINALIZED recommendations.
```

**Storage:** unchanged from 6.2 — recommendations live in Postgres (queried,
revised, gate the proposal). The Finalize snapshot is an ADDITIONAL immutable
artifact in S3, not a move. The proposal gate becomes
`recommendations_finalized_at IS NOT NULL` instead of `allDecided`.

**Chat:** removed from the Analysis tab (f46c2c1); it lives here on the
Recommendations stage as the refinement surface, reusing the persistent
engagement ACP session (Phase 2).

### 4A.1 Revised staged flow (authoritative)

Three separate agent runs, each gated behind the prior stage's completion,
selected by a `stage` run parameter (mirrors the `mode` param used for chat):

```
Analysis run (stage=requirements) -> requirements only (some needs_info)
  - needs_info items each get an INPUT; ONE page-level [Submit inputs]
    triggers a TARGETED re-run of only the open points (preserve the rest).
    Repeatable if gaps remain; the user may also proceed with a noted gap.
    There is NO manual "Re-analyse" button.
  - If analysis returns ALL sufficient (no needs_info): AUTO-ADVANCE to the
    recommendations run (nothing to resolve). [user override, 2026-09-25]
  - Analysis becomes soft-locked once recommendations start (explicit
    "edit analysis" reopen warns it invalidates downstream).
Recommendations run (stage=recommendations) -> recommendations only
  - STARTS ONLY after analysis is finalized (submit / auto-advance). Never
    before.
  - Accept / reject each (batch-accept high-confidence kept, per review-fatigue
    research). Reject = exclude from proposal (+ reason). ALL must be decided.
Proposal run (stage=proposal) -> proposal, from ACCEPTED recommendations only
  - STARTS ONLY after every recommendation is decided.
  - Existing single human approval gate applies before anything client-facing.
```

**Research-backed decisions (validated 2026-09-25):**
- **Separate gated runs** (not one multi-output run): supported by the HITL
  literature specifically BECAUSE a human gate sits between stages. Do not
  split further than the gates ("Two Calls Beat Five Agents" — naive splitting
  degrades quality).
- **Submit-once clarification** (no iterative re-prompt loop): iterative
  re-prompting is a documented failure mode that degrades the model's grip on
  original intent; batch-collect-then-submit converges. Hence no "Re-analyse".
- **No auto-advance between stages EXCEPT the all-sufficient analysis case**:
  auto-advance removes user control (UX consensus); explicit gate buttons
  otherwise. The all-sufficient case has nothing to resolve, so it advances
  automatically (with a brief "generating recommendations…" cue).
- **Soft-lock completed stages**: going back must be deliberate and warn about
  downstream invalidation (wizard-with-dependencies pattern).
- **All-decided gate + batch-accept**: require every recommendation decided;
  keep batch-accept of high-confidence to prevent review fatigue.
- **Rejected = exclude** (binary, fast decision); "request an alternative" is a
  deferred enhancement.

**Implementation notes:** add a `stage` param to the agent run
(`requirements` | `recommendations` | `proposal`); the analyst returns only
that stage's artifacts (steering split). Persistence already replaces per-stage
artifacts; extend it to persist only the run's stage. Storage unchanged (all
three stages are DB artifacts per 6.2).

## 4A.0 Original gated-flow prose (background)

The engagement progresses through GATED stages; each stage must be resolved
before the next unlocks:

```
  Analysis  ──(mark complete)──▶  Recommendations  ──(all decided)──▶  Proposal
  ▲   │                            accept / reject                    single
  │   ▼                            per recommendation                approval
  reply to needs_info                                                  (existing)
  → Re-analyse (preserve)
```

### Analysis stage — Collaborative Drafting pattern
- Run analysis → requirements, some marked `needs_info`.
- Each `needs_info` requirement gets a **reply input** where the consultant
  supplies the missing information. Replies are stored as engagement inputs
  (notes/questionnaire answers), NOT direct status edits — the agent stays the
  source of truth.
- **Re-analyse** re-runs with the new answers but **PRESERVES** already-good
  (`sufficient`) requirements and only revisits the answered/open ones
  (localized repair, not full restart).
- **Mark analysis complete** is the gate that unlocks Recommendations. If
  `needs_info` items remain, warn but allow (the consultant may accept the gap).

### Recommendations stage — Approval Gate pattern
- Unlocked only after analysis is marked complete.
- Each recommendation is **accepted** or **rejected** by the consultant
  (reject may carry an optional reason). High-confidence items may be
  **batch-accepted** to avoid review fatigue; `on_hold`/low-confidence items
  require individual attention.
- The set of ACCEPTED recommendations is what the proposal is built from.

### Proposal stage — Approval Gate (existing)
- Unlocked only after every recommendation is decided.
- The existing single human approval gate applies before anything is
  client-facing.

### Research basis (validated 2026-09-25)
- **Collaborative Drafting** for analysis: humans editing AI drafts score ~35%
  higher than from-scratch and ~42% higher than binary approve/reject
  (Microsoft Research 2025).
- **Approval Gate** for recommendations/proposal: the most-recommended HITL
  pattern; gate every action that flows to the client. Do NOT gate on the
  model's self-confidence alone — "the agent is most dangerous when most
  confident" (42% of errors at >0.90 confidence). Gate on the human decision.
- **Preserve-on-re-analysis**: "Revisable by Design" (arXiv 2026) — localized
  repair matches full-restart quality with an order of magnitude less wasted
  work, and doesn't churn requirements the consultant already accepted.
- **Review fatigue** is the #1 operational risk: surface only `needs_info` for
  reply, allow batch-accept of high-confidence recs, keep the accept/reject UI
  low-friction.

### Phase 0 — Design sign-off
Add an `architecture-v1.md §4.3` subsection recording: the presales-analyst as
the persistent per-engagement agent; run modes `analysis | chat`; session reuse
via `agent_session_id`; specialist delegation; the add-an-agent path. No code.

### Phase 1 — Create the `presales-analyst` bundle  *(closes gap #1)*
New `bundles/presales-analyst/` = `agent.json` + `manifest.json` +
`steering/*.md` (+ optional `libraries/skills/presales-analyst/SKILL.md`).
Persona encodes the v1 job: extract requirements (sufficient/needs_info +
citations) → map to AWS via 7R with confidence → draft proposal sections →
**emit the AgentEnvelope**, and be ready to answer follow-up chat.

**Delegation is part of ANALYSIS, not just chat.** The analyst may pull in a
specialist DURING the initial analysis whenever a requirement needs depth the
analyst does not have — e.g. a GPU/ML workload in the inventory → consult
`gpu-advisor` for sizing; a recommendation that needs a cost figure → consult
`tco-calculator`. The specialist's findings are folded back into the relevant
requirement/recommendation as evidence, cited to the specialist (e.g.
`source: "gpu-advisor"`); the analyst NEVER emits the specialist's raw report as
the result — it synthesizes it into the envelope. Steering must state this
explicitly (delegate for evidence → synthesize → cite). `toolsSettings.subagent.
trustedAgents = [gpu-advisor, tco-calculator, sow-generator]` (and future agents).
Point `AGENT_NAME` at `presales-analyst`. (The agent image already copies
`bundles/`.) The live `subagent` activity `AcpSession.js` already emits lets the
UI show "consulting GPU Advisor…" as a node in the analysis flow.

> RELIABILITY NOTE: analysis-time delegation makes a run longer and the final
> synthesis harder — the analyst must still return ONE clean `AgentEnvelope`.
> The strict output contract + repair loop (already built) guard the shape;
> the steering guards the behavior (fold specialist output into envelope
> fields with citations, never dump it raw).


### Phase 1b — Shared envelope-contract steering  *(author once, reuse)*
Move the envelope + 7R + citation contract into steering/skill the analyst
(and any future top-level agent) includes, so it is authored once. Trim the
runner's inline contract prompt to a concise reminder that defers to the agent's
own steering. Keep the repair loop.

### Phase 2 — Session continuity  *(closes gap #3; backbone for chat)*
`orchestrateAgentRun` passes `engagement.agent_session_id` as `body.sessionId`
so the analyst continues the same ACP session across runs; confirm the
`AcpSession.load` path; keep persisting the returned session id. Verify a second
run remembers the first.

### Phase 3 — Chat run mode  *(closes gap #2)*
Add `mode: analysis | chat` to `POST /agent` and `POST /engagements/:id/agent`.
- `analysis` = the current envelope flow (unchanged).
- `chat` = a conversational turn in the same session returning `resultType:
  "answer"` (or `"mixed"`) that does **not** overwrite artifacts unless the
  envelope carries explicit updates.
Runner + orchestrate honor `mode`; persistence is conditional (a chat answer is
logged, not a wipe).

### Phase 3b — Chat persistence + history  *(closes gap #4)*
Migration for `chat_messages` (engagement_id, run_id, role user|assistant,
content, created_at) — or extend `agent_activity`. Persist prompts + assistant
answers per engagement; add a history read endpoint so chat survives reload.

### Phase 4 — Frontend chat UI
Chat panel in the Analysis and Recommendations tabs: message list + input,
streaming via the existing SSE-over-fetch client (`api.runAgent` with
`mode:chat`), rendering assistant turns and surfaced activity. Reuses the
engagement session; matches the wireframe theme.

### Phase 5 — TCO + SOW as follow-on actions via delegation  *(closes gap #5)*
Specialist delegation works in BOTH analysis and chat (the analysis-time hook is
established in Phase 1; this phase completes the artifact capture and the
chat-initiated case). The analyst delegates to `tco-calculator` /
`sow-generator` (and future specialists) either automatically during analysis
when a requirement needs it, or on request during chat ("generate a TCO",
"draft the SOW"). Capture specialist output as engagement artifacts (a proposal
section or a new artifact table) shown in the UI. Repurposes the existing
specialist bundles (not deleted).

### Phase 6 — Extensibility: per-run agent selection + add-an-agent path  *(closes gap #6)*
Make the top-level agent selectable per run (backend passes an `agent` name;
the agent service honors it over the `AGENT_NAME` default). Optional lightweight
agent registry/listing for v1 so the UI could offer a choice. Document the
"drop in a `bundles/<name>/` folder" process so future agents are a data change,
not code.

### Phase 7 — End-to-end verification + deferred hardening
Full flow with the interactive login: create engagement + PDF → run analysis →
envelope persists → chat a follow-up (session remembered) → delegate a TCO/SOW →
artifact stored → re-verify per-engagement isolation still holds. Then address
the agreed deferred items: ownership authorization (#2) and CORS (#3).

## 5. Contracts touched (so future changes stay compatible)

- **`POST /agent`** gains `mode` (`analysis`|`chat`) and honors `agent` +
  `sessionId`; still streams the layered SSE events and, for analysis, the
  `result` envelope.
- **`AgentEnvelope`** unchanged structurally; chat uses the existing
  `resultType: "answer" | "mixed"`. TCO/SOW artifacts map to `proposalSections`
  or a new artifact type (decided in Phase 5).
- **DB**: add `chat_messages` (Phase 3b) and possibly a specialist-artifact
  table (Phase 5); everything else already exists.
- **Bundles**: `presales-analyst` is the new top-level agent; GPU/TCO/SOW become
  its delegatable specialists; the scaffold at `scaffolds/bundle/` remains the
  template for new agents.

## 6. Open questions to resolve as we go

- Phase 5: are TCO/SOW outputs **proposal sections**, or a distinct artifact
  type with their own UI area? (Leaning: SOW → proposal section; TCO → its own
  artifact so it can be regenerated independently.)
- Phase 6: does v1 actually need a user-facing agent **picker**, or is per-run
  selection enough for now (UI stays analyst-only until a second top-level agent
  exists)?
- Whether chat turns should be allowed to **mutate** artifacts (e.g. "mark this
  requirement sufficient") in v1, or stay read/explain-only until later.
