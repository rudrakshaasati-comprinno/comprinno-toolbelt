import { query } from "../db/pool.js";

/**
 * chat.js - Engagement chat message repository (Phase 3).
 *
 * Chat turns are exploration on top of the analysis (the analyst answers
 * questions using the persistent ACP session). Stored so the conversation
 * survives reloads; distinct from the analysis artifacts.
 */

export async function addChatMessage({ engagementId, role, content, runId, createdBy, dedupeWindowMs = 0 }) {
  // Optional idempotency: if an identical message from the same role was
  // inserted within dedupeWindowMs, return that row instead of a duplicate.
  // Guards against a rapid double-submit / retry racing the UI's disable.
  if (dedupeWindowMs > 0) {
    const { rows: recent } = await query(
      `SELECT * FROM chat_messages
         WHERE engagement_id = $1 AND role = $2 AND content = $3
           AND created_at > NOW() - ($4::int * INTERVAL '1 millisecond')
         ORDER BY created_at DESC LIMIT 1`,
      [engagementId, role, content, dedupeWindowMs]
    );
    if (recent[0]) return recent[0];
  }
  const { rows } = await query(
    `INSERT INTO chat_messages(engagement_id, role, content, run_id, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [engagementId, role, content, runId || null, createdBy || null]
  );
  return rows[0];
}

export async function listChatMessages(engagementId) {
  const { rows } = await query(
    `SELECT * FROM chat_messages WHERE engagement_id = $1 ORDER BY created_at`,
    [engagementId]
  );
  return rows;
}
