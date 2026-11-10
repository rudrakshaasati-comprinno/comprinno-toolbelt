import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import { Overview } from "./Overview.jsx";
import { Analysis } from "./Analysis.jsx";
import { Recommendations, Proposal, Team } from "./EngagementTabs.jsx";
import { Skeleton, SkeletonCard } from "./common.jsx";

const TABS = ["Overview", "AI Analysis", "Recommendations", "Proposal", "Team & Access"];

export function Engagement({ id, user, onBack }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [autoRun, setAutoRun] = useState(null); // { instruction, at } to start on the Analysis tab
  const refresh = useCallback(() => api.getEngagement(id).then(setData).catch(() => {}), [id]);
  useEffect(() => { refresh(); }, [refresh]);
  if (!data) return (
    <div>
      <Skeleton w="140px" h={13} style={{ marginBottom: 14 }} />
      <Skeleton w="280px" h={26} style={{ marginBottom: 6 }} />
      <Skeleton w="180px" h={14} style={{ marginBottom: 18 }} />
      <div className="row" style={{ gap: 10, marginBottom: 18 }}>
        {[70, 90, 130, 90, 110].map((w, i) => <Skeleton key={i} w={w + "px"} h={30} r={8} />)}
      </div>
      <SkeletonCard lines={2} />
      <SkeletonCard lines={4} />
    </div>
  );
  const { engagement } = data;

  // Stage gates (Phase 4A + Recs v2): Recommendations unlocks once analysis is
  // marked complete; Proposal unlocks once recommendations are FINALIZED.
  const analysisComplete = !!engagement.analysis_completed_at;
  const recsFinalized = !!engagement.recommendations_finalized_at;
  const lockedReason = {
    "Recommendations": analysisComplete ? null : "Complete the analysis first (mark it done on the AI Analysis tab).",
    "Proposal": !analysisComplete
      ? "Complete the analysis first."
      : !recsFinalized ? "Finalize the recommendations first (on the Recommendations tab)." : null,
  };
  const isLocked = (t) => !!lockedReason[t];
  const selectTab = (t) => { if (!isLocked(t)) setTab(t); };

  // Overview's "Run AI analysis": jump to the Analysis tab and start there.
  const startAnalysis = (instruction) => { setAutoRun({ instruction, at: Date.now() }); setTab("AI Analysis"); };

  return (
    <div>
      <div className="crumb"><a onClick={onBack}>Clients</a> / {engagement.client_name}</div>
      <div className="page-head">
        <div><h1>{engagement.client_name}</h1>
          <div className="muted">{engagement.name}</div></div>
        <span className="badge stage">Stage: {engagement.stage}</span>
      </div>
      <div className="tabs">
        {TABS.map((t) => (
          <div key={t}
            className={"tab" + (tab === t ? " active" : "") + (isLocked(t) ? " locked" : "")}
            title={lockedReason[t] || ""}
            onClick={() => selectTab(t)}>
            {t}
          </div>
        ))}
      </div>
      {tab === "Overview" && <Overview data={data} user={user} onChange={refresh} setTab={selectTab} onRunAnalysis={startAnalysis} />}
      {tab === "AI Analysis" && <Analysis data={data} id={id} user={user} autoRun={autoRun} onChange={refresh} onConsumed={() => setAutoRun(null)} />}
      {tab === "Recommendations" && <Recommendations data={data} user={user} onChange={refresh} setTab={selectTab} />}
      {tab === "Proposal" && <Proposal data={data} user={user} onChange={refresh} />}
      {tab === "Team & Access" && <Team id={id} data={data} user={user} onChange={refresh} />}
    </div>
  );
}
