import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { Citations } from "./common.jsx";

/* AI Analysis — live vertical node flow (left) + found artifacts (right) */
export function Analysis({ data, id, user, autoRun, onChange, onConsumed }) {
  const { requirements, activity } = data;
  const [filter, setFilter] = useState("all");
  const sufficient = requirements.filter((r) => r.status === "sufficient").length;
  const needInfo = requirements.filter((r) => r.status === "needs_info").length;
  const shown = requirements.filter((r) => filter === "all" || r.status === filter);
  const analyzed = requirements.length > 0;

  const [running, setRunning] = useState(false);
  const [liveNodes, setLiveNodes] = useState([]);
  const [runErr, setRunErr] = useState(null);
  const [replies, setReplies] = useState({});   // requirementId -> draft answer text
  const [busy, setBusy] = useState(false);
  const analysisComplete = !!data.engagement.analysis_completed_at;
  const hasRecommendations = (data.recommendations || []).length > 0;

  const run = useCallback(async (instruction, stage) => {
    setRunning(true); setRunErr(null); setLiveNodes([]);
    try {
      await api.runAgent(id, { instruction, userId: user.id, stage }, (event, dataEv) => {
        if (event === "plan" && dataEv.goal) {
          setLiveNodes((n) => [...n, { label: "Plan", detail: dataEv.goal }]);
        }
        if (event === "activity" && dataEv.message) {
          setLiveNodes((n) => [...n, { label: dataEv.label || dataEv.phase || "Step", detail: dataEv.message }]);
        }
      });
      onChange && onChange();
    } catch (e) { setRunErr(e.message); } finally { setRunning(false); }
  }, [id, user.id, onChange]);

  // Kick off the recommendations stage (called on advance from analysis).
  const runRecommendations = useCallback(() =>
    run("Map the finalized requirements to AWS services (7R) with confidence and citations.", "recommendations"),
  [run]);

  // Finalize analysis + advance to recommendations. Marks the gate (idempotent),
  // then runs the separate recommendations stage. runRecommendations surfaces
  // its own error via setRunErr, so a failed recs run is visible (and retryable)
  // rather than silently leaving the stage complete-but-empty.
  const advanceToRecommendations = useCallback(async () => {
    setBusy(true);
    try {
      if (!analysisComplete) await api.markAnalysisComplete(id, user.id);
      await runRecommendations();
    } finally { setBusy(false); }
  }, [id, user.id, runRecommendations, analysisComplete]);

  useEffect(() => {
    if (autoRun && autoRun.instruction) {
      // Initial analysis is the requirements stage.
      run(autoRun.instruction, "requirements");
      onConsumed && onConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun && autoRun.at]);

  // Auto-advance (B3 override): once analysis has run and every requirement is
  // sufficient (no gaps to resolve), move to the recommendations stage. Retries
  // even if analysis is already marked complete but recommendations are still
  // missing (a prior recs run failed), so the flow can't get stuck.
  useEffect(() => {
    if (!running && !busy && analyzed && needInfo === 0 && !hasRecommendations && !runErr) {
      advanceToRecommendations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, busy, analyzed, needInfo, analysisComplete, hasRecommendations]);

  // The Analysis tab shows the ANALYSIS (requirements-stage) activity only.
  // Each persisted activity row carries the originating run's `stage`
  // (result_type) from the backend join; exclude recommendations/proposal
  // activity so this timeline reflects the analysis flow. Rows with no stage
  // (legacy single-run analysis) are kept. The Overview page shows all activity.
  const analysisActivity = (activity || []).filter(
    (a) => a.stage !== "recommendations" && a.stage !== "proposal"
  );
  const dynamicNodes = running
    ? liveNodes
    : analysisActivity.map((a) => ({ label: a.label || a.phase || "Step", detail: a.message }));

  // Update a needs_info requirement's draft reply (staged locally).
  const setReply = (rid, val) => setReplies((p) => ({ ...p, [rid]: val }));

  // Open (needs_info) requirements that still have no non-empty draft answer.
  // The Submit control stays disabled until this reaches zero, so every gap
  // must be answered before analysis can advance to recommendations.
  const unanswered = requirements.filter(
    (r) => r.status === "needs_info" && !(replies[r.id] || "").trim()
  ).length;

  // Submit inputs: post every provided answer as a cited note, then run a
  // TARGETED requirements re-run that resolves the gaps and preserves the rest.
  // This is the ONLY re-run path — there is no manual "Re-analyse".
  const submitInputs = async () => {
    const answered = requirements.filter((r) => r.status === "needs_info" && (replies[r.id] || "").trim());
    setBusy(true);
    try {
      for (const r of answered) {
        await api.addNote(id, `Re: ${r.text} — ${replies[r.id].trim()}`, user.id);
      }
      setReplies({});
      await run(
        "Re-evaluate ONLY the requirements currently marked needs_info using the " +
        "newly provided answers/notes; preserve the sufficient ones unchanged. " +
        "Return the complete requirement set.",
        "requirements"
      );
    } finally { setBusy(false); }
  };

  return (
    <div className="analysis">
      <div className="vflow">
        <div className="vflow-title">Analysis flow</div>
        {/* Root node: the analysis run itself. */}
        <div className={"vnode" + (running ? " active" : (analyzed ? " done" : " todo"))}>
          <span className="check">✓</span>
          <div className="k">
            {running ? <>Analysing… <span className="spinner" style={{ width: 10, height: 10 }} /></> : "Analysis"}
          </div>
          <div className="d">{running ? "Working through the engagement inputs" : (analyzed ? "Completed" : "Not started")}</div>
        </div>
        {/* Emergent step nodes (real agent activity). While running, the last
            node is the current step; the rest are done. When idle they are all
            done. */}
        {dynamicNodes.map((n, i) => {
          const isLast = i === dynamicNodes.length - 1;
          const state = running ? (isLast ? " active" : " done") : " done";
          return (
            <div key={i} className={"vnode" + state}>
              <span className="check">✓</span>
              <div className="k">{n.label}</div>
              {n.detail && <div className="d">{n.detail}</div>}
            </div>
          );
        })}
        {running && !dynamicNodes.length && (
          <div className="vnode active"><div className="d">Starting…</div></div>
        )}
      </div>

      <div>
        {runErr && <div className="card err">Analysis failed: {runErr}</div>}

        {!running && !analyzed && !runErr && (
          <p className="muted">No analysis yet. Run the AI analysis from the Overview to extract requirements from the engagement inputs.</p>
        )}

        {running && !analyzed && !runErr && (
          <div className="card analysing-note">
            <span className="spinner" /> The analyst is reading the engagement inputs and extracting requirements. Steps appear in the Analysis flow on the left.
          </div>
        )}

        {analyzed && (
          <>
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="badge">{requirements.length} Requirements</span>
              <span className="badge sufficient">{sufficient} Sufficient</span>
              <span className="badge needs_info">{needInfo} Need info</span>
              <div style={{ flex: 1 }} />
              {["all", "sufficient", "needs_info"].map((f) =>
                <span key={f} className={"chip" + (filter === f ? " active" : "")} onClick={() => setFilter(f)}>{f.replace("_", " ")}</span>)}
            </div>

            {/* Analysis gate: resolve gaps then submit, or (all-sufficient)
                auto-advance. No manual re-analyse. */}
            {!analysisComplete ? (
              needInfo > 0 ? (
                <div className="card">
                  <div className="row between">
                    <div>
                      <strong>{needInfo} open question{needInfo !== 1 ? "s" : ""}</strong>
                      <div className="dim" style={{ fontSize: 13 }}>
                        Provide the missing information on each item below, then submit.
                        Submitting re-evaluates only the open points and preserves the rest.
                      </div>
                    </div>
                    <button className="btn small" onClick={submitInputs} disabled={busy || running || unanswered > 0}>
                      {busy || running ? "Submitting…" : "Submit inputs →"}
                    </button>
                  </div>
                  <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
                    {unanswered > 0
                      ? `Answer all ${needInfo} open item${needInfo !== 1 ? "s" : ""} to submit — ${unanswered} still ${unanswered !== 1 ? "need" : "needs"} a response.`
                      : "All open items answered — submit to re-evaluate them and advance to recommendations."}
                  </div>
                </div>
              ) : (
                <div className="callout">
                  <strong>Analysis complete — generating recommendations…</strong>
                  <p style={{ margin: "6px 0" }}>All requirements are sufficient. Moving to the recommendations stage.</p>
                  {(busy || running) && <span className="spinner" />}
                </div>
              )
            ) : (
              <div className="callout">
                <strong>✓ Analysis complete</strong>
                <p style={{ margin: "6px 0" }}>Recommendations have been generated — see the Recommendations tab.</p>
              </div>
            )}

            {shown.map((r) => (
              <div key={r.id} className="card">
                <div className="row between">
                  <span className="dim" style={{ fontSize: 11 }}>{r.category}</span>
                  <span className={"badge " + r.status}>{r.status.replace("_", " ")}</span>
                </div>
                <div style={{ marginTop: 4 }}>{r.text}</div>
                {r.missing && <div className="err" style={{ fontSize: 13, marginTop: 6 }}>Missing: {r.missing}</div>}
                <Citations items={r.citations} />
                {r.status === "needs_info" && !analysisComplete && (
                  <div style={{ marginTop: 8 }}>
                    <input
                      placeholder="Provide the missing information…"
                      value={replies[r.id] || ""}
                      onChange={(e) => setReply(r.id, e.target.value)}
                    />
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
