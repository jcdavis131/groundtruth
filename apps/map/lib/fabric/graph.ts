// Order the constructs at a point into a stack and link them.
//
// The stack runs from the smallest unit to the largest, by the area the
// upstream publishes, so it reads like nested shells: flood zone, tract,
// subwatershed, city, county ... state, water region, country. Edges are
// added only where the unit system itself defines the relation (a tract is in
// its county by GEOID, a HUC-12 is in its HUC-10 by code, a county is in its
// metro by the OMB delineation) or where an agency publishes the assignment
// (NWS zone to office, state to federal region). Everything else in the stack
// shares the point and nothing more is claimed about it.

import { countyByFips } from "@/lib/places/registry";
import { KINDS } from "./catalog";
import type { ConstructEdge, ConstructKind, ConstructNode, Fabric } from "./types";
import type { SourceId } from "@/lib/provenance/sources";

export interface FabricParts {
  lon: number;
  lat: number;
  elevationM?: number;
  nodes: ConstructNode[];
  edges: ConstructEdge[];
  answered: SourceId[];
  failed: { source: SourceId; error: string }[];
}

const KIND_ORDER = Object.keys(KINDS) as ConstructKind[];

/** Size used to place a node in the stack: its published area, else the kind's ordering hint. */
export function stackSize(n: ConstructNode): number {
  return n.areaKm2 ?? KINDS[n.kind].orderKm2;
}

export function sortStack(nodes: ConstructNode[]): ConstructNode[] {
  return [...nodes].sort((a, b) => stackSize(a) - stackSize(b) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
}

const HUC_CHAIN: ConstructKind[] = ["huc12", "huc10", "huc8", "huc6", "huc4", "huc2"];
const STATE_SCOPED: ConstructKind[] = ["county", "place", "cdp", "school", "cd", "sldu", "sldl"];

/** Definition-based containment among the nodes present. */
export function nestingEdges(nodes: ConstructNode[]): ConstructEdge[] {
  const out: ConstructEdge[] = [];
  const byKind = new Map<ConstructKind, ConstructNode[]>();
  for (const n of nodes) byKind.set(n.kind, [...(byKind.get(n.kind) ?? []), n]);
  const one = (k: ConstructKind) => byKind.get(k)?.[0];
  const add = (from: ConstructNode | undefined, to: ConstructNode | undefined, basis: string) => {
    if (from && to && from.id !== to.id) out.push({ from: from.id, to: to.id, relation: "nests-in", basis });
  };

  const state = one("state");
  const county = one("county");
  for (const t of byKind.get("tract") ?? []) if (county && t.code?.startsWith(county.code ?? "\u0000")) add(t, county, "Census GEOID: tract within county");
  for (const k of STATE_SCOPED)
    for (const n of byKind.get(k) ?? []) if (state && n.code?.startsWith(state.code ?? "\u0000")) add(n, state, "Census GEOID: state prefix");

  if (county?.code) {
    const ref = countyByFips(county.code);
    for (const m of byKind.get("cbsa") ?? []) if (ref?.cbsa && ref.cbsa === m.code) add(county, m, "OMB delineation: county in CBSA");
  }

  // Divisions are unions of whole states and regions unions of divisions, so
  // if the point is in both, the smaller is inside the larger.
  add(state, one("census-division"), "Census: divisions are groups of states");
  add(one("census-division"), one("census-region"), "Census: regions are groups of divisions");

  for (let i = 0; i < HUC_CHAIN.length - 1; i++) {
    const a = one(HUC_CHAIN[i]);
    const b = one(HUC_CHAIN[i + 1]);
    if (a?.code && b?.code && a.code.startsWith(b.code)) add(a, b, "WBD: hydrologic unit codes nest by prefix");
  }

  const e4 = one("eco4");
  const e3 = one("eco3");
  if (e4?.code && e3?.code && e4.code.replace(/[a-z]+$/i, "") === e3.code) add(e4, e3, "EPA: level IV ecoregions subdivide level III");

  const country = one("country");
  if (country?.code === "USA") add(state, country, "US state");
  add(country, one("continent"), "Natural Earth continent attribute");
  return out;
}

export function assembleFabric(parts: FabricParts): Fabric {
  // A unit reported twice (two identify calls overlapping) keeps its first answer.
  const seen = new Map<string, ConstructNode>();
  for (const n of parts.nodes) if (!seen.has(n.id)) seen.set(n.id, n);
  const nodes = sortStack([...seen.values()]);
  const ids = new Set(nodes.map((n) => n.id));
  const edges: ConstructEdge[] = [];
  const edgeKeys = new Set<string>();
  for (const e of [...nestingEdges(nodes), ...parts.edges]) {
    if (!ids.has(e.from)) continue;
    if (!e.external && !ids.has(e.to)) continue;
    const k = `${e.from}|${e.relation}|${e.to}`;
    if (edgeKeys.has(k)) continue;
    edgeKeys.add(k);
    edges.push(e);
  }
  const us = nodes.some((n) => n.source === "census-tigerweb");
  const coverage = us
    ? "United States: Census, USGS, EPA, FEMA and NWS constructs, plus the country."
    : nodes.length
      ? "Outside the United States only the country is known here; the Census, USGS, EPA, FEMA and NWS constructs need a point inside the US."
      : "Open ocean or outside every published boundary this layer reads.";
  return {
    point: { lon: parts.lon, lat: parts.lat, ...(parts.elevationM != null ? { elevationM: parts.elevationM } : {}) },
    nodes,
    edges,
    answered: [...new Set(parts.answered)],
    failed: parts.failed,
    coverage,
  };
}

/** One CSV row per construct, for format=csv. */
export function fabricRows(f: Fabric): Record<string, string | number | null>[] {
  return f.nodes.map((n, i) => ({
    tier: i,
    id: n.id,
    kind: n.kind,
    kind_label: KINDS[n.kind].label,
    domain: n.domain,
    name: n.name,
    code: n.code ?? null,
    area_km2: n.areaKm2 ?? null,
    area_basis: n.areaBasis ?? null,
    source: n.source,
    parents: f.edges.filter((e) => e.from === n.id && e.relation === "nests-in").map((e) => e.to).join(" ") || null,
  }));
}

export const FABRIC_COLUMNS = ["tier", "id", "kind", "kind_label", "domain", "name", "code", "area_km2", "area_basis", "source", "parents"] as const;
