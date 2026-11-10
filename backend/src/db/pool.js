import pg from "pg";
import { DATABASE_URL, PG_POOL_MAX } from "../config.js";

/**
 * pool.js - One pg Pool per process, reused for every request (the recommended
 * long-running-server pattern). Exposes query() and a transaction helper.
 */

const { Pool } = pg;

export const pool = new Pool({
  connectionString: DATABASE_URL,
  max: PG_POOL_MAX,
});

pool.on("error", (err) => {
  // A pooled client can emit an error when the DB drops the connection; log it
  // rather than crash the process.
  console.error("[db] idle client error:", err.message);
});

/**
 * Run a parameterized query. Always use $1,$2 placeholders — never string
 * interpolation — to prevent SQL injection.
 */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run fn inside a transaction with a dedicated client. Commits on success,
 * rolls back on any error. Use for atomic multi-write operations (4.2:
 * persist an agent turn and its artifacts together).
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may already be broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
