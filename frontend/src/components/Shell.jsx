import React, { useState } from "react";
import { api, setCsrfToken } from "../api.js";

export function Sidebar({ user, view, setView, collapsed, onToggleCollapse, onLogout }) {
  const initials = user.name.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const [showPw, setShowPw] = useState(false);
  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <button className="sidebar-toggle" onClick={onToggleCollapse}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? "»" : "«"}
      </button>
      <div className="brand"><img className="brand-logo" src="/comprinno-logo.webp" alt="Comprinno" /><span className="brand-text"><span className="brand-word">COMPRINNO</span><small>PRESALES AI</small></span></div>
      <div className="nav-group">
        <div className="nav-label">Workspace</div>
        <div className={"nav-item" + (view.screen !== "settings" ? " active" : "")}
          onClick={() => setView({ screen: "dashboard", engagementId: null })} title="Dashboard">
          <span className="nav-ico">▸</span><span className="nav-text">Dashboard</span></div>
        <div className="nav-item" onClick={() => setView({ screen: "dashboard", engagementId: null })} title="Clients">
          <span className="nav-ico">▸</span><span className="nav-text">Clients</span></div>
      </div>
      <div className="nav-group">
        <div className="nav-label">Account</div>
        <div className={"nav-item" + (view.screen === "settings" ? " active" : "")}
          onClick={() => setView({ screen: "settings" })} title="Settings">
          <span className="nav-ico">▸</span><span className="nav-text">Settings</span></div>
      </div>
      <div className="sidebar-user">
        <button className="sidebar-profile" onClick={() => setShowPw(true)}
          title="Account · change password" aria-label="Account settings">
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1, textAlign: "left" }}>
            <div style={{ fontSize: 13 }}>{user.name}</div>
            <div className="dim" style={{ fontSize: 11 }}>Pre-sales consultant</div>
          </div>
        </button>
        {onLogout && (
          <button className="sidebar-logout" onClick={onLogout} title="Sign out" aria-label="Sign out">⏻</button>
        )}
      </div>
      {showPw && <ChangePasswordModal user={user} onClose={() => setShowPw(false)} />}
    </aside>
  );
}

export function SignIn({ onSignedIn }) {
  const [mode, setMode] = useState("login");   // 'login' | 'register'
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const res = mode === "register"
        ? await api.register(email.trim(), name.trim(), password)
        : await api.login(email.trim(), password);
      onSignedIn(res);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const onKey = (e) => { if (e.key === "Enter" && !busy) submit(); };

  const title = mode === "register" ? "Create your account." : "Sign in to continue.";
  const cta = mode === "register" ? "Create account" : "Sign in";

  return (
    <div className="main" style={{ maxWidth: 420, margin: "90px auto" }}>
      <div className="brand brand-login" style={{ fontSize: 20 }}><img className="brand-logo" src="/comprinno-logo.webp" alt="Comprinno" /><span className="brand-text"><span className="brand-word">COMPRINNO</span><small>PRESALES AI</small></span></div>
      <p className="muted" style={{ marginTop: 20 }}>{title}</p>
      <div className="card">
        {mode === "register" && (
          <>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
          </>
        )}
        <label>Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={onKey} />
        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={onKey}
          placeholder={mode === "login" ? "" : "at least 8 characters"} />
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={submit} disabled={busy}>{busy ? "…" : cta}</button>
        </div>
        {err && <p className="err">{err}</p>}
        <p className="dim" style={{ fontSize: 12, marginTop: 12 }}>
          {mode === "register" ? "Already have an account? " : "No account yet? "}
          <a href="#" onClick={(e) => { e.preventDefault(); setErr(null); setMode(mode === "register" ? "login" : "register"); }}>
            {mode === "register" ? "Sign in" : "Create one"}
          </a>
        </p>
      </div>
    </div>
  );
}

export function Settings() {
  return (
    <div>
      <div className="crumb">Settings</div>
      <h1>Settings</h1>
      <div className="card">
        <h2>Organization</h2>
        <label>Default AWS region for estimates</label>
        <select><option>Asia Pacific (Mumbai) — ap-south-1</option><option>US East (N. Virginia) — us-east-1</option></select>
        <label>Currency for cost estimates</label>
        <select><option>USD</option><option>INR</option><option>EUR</option></select>
        <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Organization defaults (v1: display only).</div>
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>
        To change your password, click your profile at the bottom of the sidebar.
      </div>
    </div>
  );
}

function ChangePasswordModal({ user, onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);   // { ok: boolean, text: string }

  const submit = async () => {
    setMsg(null);
    if (next !== confirm) { setMsg({ ok: false, text: "New passwords do not match." }); return; }
    if (next.length < 8) { setMsg({ ok: false, text: "New password must be at least 8 characters." }); return; }
    setBusy(true);
    try {
      const res = await api.changePassword(current, next);
      // The session rotated — adopt the new CSRF token so later actions work.
      if (res?.csrfToken) setCsrfToken(res.csrfToken);
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ ok: true, text: "Password changed. Other sessions have been signed out." });
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>Change password</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="dim" style={{ fontSize: 12, marginBottom: 10 }}>{user.email}</div>
        <label>Current password</label>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        <label>New password</label>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder="at least 8 characters" />
        <label>Confirm new password</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button className="btn" onClick={submit} disabled={busy || !current || !next || !confirm}>
            {busy ? "…" : "Update password"}
          </button>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
        {msg && <p className={msg.ok ? "muted" : "err"} style={{ marginTop: 10 }}>{msg.text}</p>}
      </div>
    </div>
  );
}
