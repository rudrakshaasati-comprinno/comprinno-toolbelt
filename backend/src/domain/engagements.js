import { query } from "../db/pool.js";

/**
 * engagements.js - Engagement repository: the first-class entity everything
 * hangs off. Includes inputs (documents, questionnaire, notes) accessors used
 * to build the agent's inputs payload (task #4).
 */

export async function createEngagement({ name, clientName, engagementType, ownerId, useCase, goal }) {
  const { rows } = await query(
    `INSERT INTO engagements(name, client_name, engagement_type, owner_id, use_case, goal)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [name, clientName, engagementType, ownerId, useCase || null, goal || null]
  );
  return rows[0];
}

export async function getEngagement(id) {
  const { rows } = await query(`SELECT * FROM engagements WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listEngagementsForUser(userId) {
  // Owned or collaborated-on, most recently active first.
  const { rows } = await query(
    `SELECT DISTINCT e.* FROM engagements e
       LEFT JOIN engagement_collaborators c ON c.engagement_id = e.id
      WHERE e.owner_id = $1 OR c.user_id = $1
      ORDER BY e.updated_at DESC`,
    [userId]
  );
  return rows;
}

export async function updateEngagementStage(id, stage) {
  const { rows } = await query(
    `UPDATE engagements SET stage = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, stage]
  );
  return rows[0] || null;
}

export async function updateEngagementFields(id, { useCase, goal, clientName, engagementType, name }) {
  const { rows } = await query(
    `UPDATE engagements
        SET use_case = COALESCE($2, use_case),
            goal = COALESCE($3, goal),
            client_name = COALESCE($4, client_name),
            engagement_type = COALESCE($5, engagement_type),
            name = COALESCE($6, name),
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, useCase ?? null, goal ?? null, clientName ?? null, engagementType ?? null, name ?? null]
  );
  return rows[0] || null;
}

export async function setAgentSession(id, agentSessionId) {
  await query(
    `UPDATE engagements SET agent_session_id = $2, updated_at = now() WHERE id = $1`,
    [id, agentSessionId]
  );
}

/**
 * Mark analysis complete — the gate that unlocks the Recommendations stage.
 * Also advances the stage to 'recommendations'. Idempotent-ish: re-marking just
 * refreshes the timestamp/actor.
 */
export async function markAnalysisComplete(id, userId) {
  const { rows } = await query(
    `UPDATE engagements
        SET analysis_completed_at = now(),
            analysis_completed_by = $2,
            stage = CASE WHEN stage IN ('discovery','analysis') THEN 'recommendations' ELSE stage END,
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [id, userId || null]
  );
  return rows[0] || null;
}

export async function addCollaborator(engagementId, userId) {
  await query(
    `INSERT INTO engagement_collaborators(engagement_id, user_id)
     VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [engagementId, userId]
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────
export async function addDocument({ engagementId, name, s3Key, textS3Key, mime, addedBy, kind }) {
  const { rows } = await query(
    `INSERT INTO documents(engagement_id, name, s3_key, text_s3_key, mime, added_by, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [engagementId, name, s3Key, textS3Key || null, mime || null, addedBy || null, kind || "source"]
  );
  return rows[0];
}

export async function listDocuments(engagementId) {
  const { rows } = await query(
    `SELECT * FROM documents WHERE engagement_id = $1 ORDER BY created_at`,
    [engagementId]
  );
  return rows;
}

export async function getDocument(id) {
  const { rows } = await query(`SELECT * FROM documents WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function deleteDocument(id) {
  await query(`DELETE FROM documents WHERE id = $1`, [id]);
}

export async function deleteNote(id) {
  await query(`DELETE FROM notes WHERE id = $1`, [id]);
}

export async function deleteQuestionnaireAnswer(id) {
  await query(`DELETE FROM questionnaire_answers WHERE id = $1`, [id]);
}

export async function listQuestionnaire(engagementId) {
  const { rows } = await query(
    `SELECT * FROM questionnaire_answers WHERE engagement_id = $1 ORDER BY updated_at`,
    [engagementId]
  );
  return rows;
}

export async function listNotes(engagementId) {
  const { rows } = await query(
    `SELECT * FROM notes WHERE engagement_id = $1 ORDER BY created_at`,
    [engagementId]
  );
  return rows;
}

// ── Write helpers for the Inputs & Discovery screen ──────────────────────
export async function addQuestionnaireAnswer({ engagementId, question, answer, updatedBy }) {
  const { rows } = await query(
    `INSERT INTO questionnaire_answers(engagement_id, question, answer, updated_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [engagementId, question, answer || null, updatedBy || null]
  );
  return rows[0];
}

export async function updateQuestionnaireAnswer(id, answer) {
  const { rows } = await query(
    `UPDATE questionnaire_answers SET answer = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, answer]
  );
  return rows[0] || null;
}

export async function addNote({ engagementId, text, createdBy, kind }) {
  const { rows } = await query(
    `INSERT INTO notes(engagement_id, text, created_by, kind) VALUES ($1, $2, $3, $4) RETURNING *`,
    [engagementId, text, createdBy || null, kind || "note"]
  );
  return rows[0];
}

// ── Team & Access ────────────────────────────────────────────────────────
export async function listCollaborators(engagementId) {
  const { rows } = await query(
    `SELECT u.* FROM engagement_collaborators c
       JOIN users u ON u.id = c.user_id
      WHERE c.engagement_id = $1 ORDER BY c.added_at`,
    [engagementId]
  );
  return rows;
}

/**
 * Authorization check: is this user the owner of, or a collaborator on, the
 * engagement? Returns { allowed, exists, engagement }. `exists` distinguishes
 * a missing engagement (404) from a real access denial (403).
 */
export async function userCanAccessEngagement(engagementId, userId) {
  const { rows } = await query(
    `SELECT e.id, e.owner_id,
            (e.owner_id = $2
             OR EXISTS (SELECT 1 FROM engagement_collaborators c
                         WHERE c.engagement_id = e.id AND c.user_id = $2)) AS allowed
       FROM engagements e WHERE e.id = $1`,
    [engagementId, userId || null]
  );
  if (!rows.length) return { exists: false, allowed: false };
  return { exists: true, allowed: !!rows[0].allowed };
}

export async function transferOwnership(engagementId, newOwnerId) {
  const { rows } = await query(
    `UPDATE engagements SET owner_id = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [engagementId, newOwnerId]
  );
  return rows[0] || null;
}

/**
 * Produce the next available clone name for a source name, file-manager style:
 *   first copy -> "Base (copy)", then "Base (copy 2)", "Base (copy 3)", ...
 * Any existing " (copy)" / " (copy N)" suffix on the source is stripped first,
 * so cloning a clone yields "Base (copy 2)" rather than "Base (copy) (copy)".
 * The number is chosen by scanning existing engagement names for the same base
 * and picking the lowest free slot (collision-aware).
 */
async function nextCopyName(sourceName) {
  const base = String(sourceName).replace(/\s*\(copy(?:\s+\d+)?\)\s*$/i, "").trim();
  const { rows } = await query(
    `SELECT name FROM engagements WHERE name = $1 OR name LIKE $2`,
    [`${base} (copy)`, `${base} (copy %)`]
  );
  const taken = new Set(rows.map((r) => r.name));
  if (!taken.has(`${base} (copy)`)) return `${base} (copy)`;
  let n = 2;
  while (taken.has(`${base} (copy ${n})`)) n++;
  return `${base} (copy ${n})`;
}

/**
 * Hard-delete an engagement and everything under it. The DB foreign keys cascade
 * from engagements (documents, notes, questionnaire_answers, requirements,
 * recommendations, proposals, collaborators), but storage is NOT in the DB, so
 * the caller must purge S3 objects separately — this returns the document S3 keys
 * (raw + extracted text) so the route can delete them before/after the row.
 * Returns { deleted: boolean, s3Keys: string[] }.
 */
export async function deleteEngagement(id) {
  const { rows: docs } = await query(
    `SELECT s3_key, text_s3_key FROM documents WHERE engagement_id = $1`,
    [id]
  );
  const s3Keys = [];
  for (const d of docs) {
    if (d.s3_key) s3Keys.push(d.s3_key);
    if (d.text_s3_key) s3Keys.push(d.text_s3_key);
  }
  const { rowCount } = await query(`DELETE FROM engagements WHERE id = $1`, [id]);
  return { deleted: rowCount > 0, s3Keys };
}

/**
 * Clone ONLY the Overview inputs of an engagement into a brand-new engagement
 * owned by `newOwnerId`: metadata (name suffixed " (copy)", client, type,
 * use_case, goal), documents (source + meeting_mom), notes, and questionnaire
 * answers. The generated work — requirements, recommendations, proposal,
 * activity, agent session, and the analysis/finalize stamps — is deliberately
 * NOT copied; the clone starts fresh.
 *
 * Document S3 objects are physically duplicated to new keys (storage lives
 * outside the DB), via the provided copyObjectFn(srcKey, destKey) -> destKey so
 * this domain module stays storage-agnostic.
 */
export async function cloneEngagementOverview(sourceId, newOwnerId, copyObjectFn) {
  const src = await getEngagement(sourceId);
  if (!src) return null;

  const clone = await createEngagement({
    name: await nextCopyName(src.name),
    clientName: src.client_name,
    engagementType: src.engagement_type,
    ownerId: newOwnerId,
    useCase: src.use_case,
    goal: src.goal,
  });

  // Documents: copy the row AND the underlying S3 objects to engagement-scoped
  // keys for the new engagement.
  const { rows: docs } = await query(
    `SELECT * FROM documents WHERE engagement_id = $1 ORDER BY created_at`,
    [sourceId]
  );
  for (const d of docs) {
    const inserted = await addDocument({
      engagementId: clone.id,
      name: d.name,
      s3Key: "pending",            // replaced below once we know the new doc id
      textS3Key: null,
      mime: d.mime,
      addedBy: newOwnerId,
      kind: d.kind,
    });
    let newRaw = null, newText = null;
    try {
      if (d.s3_key) {
        newRaw = `engagements/${clone.id}/sources/${inserted.id}-${d.name}`;
        await copyObjectFn(d.s3_key, newRaw);
      }
      if (d.text_s3_key) {
        newText = `engagements/${clone.id}/sources/${inserted.id}-${d.name}.txt`;
        await copyObjectFn(d.text_s3_key, newText);
      }
    } catch {
      /* if a source object is missing, keep the row pointing at best-effort keys */
    }
    await query(
      `UPDATE documents SET s3_key = $2, text_s3_key = $3, status = $4 WHERE id = $1`,
      [inserted.id, newRaw || d.s3_key, newText, d.status]
    );
  }

  // Notes.
  await query(
    `INSERT INTO notes(engagement_id, text, created_by, kind)
     SELECT $1, text, $2, kind FROM notes WHERE engagement_id = $3`,
    [clone.id, newOwnerId, sourceId]
  );

  // Questionnaire answers.
  await query(
    `INSERT INTO questionnaire_answers(engagement_id, question, answer, updated_by)
     SELECT $1, question, answer, $2 FROM questionnaire_answers WHERE engagement_id = $3`,
    [clone.id, newOwnerId, sourceId]
  );

  return getEngagement(clone.id);
}
