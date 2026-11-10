import React, { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api.js";
import { Citations, Markdown } from "./common.jsx";

// The Recommendations stage is now a full-page chatbot in its own module.
export { Recommendations } from "./Recommendations.jsx";

export function Proposal({ data, user, onChange }) {
  const { engagement, proposal } = data;
  const [busy, setBusy] = useState(false);
  if (!proposal) return <p className="muted">No proposal yet. Decide all recommendations, then use “Generate proposal” on the Recommendations tab.</p>;
  const { version, sections } = proposal;
  const approve = async () => { setBusy(true); try { await api.approveProposal(version.id, user.id); onChange(); } finally { setBusy(false); } };
  return (
    <div className="proposal-print">
      {!version.approved_at
        ? <div className="callout no-print">
            <strong>This is the one approval this engagement needs</strong>
            <p style={{ margin: "6px 0" }}>Everything up to here was handled by the agent. Nothing reaches {engagement.client_name} until you approve it.</p>
            <button className="btn approve" onClick={approve} disabled={busy}>{busy ? "Approving…" : "Approve for client"}</button>
          </div>
        : <div className="callout no-print"><strong>✓ Approved for client</strong></div>}
      <div className="card row between">
        <div>Proposal v{version.version} {version.approved_at
          ? <span className="badge reviewed">approved</span> : <span className="badge needs_review">draft</span>}</div>
        <div className="row no-print">
          <button className="btn secondary small" onClick={() => window.print()}>Export as PDF</button>
          <button className="btn secondary small" disabled title="v2">Export as Word</button>
        </div>
      </div>
      {sections.map((s) => (
        <div key={s.id} className="card">
          <div className="row between"><h3>{s.title}</h3><span className={"badge " + s.status}>{s.status.replace("_", " ")}</span></div>
          <div className="md" style={{ fontSize: 15 }}><Markdown>{s.content}</Markdown></div>
        </div>
      ))}
    </div>
  );
}

export function Team({ id, data, user, onChange }) {
  const [team, setTeam] = useState({ collaborators: [], ownerId: null });
  const [allUsers, setAllUsers] = useState([]);
  const [email, setEmail] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const load = useCallback(async () => {
    const [t, u] = await Promise.all([api.getTeam(id), api.listUsersAll()]);
    setTeam(t); setAllUsers(u.users);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const owner = allUsers.find((u) => u.id === team.ownerId);
  const invite = async () => { if (!email.trim()) return; await api.invite(id, email.trim()); setEmail(""); load(); };
  const transfer = async () => { if (!transferTo) return; await api.transfer(id, transferTo); onChange(); load(); };

  return (
    <div>
      <div className="card">
        <h2>People on this engagement</h2>
        {owner && <div className="row between" style={{ padding: "6px 0" }}>
          <span>{owner.name} <span className="dim">· {owner.email}</span></span><span className="badge reviewed">Owner</span></div>}
        {team.collaborators.filter((c) => c.id !== team.ownerId).map((c) => (
          <div key={c.id} className="row between" style={{ padding: "6px 0" }}>
            <span>{c.name} <span className="dim">· {c.email}</span></span><span className="badge stage">Collaborator</span></div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@comprinno.net" />
          <button className="btn small" onClick={invite}>Invite</button>
        </div>
      </div>
      <div className="card">
        <h2>Transfer ownership</h2>
        <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Hand this engagement to a teammate — they inherit full access.</div>
        <div className="row">
          <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
            <option value="">Choose a teammate…</option>
            {allUsers.filter((u) => u.id !== team.ownerId).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
          <button className="btn small" onClick={transfer} disabled={!transferTo}>Transfer</button>
        </div>
      </div>
      <div className="card">
        <h2>Open blockers</h2>
        <Blockers data={data} />
      </div>
    </div>
  );
}

function Blockers({ data }) {
  const needInfo = data.requirements.filter((r) => r.status === "needs_info");
  const onHold = data.recommendations.filter((r) => r.status === "on_hold");
  if (!needInfo.length && !onHold.length) return <div className="muted">No open blockers.</div>;
  return <>
    {needInfo.length > 0 && <div>• {needInfo.length} requirement(s) need client clarification</div>}
    {onHold.length > 0 && <div>• {onHold.length} recommendation(s) on hold</div>}
  </>;
}
