// Strata: the constructs stack as an ordered list, and the pure rules the
// rail, the globe and the Ascend flight share.
//
// The globe used to draw every construct at once (outline, tether, label),
// which from straight overhead collapsed into a starburst. The stack now lives
// in the HUD as a list ordered smallest to largest; the globe draws only the
// focused construct's outline, on the ground, with its immediate parent and
// child ghosted. Everything here is pure so the tests pin it down.

import type { LayerFeature, LayerId } from "@/lib/layers/types";
import { KINDS } from "./catalog";
import { ringsBbox, type BBox } from "./geo";
import { countOf } from "./join";
import type { ConstructKind, ConstructNode, Fabric } from "./types";

const KIND_ORDER = Object.keys(KINDS) as ConstructKind[];

/**
 * The stack smallest first (flood zone, tract, HUC-12 … state, country): by
 * published area, else the kind's ordering hint; the same rule the server's
 * sortStack (lib/fabric/graph.ts) uses, kept here so the browser does not pull
 * the bundled place tables in with it.
 */
export function orderStrata(nodes: ConstructNode[]): ConstructNode[] {
  const size = (n: ConstructNode) => n.areaKm2 ?? KINDS[n.kind].orderKm2;
  return [...nodes].sort((a, b) => size(a) - size(b) || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.id.localeCompare(b.id));
}

/** Short, uppercase-ready kind names for the rail's kind column: at most 11 characters, so the column never truncates. */
export const SHORT_KIND: Record<ConstructKind, string> = {
  flood: "Flood zone",
  tract: "Tract",
  zcta: "ZIP area",
  huc12: "HUC-12",
  place: "City",
  cdp: "CDP",
  sldl: "State house",
  "flood-community": "NFIP",
  "nws-alert": "Warning",
  school: "School dist",
  huc10: "HUC-10",
  urban: "Urban area",
  tribal: "Tribal land",
  sldu: "St. senate",
  county: "County",
  "nws-zone": "NWS zone",
  huc8: "HUC-8",
  eco4: "Eco IV",
  cbsa: "Metro",
  cd: "Congress",
  csa: "CSA",
  huc6: "HUC-6",
  "nws-office": "NWS office",
  eco3: "Eco III",
  huc4: "HUC-4",
  state: "State",
  huc2: "HUC-2",
  "census-division": "Division",
  "epa-region": "EPA region",
  "fema-region": "FEMA region",
  "fed-district": "Fed Reserve",
  "census-region": "Region",
  timezone: "Time zone",
  country: "Country",
  continent: "Continent",
};

/** The kind as a caption word: the catalogue label without its parenthetical ("Subbasin (HUC-8)" → "Subbasin"). */
export function captionKind(kind: ConstructKind): string {
  return KINDS[kind].label.replace(/\s*\(.*\)\s*$/, "");
}

/** Area as the rail prints it: "0.42", "86.1", "1,234", "12.3k", "9.1M" (km², the column carries the unit). */
export function formatArea(km2: number | undefined | null): string {
  if (km2 == null || !Number.isFinite(km2)) return "—";
  if (km2 < 10) return km2.toFixed(2);
  if (km2 < 100) return km2.toFixed(1);
  if (km2 < 10_000) return Math.round(km2).toLocaleString("en-US");
  if (km2 < 1_000_000) return `${(km2 / 1000).toFixed(km2 < 100_000 ? 1 : 0)}k`;
  return `${(km2 / 1_000_000).toFixed(1)}M`;
}

export interface FocusSet {
  focus: ConstructNode;
  /** The unit the focus nests in (by definition), else the next larger stratum of the same point of view. */
  parent: ConstructNode | null;
  /** The unit that nests in the focus, else the next smaller stratum of the same point of view. */
  child: ConstructNode | null;
}

/**
 * What the globe draws for a focused construct: the focus itself, and its
 * immediate parent and child. Nesting edges (GEOID, HUC prefix, OMB
 * delineation) come first; without one, the neighbouring stratum of the same
 * point of view stands in, since that is the next shell a reader looks for.
 */
