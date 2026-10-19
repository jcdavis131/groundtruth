// Emergence: the constructs world takes its state from the physical one.
//
// A construct has no sensors of its own. What it "knows" is what the physical
// layers put inside it: the gauges in a watershed, the aircraft over a
// district right now, the companies and bank offices in a county, the
// earthquakes in an ecoregion today. This module turns the loaded physical
// features into vitals per construct: counts by layer, density per 1,000 km²,
// and a heat in 0..1 relative to the other constructs in view. The field
// layer is drawn from those vitals, so it changes as the physical twin does.
//
// Rules kept: simulated features (the traffic layer) are never counted; only
// features with a point position are placed (polygon layers are constructs of
// their own, not things inside one); counts are of what is loaded in the
// browser now, and every place that shows them says so. A binned fires cell
// counts as the detections it stands for (join.ts standsFor), not as one.
// Missing means missing: a unit the counted layers did not fully load (it
// runs past a near-only layer's dashed loaded box, or the source hit its
// record limit), or one with no known area under density, gets no value and
// a reason, never a 0 that would read as "nothing here".

import type { LayerFeature, LayerId, LoadedBoxExtra } from "@/lib/layers/types";
import { departure, flowClass, FLOW_CLASSES, median, ordinal, type FlowClass } from "./condition";
import { bboxContains, ringsBbox, ringsContain, type BBox } from "./geo";
import { standsFor } from "./join";
import type { ConstructNode } from "./types";

/**
 * What a construct's heat is measured by: how many physical signals are
 * inside it (every layer, or one), or the condition of what is inside it
 * ("streamflow": its gauges' flow against the day's published percentiles).
 */
export type Measure = "all" | "streamflow" | LayerId;
export type Normalise = "count" | "density";

/** One physical feature's condition, when it has one. */
export interface FeatureCondition {
  /** Percentile of the latest flow among the day's daily-mean percentiles; null when there is no table. */
  pct: number | null;
  /** An NWS forecast point at or above minor flood. */
  flooding: boolean;
}

export interface UnitCondition {
  /** Median percentile of the rated gauges inside; null when none are rated. */
  median: number | null;
  /** Gauges with a flow reading inside. */
  gauges: number;
  /** Of those, how many have a percentile table for the day. */
  rated: number;
  flooding: number;
  classes: Partial<Record<FlowClass, number>>;
}

/**
 * Whether the counted layers loaded all of a unit: "complete", "partial" (part
 * of it lies outside a layer's loaded box, the source hit its record limit, or
 * density has no area to divide by) or "none" (it lies wholly outside every
 * counted layer's loaded box).
 */
export type Coverage = "complete" | "partial" | "none";

export interface Vitals {
  /** Physical signals loaded inside: a floor, not a total, unless coverage is complete. */
  total: number;
  byLayer: Partial<Record<LayerId, number>>;
  /** Features per 1,000 km² of the construct's area; null when no area is known. */
  density: number | null;
  /** The value the heat is taken from (count or density of the chosen measure); null when it is not known (see reason). */
  value: number | null;
  /** value relative to the largest complete value in view, 0..1, square-root scaled so small counts still show; 0 when value is null. */
  heat: number;
  coverage: Coverage;
  /** Why value is null, in words: "schools not loaded here: outside the loaded box". */
  reason?: string;
  /** 0 = the largest value in view; units with no value rank last. */
  rank: number;
  /** Short text for the unit's label. */
  display: string;
  /** Set when the colour says something the heat ramp cannot (flow class). */
  color?: string;
  /** Present when the measure is a condition. */
  condition?: UnitCondition;
}

/**
 * Layers whose points are not things on the ground: the constructs themselves
 * (the stack, the field, live warnings), disaster alerts placed at an
 * event's reported point (GDACS, EONET), metro-level statistics drawn at a
 * centroid, and a sampling grid. Area layers (counties, countries) drop out
 * on their own because only points count. Fire hotspots and wildfire
 * incident points are observations on the ground, like earthquakes, and count.
 */
