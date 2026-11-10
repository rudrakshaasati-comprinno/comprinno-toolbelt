import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Render an assistant reply as markdown (bold, lists, headings, code, links,
 * and GitHub-Flavored Markdown: tables, strikethrough, task lists, autolinks).
 * Safe by default (react-markdown builds React elements, no raw HTML). */
export function Markdown({ children }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{children || ""}</ReactMarkdown></div>;
}

/** A single shimmering placeholder bar. w/h accept any CSS size. */
export function Skeleton({ w = "100%", h = 14, r = 6, style }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

/** A skeleton card block: a few lines of shimmer inside a card. */
export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="card">
      <Skeleton w="40%" h={16} style={{ marginBottom: 12 }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? "70%" : "100%"} style={{ marginBottom: 8 }} />
      ))}
    </div>
  );
}

/** Source citations line, e.g. "arch.pdf · p.4  |  Questionnaire · Q2".
 * URLs in a source/locator are rendered as clickable links. */
export function Citations({ items }) {
  if (!items?.length) return null;
  return (
    <div className="cite">
      {items.map((c, i) => {
        const label = `${c.source || ""}${c.locator ? ` · ${c.locator}` : ""}`;
        return (
          <span key={i}>
            {i > 0 && "  |  "}
            {linkify(label)}
          </span>
        );
      })}
    </div>
  );
}

/** Split a string on URLs and render the URL parts as links. */
function linkify(str) {
  const parts = String(str).split(/(https?:\/\/[^\s)]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="src-link">{p}</a>
      : <span key={i}>{p}</span>
  );
}

// Plain-language explanations shown as a hover tooltip on a recommendation
// badge, so the consultant understands what each label means.
const BADGE_TOOLTIPS = {
  // confidence
  high: "High confidence — the evidence clearly supports this mapping; auto-applied.",
  medium: "Medium confidence — reasonable, but an open input or assumption remains.",
  low: "Low confidence — significant unknowns; treat as a candidate, not a decision.",
  // status
  applied: "Applied — a high-confidence mapping included in the plan.",
  on_hold: "On hold — blocked on missing information or an open decision.",
  override: "Override — a human changed this from the analyst's original mapping.",
  // 7R strategy
  rehost: "Rehost — lift-and-shift to AWS with minimal change.",
  replatform: "Replatform — move with small optimizations (e.g. managed service).",
  repurchase: "Repurchase — switch to a different/managed product.",
  refactor: "Refactor — re-architect the workload for AWS.",
  retire: "Retire — decommission; no longer needed.",
  retain: "Retain — keep as-is / a constraint to honor.",
  relocate: "Relocate — move without changing the stack (e.g. region/hypervisor).",
};

/** A recommendation badge that explains itself on hover. `kind` is the raw
 * value (e.g. "on_hold", "high", "replatform"); the label is prettified. */
export function Badge({ kind, extraClass = "" }) {
  if (!kind) return null;
  const k = String(kind);
  const tip = BADGE_TOOLTIPS[k] || "";
  return (
    <span className={"badge " + k + (extraClass ? " " + extraClass : "")}
      data-tooltip={tip || undefined}>
      {k.replace(/_/g, " ")}
    </span>
  );
}