export function focusSet(fabric: Pick<Fabric, "nodes" | "edges">, focusId: string): FocusSet | null {
  const nodes = orderStrata(fabric.nodes);
  const i = nodes.findIndex((n) => n.id === focusId);
  if (i < 0) return null;
  const focus = nodes[i];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nests = fabric.edges.filter((e) => e.relation === "nests-in" && !e.external);
  // Of several definitional parents, the smallest is the immediate one.
  const parents = nests.filter((e) => e.from === focusId).map((e) => byId.get(e.to)).filter((n): n is ConstructNode => !!n);
  const children = nests.filter((e) => e.to === focusId).map((e) => byId.get(e.from)).filter((n): n is ConstructNode => !!n);
  const rank = (n: ConstructNode) => nodes.indexOf(n);
  let parent: ConstructNode | null = parents.sort((a, b) => rank(a) - rank(b))[0] ?? null;
  let child: ConstructNode | null = children.sort((a, b) => rank(b) - rank(a))[0] ?? null;
  if (!parent) parent = nodes.slice(i + 1).find((n) => n.domain === focus.domain) ?? null;
  if (!child) child = [...nodes.slice(0, i)].reverse().find((n) => n.domain === focus.domain) ?? null;
  return { focus, parent, child };
}

/** Bounding box of a construct: its outline when published, else a square of its area around the point. */
export function constructExtent(node: Pick<ConstructNode, "rings" | "areaKm2" | "kind">, ground: [number, number]): BBox {
  const box = node.rings?.length ? ringsBbox(node.rings) : null;
  if (box) return box;
  const km2 = node.areaKm2 ?? KINDS[node.kind].orderKm2;
  const halfKm = Math.sqrt(Math.max(km2, 0.01)) / 2;
  const dLat = halfKm / 111.32;
  const dLon = halfKm / (111.32 * Math.max(0.05, Math.cos((ground[1] * Math.PI) / 180)));
  return [ground[0] - dLon, Math.max(-89.9, ground[1] - dLat), ground[0] + dLon, Math.min(89.9, ground[1] + dLat)];
}

/** Largest ground span of a box, metres (east-west at its mid-latitude, or north-south). */
export function extentSpanM(b: BBox): number {
  const midLat = ((b[1] + b[3]) / 2) * (Math.PI / 180);
  const ew = (b[2] - b[0]) * 111_320 * Math.cos(midLat);
  const ns = (b[3] - b[1]) * 111_320;
  return Math.max(ew, ns, 200);
}

/**
 * A composed oblique pitch for a construct of this span: low and cinematic
 * for a neighbourhood, steeper as the frame widens, nearly overhead for a
 * continent (an oblique view of a country is mostly horizon).
 */
export function framePitch(spanM: number): number {
  if (spanM < 30_000) return -42;
  if (spanM < 300_000) return -50;
  if (spanM < 1_500_000) return -62;
  return -80;
}

// ---------------------------------------------------------------------------
// What is inside: counts and condition, as the rail and the captions print them.

/** Words for a count of one layer's features ("14 gauges"). Singular, plural. */
const NOUNS: Partial<Record<LayerId, [string, string]>> = {
  aircraft: ["aircraft", "aircraft"],
  ships: ["ship", "ships"],
  satellites: ["satellite", "satellites"],
  earthquakes: ["earthquake", "earthquakes"],
  cameras: ["camera", "cameras"],
  launches: ["launch site", "launch sites"],
  water: ["gauge", "gauges"],
  groundwater: ["well", "wells"],
  turbidity: ["water scene", "water scenes"],
  trade: ["port", "ports"],
  commerce: ["employer area", "employer areas"],
  realestate: ["housing market", "housing markets"],
  companies: ["company", "companies"],
  banks: ["bank office", "bank offices"],
  spending: ["award place", "award places"],
  sports: ["venue", "venues"],
  weather: ["weather station", "weather stations"],
};

export function countPhrase(layer: LayerId, n: number, fallback?: string): string {
  const w = NOUNS[layer];
  const word = w ? (n === 1 ? w[0] : w[1]) : (fallback ?? layer).toLowerCase();
  return `${n.toLocaleString("en-US")} ${word}`;
}