// Permits, licences and environmental permits are records about a site, not things on the ground.
const NOT_PHYSICAL = new Set<LayerId>(["constructs", "field", "alerts", "hazards", "occupations", "weather", "plss", "events", "permits", "licences", "envpermits", "historic", "crithab", "contaminants", "wayback", "topo", "impaired", "pfas", "ust", "hydro", "riskindex", "naip", "heritage", "health", "vulnerability"]);

export function isPhysical(f: LayerFeature): boolean {
  return !NOT_PHYSICAL.has(f.properties.layer) && !f.properties.simulated && f.geometry?.type === "Point";
}

/**
 * Layers that are not field measures: the not-physical ones above, and area or
 * line layers whose features never count (FieldControls offers the rest as
 * measures). A dashed loaded box bounds a unit's coverage only for a layer
 * that can be counted, so turning on zoning or wetlands does not blank the field.
 */
export const NOT_MEASURES = new Set<string>(["constructs", "field", "occupations", "weather", "commerce", "realestate", "spending", "traffic", "hazards", "flood", "wetlands", "publiclands", "relief", "slope", "contours", "soils", "firehazard", "landcover", "sealevel", "transmission", "pipelines", "rail", "faults", "geology", "plss", "events", "parcels", "zoning", "permits", "licences", "envpermits", "historic", "crithab", "contaminants", "wayback", "topo", "impaired", "pfas", "ust", "hydro", "riskindex", "naip", "heritage", "health", "vulnerability", "broadband", "wildfirerisk", "tribal", "housing", "landslidesusc"]);

/**
 * Counted layers that load the whole world with no floor or limit, so they
 * are complete without a loaded box: USGS's feed of every earthquake in the
 * past 24 hours. Every other counted layer loads for the view (a bbox, a
 * radius, a height cut-off or a size floor) and, unless it draws a loaded
 * box, does not say what it loaded, so a unit reads as not loaded for it.
 */
export const WORLD_LOADED = new Set<string>(["earthquakes"]);

/** Whether a layer's points are counted by the field at all. */
export function isCounted(layer: string): boolean {
  return !NOT_MEASURES.has(layer) && !NOT_PHYSICAL.has(layer as LayerId);
}

/** The box a near-only layer loaded and what its answer left out. */
interface Loaded {
  layer: LayerId;
  box: BBox;
  truncated: boolean;
  floorMw?: number;
  missing?: string[];
}

function loadedBoxOf(f: LayerFeature): Loaded | null {
  if (f.properties.kind !== "loaded-box" || f.geometry?.type !== "Polygon") return null;
  if (!isCounted(f.properties.layer)) return null;
  const box = ringsBbox(f.geometry.coordinates as number[][][]);
  if (!box) return null;
  const x = (f.properties.extra as LoadedBoxExtra | undefined) ?? {};
  return { layer: f.properties.layer, box, truncated: x.truncated === true, ...(x.floorMw ? { floorMw: x.floorMw } : {}), ...(x.missing?.length ? { missing: x.missing } : {}) };
}

const within = (a: BBox, b: BBox) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const meets = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * A unit's coverage by the counted layers. A layer with a loaded box covers
 * what is inside it, less a record limit, a size floor or a missing part; a
 * layer without one covers nothing unless it is WORLD_LOADED. Reasons are
 * sorted so the answer does not depend on the order layers arrive in.
 */
function coverageOf(unit: BBox, counted: Set<LayerId>, boxes: Loaded[]): { coverage: Coverage; reasons: string[] } {
  const byLayer = new Map<LayerId, Loaded[]>();
  for (const l of counted) if (!WORLD_LOADED.has(l)) byLayer.set(l, []);
  for (const b of boxes) byLayer.set(b.layer, [...(byLayer.get(b.layer) ?? []), b]);
  let partial = false;
  let reached = false;
  let missed = false;
  const reasons: string[] = [];
  for (const [layer, list] of byLayer) {
    if (!list.length) {
      missed = true;
      reasons.push(`${layer} doesn't report what it loaded (it loads for the view), so its count here is unknown`);
      continue;
    }
    const whole = (b: Loaded) => !b.truncated && !b.floorMw && !b.missing;
    const inside = list.find((b) => within(unit, b.box) && whole(b)) ?? list.find((b) => within(unit, b.box));
    if (inside) {
      reached = true;
      if (inside.truncated) {
        partial = true;
        reasons.push(`${layer} incomplete here: the source's record limit was hit, so its count is a floor`);
      }
      if (inside.floorMw) {
        partial = true;
        reasons.push(`${layer} incomplete here: only those of ${inside.floorMw.toLocaleString("en-US")} MW or more were loaded at this height`);
      }
      if (inside.missing) {
        partial = true;
        reasons.push(`${layer} incomplete here: ${inside.missing.join(", ")} did not load`);
      }
    } else if (list.some((b) => meets(unit, b.box))) {
      reached = true;
      partial = true;
      reasons.push(`${layer} not loaded here: part of the unit lies outside the loaded box`);
    } else {
      missed = true;
      reasons.push(`${layer} not loaded here: outside the loaded box`);
    }
  }
  const coverage: Coverage = missed && !reached ? "none" : missed || partial ? "partial" : "complete";
  return { coverage, reasons: reasons.sort() };
}

