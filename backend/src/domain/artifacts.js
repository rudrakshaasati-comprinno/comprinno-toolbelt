import { query, withTransaction } from "../db/pool.js";
import { putObject, keys } from "../storage/storage.js";

/**
 * artifacts.js - Persist and read the agent's structured artifacts.
 *
 * persistEnvelope() writes everything from one agent run atomically (4.2:
 * an agent turn and its artifacts must be written in a single transaction so a
 * crash never leaves orphaned partial state). It maps the envelope's external
 * ids (req_1, rec_1, ...) to DB UUIDs so recommendation->requirement links
 * survive.
 *
 * NOTE (4.1 shape-not-truth): the envelope is already schema-valid at the agent
 * boundary. The DB CHECK constraints (applied=>high confidence, on_hold=>reason,
 * enum values) are the final semantic guard; a violating envelope makes the
 * transaction fail loudly rather than persist bad data.
 */

export async function persistEnvelope({ engagementId, runId, envelope, userId = null, stage = null }) {
  return withTransaction(async (client) => {
    // Archive the raw envelope for audit/repair.
    await client.query(
      `INSERT INTO agent_runs(engagement_id, run_id, result_type, envelope)
       VALUES ($1, $2, $3, $4)`,
      [engagementId, runId, envelope.resultType || null, envelope]
    );

    const artifacts = envelope.artifacts || {};
    const reqIdMap = new Map(); // external req id -> db uuid

    // Per-stage replacement (staged flow): each gated run persists ONLY its own
    // stage's artifacts, so a recommendations run does not wipe requirements and
    // a requirements re-run does not wipe recommendations. When stage is null
    // (legacy single-run analysis / chat) we fall back to presence-guarded
    // replacement of whatever the envelope carries.
    const doRequirements = stage === "requirements" || stage === null;
    const doRecommendations = stage === "recommendations" || stage === null;
    const doProposal = stage === "proposal" || stage === null;

    // Requirements stage replaces requirements (and their dependent recs, since
    // recs FK to requirements). Recommendations stage replaces only recs.
    if (doRequirements && Array.isArray(artifacts.requirements) && artifacts.requirements.length) {
      await client.query(`DELETE FROM recommendations WHERE engagement_id = $1`, [engagementId]);
      await client.query(`DELETE FROM requirements WHERE engagement_id = $1`, [engagementId]);
    } else if (doRecommendations && Array.isArray(artifacts.recommendations) && artifacts.recommendations.length) {
      await client.query(`DELETE FROM recommendations WHERE engagement_id = $1`, [engagementId]);
    }

    // Requirements (only when this run owns the requirements stage)
    if (doRequirements) {
      for (const r of artifacts.requirements || []) {
        const { rows } = await client.query(
          `INSERT INTO requirements
             (engagement_id, external_id, category, text, status, missing, citations)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            engagementId, r.id || null, r.category, r.text, r.status,
            r.missing || null, JSON.stringify(r.citations || []),
          ]
        );
        if (r.id) reqIdMap.set(r.id, rows[0].id);
      }
    }

    // For a recommendations-only run, requirements already exist in the DB;
    // load their external_id -> uuid so recommendation FK linkage still works.
    if (doRecommendations && !doRequirements) {
      const { rows } = await client.query(
        `SELECT id, external_id FROM requirements WHERE engagement_id = $1`, [engagementId]
      );
      for (const row of rows) if (row.external_id) reqIdMap.set(row.external_id, row.id);
    }

    // Recommendations (link to requirement by external id when present)
    if (doRecommendations) {
      for (const rec of artifacts.recommendations || []) {
        const requirementUuid = rec.requirementId ? reqIdMap.get(rec.requirementId) || null : null;
        await client.query(
          `INSERT INTO recommendations
             (engagement_id, external_id, requirement_id, from_service, aws_service,
              strategy, confidence, status, on_hold_reason, rationale, impact,
              estimated_cost, depth, gpu_detail, citations)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            engagementId, rec.id || null, requirementUuid, rec.from || null, rec.awsService,
            rec.strategy, rec.confidence, rec.status, rec.onHoldReason || null,
            rec.rationale, rec.impact || null,
            rec.estimatedMonthlyCost ? JSON.stringify(rec.estimatedMonthlyCost) : null,
            rec.depth === "deep" ? "deep" : "overview",
            rec.gpuDetail ? JSON.stringify(rec.gpuDetail) : null,
            JSON.stringify(rec.citations || []),
          ]
        );
      }
    }

    // Proposal sections -> a new proposal version (only when this run owns it)
    if (doProposal && (artifacts.proposalSections || []).length) {
      const { rows: verRows } = await client.query(
        `INSERT INTO proposal_versions(engagement_id, version, created_by)
         VALUES ($1, COALESCE((SELECT MAX(version) FROM proposal_versions WHERE engagement_id = $1), 0) + 1, $2)
         RETURNING id`,
        [engagementId, userId]
      );
      const versionId = verRows[0].id;
      let order = 0;
      for (const s of artifacts.proposalSections) {
        await client.query(
          `INSERT INTO proposal_sections
             (proposal_version_id, external_id, title, content, status, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [versionId, s.id || null, s.title, s.content, s.status || "drafted", order++]
        );
      }
    }

    // Activity timeline
    for (const a of envelope.activity || []) {
      await client.query(
        `INSERT INTO agent_activity(engagement_id, run_id, ts, label, message, agent_session_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [engagementId, runId, a.ts || new Date().toISOString(), a.label || a.phase || "step", a.message, envelope.sessionId || null]
      );
    }
  });
}

// ── Read artifacts back (for the frontend screens) ────────────────────────
export async function getRequirements(engagementId) {
  const { rows } = await query(
    `SELECT * FROM requirements WHERE engagement_id = $1 ORDER BY created_at`,
    [engagementId]
  );
  return rows;
}

export async function getRecommendations(engagementId) {
  const { rows } = await query(
    `SELECT * FROM recommendations WHERE engagement_id = $1 ORDER BY created_at`,
    [engagementId]
  );
  return rows;
}

/**
 * Record the consultant's decision (accept/reject) on a recommendation — the
 * Recommendations-stage approval gate. Kept separate from the agent's `status`.
 */
export async function decideRecommendation(recommendationId, { decision, reason, userId }) {
  if (!["pending", "accepted", "rejected"].includes(decision)) {
    throw new Error(`invalid decision: ${decision}`);
  }
  const { rows } = await query(
    `UPDATE recommendations
        SET decision = $2,
            decision_reason = $3,
            decided_by = $4,
            decided_at = CASE WHEN $2 = 'pending' THEN NULL ELSE now() END
      WHERE id = $1 RETURNING *`,
    [recommendationId, decision, reason || null, userId || null]
  );
  return rows[0] || null;
}

/**
 * Are all recommendations for an engagement decided (none left pending)?
 * The gate that unlocks the Proposal stage. Returns { total, pending, decided,
 * accepted, rejected, allDecided }.
 */
export async function recommendationDecisionStatus(engagementId) {
  const { rows } = await query(
    `SELECT decision, COUNT(*)::int AS n FROM recommendations
      WHERE engagement_id = $1 GROUP BY decision`,
    [engagementId]
  );
  const by = Object.fromEntries(rows.map((r) => [r.decision, r.n]));
  const total = (by.pending || 0) + (by.accepted || 0) + (by.rejected || 0);
  return {
    total,
    pending: by.pending || 0,
    accepted: by.accepted || 0,
    rejected: by.rejected || 0,
    decided: (by.accepted || 0) + (by.rejected || 0),
    allDecided: total > 0 && (by.pending || 0) === 0,
  };
}

/**
 * Finalize the recommendations (Recommendations stage v2): write an IMMUTABLE
 * JSON snapshot of the current recommendation set to S3, then stamp the gate on
 * the engagement. Postgres remains the working/gating source of truth; the S3
 * object is the signed-off record the proposal is built from. Returns the
 * updated engagement row.
 */
export async function finalizeRecommendations(engagementId, userId) {
  // Idempotent: finalization is a one-time, immutable (WORM) event. If this
  // engagement is already finalized, return it unchanged rather than writing a
  // second, divergent snapshot and re-stamping the columns.
  const { rows: existing } = await query(
    `SELECT * FROM engagements WHERE id = $1`, [engagementId]
  );
  if (!existing.length) return null;
  if (existing[0].recommendations_finalized_at) return existing[0];

  const recs = await getRecommendations(engagementId);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshotKey = keys.recommendationsSnapshot(engagementId, ts);
  const snapshot = {
    engagementId,
    finalizedAt: new Date().toISOString(),
    finalizedBy: userId || null,
    count: recs.length,
    recommendations: recs,
  };
  await putObject(snapshotKey, JSON.stringify(snapshot, null, 2), "application/json");

  const { rows } = await query(
    `UPDATE engagements
        SET recommendations_finalized_at = now(),
            recommendations_finalized_by = $2,
            recommendations_snapshot_key = $3,
            stage = CASE WHEN stage IN ('discovery','analysis','recommendations') THEN 'proposal' ELSE stage END,
            updated_at = now()
      WHERE id = $1 RETURNING *`,
    [engagementId, userId || null, snapshotKey]
  );
  return rows[0] || null;
}

export async function getLatestProposal(engagementId) {
  const { rows: versions } = await query(
    `SELECT * FROM proposal_versions WHERE engagement_id = $1 ORDER BY version DESC LIMIT 1`,
    [engagementId]
  );
  if (!versions.length) return null;
  const version = versions[0];
  const { rows: sections } = await query(
    `SELECT * FROM proposal_sections WHERE proposal_version_id = $1 ORDER BY sort_order`,
    [version.id]
  );
  return { version, sections };
}

export async function approveProposal(proposalVersionId, approvedBy) {
  const { rows } = await query(
    `UPDATE proposal_versions SET approved_at = now(), approved_by = $2
     WHERE id = $1 RETURNING *`,
    [proposalVersionId, approvedBy]
  );
  return rows[0] || null;
}

export async function getActivity(engagementId) {
  // Each activity row correlates to the agent run that produced it via run_id
  // (AG-UI-style run correlation). We surface that run's result_type as `stage`
  // so the frontend can render either the all-interaction timeline (Overview)
  // or a stage-filtered timeline (e.g. the Analysis tab shows requirements-stage
  // activity only). No stage column is denormalized onto agent_activity because
  // the stage is derivable from the run.
  const { rows } = await query(
    `SELECT a.*, r.result_type AS stage
       FROM agent_activity a
       LEFT JOIN LATERAL (
         SELECT result_type FROM agent_runs
          WHERE agent_runs.run_id = a.run_id
          ORDER BY created_at DESC LIMIT 1
       ) r ON TRUE
      WHERE a.engagement_id = $1
      ORDER BY a.ts`,
    [engagementId]
  );
  return rows;
}