export interface InsideStats {
  /** Loaded physical features inside, by layer (the location join). */
  byLayer: Partial<Record<LayerId, number>>;
  total: number;
  /** Live NWS warnings whose anchor falls inside; null when the warnings layer is off (unknown, not zero). */
  warnings: number | null;
  /** Median flow percentile of the rated gauges inside, and how many gauges were rated; null when none. */
  flowPct: number | null;
  rated: number;
}

export function statsFromJoin(joined: Map<LayerId, LayerFeature[]> | null, warnings: number | null, flow: { median: number | null; rated: number } | null): InsideStats {
  const byLayer: Partial<Record<LayerId, number>> = {};
  let total = 0;
  for (const [layer, list] of joined ?? []) {
    // Surface water carries rivers and lakes as well as gauges; only the
    // instruments are "gauges" in a count. A binned fires cell counts as the
    // detections it stands for.
    const n = layer === "water" ? list.filter((f) => /gauge/.test(f.properties.kind ?? "")).length : countOf(list);
    if (!n) continue;
    byLayer[layer] = n;
    total += n;
  }
  return { byLayer, total, warnings, flowPct: flow?.median ?? null, rated: flow?.rated ?? 0 };
}

/**
 * The caption for one stratum of the Ascend flight, e.g.
 * "SUBBASIN · Aransas · 1,234 km² · 14 gauges · 2 warnings". Only computed
 * values appear: a missing area is left out, not guessed; counts are of what
 * is loaded now and at most the two largest layers are named.
 */
export function strataCaption(node: Pick<ConstructNode, "kind" | "name" | "areaKm2">, stats: InsideStats | null, labels: Partial<Record<LayerId, string>> = {}): string {
  const parts = [captionKind(node.kind).toUpperCase(), node.name];
  if (node.areaKm2 != null && Number.isFinite(node.areaKm2)) parts.push(`${Math.round(node.areaKm2).toLocaleString("en-US")} km²`);
  if (stats) {
    const top = (Object.entries(stats.byLayer) as [LayerId, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2);
    for (const [layer, n] of top) parts.push(countPhrase(layer, n, labels[layer]));
    if (stats.warnings) parts.push(`${stats.warnings} warning${stats.warnings === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Ascend: the flight through the stack, one stratum at a time.

/** Seconds each stratum holds the frame during an Ascend flight (fly + dwell). */
export const ASCEND_FLY_S = 2.6;
export const ASCEND_DWELL_S = 4.4;

/**
 * The strata an Ascend flight visits, smallest to largest. Two strata that
 * cover the same ground at the same size (a city and its census-designated
 * twin) would be the same frame twice; the smaller-ranked one is kept.
 */
export function ascendSteps(nodes: ConstructNode[]): ConstructNode[] {
  const out: ConstructNode[] = [];
  for (const n of orderStrata(nodes)) {
    const prev = out[out.length - 1];
    if (prev && prev.areaKm2 != null && n.areaKm2 != null && prev.name === n.name && Math.abs(prev.areaKm2 - n.areaKm2) / Math.max(1, n.areaKm2) < 0.01) continue;
    out.push(n);
  }
  return out;
}

/**
 * A ring with extra vertices so no segment spans more than `maxStepDeg`.
 * Polylines are straight chords between vertices; a country outline drawn on
 * the ground from 1:110m vertices would sag kilometres below the surface and
 * vanish into the globe. At 0.2° (about 22 km) the sag is under 10 m.
 */
export function densifyRing(ring: number[][], maxStepDeg = 0.2): number[][] {
  if (ring.length < 2) return ring.map((p) => [p[0], p[1]]);
  const out: number[][] = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    const [x0, y0] = ring[i - 1];
    const [x1, y1] = ring[i];
    // A segment across the antimeridian is not interpolated the long way round.
    const n = Math.abs(x1 - x0) > 180 ? 1 : Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / maxStepDeg);
    for (let k = 1; k < n; k++) out.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    out.push([x1, y1]);
  }
  return out;
}
