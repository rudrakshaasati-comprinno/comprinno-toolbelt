import React, { useEffect, useState, useCallback, useRef } from "react";
import { api } from "../api.js";
import { Skeleton } from "./common.jsx";

export function Dashboard({ user, onOpen }) {
  const [engagements, setEngagements] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => api.listEngagements(user.id).then((r) => { setEngagements(r.engagements); setLoaded(true); }).catch(() => setLoaded(true)), [user.id]);
  useEffect(() => { load(); }, [load]);

  const active = engagements.filter((e) => !["sent", "closed"].includes(e.stage)).length;
  const review = engagements.filter((e) => e.stage === "proposal").length;
  const sent = engagements.filter((e) => e.stage === "sent").length;
  const firstName = user.name.split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="crumb">Dashboard</div>
          <h1>{greeting}, {firstName}</h1>
          <div className="muted">{active} active engagement{active !== 1 ? "s" : ""}
            {review ? ` · ${review} waiting on your review` : ""}</div>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>+ New Engagement</button>
      </div>

      <div className="stats">
        <div className="stat"><div className="n">{active}</div><div className="l">Active</div></div>
        <div className="stat"><div className="n">{review}</div><div className="l">Need Review</div></div>
        <div className="stat"><div className="n">{sent}</div><div className="l">Sent</div></div>
      </div>

      <div className="card">
        <h2>Your engagements</h2>
        {!loaded && (
          <table>
            <thead><tr><th>Engagement</th><th>Client</th><th>Stage</th><th>Type</th><th>Last activity</th><th></th></tr></thead>
            <tbody>
              {Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>
                  <td><Skeleton w="160px" /></td>
                  <td><Skeleton w="120px" /></td>
                  <td><Skeleton w="70px" h={18} r={7} /></td>
                  <td><Skeleton w="140px" /></td>
                  <td><Skeleton w="80px" /></td>
                  <td><Skeleton w="24px" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loaded && !engagements.length && <p className="muted">No engagements yet. Create one to get started.</p>}
        {loaded && !!engagements.length && (
          <table>
            <thead><tr><th>Engagement</th><th>Client</th><th>Stage</th><th>Type</th><th>Last activity</th><th aria-label="Actions"></th></tr></thead>
            <tbody>
              {engagements.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => onOpen(e.id)}>
                  <td><NameCell engagement={e} onChanged={load} /></td>
                  <td><strong>{e.client_name}</strong></td>
                  <td><span className="badge stage">{e.stage}</span></td>
                  <td className="muted">{e.engagement_type}</td>
                  <td className="dim">{new Date(e.updated_at).toLocaleDateString()}</td>
                  <td className="row-actions-cell" onClick={(ev) => ev.stopPropagation()}>
                    <RowActions engagement={e} onOpen={onOpen} onChanged={load} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && <NewEngagement user={user} onClose={() => setCreating(false)}
        onCreated={(e) => { setCreating(false); load(); onOpen(e.id); }} />}
    </div>
  );
}

/**
 * Inline-editable engagement name. Click the pencil (or double-click the name)
 * to edit; Enter or blur saves via PATCH, Escape cancels. All handlers
 * stopPropagation so editing never opens the engagement row.
 */
function NameCell({ engagement, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(engagement.name || "");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  const start = (ev) => { ev.stopPropagation(); setValue(engagement.name || ""); setEditing(true); };

  const save = async () => {
    const name = value.trim();
    if (!name || name === engagement.name) { setEditing(false); return; }
    setBusy(true);
    try { await api.updateEngagement(engagement.id, { name }); onChanged(); }
    catch (e) { alert(`Rename failed: ${e.message}`); setValue(engagement.name || ""); }
    finally { setBusy(false); setEditing(false); }
  };

  const onKey = (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") { ev.preventDefault(); save(); }
    else if (ev.key === "Escape") { ev.preventDefault(); setValue(engagement.name || ""); setEditing(false); }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="name-edit"
        value={value}
        disabled={busy}
        onClick={(ev) => ev.stopPropagation()}
        onChange={(ev) => setValue(ev.target.value)}
        onKeyDown={onKey}
        onBlur={save}
      />
    );
  }
  return (
    <span className="name-cell" onDoubleClick={start}>
      <strong>{engagement.name}</strong>
      <button className="name-edit-btn" title="Rename" aria-label="Rename engagement" onClick={start}>✎</button>
    </span>
  );
}

/** Per-engagement 3-dot actions menu: Clone and Delete. */
function RowActions({ engagement, onOpen, onChanged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev) => { if (ref.current && !ref.current.contains(ev.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const clone = async () => {
    setOpen(false); setBusy(true);
    try {
      const copy = await api.cloneEngagement(engagement.id);
      onChanged();                 // refresh the list
      if (copy?.id) onOpen(copy.id); // open the new clone
    } catch (e) { alert(`Clone failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setOpen(false);
    const label = engagement.client_name || "this engagement";
    if (!window.confirm(`Delete ${label}? This permanently removes its documents, notes, analysis, recommendations and proposal. This cannot be undone.`)) return;
    setBusy(true);
    try { await api.deleteEngagement(engagement.id); onChanged(); }
    catch (e) { alert(`Delete failed: ${e.message}`); }
    finally { setBusy(false); }
  };

  return (
    <div className="row-actions" ref={ref}>
      <button className="kebab" aria-label="Actions" aria-haspopup="true" aria-expanded={open}
        disabled={busy} onClick={() => setOpen((o) => !o)}>
        {busy ? <span className="spinner" /> : "⋮"}
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={clone}>Clone</button>
          <button role="menuitem" className="danger" onClick={remove}>Delete</button>
        </div>
      )}
    </div>
  );
}

function NewEngagement({ user, onClose, onCreated }) {
  const [clientName, setClientName] = useState("");
  const [types, setTypes] = useState([]);
  const [engagementType, setType] = useState("azure-to-aws-migration");
  const [customType, setCustomType] = useState("");
  const [useCase, setUseCase] = useState("");
  const [goal, setGoal] = useState("");
  const [docFiles, setDocFiles] = useState([]);
  const [momMode, setMomMode] = useState("text"); // 'text' | 'upload'
  const [momText, setMomText] = useState("");
  const [momFiles, setMomFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.listEngagementTypes().then((r) => {
      setTypes(r.types);
      if (r.types.length) setType(r.types[0].id);
    }).catch(() => {});
  }, []);

  const isCustom = engagementType === "custom";
  const typeLabel = isCustom
    ? (customType.trim() || "Custom")
    : (types.find((t) => t.id === engagementType)?.label || engagementType);
  const derivedName = `${clientName.trim() || "Engagement"} — ${typeLabel}`;

  const create = async () => {
    setErr(null);
    if (!clientName.trim()) return setErr("Client name is required.");
    if (isCustom && !customType.trim()) return setErr("Please describe the custom engagement type.");
    if (!useCase.trim()) return setErr("Use case description is required.");
    if (!docFiles.length) return setErr("At least one inventory / source document is required.");
    const hasMom = (momMode === "text" && momText.trim()) || (momMode === "upload" && momFiles.length);
    if (!hasMom) return setErr("Meeting MoM is required (paste text or upload a file).");
    setBusy(true);
    try {
      const e = await api.createEngagement({
        name: derivedName, clientName, engagementType,
        customType: isCustom ? customType.trim() : undefined,
        ownerId: user.id, useCase, goal,
      });
      try {
        if (docFiles.length) await api.uploadDocuments(e.id, docFiles, user.id, "source");
        if (momMode === "upload" && momFiles.length) await api.uploadDocuments(e.id, momFiles, user.id, "meeting_mom");
        if (momMode === "text" && momText.trim()) await api.addNote(e.id, momText.trim(), user.id, "meeting_mom");
      } catch { /* retry on Overview */ }
      onCreated(e);
    } catch (e) { setErr(e.message); setBusy(false); }
  };

  const S = { fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", marginTop: 16, fontWeight: 700 };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="dim" style={{ fontSize: 11, letterSpacing: ".1em" }}>NEW ENGAGEMENT</div>
        <h1 style={{ marginTop: 4 }}>Set up a client engagement</h1>

        <div className="dim" style={S}>Basics</div>
        <label>Client name <span className="err">*</span></label>
        <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Northwind Retail" />
        <label>Engagement type <span className="err">*</span></label>
        <select value={engagementType} onChange={(e) => setType(e.target.value)}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        {isCustom && (
          <>
            <label>Describe the custom engagement type <span className="err">*</span></label>
            <input value={customType} onChange={(e) => setCustomType(e.target.value)}
              placeholder="e.g. Data-platform migration, DR setup…" />
          </>
        )}
        <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Engagement: <strong>{derivedName}</strong></div>

        <div className="dim" style={S}>What &amp; why</div>
        <label>Use case description <span className="err">*</span></label>
        <textarea rows={3} value={useCase} onChange={(e) => setUseCase(e.target.value)}
          placeholder="What is the client trying to do? Current environment, drivers, scope…" />
        <label>Analysis instruction / end goal / target to achieve <span className="dim">(optional — can set before running analysis)</span></label>
        <textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="What should the AI produce? You can add this on the Overview before running the analysis." />

        <div className="dim" style={S}>Inputs (required)</div>
        <label>Inventory / source documents <span className="err">*</span></label>
        <input type="file" multiple accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.pptx" onChange={(e) => setDocFiles([...e.target.files])} />

        <label>Meeting MoM (minutes of meeting) <span className="err">*</span></label>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className={"chip" + (momMode === "text" ? " active" : "")} onClick={() => setMomMode("text")}>Paste text</span>
          <span className={"chip" + (momMode === "upload" ? " active" : "")} onClick={() => setMomMode("upload")}>Upload file</span>
        </div>
        {momMode === "text"
          ? <textarea rows={3} value={momText} onChange={(e) => setMomText(e.target.value)} placeholder="Paste the meeting minutes here…" />
          : <input type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={(e) => setMomFiles([...e.target.files])} />}

        <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
          The discovery questionnaire comes from the template for this engagement type — fill it in on the Overview if needed.
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn" onClick={create} disabled={busy}>
            {busy ? <><span className="spinner" /> Creating…</> : "Create engagement"}</button>
          <button className="btn secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>
    </div>
  );
}
