import React from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  PieChart, Pie, Legend,
} from "recharts";

/* Charts.jsx — inline charts for the recommendations chatbot.
 *
 * Structural charts (strategy / confidence / status) are derived entirely from
 * the recommendation fields the backend already returns. The cost chart uses
 * the OPTIONAL estimated_cost the agent emits only when grounded — so it renders
 * only for recs that carry a real figure, and is clearly labelled an ESTIMATE.
 */

const NAVY = "#24437a";
const GREEN = "#2c7a56";
const AMBER = "#a35a1a";
const MUTED = "#8a866f";
const PALETTE = ["#24437a", "#2c7a56", "#a35a1a", "#6b7fb0", "#7cae9a", "#c99b6a", "#4a4636"];

function countBy(recs, key, norm = (v) => v) {
  const m = new Map();
  for (const r of recs) {
    const k = norm(r[key]) || "unknown";
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([name, value]) => ({ name, value }));
}

/** Small labelled wrapper so charts read clearly inside a chat bubble. */
function ChartCard({ title, note, height = 200, children }) {
  return (
    <div className="chart-card">
      <div className="chart-title">{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
      {note && <div className="chart-note">{note}</div>}
    </div>
  );
}

/** 7R strategy breakdown (bar). */
export function StrategyChart({ recs }) {
  const data = countBy(recs, "strategy");
  if (!data.length) return null;
  return (
    <ChartCard title="Migration strategy (7R) breakdown">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: -16 }}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip cursor={{ fill: "rgba(36,67,122,.06)" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}

/** Confidence distribution (pie). */
export function ConfidenceChart({ recs }) {
  const order = { high: 0, medium: 1, low: 2 };
  const color = { high: GREEN, medium: NAVY, low: AMBER };
  const data = countBy(recs, "confidence").sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9));
  if (!data.length) return null;
  return (
    <ChartCard title="Confidence distribution">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" outerRadius={70} label={(d) => `${d.name} (${d.value})`}>
          {data.map((d, i) => <Cell key={i} fill={color[d.name] || PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Legend />
      </PieChart>
    </ChartCard>
  );
}

/** Applied vs on_hold status (bar). */
export function StatusChart({ recs }) {
  const color = { applied: GREEN, on_hold: AMBER, override: NAVY };
  const data = countBy(recs, "status").map((d) => ({ ...d, label: d.name.replace("_", " ") }));
  if (!data.length) return null;
  return (
    <ChartCard title="Status (applied vs on hold)">
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 24 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 11 }} width={70} />
        <Tooltip cursor={{ fill: "rgba(36,67,122,.06)" }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {data.map((d, i) => <Cell key={i} fill={color[d.name] || MUTED} />)}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}

/** Read a rec's grounded cost, if any. Normalizes db (snake) vs envelope (camel).
 * `period` distinguishes recurring monthly spend from a per-run (e.g. training)
 * figure; when absent we infer per-run from the basis text so we never mix them. */
function costOf(r) {
  const c = r.estimated_cost || r.estimatedMonthlyCost;
  if (!c || typeof c.amount !== "number") return null;
  const basis = c.basis || "";
  const period =
    c.period ||
    (/per\s*run|per-run|\/run|per representative|per\s*\d+\s*-?\s*day/i.test(basis) ? "per_run" : "monthly");
  return {
    name: (r.aws_service || r.awsService || "").split(/[\s(]/)[0].slice(0, 18) || "rec",
    amount: c.amount,
    currency: c.currency || "USD",
    basis,
    confidence: c.confidence || "",
    period,
  };
}

/** Cost comparison (bar) — MONTHLY recurring only, so figures are comparable.
 * Per-run costs (training) are surfaced as a note, never mixed into the bars. */
export function CostChart({ recs }) {
  const all = recs.map(costOf).filter(Boolean);
  const monthly = all.filter((c) => c.period === "monthly");
  const perRun = all.filter((c) => c.period === "per_run");
  if (!monthly.length && !perRun.length) return null;
  const cur = (monthly[0] || perRun[0]).currency;
  const perRunNote = perRun.length
    ? "Per-run (not monthly), shown separately: " +
      perRun.map((c) => `${c.name} ~${cur} ${Number(c.amount).toLocaleString()}/run`).join("; ") + "."
    : "";
  // If only per-run figures exist, there's nothing comparable to bar-chart.
  if (!monthly.length) {
    return (
      <ChartCard title={`Estimated cost (${cur})`} note={perRunNote + " Estimates only, not a quote."} height={70}>
        <BarChart data={[]}><XAxis hide /><YAxis hide /></BarChart>
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title={`Estimated monthly recurring cost (${cur})`}
      note={("Monthly recurring only, so the bars are comparable. " + perRunNote +
        " Estimates the analyst retrieved, not a quote.").trim()}
      height={Math.max(180, monthly.length * 34)}
    >
      <BarChart data={monthly} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 40 }}>
        <XAxis type="number" tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
        <Tooltip
          formatter={(v, _n, p) => [`${cur} ${Number(v).toLocaleString()}/mo`, p?.payload?.basis || "estimate"]}
          cursor={{ fill: "rgba(36,67,122,.06)" }}
        />
        <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
          {monthly.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Bar>
      </BarChart>
    </ChartCard>
  );
}

/** Does any rec carry a grounded cost estimate? (drives whether to offer the cost chart) */
export function hasCostData(recs) {
  return (recs || []).some((r) => costOf(r) != null);
}
export { costOf };

/** Pick charts by intent keyword (used when the user asks for a specific view). */
export function ChartsForIntent({ recs, intent }) {
  const t = (intent || "").toLowerCase();
  const out = [];
  if (/cost|price|spend|\$|budget|compare/.test(t) && hasCostData(recs)) out.push(<CostChart key="cost" recs={recs} />);
  if (/strateg|7r|rehost|replatform|refactor/.test(t)) out.push(<StrategyChart key="strat" recs={recs} />);
  if (/confidence|certain/.test(t)) out.push(<ConfidenceChart key="conf" recs={recs} />);
  if (/status|applied|on.?hold|hold/.test(t)) out.push(<StatusChart key="status" recs={recs} />);
  // A generic "chart/graph/visual/overview" ask -> the summary set.
  if (!out.length && /chart|graph|visual|overview|breakdown|summar/.test(t)) {
    out.push(<StrategyChart key="strat" recs={recs} />, <StatusChart key="status" recs={recs} />);
    if (hasCostData(recs)) out.push(<CostChart key="cost" recs={recs} />);
  }
  return out.length ? <div className="charts">{out}</div> : null;
}

/** The default summary shown with the opening recs presentation. The
 * structural breakdowns (7R strategy / status / confidence) were dropped as
 * low-value — the recs-summary strip already shows those counts. Only the
 * grounded cost comparison remains, and only when a real figure exists. */
export function SummaryCharts({ recs }) {
  if (!hasCostData(recs)) return null;
  return (
    <div className="charts">
      <CostChart recs={recs} />
    </div>
  );
}
