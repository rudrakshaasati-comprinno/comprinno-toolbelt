import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, closePool } from "./pool.js";

/**
 * migrate.js - Apply pending SQL migrations in filename order.
 *
 * Plain versioned .sql files + a schema_migrations tracking table. Transparent,
 * dependency-light, provider-agnostic (works on local Postgres, RDS, etc.).
 * Each migration file is applied inside its own transaction (the files also
 * wrap their DDL in BEGIN/COMMIT, which is a harmless no-op nesting).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

async function ensureTrackingTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function appliedSet() {
  const { rows } = await pool.query("SELECT filename FROM schema_migrations");
  return new Set(rows.map((r) => r.filename));
}

export async function migrate() {
  await ensureTrackingTable();
  const applied = await appliedSet();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`[migrate] applying ${file} ...`);
    const client = await pool.connect();
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [file]);
      count++;
    } catch (err) {
      console.error(`[migrate] FAILED ${file}: ${err.message}`);
      client.release();
      throw err;
    }
    client.release();
  }
  console.log(count ? `[migrate] applied ${count} migration(s).` : "[migrate] up to date.");
  return count;
}

// Allow running directly: `npm run migrate`.
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      closePool().finally(() => process.exit(1));
    });
}
