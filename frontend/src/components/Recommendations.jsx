import React, { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api.js";
import { Citations, Markdown, Badge } from "./common.jsx";
import { SummaryCharts, ChartsForIntent, hasCostData, costOf } from "./Charts.jsx";
import { GpuDetail } from "./GpuDetail.jsx";

/* Recommendations — a full-page Claude/GPT-style chatbot on the engagement's
 * recommendations. The recs render INSIDE the chat as the opening assistant
 * turn (cards + summary charts); everything after is a single freeform
 * conversation (understand / analyze / research / refine). A slim header holds
 * the stage actions (Finalize -> Proceed to proposal). No side panel. */
export function Recommendations({ data, user, onChange, setTab }) {
  const { recommendations, engagement, proposal } = data;
  const finalized = !!engagement.recommendations_finalized_at;
  const analysisComplete = !!engagement.analysis_completed_at;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [liveActivity, setLiveActivity] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [followups, setFollowups] = useState([]); // chips under the latest reply (ephemeral)
  const threadRef = useRef(null);
  const taRef = useRef(null);

  const loadChat = useCallback(
    () => api.listChat(engagement.id).then((r) => setMessages(r.messages)).catch(() => {}),
    [engagement.id]
  );
  useEffect(() => { loadChat(); }, [loadChat]);

  const scrollToBottom = () => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; };
  const onThreadScroll = () => {
    const el = threadRef.current; if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };
  useEffect(() => { if (atBottom) scrollToBottom(); }, [messages, sending, liveActivity, atBottom]);
  const autoGrow = () => { const t = taRef.current; if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; };

  const generateRecommendations = async () => {
    setBusy(true); setErr(null);
    try {
      await api.runAgent(engagement.id, {
        instruction: "Map the finalized requirements to AWS services (7R) with confidence and citations.",
        userId: user.id, stage: "recommendations",
      }, () => {});
      onChange && onChange();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  // Empty state: analysis complete but no recs (self-heal), or not analyzed yet.
  if (!recommendations.length) {
    if (analysisComplete) {
      return (
        <div className="card">
          <strong>No recommendations generated yet.</strong>
          <p className="dim" style={{ fontSize: 13, margin: "6px 0" }}>
            Analysis is complete but recommendations haven't been produced (the automatic step may have failed). Generate them now.
          </p>
          <button className="btn small" onClick={generateRecommendations} disabled={busy}>
            {busy ? "Generating recommendations…" : "Generate recommendations"}
          </button>
          {err && <p className="err">{err}</p>}
        </div>
      );
    }
    return <p className="muted">No recommendations yet. Complete the analysis so the agent can map requirements to AWS services.</p>;
  }

  // A conversation turn. For an exploratory question the agent answers and keeps
  // recs unchanged; for a change request it revises them. Either way it's a
  // stage=recommendations refine turn (the backend persists the dialogue and
  // replaces the rec set with whatever the agent returns). We also render any
  // charts the user's message implies, inline under the reply.
  const send = async (override) => {
    const text = (typeof override === "string" ? override : input).trim();
    if (!text || sending || finalized) return;
    setSending(true); setErr(null); setLiveActivity(""); setAtBottom(true); setFollowups([]);
    setMessages((m) => [...m, { id: "tmp-" + Date.now(), role: "user", content: text }]);
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    let answer = "";
    let nextFollowups = [];
    try {
      await api.runAgent(engagement.id, { instruction: text, userId: user.id, stage: "recommendations", refine: true }, (event, d) => {
        if (event === "activity" && (d.label || d.message)) setLiveActivity(d.label || d.message);
        if (event === "result" && d.artifacts) {
          if (d.artifacts.answer) answer = d.artifacts.answer;
          if (Array.isArray(d.artifacts.followups)) nextFollowups = d.artifacts.followups.filter((s) => s && s.trim()).slice(0, 3);
        }
      });
      if (answer) setMessages((m) => [...m, { id: "tmpa-" + Date.now(), role: "assistant", content: answer, intent: text }]);
      await loadChat();
      setFollowups(nextFollowups);
      onChange && onChange();
    } catch (e) { setErr(e.message); } finally { setSending(false); setLiveActivity(""); }
  };
  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };

  const finalize = async () => {
    setBusy(true); setErr(null);
    try { await api.finalizeRecommendations(engagement.id, user.id); onChange && onChange(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const generateProposal = async () => {
    setBusy(true); setErr(null);
    try {
      await api.runAgent(engagement.id, { instruction: "Draft the proposal from the finalized recommendations.", userId: user.id, stage: "proposal" }, () => {});
      onChange && onChange(); setTab && setTab("Proposal");
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const suggestions = [
    "Explain the training recommendation and why P4de",
    hasCostData(recommendations) ? "Compare the estimated monthly costs" : "Compare the GPU options for inference (T4 vs L4 vs A10G)",
    "Which recommendations are on hold, and what's needed to resolve them?",
  ];

  const first = (user.name || "You").split(" ")[0];

  // Decision-oriented cost framing. Only MONTHLY recurring figures are
  // comparable, so the "~N× the cheapest" verdict is computed over those alone;
  // per-run costs (training) get their own label and never enter the ratio
  // (mixing them produced nonsense like "440×").
  const monthlyCosted = recommendations
    .map((r) => ({ r, c: costOf(r) }))
    .filter((x) => x.c && x.c.period === "monthly");
  const cheapestAmt = monthlyCosted.length ? Math.min(...monthlyCosted.map((x) => x.c.amount)) : null;
  const costVerdict = (r) => {
    const c = costOf(r);
    if (!c) return null;
    if (c.period === "per_run") return "Per-run cost (not monthly) — depends on run cadence.";
    if (cheapestAmt == null || monthlyCosted.length < 2) return null;
    if (c.amount <= cheapestAmt * 1.05) return "Lowest monthly cost of the priced options.";
    return `~${(c.amount / cheapestAmt).toFixed(1)}× the cheapest monthly option.`;
  };

  // Summary counts for the header strip (applied vs on hold, priced).
  const nApplied = recommendations.filter((r) => r.status === "applied").length;
  const nHold = recommendations.filter((r) => r.status === "on_hold").length;

  // Depth split: GPU / AI-ML recs are the deep, dedicated section; everything
  // else is a high-level overview. Default missing depth to "overview".
  const deepRecs = recommendations.filter((r) => r.depth === "deep");
  const overviewRecs = recommendations.filter((r) => r.depth !== "deep");

  return (
    <div className="recs-chat">
      {/* Slim header: stage actions live here, out of the conversation. */}
      <div className="recs-head">
        <div>
          <strong>Recommendations</strong>
          <span className="dim" style={{ fontSize: 12, marginLeft: 8 }}>
            {recommendations.length} mapping{recommendations.length !== 1 ? "s" : ""}
            {finalized ? " · finalized" : ""}
          </span>
        </div>
        <div className="row">
          {!finalized && (
            <button className="btn small" onClick={finalize} disabled={busy || sending}>
              {busy ? "Finalizing…" : "Finalize"}
            </button>
          )}
          {finalized && !proposal && (
            <button className="btn small" onClick={generateProposal} disabled={busy}>
              {busy ? "Generating proposal…" : "Proceed to proposal →"}
            </button>
          )}
          {finalized && proposal && (
            <button className="btn secondary small" onClick={() => setTab && setTab("Proposal")}>View proposal →</button>
          )}
        </div>
      </div>

      <div className="chat chat-full" style={{ position: "relative" }}>
        <div className="chat-thread" ref={threadRef} onScroll={onThreadScroll}>
          {/* Opening assistant turn: the recommendations themselves, in-chat. */}
          <div className="msg assistant">
            <div className="msg-avatar">A</div>
            <div className="msg-body" style={{ maxWidth: "92%" }}>
              <div className="msg-name">Analyst</div>
              <div className="bubble">
                Here are the {recommendations.length} AWS recommendations from your engagement analysis.
                Ask me anything about them — explain a mapping, compare options, research a service or its
                cost, weigh trade-offs, or request a change.
                <div className="recs-summary">
                  <span className="recs-stat"><b>{recommendations.length}</b> recommendations</span>
                  <span className="recs-stat gpu"><b>{deepRecs.length}</b> GPU (deep)</span>
                  {overviewRecs.length > 0 && <span className="recs-stat"><b>{overviewRecs.length}</b> other (overview)</span>}
                  <span className="recs-stat ok"><b>{nApplied}</b> applied</span>
                  {nHold > 0 && <span className="recs-stat hold"><b>{nHold}</b> on hold</span>}
                </div>

                {/* Deep, dedicated GPU / AI-ML section — full cards + charts. */}
                {deepRecs.length > 0 && (
                  <div className="recs-section">
                    <div className="recs-section-head gpu">
                      <span className="recs-section-title">GPU / AI-ML — in depth</span>
                      <span className="recs-section-note">sized &amp; priced via the GPU specialist</span>
                    </div>
                    <div className="recs-list">
                      {deepRecs.map((r) => (
                        <div key={r.id} className="rec-item">
                          <div className="rec-head">
                            <div className="rec-title">{r.aws_service}</div>
                            <div className="rec-badges">
                              <Badge kind={r.strategy} extraClass="strategy" />
                              <Badge kind={r.confidence} />
                              <Badge kind={r.status} />
                            </div>
                          </div>
                          {r.from_service && <div className="rec-map">{r.from_service} <span className="arr">→</span> {r.aws_service}</div>}
                          <div className="rec-rationale">{r.rationale}</div>
                          {r.on_hold_reason && <div className="rec-hold">On hold: {r.on_hold_reason}</div>}
                          {(() => { const c = costOf(r); return c ? (
                            <div className="rec-cost">
                              <span className="rec-cost-amt">{c.currency} {Number(c.amount).toLocaleString()}{c.period === "monthly" ? "/mo" : "/run"}</span>
                              {costVerdict(r) && <span className="cost-verdict">{costVerdict(r)}</span>}
                              <span className="rec-cost-basis" title={c.basis}>estimate</span>
                            </div>
                          ) : null; })()}
                          <GpuDetail detail={r.gpu_detail} />
                          <Citations items={r.citations} />
                        </div>
                      ))}
                    </div>
                    <SummaryCharts recs={deepRecs} />
                  </div>
                )}

                {/* High-level overview of the rest of the AWS estate — compact. */}
                {overviewRecs.length > 0 && (
                  <div className="recs-section">
                    <div className="recs-section-head">
                      <span className="recs-section-title">Other AWS services — overview</span>
                      <span className="recs-section-note">high-level mapping, no deep sizing</span>
                    </div>
                    <div className="recs-list overview">
                      {overviewRecs.map((r) => (
                        <div key={r.id} className="rec-item compact">
                          <div className="rec-head">
                            <div className="rec-title">{r.aws_service}</div>
                            <div className="rec-badges">
                              <Badge kind={r.strategy} extraClass="strategy" />
                              <Badge kind={r.status} />
                            </div>
                          </div>
                          {r.from_service && <div className="rec-map">{r.from_service} <span className="arr">→</span> {r.aws_service}</div>}
                          <div className="rec-rationale">{r.rationale}</div>
                          {r.on_hold_reason && <div className="rec-hold">On hold: {r.on_hold_reason}</div>}
                          <Citations items={r.citations} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* The freeform conversation. */}
          {messages.map((m, i) => {
            // Chart intent survives a reload by reading the user turn that
            // precedes this assistant reply (the optimistic m.intent is lost
            // once loadChat replaces messages with the persisted copies).
            const priorUser = m.role === "assistant"
              ? [...messages.slice(0, i)].reverse().find((x) => x.role === "user")
              : null;
            const intent = m.intent || (priorUser && priorUser.content) || "";
            return (
              <div key={m.id} className={"msg " + m.role}>
                <div className="msg-avatar">{m.role === "user" ? first.slice(0, 1).toUpperCase() : "A"}</div>
                <div className="msg-body">
                  <div className="msg-name">{m.role === "user" ? first : "Analyst"}</div>
                  <div className="bubble">
                    {m.role === "assistant"
                      ? <Markdown>{m.content}</Markdown>
                      : <span style={{ whiteSpace: "pre-wrap" }}>{m.content}</span>}
                    {m.role === "assistant" && intent && (
                      <ChartsForIntent recs={recommendations} intent={intent} />
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {sending && (
            <div className="msg assistant pending">
              <div className="msg-avatar">A</div>
              <div className="msg-body">
                <div className="msg-name">Analyst</div>
                <div className="bubble">
                  <span className="typing"><span /><span /><span /></span>
                  {liveActivity && <div className="chat-activity">{liveActivity}</div>}
                </div>
              </div>
            </div>
          )}

          {/* Clickable follow-up suggestions under the latest reply (ephemeral,
              agent-generated). Clicking one asks it as the next turn. */}
          {!sending && !finalized && followups.length > 0 && (
            <div className="followups">
              {followups.map((q) => (
                <button key={q} className="chip followup" onClick={() => send(q)}>{q}</button>
              ))}
            </div>
          )}
        </div>

        {!atBottom && (
          <button className="jump-latest" onClick={() => { setAtBottom(true); scrollToBottom(); }}>↓ Latest</button>
        )}

        {finalized ? (
          <div className="chat-hint" style={{ padding: 12 }}>Recommendations are finalized — the conversation is closed. Proceed to the proposal.</div>
        ) : (
          <>
            {!messages.length && (
              <div className="recs-suggestions">
                {suggestions.map((s) => (
                  <button key={s} className="chip" onClick={() => { setInput(s); setTimeout(send, 0); }} disabled={sending}>{s}</button>
                ))}
              </div>
            )}
            <div className="composer">
              <textarea ref={taRef} value={input} rows={1}
                onChange={(e) => { setInput(e.target.value); autoGrow(); }} onKeyDown={onKey}
                placeholder="Ask anything about these recommendations — explain, compare, research a service or its cost, or request a change…"
                disabled={sending} />
              <button className="btn small" onClick={send} disabled={sending || !input.trim()}>Send</button>
            </div>
          </>
        )}
        {err && <p className="err" style={{ padding: "0 12px 10px" }}>{err}</p>}
      </div>
    </div>
  );
}
