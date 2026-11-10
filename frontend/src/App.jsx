import React, { useState, useEffect, useCallback } from "react";
import { api, setCsrfToken, setOnUnauthorized } from "./api.js";
import { Sidebar, SignIn, Settings } from "./components/Shell.jsx";
import { Dashboard } from "./components/Dashboard.jsx";
import { Engagement } from "./components/Engagement.jsx";

/**
 * App.jsx — top-level shell for the AWS Pre-Sales AI Platform frontend.
 * Routes between Dashboard, an Engagement (tabbed), and Settings. Screen
 * components live under ./components/. Auth is a server-side session in an
 * HttpOnly cookie: on load we call /me to rehydrate (survives refresh), and a
 * 401 anywhere drops back to sign-in.
 */
export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);   // finished the initial /me check
  const [view, setView] = useState({ screen: "dashboard", engagementId: null });
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "1");
  const toggleCollapse = () => setCollapsed((c) => {
    const next = !c; localStorage.setItem("sidebarCollapsed", next ? "1" : "0"); return next;
  });

  const signOut = useCallback(() => { setUser(null); setCsrfToken(null); setView({ screen: "dashboard", engagementId: null }); }, []);

  // A 401 from any call means the session ended — return to sign-in.
  useEffect(() => { setOnUnauthorized(signOut); }, [signOut]);

  // Rehydrate an existing session on load (the cookie is sent automatically).
  useEffect(() => {
    api.me()
      .then(({ user: u, csrfToken }) => { setCsrfToken(csrfToken); setUser(u); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const onSignedIn = ({ user: u, csrfToken }) => { setCsrfToken(csrfToken); setUser(u); };
  const logout = async () => { try { await api.logout(); } catch { /* ignore */ } signOut(); };

  if (!ready) return null;                 // avoid flashing sign-in before /me resolves
  if (!user) return <SignIn onSignedIn={onSignedIn} />;

  return (
    <div className="app">
      <Sidebar user={user} view={view} setView={setView} collapsed={collapsed} onToggleCollapse={toggleCollapse} onLogout={logout} />
      <main className="main">
        <div className="main-inner">
          {view.screen === "dashboard" && (
            <Dashboard user={user} onOpen={(id) => setView({ screen: "engagement", engagementId: id })} />
          )}
          {view.screen === "engagement" && (
            <Engagement id={view.engagementId} user={user}
              onBack={() => setView({ screen: "dashboard", engagementId: null })} />
          )}
          {view.screen === "settings" && <Settings />}
        </div>
      </main>
    </div>
  );
}
