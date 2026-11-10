/* AUTO-GENERATED from docs/agent-envelope.schema.json by scripts/gen-contract.mjs.
 * Do not edit by hand. Run `npm run contract:gen` after changing the schema. */

/**
 * Self-describing structured result returned by the agent microservice POST /agent. Designed to be Bedrock structured-outputs compatible: every object sets additionalProperties:false, constrained fields use enum, and no unsupported JSON Schema features (recursion, external $ref, numeric/length constraints) are used.
 */
export interface AgentEnvelope {
  /**
   * The agent's ACP session id this result belongs to; the backend passes it back to continue the session.
   */
  sessionId: string;
  /**
   * What the agent produced, so the backend knows which artifacts to persist.
   */
  resultType: "analysis" | "recommendations" | "proposal" | "answer" | "mixed";
  /**
   * Only the sections relevant to resultType are populated; others may be empty arrays or omitted.
   */
  artifacts: {
    /**
     * Requirements extracted from the engagement inputs.
     */
    requirements?: {
      /**
       * Stable id for this requirement, e.g. req_1.
       */
      id: string;
      /**
       * Grouping, e.g. COMPUTE & HOSTING, DATA & STORAGE, INTEGRATION, SECURITY, NETWORKING.
       */
      category: string;
      /**
       * The requirement in one sentence.
       */
      text: string;
      /**
       * Whether the requirement is well-supported by evidence or needs client clarification.
       */
      status: "sufficient" | "needs_info";
      /**
       * When status is needs_info, what specifically is missing. Empty string when sufficient.
       */
      missing?: string;
      /**
       * Sources from the engagement inputs supporting this requirement.
       */
      citations: Citation[];
    }[];
    /**
     * AWS service mappings for well-supported requirements.
     */
    recommendations?: {
      /**
       * Stable id, e.g. rec_1.
       */
      id: string;
      /**
       * The requirement this maps, referencing requirements[].id.
       */
      requirementId: string;
      /**
       * The current-state service being migrated from, e.g. Azure App Service. Empty string if not applicable.
       */
      from?: string;
      /**
       * The recommended AWS service(s).
       */
      awsService: string;
      /**
       * The 7R migration strategy for this mapping.
       */
      strategy: "rehost" | "replatform" | "repurchase" | "refactor" | "retire" | "retain" | "relocate";
      /**
       * Agent confidence in this mapping. Only high-confidence items should be status:applied.
       */
      confidence: "high" | "medium" | "low";
      /**
       * applied = auto-applied at high confidence; on_hold = blocked on missing info; override = a human changed it.
       */
      status: "applied" | "on_hold" | "override";
      /**
       * When status is on_hold, why. Empty string otherwise.
       */
      onHoldReason?: string;
      /**
       * Why this AWS service was chosen.
       */
      rationale: string;
      /**
       * Directional cost/operational impact. Must be framed as directional, never a priced quote. Empty string if none.
       */
      impact?: string;
      /**
       * OPTIONAL structured monthly cost ESTIMATE for charting/comparison. Populate ONLY when a defensible figure was grounded in a real source (e.g. the aws-pricing MCP or a consulted specialist); otherwise omit it entirely (leave the directional text in impact). This is an estimate, never a quote.
       */
      estimatedMonthlyCost?: {
        /**
         * Estimated monthly cost as a number, in the given currency.
         */
        amount: number;
        /**
         * ISO currency code, e.g. USD.
         */
        currency: string;
        /**
         * What the estimate assumes, e.g. 'On-Demand, 730h/mo, us-east-1, 1x instance'. Required so the number is interpretable.
         */
        basis: string;
        /**
         * Confidence in the estimate.
         */
        confidence: "high" | "medium" | "low";
        /**
         * Where the figure came from, e.g. 'aws-pricing' or a cited specialist. Never fabricate.
         */
        source: string;
        /**
         * OPTIONAL. 'monthly' for recurring monthly spend (the default assumption if omitted), or 'per_run' when the figure is per execution (e.g. a training run) rather than monthly. Prevents per-run costs being compared against monthly ones.
         */
        period?: "monthly" | "per_run";
      };
      /**
       * Supporting sources from engagement inputs.
       */
      citations: Citation[];
      /**
       * OPTIONAL analysis depth for this recommendation, used to group the output. 'deep' = fully analyzed with specialist sizing/cost (currently the GPU / AI-ML workloads, grounded by gpu-advisor); 'overview' = high-level AWS mapping for a non-focus service (short target-service rationale, no deep sizing). Defaults to 'overview' when omitted. GPU / AI-ML recommendations MUST be 'deep'.
       */
      depth?: "deep" | "overview";
      /**
       * OPTIONAL rich GPU/AI-ML analysis for a depth:'deep' recommendation, folded in from the gpu-advisor specialist so the UI can render the full advisor experience (hero instance, four-dimension confidence, candidate comparison, Bedrock verdict, cost comparison). Populate ONLY for deep GPU recs and ONLY with figures grounded in real sources (aws-pricing / aws-documentation / cloud-cost, or the specialist's report). Omit any sub-object or field that cannot be grounded; never fabricate specs, prices, availability, or benchmarks.
       */
      gpuDetail?: {
        /**
         * The single recommended AWS GPU instance shown in the hero card.
         */
        instance?: {
          /**
           * AWS instance type, e.g. g6.xlarge.
           */
          name: string;
          /**
           * GPU model and count, e.g. '1x NVIDIA L4'. Empty string if unknown.
           */
          gpu?: string;
          /**
           * GPU memory, e.g. '24 GB'. Empty string if unknown.
           */
          gpuMem?: string;
          /**
           * vCPU count as text, e.g. '4'. Empty string if unknown.
           */
          vcpu?: string;
          /**
           * System RAM, e.g. '16 GB'. Empty string if unknown.
           */
          ram?: string;
          /**
           * Target region, e.g. us-east-1. Empty string if unknown.
           */
          region?: string;
        };
        /**
         * The four independent confidence dimensions shown as a matrix. Each is rated separately; 'low'/'medium' typically carry a note like 'Benchmark required' or 'Validation required'.
         */
        confidenceMatrix?: {
          hardware?: GpuConfidenceDimension;
          cost?: GpuConfidenceDimension;
          performance?: GpuConfidenceDimension;
          migration?: GpuConfidenceDimension;
        };
        /**
         * Top candidate AWS GPU instances ranked by fit and cost (typically up to 3), each with specs, a fit rationale, availability, and grounded pricing tiers.
         */
        candidates?: {
          /**
           * AWS instance type, e.g. g5.2xlarge.
           */
          name: string;
          /**
           * OPTIONAL short label, e.g. 'Cost-optimized', 'Direct equivalent', 'Sizing candidate'. Empty string if none.
           */
          tag?: string;
          /**
           * GPU model and count, e.g. '1x NVIDIA A10G'. Empty string if unknown.
           */
          gpu?: string;
          /**
           * GPU memory, e.g. '24 GB'. Empty string if unknown.
           */
          gpuMem?: string;
          /**
           * vCPU count as text. Empty string if unknown.
           */
          vcpu?: string;
          /**
           * System RAM, e.g. '32 GB'. Empty string if unknown.
           */
          ram?: string;
          /**
           * One or two sentences on why this instance fits (or the trade-off). Empty string if none.
           */
          fit?: string;
          /**
           * Target region. Empty string if unknown.
           */
          region?: string;
          /**
           * Availability note, e.g. 'verify quota / capacity'. Empty string if none.
           */
          availability?: string;
          /**
           * Grounded pricing tiers for this candidate (e.g. On-Demand, 1yr No Upfront). Omit or leave empty if not grounded.
           */
          pricing?: GpuPricingTier[];
        }[];
        /**
         * Amazon Bedrock (managed inference) verdict for this workload, evaluated separately. Bedrock is inference-only; state applicability and the reason.
         */
        bedrock?: {
          /**
           * Whether managed Bedrock inference applies to this workload.
           */
          status: "applicable" | "not_applicable" | "partial";
          /**
           * Why Bedrock does or does not apply, e.g. 'Fine-tuning workload, not managed-inference; Bedrock is inference-only'.
           */
          reason: string;
        };
        /**
         * Current source-cloud spend vs AWS options, for the savings chart. All figures grounded; the sourceCloud baseline is labeled by its provenance in the note.
         */
        costComparison?: {
          /**
           * The current (pre-migration) monthly spend being compared against.
           */
          sourceCloud?: {
            /**
             * Source-cloud label, e.g. 'GCP a2-highgpu-1g' or 'Current'.
             */
            name: string;
            /**
             * Current monthly spend as a number.
             */
            monthly: number;
            /**
             * ISO currency code, e.g. USD. Defaults to USD if omitted.
             */
            currency?: string;
          };
          /**
           * AWS options to compare (each a monthly figure with a label). The lowest is the recommended target.
           */
          options?: {
            /**
             * Option label, e.g. 'AWS On-Demand - g6.xlarge' or 'AWS Savings Plan - 3yr All Upfront - g6.xlarge'.
             */
            label: string;
            /**
             * Monthly cost as a number.
             */
            monthly: number;
            /**
             * ISO currency code. Defaults to USD if omitted.
             */
            currency?: string;
            /**
             * OPTIONAL true if this is the lowest-cost / recommended option.
             */
            lowest?: boolean;
          }[];
          /**
           * OPTIONAL percentage the best AWS option saves vs the source-cloud baseline (e.g. 81.1 for -81.1%). Positive = a saving.
           */
          savingsPct?: number;
          /**
           * How the comparison was computed and where each figure came from (AWS pricing/MCP, source-cloud basis, utilization hours). Empty string if none.
           */
          provenance?: string;
        };
        /**
         * OPTIONAL one- or two-sentence plain-English recommendation shown under the hero card. Empty string if none.
         */
        summary?: string;
      };
    }[];
    /**
     * Drafted proposal sections.
     */
    proposalSections?: {
      /**
       * Stable section id, e.g. sec_exec.
       */
      id: string;
      /**
       * Section heading, e.g. Executive summary.
       */
      title: string;
      /**
       * Section body as markdown.
       */
      content: string;
      /**
       * Review state of the section.
       */
      status: "drafted" | "needs_review" | "reviewed";
    }[];
    /**
     * For interrogation-style instructions (e.g. 'why Elastic Beanstalk?'), the agent's natural-language answer. Empty string when not applicable.
     */
    answer?: string;
    /**
     * OPTIONAL 2-3 short, contextual follow-up QUESTIONS the consultant might click next, phrased from the consultant's point of view (e.g. 'How does P4de compare to P5 on cost?'). Shown as clickable chips under the latest reply. Omit or empty when not applicable.
     */
    followups?: string[];
  };
  /**
   * Ordered activity-timeline entries describing what the agent did during this run.
   */
  activity: {
    /**
     * ISO 8601 timestamp.
     */
    ts: string;
    /**
     * A short, free-form label for what the agent actually did in this step — emergent, not a fixed enum. Prefer the real tool or action (e.g. "Read inventory.txt", "Consult tco-calculator", "Extract requirements").
     */
    label: string;
    /**
     * Human-readable description of the step.
     */
    message: string;
  }[];
}
export interface Citation {
  /**
   * Source name, e.g. Current-State-Architecture.pdf or Questionnaire.
   */
  source: string;
  /**
   * Where in the source, e.g. p.4 or Q2. Empty string if whole-document.
   */
  locator: string;
}
/**
 * One dimension of the GPU confidence matrix: a rating plus an optional note explaining what would raise it (e.g. 'Benchmark required').
 */
export interface GpuConfidenceDimension {
  /**
   * Confidence for this dimension.
   */
  rating: "high" | "medium" | "low";
  /**
   * OPTIONAL short qualifier, e.g. 'Benchmark required' or 'Validation required'. Empty string if none.
   */
  note?: string;
}
/**
 * A grounded pricing tier for a GPU instance (e.g. On-Demand or a Savings Plan term). Figures come from the aws-pricing MCP; never fabricate.
 */
export interface GpuPricingTier {
  /**
   * Tier label, e.g. 'On-Demand', '1yr No Upfront', '3yr All Upfront'.
   */
  label: string;
  /**
   * Monthly cost as a number, in the given currency.
   */
  monthly: number;
  /**
   * OPTIONAL hourly rate as a number.
   */
  hourly?: number;
  /**
   * ISO currency code, e.g. USD. Defaults to USD if omitted.
   */
  currency?: string;
}
