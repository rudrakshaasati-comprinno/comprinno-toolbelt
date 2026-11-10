/**
 * semanticValidation.js - Business-rule ("truth-layer") validation of an
 * AgentEnvelope, run in the BACKEND after the agent has already guaranteed the
 * SHAPE (architecture-v1.md 4.1). A schema guarantees shape, not truth; these
 * checks enforce the cross-field invariants the schema cannot express.
 *
 * Rules enforced:
 *   1. Every recommendation.requirementId must reference an existing
 *      requirements[].id (referential integrity).
 *   2. A recommendation with status "applied" must have confidence "high"
 *      (only high-confidence mappings auto-apply).
 *   3. A recommendation with status "on_hold" must carry a non-empty
 *      onHoldReason.
 *   4. A requirement with status "needs_info" must carry a non-empty missing.
 *
 * Returns { valid, violations } where violations is a list of human-readable
 * strings. This is advisory: the caller decides whether to block, warn, or
 * repair. The product's real truth gate is confidence-gating + the single
 * human proposal approval, so we surface violations rather than hard-failing.
 */
export function validateEnvelopeSemantics(envelope) {
  const violations = [];
  const artifacts = (envelope && envelope.artifacts) || {};
  const requirements = Array.isArray(artifacts.requirements) ? artifacts.requirements : [];
  const recommendations = Array.isArray(artifacts.recommendations) ? artifacts.recommendations : [];

  const reqIds = new Set(requirements.map((r) => r && r.id).filter(Boolean));

  for (const r of recommendations) {
    if (!r || typeof r !== "object") continue;
    const label = r.id || r.awsService || "recommendation";
    // Rule 1: referential integrity.
    if (r.requirementId && !reqIds.has(r.requirementId)) {
      violations.push(`${label}: requirementId "${r.requirementId}" does not match any requirement.`);
    }
    // Rule 2: applied requires high confidence.
    if (r.status === "applied" && r.confidence !== "high") {
      violations.push(`${label}: status "applied" requires confidence "high" (got "${r.confidence || "none"}").`);
    }
    // Rule 3: on_hold requires a reason.
    if (r.status === "on_hold" && !(r.onHoldReason && String(r.onHoldReason).trim())) {
      violations.push(`${label}: status "on_hold" requires a non-empty onHoldReason.`);
    }
    // Rule 5: a structured cost estimate, when present, must be interpretable —
    // a numeric amount plus currency, basis, and a source (never a bare number).
    if (r.estimatedMonthlyCost != null) {
      const c = r.estimatedMonthlyCost;
      if (typeof c !== "object" || Array.isArray(c)) {
        violations.push(`${label}: estimatedMonthlyCost must be an object.`);
      } else {
        if (typeof c.amount !== "number" || !isFinite(c.amount)) {
          violations.push(`${label}: estimatedMonthlyCost.amount must be a number.`);
        }
        if (!(c.currency && String(c.currency).trim())) {
          violations.push(`${label}: estimatedMonthlyCost.currency is required.`);
        }
        if (!(c.basis && String(c.basis).trim())) {
          violations.push(`${label}: estimatedMonthlyCost.basis is required (so the number is interpretable).`);
        }
        if (!(c.source && String(c.source).trim())) {
          violations.push(`${label}: estimatedMonthlyCost.source is required (never a fabricated figure).`);
        }
        if (c.period != null && !["monthly", "per_run"].includes(c.period)) {
          violations.push(`${label}: estimatedMonthlyCost.period must be 'monthly' or 'per_run' when present.`);
        }
      }
    }
  }

  for (const q of requirements) {
    if (!q || typeof q !== "object") continue;
    const label = q.id || "requirement";
    // Rule 4: needs_info requires a missing note.
    if (q.status === "needs_info" && !(q.missing && String(q.missing).trim())) {
      violations.push(`${label}: status "needs_info" requires a non-empty missing.`);
    }
  }

  return { valid: violations.length === 0, violations };
}
