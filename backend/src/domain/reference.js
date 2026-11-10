import { query } from "../db/pool.js";

/**
 * reference.js - DB-driven reference data: engagement types and per-type
 * discovery questionnaire templates. Served to the frontend so the dropdown
 * options and default questions come from the DB, not hardcoded UI.
 */

export async function listEngagementTypes() {
  const { rows } = await query(`SELECT id, label FROM engagement_types ORDER BY sort_order`);
  return rows;
}

export async function questionnaireTemplate(engagementType) {
  const { rows } = await query(
    `SELECT question FROM questionnaire_templates WHERE engagement_type = $1 ORDER BY sort_order`,
    [engagementType]
  );
  return rows.map((r) => r.question);
}
