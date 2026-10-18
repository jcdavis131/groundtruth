// Compare two places: which constructs A and B share and where they part.
//
// Two points share a construct when both stacks hold the same unit (same id,
// "<kind>:<code>"). Where both stacks hold a unit of the same kind but not the
// same one, the places differ on that construct: same county, different
// congressional district, same HUC-8, different HUC-12. A kind only one stack
// has (a flood zone mapped at A, none published at B) is reported as such,
// never as a difference. Pure: the rail, the share link, the API route and the
// tests use the same rules.

import { KINDS } from "./catalog";
import { orderStrata } from "./strata";
import type { ConstructKind, ConstructNode, Fabric } from "./types";

export type CompareStatus = "shared" | "differs" | "only-a" | "only-b";

export interface CompareRow {
  kind: ConstructKind;
  status: CompareStatus;
  a: ConstructNode | null;
  b: ConstructNode | null;
}

export interface Comparison {
  rows: CompareRow[];
  shared: number;
  differs: number;
  /** The smallest construct both places are inside, when there is one. */
  meet: ConstructNode | null;
}

/**
 * Row per kind, ordered as A's stack (smallest first), with B-only kinds
 * placed by their size. A kind with several units at one point (two tribal
 * lands) is matched unit by unit: any shared unit makes the kind shared.
 */
export function compareFabrics(a: Pick<Fabric, "nodes">, b: Pick<Fabric, "nodes">): Comparison {
  const byKind = (nodes: ConstructNode[]) => {
    const m = new Map<ConstructKind, ConstructNode[]>();
    for (const n of nodes) m.set(n.kind, [...(m.get(n.kind) ?? []), n]);
    return m;
  };
  const A = byKind(a.nodes);
  const B = byKind(b.nodes);
  const bIds = new Set(b.nodes.map((n) => n.id));
  // Order every kind by where its A unit (else its B unit) sits in a merged stack.
  const order = orderStrata([...a.nodes, ...b.nodes.filter((n) => !A.has(n.kind))]);
  const seen = new Set<ConstructKind>();
  const rows: CompareRow[] = [];
  for (const n of order) {
    if (seen.has(n.kind)) continue;
    seen.add(n.kind);
    const as = A.get(n.kind) ?? [];
    const bs = B.get(n.kind) ?? [];
    const common = as.find((x) => bIds.has(x.id));
    if (common) rows.push({ kind: n.kind, status: "shared", a: common, b: bs.find((x) => x.id === common.id) ?? common });
    else if (as.length && bs.length) rows.push({ kind: n.kind, status: "differs", a: as[0], b: bs[0] });
    else if (as.length) rows.push({ kind: n.kind, status: "only-a", a: as[0], b: null });
    else rows.push({ kind: n.kind, status: "only-b", a: null, b: bs[0] });
  }
  const shared = rows.filter((r) => r.status === "shared").length;
  const differs = rows.filter((r) => r.status === "differs").length;
  const meet = rows.find((r) => r.status === "shared")?.a ?? null;
  return { rows, shared, differs, meet };
}

/** Kinds people navigate by, in the order a one-line summary names them. */
const SUMMARY_KINDS: ConstructKind[] = ["place", "county", "cd", "sldu", "school", "huc12", "huc8", "cbsa", "state", "country"];

const SUMMARY_WORD: Partial<Record<ConstructKind, string>> = {
  place: "city",
  county: "county",
  cd: "congressional district",
  sldu: "state senate district",
  school: "school district",
  huc12: "HUC-12",
  huc8: "HUC-8",
  cbsa: "metro",
  state: "state",
  country: "country",
};

/**
 * One line a person reads at a glance: "same county, different congressional
 * district, same HUC-8". At most `max` clauses, taken from the kinds people
 * navigate by, differences first so the surprising part leads.
 */
export function compareSummary(c: Comparison, max = 4): string {
  const pick = SUMMARY_KINDS.map((k) => c.rows.find((r) => r.kind === k)).filter((r): r is CompareRow => !!r && (r.status === "shared" || r.status === "differs"));
  const differs = pick.filter((r) => r.status === "differs");
  const shared = pick.filter((r) => r.status === "shared");
  // Once a larger unit differs, every larger shared one is the informative contrast; keep the order of the stack.
  const chosen = [...differs.slice(0, Math.ceil(max / 2)), ...shared].slice(0, max);
  chosen.sort((x, y) => SUMMARY_KINDS.indexOf(x.kind) - SUMMARY_KINDS.indexOf(y.kind));
  if (!chosen.length) return c.rows.length ? "No construct in common among the ones people navigate by." : "";
  return chosen.map((r) => `${r.status === "shared" ? "same" : "different"} ${SUMMARY_WORD[r.kind] ?? KINDS[r.kind].label.toLowerCase()}`).join(", ");
}
