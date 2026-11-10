import { randomBytes } from "node:crypto";
import { query } from "../db/pool.js";

/**
 * sessions.js - Server-side session store for cookie authentication.
 *
 * A login creates a session row; its opaque UUID id is what goes in the
 * HttpOnly cookie (never a JWT, never in JS-readable storage). Each session
 * carries a high-entropy CSRF token used for double-submit protection on
 * mutating requests. Revocation is a single DELETE (instant logout), and
 * "log out everywhere" is a delete by user_id — the property that makes
 * server-side sessions preferable to JWTs here.
 */

// Session lifetime. Overridable via env; default 24h.
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 24 * 60 * 60 * 1000);

/** Create a session for a user, returning { id, csrfToken, expiresAt }. */
export async function createSession(userId) {
  const csrfToken = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const { rows } = await query(
    `INSERT INTO sessions(user_id, csrf_token, expires_at)
     VALUES ($1, $2, $3) RETURNING id, csrf_token, expires_at`,
    [userId, csrfToken, expiresAt]
  );
  const s = rows[0];
  return { id: s.id, csrfToken: s.csrf_token, expiresAt: s.expires_at };
}

/**
 * Look up a live (non-expired) session by id. Returns { userId, csrfToken } or
 * null. Refreshes last_seen opportunistically (sliding activity, not TTL).
 */
export async function getSession(sessionId) {
  if (!sessionId) return null;
  const { rows } = await query(
    `SELECT user_id, csrf_token, expires_at FROM sessions
     WHERE id = $1 AND expires_at > now()`,
    [sessionId]
  );
  const s = rows[0];
  if (!s) return null;
  // Best-effort activity timestamp; ignore failures (not on the hot path).
  query(`UPDATE sessions SET last_seen = now() WHERE id = $1`, [sessionId]).catch(() => {});
  return { userId: s.user_id, csrfToken: s.csrf_token };
}

/** Delete one session (logout). */
export async function deleteSession(sessionId) {
  if (!sessionId) return;
  await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

/** Delete every session for a user ("log out everywhere" / on password change). */
export async function deleteUserSessions(userId) {
  await query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
}

/** Best-effort cleanup of expired sessions (call periodically if desired). */
export async function purgeExpiredSessions() {
  await query(`DELETE FROM sessions WHERE expires_at <= now()`);
}
