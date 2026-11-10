-- 011_user_auth.sql — self-hosted session-cookie authentication.
--
-- Replaces the v1 stub auth (a trusted X-User-Id header) with real
-- authentication: an Argon2 password hash on each user, and a server-side
-- sessions table whose opaque id is handed to the browser in an HttpOnly,
-- Secure, SameSite cookie. This is the OWASP/2026-recommended shape for a
-- single-domain app (server-side sessions give instant revocation; the
-- credential never lives in JavaScript). JWTs were deliberately not chosen —
-- there is no stateless-scaling need here and revocation would be harder.
--
-- password_hash is nullable so existing rows stay valid; a user without a hash
-- simply cannot log in with a password until one is set (register/set-password).
-- csrf_token is stored per session for double-submit CSRF protection on
-- mutating requests (cookies are sent automatically, so a CSRF token is needed).

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE IF NOT EXISTS sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

COMMIT;
