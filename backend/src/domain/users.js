import { query } from "../db/pool.js";
import argon2 from "argon2";

/**
 * users.js - User repository + password credentials.
 *
 * Identity is modeled from day one so ownership/collaboration is real.
 * Passwords are hashed with Argon2id (OWASP's current first-choice algorithm);
 * the plaintext never touches the store and the hash never leaves the backend.
 */

export async function createUser({ email, name, role = "consultant" }) {
  const { rows } = await query(
    `INSERT INTO users(email, name, role) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [email, name, role]
  );
  return rows[0];
}

export async function getUserById(id) {
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function getUserByEmail(email) {
  const { rows } = await query(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0] || null;
}

export async function listUsers() {
  const { rows } = await query(`SELECT * FROM users ORDER BY created_at`);
  return rows;
}

/** Set (or change) a user's password. Hashes with Argon2id before storing. */
export async function setPassword(userId, plaintext) {
  const hash = await argon2.hash(plaintext, { type: argon2.argon2id });
  await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
}

/**
 * Verify an email + password. Returns the user row on success, or null on any
 * failure (unknown email, no password set, or wrong password) — the caller
 * MUST NOT distinguish these to avoid user-enumeration.
 */
export async function verifyCredentials(email, plaintext) {
  const user = await getUserByEmail(email);
  if (!user || !user.password_hash) return null;
  let ok = false;
  try { ok = await argon2.verify(user.password_hash, plaintext); } catch { ok = false; }
  return ok ? user : null;
}
