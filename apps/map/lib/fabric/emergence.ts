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

import type { LayerFeature, LayerId } from "@/lib/layers/types";
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

export interface Vitals {
  total: number;
  byLayer: Partial<Record<LayerId, number>>;
  /** Features per 1,000 km² of the construct's area; null when no area is known. */
  density: number | null;
  /** The value the heat is taken from (count or density of the chosen measure). */
  value: number;
  /** value relative to the largest in view, 0..1, square-root scaled so small counts still show. */
  heat: number;
  /** 0 = the largest value in view. */
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
  for (const f of features) {
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
  for (const { node } of idx) {
    const byLayer = byNode.get(node.id) ?? {};
    const total = Object.values(byLayer).reduce((a, b) => a + (b ?? 0), 0);
    const area = node.areaKm2 && node.areaKm2 > 0 ? node.areaKm2 : null;
    const density = area ? (total / area) * 1000 : null;
    if (measure === "streamflow") {
      out.set(node.id, { total, byLayer, density, ...conditionVitals(conds.get(node.id) ?? []), rank: 0 });
      continue;
    }
    const count = measure === "all" ? total : (byLayer[measure] ?? 0);
    const value = normalise === "density" ? (area ? (count / area) * 1000 : 0) : count;
    out.set(node.id, { total, byLayer, density, value, heat: 0, rank: 0, display: value > 0 ? fmtValue(value) : "" });
  }
  const sorted = [...out.entries()].sort((a, b) => b[1].value - a[1].value);
  if (measure === "streamflow") {
    // Heat is absolute (distance from the day's median), so it is not rescaled to the busiest unit.
    sorted.forEach(([, v], i) => (v.rank = i));
    return out;
  }
  const max = Math.max(0, ...sorted.map(([, v]) => v.value));
  sorted.forEach(([, v], i) => {
    v.rank = i;
    v.heat = max > 0 ? Math.sqrt(v.value / max) : 0;
  });
  return out;
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
export function conditionVitals(list: FeatureCondition[]): Pick<Vitals, "value" | "heat" | "display" | "color" | "condition"> {
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
  for (const [id, x] of v) if (x.value > 0 || x.condition?.gauges) parts.push(`${id}=${x.value.toFixed(2)}${x.color ?? ""}`);
  return parts.sort().join("|");
}

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