interface Indexed {
  node: ConstructNode;
  box: BBox;
}

/** Place each physical feature into every construct whose outline contains it. */
export function computeVitals(
  nodes: ConstructNode[],
  features: Iterable<LayerFeature>,
  measure: Measure = "all",
  normalise: Normalise = "count",
  conditionOf?: (f: LayerFeature) => FeatureCondition | null,
  /** The layers turned on. A counted one with nothing loaded in view still bounds coverage. Defaults to the layers of `features`. */
  shown?: Iterable<string>,
): Map<string, Vitals> {
  const idx: Indexed[] = [];
  for (const node of nodes) {
    if (!node.rings) continue;
    const box = ringsBbox(node.rings);
    if (box) idx.push({ node, box });
  }
  const byNode = new Map<string, Partial<Record<LayerId, number>>>();
  const conds = new Map<string, FeatureCondition[]>();
  const wantCondition = measure === "streamflow" && !!conditionOf;
  const boxes: Loaded[] = [];
  // Under one layer only that layer bounds what is known; under streamflow, the gauges'; under "all", every counted layer turned on.
  const counts = (l: string) => isCounted(l) && (measure === "all" || l === (measure === "streamflow" ? "water" : measure));
  const counted = new Set<LayerId>();
  if (measure !== "all") counted.add((measure === "streamflow" ? "water" : measure) as LayerId);
  if (shown) for (const l of shown) if (counts(l)) counted.add(l as LayerId);
  for (const f of features) {
    if (!shown && counts(f.properties.layer) && !f.properties.simulated) counted.add(f.properties.layer);
    const lb = loadedBoxOf(f);
    if (lb) {
      if (counts(lb.layer)) boxes.push(lb);
      continue;
    }
    if (!isPhysical(f)) continue;
    const c = (f.geometry as { coordinates: number[] }).coordinates;
    const lon = c[0];
    const lat = c[1];
    const cond = wantCondition ? conditionOf!(f) : null;
    const w = standsFor(f);
    for (const { node, box } of idx) {
      if (!bboxContains(box, lon, lat) || !ringsContain(node.rings!, lon, lat)) continue;
      const m = byNode.get(node.id) ?? {};
      m[f.properties.layer] = (m[f.properties.layer] ?? 0) + w;
      byNode.set(node.id, m);
      if (cond) conds.set(node.id, [...(conds.get(node.id) ?? []), cond]);
    }
  }
  const out = new Map<string, Vitals>();
  // Units in id order, so ties and the map's order never depend on the order units arrive in.
  idx.sort((x, y) => byId(x.node.id, y.node.id));
  for (const { node, box } of idx) {
    const byLayer = byNode.get(node.id) ?? {};
    const total = Object.values(byLayer).reduce((a, b) => a + (b ?? 0), 0);
    const area = node.areaKm2 && node.areaKm2 > 0 ? node.areaKm2 : null;
    const density = area ? (total / area) * 1000 : null;
    const { coverage, reasons } = coverageOf(box, counted, boxes);
    if (measure === "streamflow") {
      // A condition is the median of the gauges loaded, not a count, so it is shown with its coverage rather than withheld.
      out.set(node.id, { total, byLayer, density, ...conditionVitals(conds.get(node.id) ?? []), rank: 0, coverage, ...(reasons.length ? { reason: reasons.join("; ") } : {}) });
      continue;
    }
    const count = measure === "all" ? total : (byLayer[measure] ?? 0);
    const noArea = normalise === "density" && !area;
    if (noArea) reasons.push("no area known for this unit, so no density");
    const value = coverage !== "complete" || noArea ? null : normalise === "density" ? (count / area!) * 1000 : count;
    out.set(node.id, {
      total,
      byLayer,
      density,
      value,
      heat: 0,
      rank: 0,
      coverage: noArea && coverage === "complete" ? "partial" : coverage,
      ...(reasons.length ? { reason: reasons.join("; ") } : {}),
      display: value == null ? "not loaded" : value > 0 ? fmtValue(value) : "",
    });
  }
  // Largest first, units with no value last, ties by id.
  const sorted = [...out.entries()].sort((a, b) => (b[1].value ?? -Infinity) - (a[1].value ?? -Infinity) || byId(a[0], b[0]));
  if (measure === "streamflow") {
    // Heat is absolute (distance from the day's median), so it is not rescaled to the busiest unit.
    sorted.forEach(([, v], i) => (v.rank = i));
    return out;
  }
  // Rescaled over complete units only: a partly loaded unit's count is a floor, so it can neither set the top of the ramp nor sit on it.
  const max = Math.max(0, ...sorted.map(([, v]) => v.value ?? 0));
  sorted.forEach(([, v], i) => {
    v.rank = i;
    v.heat = v.value != null && max > 0 ? Math.sqrt(v.value / max) : 0;
  });
  return out;
}

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function fmtValue(v: number): string {
  return v >= 100 ? Math.round(v).toLocaleString("en-US") : v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

/**
 * A unit's condition from the gauges inside it: the median percentile of the
 * rated ones, its class and colour, and how many forecast points are in flood.
 * Heat is the median's distance from normal, either way; a flood anywhere
 * inside takes it to the top.
 */
export function conditionVitals(list: FeatureCondition[]): Pick<Vitals, "heat" | "display" | "color" | "condition"> & { value: number } {
  const pcts = list.map((c) => c.pct).filter((p): p is number => p != null);
  const flooding = list.filter((c) => c.flooding).length;
  const m = median(pcts);
  const classes: Partial<Record<FlowClass, number>> = {};
  for (const p of pcts) classes[flowClass(p)] = (classes[flowClass(p)] ?? 0) + 1;
  const heat = flooding > 0 ? 1 : m != null ? departure(m) : 0;
  const parts: string[] = [];
  if (m != null) parts.push(`${ordinal(m)} pct`);
  if (flooding) parts.push(`${flooding} in flood`);
  return {
    value: heat,
    heat,
    display: parts.join(" · "),
    color: m != null ? FLOW_CLASSES[flowClass(m)].color : flooding ? FLOW_CLASSES["much-above"].color : undefined,
    condition: { median: m, gauges: list.length, rated: pcts.length, flooding, classes },
  };
}

/** A cheap fingerprint so the field is only redrawn when something it shows changed. */
export function vitalsKey(v: Map<string, Vitals>): string {
  const parts: string[] = [];
  for (const [id, x] of v) {
    // A unit with no value is drawn too (as not loaded), so it is in the fingerprint.
    if (x.value == null) parts.push(`${id}=?`);
    else if (x.value > 0 || x.condition?.gauges) parts.push(`${id}=${x.value.toFixed(2)}${x.color ?? ""}`);
  }
  return parts.sort().join("|");
}

/** A unit with no value: the field draws it as a dashed outline in this grey, outside the heat ramp. */
export const NOT_LOADED = "#9CA3AF";

/** Heat ramp for the field: dim slate, through cyan and gold, to hot orange. */
export function heatColor(heat: number): string {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [71, 85, 105]],
    [0.25, [34, 211, 238]],
    [0.6, [250, 204, 21]],
    [1, [249, 115, 22]],
  ];
  const h = Math.max(0, Math.min(1, heat));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i];
    const [t0, c0] = stops[i - 1];
    if (h <= t1) {
      const k = (h - t0) / (t1 - t0);
      const c = c0.map((x, j) => Math.round(x + (c1[j] - x) * k));
      return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  return "#f97316";
}
