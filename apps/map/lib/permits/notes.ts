// The layer notes for the three permit layers: what loaded, from where, what
// was capped, what failed, and which cities in view have no usable feed and
// why. Pure, so the wording for each coverage state is tested.

import type { CoverageState } from "./features";

export interface CoverageLike {
  id: string;
  name: string;
  state: CoverageState;
  count: number | null;
  reason?: string;
}

const STATE: Record<CoverageState, string> = {
  covered: "",
  partial: "capped",
  stale: "stale",
  "no-feed": "no permit records published",
  "token-required": "service asks for a token",
  "not-wired": "not wired",
  error: "did not answer",
};

/** "Chicago capped (the newest 500 of more) · Dallas stale (…)". Covered sources are named in the lead. */
export function coverageTail(coverage: CoverageLike[]): string[] {
  const out: string[] = [];
  for (const c of coverage) {
    if (c.state === "covered") continue;
    out.push(`${c.name} ${STATE[c.state]}${c.reason ? ` (${c.reason})` : ""}`);
  }
  return out;
}

export function coverageNote(lead: string, coverage: CoverageLike[]): string {
  const answered = coverage.filter((c) => c.state === "covered" || c.state === "partial");
  const parts = [lead];
  if (answered.length) parts.push(`from ${answered.map((c) => (c.count == null ? c.name : `${c.name} ${c.count.toLocaleString("en-US")}`)).join(", ")}`);
  parts.push(...coverageTail(coverage));
  return parts.join(" · ");
}
