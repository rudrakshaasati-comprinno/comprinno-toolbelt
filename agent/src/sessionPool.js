import { AcpSession } from "./AcpSession.js";
import { cleanupDir } from "./storage.js";

/**
 * sessionPool.js - Keep ACP sessions WARM across turns.
 *
 * Problem (observed): every POST /agent turn created a fresh AcpSession (a new
 * `kiro-cli acp` child process), re-ran session/load, and re-downloaded the
 * engagement's files — so every chat/refinement turn paid the full cold-start
 * cost ("downloading files" -> "resume session" -> long wait).
 *
 * Fix (validated against warm-session / KV-residency literature — Pensieve,
 * Continuum KV-TTL, "Keepalive Economics"): keep the live process resident in a
 * process-level pool keyed by engagement. The FIRST turn initializes/loads the
 * session and downloads the files once; SUBSEQUENT turns reuse the same warm
 * process (no re-spawn, no session/load, no re-download). An idle-TTL sweeper
 * closes sessions that have been unused for a while to free resources.
 *
 * Concurrency: one child process == one conversation, so turns for the same key
 * are SERIALIZED via a per-key promise chain (a second turn waits for the first
 * to finish) rather than racing the same stdin.
 */

// poolKey -> entry. entry = { session, downloadDir, filesLoaded, lastUsed,
//                             lock (Promise chain tail), creating (Promise) }
const pool = new Map();

// Evict a session after this long with no use. Overridable via env.
const IDLE_TTL_MS = Number(process.env.SESSION_POOL_TTL_MS || 15 * 60 * 1000); // 15 min
const SWEEP_MS = 60 * 1000; // check every minute

/**
 * Acquire the pooled entry for a key, creating (and warming) it if absent or if
 * the previous session died. `warm` is a callback that initializes a brand-new
 * AcpSession — it receives the fresh session and must load/initialize it and do
 * any one-time setup (e.g. download files), returning any metadata the caller
 * wants cached on the entry (e.g. { downloadDir }). It is only invoked on a
 * COLD create; on warm reuse it is NOT called.
 *
 * Returns { entry, warmedNow } where warmedNow=true means this call created the
 * session (cold), false means it was reused (warm).
 */
export async function acquire(key, makeSession, warm) {
  let entry = pool.get(key);

  // Reuse a live warm session.
  if (entry && entry.session && !entry.session.closed && entry.session.ready) {
    entry.lastUsed = Date.now();
    return { entry, warmedNow: false };
  }

  // Stale/dead entry — clean it up before recreating.
  if (entry) await evict(key);

  // Cold create. Guard against a concurrent second caller creating a duplicate
  // by stashing the in-flight creation promise on the map.
  entry = { session: null, downloadDir: null, filesLoaded: false, lastUsed: Date.now(), lock: Promise.resolve(), creating: null };
  pool.set(key, entry);
  entry.creating = (async () => {
    const session = makeSession();
    entry.session = session;
    // If the child process dies, drop it from the pool so the next turn recreates.
    session.addListener((event) => { if (event === "closed") pool.delete(key); });
    const meta = (await warm(session)) || {};
    if (meta.downloadDir !== undefined) entry.downloadDir = meta.downloadDir;
    if (meta.docText !== undefined) entry.docText = meta.docText;
    if (meta.modes !== undefined) entry.modes = meta.modes;
    entry.filesLoaded = true;
    entry.lastUsed = Date.now();
    return entry;
  })();
  try {
    await entry.creating;
  } catch (err) {
    // Creation failed — remove the half-built entry so we don't cache a broken one.
    await evict(key).catch(() => {});
    throw err;
  } finally {
    entry.creating = null;
  }
  return { entry, warmedNow: true };
}

/**
 * Serialize an async turn against the entry's per-key lock, so two turns for the
 * same session never write to the same stdin concurrently. Returns the turn's
 * result.
 */
export async function withTurnLock(entry, fn) {
  const run = entry.lock.then(fn, fn); // run after the previous turn settles
  // Keep the chain alive but don't let a rejection break future turns.
  entry.lock = run.then(() => {}, () => {});
  return run;
}

/** Close a session and clean up its resources, removing it from the pool. */
export async function evict(key) {
  const entry = pool.get(key);
  if (!entry) return;
  pool.delete(key);
  try { entry.session?.close?.(); } catch { /* ignore */ }
  try { await cleanupDir(entry.downloadDir); } catch { /* ignore */ }
}

/** Idle-TTL sweeper: evict sessions unused for longer than IDLE_TTL_MS. */
function sweep() {
  const now = Date.now();
  for (const [key, entry] of pool) {
    if (entry.creating) continue; // don't evict mid-creation
    if (now - entry.lastUsed > IDLE_TTL_MS) {
      evict(key).catch(() => {});
    }
  }
}
const sweeper = setInterval(sweep, SWEEP_MS);
sweeper.unref?.(); // don't keep the process alive just for the sweeper

export function poolStats() {
  return { size: pool.size, keys: [...pool.keys()] };
}
