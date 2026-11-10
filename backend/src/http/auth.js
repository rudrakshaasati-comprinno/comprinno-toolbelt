import { userCanAccessEngagement } from "../domain/engagements.js";
import { getSession } from "../domain/sessions.js";

/**
 * auth.js - Identity + authorization for cookie-based sessions.
 *
 * `identity` establishes WHO the caller is by verifying the server-side session
 * referenced by the HttpOnly `session` cookie — this is the one seam that
 * changed when real auth replaced the stub. Everything downstream still relies
 * on req.userId, so `authorizeEngagement` and the routes are unchanged.
 *
 * `requireCsrf` guards state-changing requests with a double-submit token:
 * because the session cookie is sent automatically by the browser, a mutating
 * request must ALSO echo the session's CSRF token in the X-CSRF-Token header
 * (which cross-site attackers cannot read). Safe methods are exempt.
 */

export const SESSION_COOKIE = "session";

/**
 * Resolve the caller from the session cookie into req.userId. Also stashes the
 * session's CSRF token (req.csrfToken) for requireCsrf. No valid session ->
 * req.userId stays null and protected routes 401.
 */
export async function identity(req, _res, next) {
  req.userId = null;
  req.csrfToken = null;
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) {
    try {
      const session = await getSession(sid);
      if (session) {
        req.userId = session.userId;
        req.csrfToken = session.csrfToken;
      }
    } catch {
      /* treat a lookup failure as unauthenticated */
    }
  }
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Reject a mutating request that does not present the session's CSRF token.
 * Applied globally after `identity`; safe methods and the auth endpoints
 * (which have no session yet) pass through.
 */
export function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  // No session at all -> nothing to protect; the route's own auth check (401)
  // handles it. Only enforce CSRF once a session exists.
  if (!req.userId) return next();
  const presented = req.get("X-CSRF-Token");
  if (!presented || presented !== req.csrfToken) {
    return res.status(403).json({ error: "invalid or missing CSRF token" });
  }
  next();
}

/** Require an authenticated caller (used by routes that aren't engagement-scoped). */
export function requireAuth(req, res, next) {
  if (!req.userId) return res.status(401).json({ error: "authentication required" });
  next();
}

/**
 * Require that req.userId owns or collaborates on the engagement identified by
 * :id (or :engagementId) in the route. 401 if no caller, 404 if the engagement
 * doesn't exist, 403 if the caller has no access.
 */
export async function authorizeEngagement(req, res, next) {
  const engagementId = req.params.id || req.params.engagementId;
  if (!engagementId) return next(); // nothing to authorize against
  if (!req.userId) return res.status(401).json({ error: "authentication required (no user id)" });
  try {
    const { exists, allowed } = await userCanAccessEngagement(engagementId, req.userId);
    if (!exists) return res.status(404).json({ error: "engagement not found" });
    if (!allowed) return res.status(403).json({ error: "not authorized for this engagement" });
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
