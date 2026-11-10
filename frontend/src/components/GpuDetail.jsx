import React from "react";

/* GpuDetail — renders the rich GPU-Advisor view for a deep GPU recommendation,
 * from the envelope's recommendations[].gpuDetail (persisted as gpu_detail).
 * Mirrors the AWS GPU Migration Advisor experience: a hero instance card with a
 * four-dimension confidence matrix, a ranked candidate-instance comparison
 * table, a Bedrock (managed inference) verdict panel, and a current-vs-AWS cost
 * comparison. Every sub-section is optional and renders only when the agent
 * grounded that data, so a partial gpuDetail degrades gracefully. */

const CUR = (c) => c || "USD";
const money = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** A confidence pill: green (high) / amber (medium) / red (low), with an
 * optional qualifier note like "Benchmark required". */
function ConfPill({ dim }) {
  if (!dim || !dim.rating) return <span className="gpu-conf-pill none">—</span>;
  const label = dim.note ? `${cap(dim.rating)} — ${dim.note}` : cap(dim.rating);
  return <span className={"gpu-conf-pill " + dim.rating}>{label}</span>;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The recommended-instance hero + the 4-dimension confidence matrix. */
function Hero({ instance, summary, matrix }) {
  if (!instance && !matrix) return null;
  const specLine = instance
    ? [instance.gpu, instance.gpuMem, instance.region].filter(Boolean).join(" · ")
    : "";
  const dims = matrix
    ? [
        ["Hardware match", matrix.hardware],
        ["Cost comparison", matrix.cost],
        ["Performance", matrix.performance],
        ["Migration", matrix.migration],
      ].filter(([, d]) => d && d.rating)
    : [];
  return (
    <div className="gpu-hero">
      <div className="gpu-hero-main">
        <div className="gpu-hero-label">Recommended AWS instance</div>
        {instance && <div className="gpu-hero-name">{instance.name}</div>}
        {specLine && <div className="gpu-hero-spec">{specLine}</div>}
      </div>
      {dims.length > 0 && (
        <div className="gpu-conf">
          <div className="gpu-conf-title">Confidence</div>
          <div className="gpu-conf-grid">
            {dims.map(([label, d]) => (
              <div key={label} className="gpu-conf-row">
                <span className="gpu-conf-dim">{label}</span>
                <ConfPill dim={d} />
              </div>
            ))}
          </div>
        </div>
      )}
      {summary && <div className="gpu-hero-summary">{summary}</div>}
    </div>
  );
}

/** Ranked candidate-instance comparison table (specs / fit / availability /
 * pricing). */
function Candidates({ candidates }) {
  const rows = (candidates || []).filter((c) => c && c.name);
  if (!rows.length) return null;
  return (
    <div className="gpu-block">
      <div className="gpu-block-head">
        <span className="gpu-block-title">Recommended AWS GPU instances</span>
        <span className="gpu-block-note">ranked by fit &amp; cost</span>
      </div>
      <div className="gpu-table-wrap">
        <table className="gpu-table">
          <thead>
            <tr>
              <th>Instance</th>
              <th>GPU</th>
              <th>GPU mem</th>
              <th>vCPU</th>
              <th>RAM</th>
              <th>Fit</th>
              <th>Region / availability</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => {
              const od = (c.pricing || []).find((p) => /on.?demand/i.test(p.label)) || (c.pricing || [])[0];
              return (
                <tr key={i}>
                  <td>
                    <div className="gpu-inst">{c.name}</div>
                    {c.tag && <span className="gpu-tag">{c.tag}</span>}
                  </td>
                  <td>{c.gpu || "—"}</td>
                  <td>{c.gpuMem || "—"}</td>
                  <td>{c.vcpu || "—"}</td>
                  <td>{c.ram || "—"}</td>
                  <td className="gpu-fit">{c.fit || "—"}</td>
                  <td>
                    <div>{c.region || "—"}</div>
                    {c.availability && <div className="gpu-avail">{c.availability}</div>}
                  </td>
                  <td className="gpu-price">
                    {od ? (
                      <>
                        <div className="gpu-price-mo">{CUR(od.currency)} {money(od.monthly)}<span>/mo</span></div>
                        {od.hourly != null && <div className="gpu-price-hr">{CUR(od.currency)} {money(od.hourly)}/hr</div>}
                        <div className="gpu-price-lbl">{od.label}</div>
                      </>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Amazon Bedrock (managed inference) verdict panel. */
function Bedrock({ bedrock }) {
  if (!bedrock || !bedrock.status) return null;
  const cls = bedrock.status === "applicable" ? "ok" : bedrock.status === "partial" ? "warn" : "no";
  const label = bedrock.status === "applicable" ? "Applicable"
    : bedrock.status === "partial" ? "Partially applicable" : "Not applicable";
  return (
    <div className="gpu-block">
      <div className="gpu-block-head">
        <span className="gpu-block-title">Amazon Bedrock (managed inference)</span>
        <span className={"gpu-bedrock-pill " + cls}>{label}</span>
      </div>
      {bedrock.reason && <div className="gpu-bedrock-reason">{bedrock.reason}</div>}
    </div>
  );
}

/** Current source-cloud vs AWS options, with the savings and provenance. */
function CostComparison({ cost }) {
  if (!cost) return null;
  const src = cost.sourceCloud;
  const opts = (cost.options || []).filter((o) => o && o.label && o.monthly != null);
  if (!src && !opts.length) return null;
  // Scale bars against the largest monthly figure across source + options.
  const all = [...(src ? [src.monthly] : []), ...opts.map((o) => o.monthly)];
  const max = Math.max(...all, 1);
  const cur = CUR((opts[0] || src || {}).currency);
  const best = opts.reduce((m, o) => (m == null || o.monthly < m.monthly ? o : m), null);
  return (
    <div className="gpu-block">
      <div className="gpu-block-head">
        <span className="gpu-block-title">Cost comparison — current vs AWS</span>
        {cost.savingsPct != null && (
          <span className={"gpu-savings " + (cost.savingsPct >= 0 ? "save" : "more")}>
            {cost.savingsPct >= 0 ? "Save " : "+"}{Math.abs(cost.savingsPct)}%
          </span>
        )}
      </div>
      <div className="gpu-bars">
        {opts.map((o, i) => (
          <div key={i} className="gpu-bar-row">
            <div className="gpu-bar-label">
              {o.label}
              {o.lowest && <span className="gpu-bar-lowest">lowest</span>}
            </div>
            <div className="gpu-bar-track">
              <div className={"gpu-bar-fill" + (o.lowest ? " lowest" : "")} style={{ width: `${(o.monthly / max) * 100}%` }} />
            </div>
            <div className="gpu-bar-val">{CUR(o.currency)} {money(o.monthly)}<span>/mo</span></div>
          </div>
        ))}
        {src && (
          <div className="gpu-bar-row">
            <div className="gpu-bar-label">{src.name} <span className="gpu-bar-cur">current</span></div>
            <div className="gpu-bar-track">
              <div className="gpu-bar-fill current" style={{ width: `${(src.monthly / max) * 100}%` }} />
            </div>
            <div className="gpu-bar-val">{CUR(src.currency)} {money(src.monthly)}<span>/mo</span></div>
          </div>
        )}
      </div>
      {(src || best) && (
        <div className="gpu-cost-callout">
          {src && <span>Current: <b>{CUR(src.currency)} {money(src.monthly)}/mo</b></span>}
          {best && <span>Best AWS: <b>{CUR(best.currency)} {money(best.monthly)}/mo</b> — {best.label}</span>}
        </div>
      )}
      {cost.provenance && <div className="gpu-provenance">{cost.provenance}</div>}
      <div className="gpu-disclaimer">
        AWS pricing is retrieved from AWS pricing/MCP sources; any source-cloud cost is public list pricing and may differ from your billed cost. Estimates, not a quote.
      </div>
    </div>
  );
}

/** The full GPU detail block for one deep recommendation. Renders nothing if
 * no gpuDetail was grounded. */
export function GpuDetail({ detail }) {
  if (!detail || typeof detail !== "object") return null;
  const hasAny =
    detail.instance || detail.confidenceMatrix || (detail.candidates || []).length ||
    detail.bedrock || detail.costComparison || detail.summary;
  if (!hasAny) return null;
  return (
    <div className="gpu-detail">
      <Hero instance={detail.instance} summary={detail.summary} matrix={detail.confidenceMatrix} />
      <Candidates candidates={detail.candidates} />
      <Bedrock bedrock={detail.bedrock} />
      <CostComparison cost={detail.costComparison} />
    </div>
  );
}
