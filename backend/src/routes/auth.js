import { Router } from "express";
import { createUser, getUserById, setPassword, verifyCredentials, getUserByEmail } from "../domain/users.js";
import { createSession, deleteSession, deleteUserSessions } from "../domain/sessions.js";
import { SESSION_COOKIE, requireCsrf } from "../http/auth.js";

/**
 * auth.js (routes) - Session-cookie authentication endpoints.
 *
 *   POST /api/auth/register  { email, name, password }  -> create user + log in
 *   POST /api/auth/login     { email, password }        -> log in
 *   POST /api/auth/logout                               -> destroy the session
 *   GET  /api/auth/me                                   -> current user (or 401)
 *
 * On login/register the backend creates a server-side session and sets an
 * HttpOnly, Secure*, SameSite=Lax cookie holding the opaque session id; it also
 * returns the session's CSRF token in the JSON body so the SPA can echo it on
 * mutating requests. (*Secure is enabled in production; omitted for local plain
 * HTTP so the cookie is accepted on http://localhost.)
 */

export const authRouter = Router();

// The session cookie's Secure flag. The app is served over plain HTTP on
// :8000 by convention, and browsers reject a Secure cookie over http://, so
// this defaults OFF. Set COOKIE_SECURE=true only when TLS terminates in front
// of the app (a reverse proxy / load balancer), otherwise logins silently fail.
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000);

function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, {
    httpOnly: true,            // JS cannot read it -> blunts XSS exfiltration
    secure: COOKIE_SECURE,     // only over HTTPS; off for the plain-HTTP default
    sameSite: "lax",           // same-origin app; mitigates CSRF on navigations
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

/** Shape a user row for the client (never expose the password hash). */
function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

async function startSession(res, user) {
  const { id, csrfToken } = await createSession(user.id);
  setSessionCookie(res, id);
  return { user: publicUser(user), csrfToken };
}

authRouter.post("/auth/register", async (req, res) => {
  const { email, name, password } = req.body || {};
  if (!email || !name || !password) {
    return res.status(400).json({ error: "email, name and password are required" });
  }
  if (String(password).length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  try {
    if (await getUserByEmail(email)) {
      // Do not reveal whether the email exists beyond what registration must.
      return res.status(409).json({ error: "an account with that email already exists" });
    }
    const user = await createUser({ email, name });
    await setPassword(user.id, password);
    res.status(201).json(await startSession(res, user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

authRouter.post("/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });
  try {
    const user = await verifyCredentials(email, password);
    // One generic message for any failure — no user-enumeration.
    if (!user) return res.status(401).json({ error: "invalid email or password" });
    res.json(await startSession(res, user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

authRouter.post("/auth/logout", async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  try { await deleteSession(sid); } catch { /* already gone */ }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

authRouter.get("/auth/me", async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: "not authenticated" });
  try {
    const user = await getUserById(req.userId);
    if (!user) return res.status(401).json({ error: "not authenticated" });
    res.json({ user: publicUser(user), csrfToken: req.csrfToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/change-password { currentPassword, newPassword } — change the
 * signed-in user's password. Requires an authenticated session, verifies the
 * current password, then rotates: sets the new hash and invalidates every OTHER
 * session for the user (a compromised old session cannot survive a password
 * change). The caller's current session is kept, and its cookie/CSRF stay valid.
 */
authRouter.post("/auth/change-password", requireCsrf, async (req, res) => {
  if (!req.userId) return res.status(401).json({ error: "authentication required" });
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "new password must be at least 8 characters" });
  }
  try {
    const user = await getUserById(req.userId);
    if (!user) return res.status(401).json({ error: "authentication required" });
    // A user with no password yet must use set-password, not change-password.
    if (!user.password_hash || !(await verifyCredentials(user.email, currentPassword))) {
      return res.status(403).json({ error: "current password is incorrect" });
    }
    await setPassword(user.id, newPassword);
    // Invalidate every other session, then re-issue this one so the caller
    // stays signed in with a fresh session + CSRF token.
    await deleteUserSessions(user.id);
    const { id, csrfToken } = await createSession(user.id);
    setSessionCookie(res, id);
    res.json({ user: publicUser(user), csrfToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/set-password { email, password } — bootstrap a password for an
 * account that has NONE yet (i.e. users seeded before password auth existed).
 * It refuses if the account already has a password (so it can't hijack a live
 * account); changing an existing password is the authenticated change-password
 * flow above. On success it logs the user in.
 */
authRouter.post("/auth/set-password", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "email and password are required" });
  if (String(password).length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }
  try {
    const user = await getUserByEmail(email);
    // Generic response whether or not the account exists / is eligible, to avoid
    // revealing which emails are registered or passwordless.
    if (!user || user.password_hash) {
      return res.status(409).json({ error: "this account cannot set a password here; sign in instead" });
    }
    await setPassword(user.id, password);
    res.status(201).json(await startSession(res, user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
