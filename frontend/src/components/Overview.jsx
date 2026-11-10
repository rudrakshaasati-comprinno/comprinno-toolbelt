import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";

/* Overview — engagement details (editable) + optional inputs + run analysis. */
export function Overview({ data, user, onChange, setTab, onRunAnalysis }) {
  const { engagement, requirements, recommendations, proposal, activity } = data;
  const applied = recommendations.filter((r) => r.status === "applied").length;
  const onHold = recommendations.filter((r) => r.status === "on_hold").length;
  const needsInfo = requirements.filter((r) => r.status === "needs_info").length;
  const proposalReady = !!proposal && !proposal.version.approved_at;
  const analyzed = requirements.length > 0 || recommendations.length > 0;

  const [useCase, setUseCase] = useState(engagement.use_case || "");
  const [goal, setGoal] = useState(engagement.goal || "");
  const [clientName, setClientName] = useState(engagement.client_name || "");
  const [engType, setEngType] = useState(engagement.engagement_type || "");
  const [customType, setCustomType] = useState("");
  const [types, setTypes] = useState([]);
  const [editing, setEditing] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const [inputsSaved, setInputsSaved] = useState(false);

  useEffect(() => { api.listEngagementTypes().then((r) => setTypes(r.types)).catch(() => {}); }, []);

  const startEdit = () => {
    setClientName(engagement.client_name || "");
    const known = types.some((t) => t.id === engagement.engagement_type);
    setEngType(known ? engagement.engagement_type : "custom");
    setCustomType(known ? "" : (engagement.engagement_type || ""));
    setUseCase(engagement.use_case || ""); setGoal(engagement.goal || "");
    setEditing(true);
  };
  const saveFields = async () => {
    if (engType === "custom" && !customType.trim()) return;
    setSavingFields(true);
    const effectiveType = engType === "custom" ? customType.trim() : engType;
    const typeLabel = engType === "custom" ? customType.trim() : (types.find((t) => t.id === engType)?.label || engType);
    const name = `${(clientName || "").trim() || "Engagement"} — ${typeLabel}`;
    try {
      await api.updateEngagement(engagement.id, { useCase, goal, clientName, engagementType: effectiveType, name });
      setEditing(false); onChange();
    } finally { setSavingFields(false); }
  };

  const runAnalysis = () => {
    const instruction = (goal && goal.trim())
      ? goal.trim()
      : "Analyze all sources, meeting MoM, questionnaire answers and notes. Extract requirements " +
        "(mark ones lacking evidence as needs_info), then map the well-supported ones to AWS services " +
        "with a 7R strategy and confidence. Cite sources.";
    onRunAnalysis(instruction);
  };

  return (
    <div>
      <div className="card">
        <div className="row between">
          <h2>Engagement details</h2>
          {!editing
            ? <button className="btn secondary small" onClick={startEdit}>Edit</button>
            : <div className="row"><button className="btn small" onClick={saveFields} disabled={savingFields}>{savingFields ? "Saving…" : "Save"}</button>
                <button className="btn secondary small" onClick={() => setEditing(false)}>Cancel</button></div>}
        </div>
        <label>Client name</label>
        {editing ? <input value={clientName} onChange={(e) => setClientName(e.target.value)} />
          : <div>{engagement.client_name}</div>}
        <label>Engagement type</label>
        {editing
          ? <>
              <select value={engType} onChange={(e) => setEngType(e.target.value)}>
                {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {engType === "custom" && (
                <>
                  <label>Describe the custom engagement type <span className="err">*</span></label>
                  <input value={customType} onChange={(e) => setCustomType(e.target.value)}
                    placeholder="e.g. Data-platform migration, DR setup…" />
                </>
              )}
            </>
          : <div>{types.find((t) => t.id === engagement.engagement_type)?.label || engagement.engagement_type}</div>}
        <label>Use case</label>
        {editing ? <textarea rows={3} value={useCase} onChange={(e) => setUseCase(e.target.value)} />
          : <div>{engagement.use_case || <span className="muted">—</span>}</div>}
        <label>Analysis instruction / goal / target</label>
        {editing ? <textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Optional — leave blank for a default analysis." />
          : <div>{engagement.goal || <span className="muted">Not set — a default analysis will run.</span>}</div>}
      </div>

      <div className="card">
        <div className="row between">
          <h2>Inputs &amp; discovery <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(optional — add before running analysis)</span></h2>
          <div className="row">
            {inputsSaved && <span className="badge sufficient">Saved ✓</span>}
            <button className="btn secondary small" onClick={() => setShowInputs((s) => !s)}>{showInputs ? "Hide" : "Add / review inputs"}</button>
          </div>
        </div>
        {showInputs && (
          <InputsSection id={engagement.id} user={user}
            onChange={onChange}
            onSaved={(discarded) => { if (!discarded) setInputsSaved(true); setShowInputs(false); }} />
        )}
      </div>

      <div className="card">
        <div className="row between">
          <div>
            <h3 style={{ marginBottom: 2 }}>{analyzed ? "Re-run analysis" : "Ready to analyze"}</h3>
            <div className="dim" style={{ fontSize: 13 }}>
              Analyzes the inventory, meeting MoM, questionnaire and notes to extract requirements, map them to AWS, and draft the proposal. Opens the AI Analysis view.
            </div>
          </div>
          <button className="btn" onClick={runAnalysis}>Run AI analysis →</button>
        </div>
      </div>

      {proposalReady && (
        <div className="callout">
          <strong>1 approval needed</strong>
          <p style={{ margin: "6px 0" }}>The agent has drafted the proposal. Nothing reaches {engagement.client_name} until you approve it.</p>
          <button className="btn approve small" onClick={() => setTab("Proposal")}>Review &amp; approve</button>
        </div>
      )}

      {!!activity.length && (
        <div className="card">
          <h2>Agent activity</h2>
          <div className="timeline">
            {activity.map((a) => (
              <div key={a.id} className="line"><span className="phase">{a.label || a.phase}</span><span>{a.message}</span></div>
            ))}
          </div>
        </div>
      )}

      {analyzed && (
        <div className="card">
          <h2>Handled automatically</h2>
          <div className="row">
            <div className="chip" onClick={() => setTab("Recommendations")}>AWS mappings · {applied} applied →</div>
            <div className="chip" onClick={() => setTab("AI Analysis")}>Requirements · {requirements.length} found →</div>
            <div className="chip" onClick={() => setTab("AI Analysis")}>Open questions · {needsInfo} pending →</div>
            {onHold > 0 && <div className="chip" onClick={() => setTab("Recommendations")}>On hold · {onHold} →</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* Inputs section — STAGED: all changes (adds + deletes) are held locally and
 * only committed to the backend when the user clicks Save. Hiding/discarding
 * throws staged changes away, leaving the backend untouched. */
function InputsSection({ id, user, onChange, onSaved }) {
  // Server-loaded baseline.
  const [docs, setDocs] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [notes, setNotes] = useState([]);
  // Staged (uncommitted) changes.
  const [newDocs, setNewDocs] = useState([]);        // File[] (kind: source)
  const [newMomFiles, setNewMomFiles] = useState([]); // File[]
  const [newNotes, setNewNotes] = useState([]);       // [{ text, kind }]
  const [answerEdits, setAnswerEdits] = useState({}); // { questionId: answer }
  const [pendingDeletes, setPendingDeletes] = useState({ docs: new Set(), notes: new Set(), questions: new Set() });
  const [noteText, setNoteText] = useState("");
  const [momText, setMomText] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [d, q, n] = await Promise.all([api.listDocuments(id), api.listQuestionnaire(id), api.listNotes(id)]);
    setDocs(d.documents); setQuestions(q.questionnaire); setNotes(n.notes);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const dirty = newDocs.length || newMomFiles.length || newNotes.length ||
    Object.keys(answerEdits).length || pendingDeletes.docs.size || pendingDeletes.notes.size || pendingDeletes.questions.size;

  const resetStaged = () => {
    setNewDocs([]); setNewMomFiles([]); setNewNotes([]); setAnswerEdits({});
    setPendingDeletes({ docs: new Set(), notes: new Set(), questions: new Set() });
    setNoteText(""); setMomText("");
  };

  // ── Staging actions (no backend calls) ──────────────────────────────────
  const stageDocs = (e) => setNewDocs((p) => [...p, ...e.target.files]);
  const stageMomFiles = (e) => setNewMomFiles((p) => [...p, ...e.target.files]);
  const stageMomText = () => { if (!momText.trim()) return; setNewNotes((p) => [...p, { text: momText.trim(), kind: "meeting_mom" }]); setMomText(""); };
  const stageNote = () => { if (!noteText.trim()) return; setNewNotes((p) => [...p, { text: noteText.trim(), kind: "note" }]); setNoteText(""); };
  const stageDeleteDoc = (docId) => setPendingDeletes((p) => ({ ...p, docs: new Set(p.docs).add(docId) }));
  const stageDeleteNote = (noteId) => setPendingDeletes((p) => ({ ...p, notes: new Set(p.notes).add(noteId) }));
  const stageDeleteQuestion = (qid) => setPendingDeletes((p) => ({ ...p, questions: new Set(p.questions).add(qid) }));
  const unstageNewDoc = (i) => setNewDocs((p) => p.filter((_, idx) => idx !== i));
  const unstageNewNote = (i) => setNewNotes((p) => p.filter((_, idx) => idx !== i));

  // ── Commit all staged changes on Save ───────────────────────────────────
  const save = async () => {
    setSaving(true);
    try {
      if (newDocs.length) await api.uploadDocuments(id, newDocs, user.id, "source");
      if (newMomFiles.length) await api.uploadDocuments(id, newMomFiles, user.id, "meeting_mom");
      for (const n of newNotes) await api.addNote(id, n.text, user.id, n.kind);
      for (const [qid, answer] of Object.entries(answerEdits)) await api.answerQuestion(qid, answer);
      for (const docId of pendingDeletes.docs) await api.deleteDocument(docId);
      for (const noteId of pendingDeletes.notes) await api.deleteNote(noteId);
      for (const qid of pendingDeletes.questions) await api.deleteQuestion(qid);
      resetStaged();
      await load();
      onChange();
      onSaved && onSaved();
    } finally { setSaving(false); }
  };

  const discard = () => { resetStaged(); onSaved && onSaved(true); };

  // Seeding the questionnaire is a template load — apply immediately (it only
  // adds template questions to answer; not part of the staged diff).
  const seed = async () => { await api.seedQuestionnaire(id); await load(); };

  const QUICK_NOTES = [
    "Prioritize fully managed AWS services over self-managed alternatives.",
    "Treat data residency as a hard requirement, not a preference.",
    "Assume minimal downtime tolerance during cutover.",
  ];

  // Visible items = server items minus pending deletes.
  const visDocs = docs.filter((d) => !pendingDeletes.docs.has(d.id));
  const visNotes = notes.filter((n) => !pendingDeletes.notes.has(n.id));
  const visQuestions = questions.filter((q) => !pendingDeletes.questions.has(q.id));
  const sourceDocs = visDocs.filter((d) => d.kind !== "meeting_mom");
  const momDocs = visDocs.filter((d) => d.kind === "meeting_mom");
  const momNotes = visNotes.filter((n) => n.kind === "meeting_mom");
  const plainNotes = visNotes.filter((n) => n.kind !== "meeting_mom");
  const stagedMom = newNotes.filter((n) => n.kind === "meeting_mom");
  const stagedPlain = newNotes.filter((n) => n.kind !== "meeting_mom");
  const answered = visQuestions.filter((q) => q.answer || answerEdits[q.id]).length;

  return (
    <div style={{ marginTop: 12 }}>
      <h3>Inventory / source documents</h3>
      <div className="dropzone"><input type="file" multiple onChange={stageDocs} accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.pptx" /></div>
      <div style={{ margin: "8px 0 14px" }}>
        {sourceDocs.map((d) => (
          <div key={d.id} className="row between" style={{ padding: "5px 0" }}>
            <span>{d.name}</span><span className="chip" style={{ marginTop: 0 }} onClick={() => stageDeleteDoc(d.id)}>✕ Remove</span>
          </div>
        ))}
        {newDocs.map((f, i) => (
          <div key={"new" + i} className="row between" style={{ padding: "5px 0" }}>
            <span>{f.name} <span className="badge drafted">new</span></span>
            <span className="chip" style={{ marginTop: 0 }} onClick={() => unstageNewDoc(i)}>✕</span>
          </div>
        ))}
        {!sourceDocs.length && !newDocs.length && <span className="muted">No source documents.</span>}
      </div>

      <h3>Meeting MoM</h3>
      <div style={{ marginBottom: 8 }}>
        {momDocs.map((d) => <div key={d.id} className="row between" style={{ padding: "4px 0" }}><span>📎 {d.name}</span><span className="chip" style={{ marginTop: 0 }} onClick={() => stageDeleteDoc(d.id)}>✕ Remove</span></div>)}
        {momNotes.map((n) => <div key={n.id} className="row between" style={{ padding: "4px 0" }}><span>• {n.text}</span><span className="chip" style={{ marginTop: 0 }} onClick={() => stageDeleteNote(n.id)}>✕ Remove</span></div>)}
        {stagedMom.map((n, i) => <div key={"sm" + i} className="row between" style={{ padding: "4px 0" }}><span>• {n.text} <span className="badge drafted">new</span></span><span className="chip" style={{ marginTop: 0 }} onClick={() => unstageNewNote(newNotes.indexOf(n))}>✕</span></div>)}
        {newMomFiles.map((f, i) => <div key={"mf" + i} className="row" style={{ padding: "4px 0" }}>📎 {f.name} <span className="badge drafted">new</span></div>)}
        {!momDocs.length && !momNotes.length && !stagedMom.length && !newMomFiles.length && <span className="muted">No meeting MoM.</span>}
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <input value={momText} onChange={(e) => setMomText(e.target.value)} placeholder="Add meeting MoM as text…" />
        <button className="btn small" onClick={stageMomText}>Add</button>
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="dim" style={{ fontSize: 12 }}>or upload:</span>
        <input type="file" multiple accept=".pdf,.docx,.txt,.md" onChange={stageMomFiles} style={{ maxWidth: 320 }} />
      </div>

      <div className="row between"><h3>Discovery questionnaire</h3><span className="muted">{answered} of {visQuestions.length} answered</span></div>
      {!visQuestions.length && <button className="btn secondary small" onClick={seed}>Load discovery questionnaire</button>}
      {visQuestions.map((q) => (
        <StagedQA key={q.id} q={q} draft={answerEdits[q.id]}
          onEdit={(val) => setAnswerEdits((p) => ({ ...p, [q.id]: val }))}
          onRemove={() => stageDeleteQuestion(q.id)} />
      ))}

      <h3 style={{ marginTop: 14 }}>Notes &amp; instructions for the AI</h3>
      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Explicit, cited input the analysis draws on — not chat.</div>
      {plainNotes.map((n) => <div key={n.id} className="row between" style={{ padding: "4px 0" }}><span>• {n.text}</span><span className="chip" style={{ marginTop: 0 }} onClick={() => stageDeleteNote(n.id)}>✕ Remove</span></div>)}
      {stagedPlain.map((n, i) => <div key={"sn" + i} className="row between" style={{ padding: "4px 0" }}><span>• {n.text} <span className="badge drafted">new</span></span><span className="chip" style={{ marginTop: 0 }} onClick={() => unstageNewNote(newNotes.indexOf(n))}>✕</span></div>)}
      <div className="row" style={{ marginTop: 8 }}>
        <input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add context, corrections or directives…" />
        <button className="btn small" onClick={stageNote}>Add</button>
      </div>
      <div style={{ marginTop: 8 }}>
        {QUICK_NOTES.map((t) => <span key={t} className="chip" onClick={() => setNoteText(t)}>+ {t}</span>)}
      </div>

      {/* Explicit Save — commits all staged adds + deletes; nothing persists until then. */}
      <div className="row between" style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <span className="dim" style={{ fontSize: 12 }}>{dirty ? "You have unsaved changes." : "No unsaved changes."}</span>
        <div className="row">
          <button className="btn secondary small" onClick={discard} disabled={saving}>Discard</button>
          <button className="btn small" onClick={save} disabled={saving || !dirty}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    </div>
  );
}

/* Questionnaire item in staged mode: answer edits go to a draft, not the API. */
function StagedQA({ q, draft, onEdit, onRemove }) {
  const value = draft !== undefined ? draft : (q.answer || "");
  return (
    <div style={{ padding: "8px 0", borderBottom: "1px dashed var(--border)" }}>
      <div className="row between">
        <div style={{ fontSize: 13 }}>{q.question}</div>
        <span className="chip" style={{ marginTop: 0 }} onClick={onRemove}>✕</span>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <input value={value} onChange={(e) => onEdit(e.target.value)} placeholder="Your answer…" />
        {draft !== undefined && draft !== (q.answer || "") && <span className="badge drafted">edited</span>}
      </div>
    </div>
  );
}
