// The construct field's legend, derived from the functions that paint it.
//
// Entries come from heatColor, NOT_LOADED and FLOW_CLASSES, and the labels
// from fmtValue, the same function the unit labels use. Nothing here is a
// second copy of a colour. lib/fabric/legend.test.ts checks, over 200 seeded
// random maps, that every colour fieldStyle.colorFor emits is an entry or
// lies on the ramp the entries define, so the legend cannot drift from the
// paint.
//
// Heat is the square root of value over the largest complete value in view
// (lib/fabric/emergence.ts), so the value at a ramp stop h is max * h^2.

import { FLOW_CLASSES, FLOW_CLASS_ORDER } from "./condition";
import { fmtValue, heatColor, NOT_LOADED, type Measure, type Normalise, type Vitals } from "./emergence";
import { parseHex, toHex, type Rgb } from "@/lib/color/cvd";

export type LegendKind = "ramp" | "not-loaded" | "class" | "outline";

export interface LegendEntry {
  color: string;
  label: string;
  kind: LegendKind;
  /** Where on the heat ramp (0..1) a ramp entry sits. */
  heat?: number;
}

export type LegendUnits = "count" | "per 1,000 km²" | "percentile against normal for today" | "classes";

/**
 * What a binned layer's classes were cut from, read from its committed breaks file
 * (lib/breaks): the universe the cut points were computed over and how many units
 * had a value, with the caveat on any unit binned against another level's cut points.
 */
export interface LegendScale {
  universe: string;
  n: number;
  caveat: string | null;
}

export interface Legend {
  entries: LegendEntry[];
  /** The complete unit that sets the top of the ramp; null when none is complete with a value above zero, or under streamflow. */
  max: { id: string; name: string; value: number; display: string } | null;
  /** Units with no value, and why, counted by the reason each carries. */
  notLoaded: { count: number; reasons: Record<string, number> };
  units: LegendUnits;
  /** Set by a binned layer that has a breaks file; the construct field scales to its largest unit in view and names that unit in `max`. */
  scale?: LegendScale;
}

/** The heats at which the ramp is labelled. */
export const RAMP_STOPS = [0, 0.25, 0.6, 1] as const;

const NO_REASON = "no reason recorded";

export function legendFor(vitals: Map<string, Vitals>, measure: Measure, normalise: Normalise, nameOf: (id: string) => string = (id) => id): Legend {
  const streamflow = measure === "streamflow";
  let nulls = 0;
  let anyValue = false;
  const reasons: Record<string, number> = {};
  let max: Legend["max"] = null;
  for (const [id, v] of vitals) {
    if (v.value == null) {
      nulls++;
      const r = v.reason ?? NO_REASON;
      reasons[r] = (reasons[r] ?? 0) + 1;
      continue;
    }
    anyValue = true;
    // A partly loaded unit's value is a floor: it never sets the top of the ramp.
    if (streamflow || v.coverage !== "complete" || v.value <= 0) continue;
    if (!max || v.value > max.value || (v.value === max.value && id < max.id)) max = { id, name: nameOf(id), value: v.value, display: fmtValue(v.value) };
  }

  const entries: LegendEntry[] = [];
  if (streamflow) {
    for (const c of FLOW_CLASS_ORDER) entries.push({ color: FLOW_CLASSES[c].color, label: `${FLOW_CLASSES[c].label} (${FLOW_CLASSES[c].range} percentile)`, kind: "class" });
    // A unit with no rated gauge is drawn at the bottom of the heat ramp.
    entries.push({ color: heatColor(0), label: "no rated gauge", kind: "class" });
  } else if (anyValue) {
    if (max) for (const h of RAMP_STOPS) entries.push({ color: heatColor(h), label: h === 0 ? "0" : fmtValue(max.value * h * h), kind: "ramp", heat: h });
    else entries.push({ color: heatColor(0), label: "0", kind: "ramp", heat: 0 });
  }
  if (nulls > 0) entries.push({ color: NOT_LOADED, label: "not loaded", kind: "not-loaded" });

  const units: LegendUnits = streamflow ? "percentile against normal for today" : normalise === "density" ? "per 1,000 km²" : "count";
  return { entries, max, notLoaded: { count: nulls, reasons }, units };
}

/**
 * The colour of a heat, computed from the legend's own ramp entries alone
 * (linear between neighbouring stops, rounded per channel as heatColor does).
 * Null when the legend has no ramp.
 */
export function rampColorAt(entries: readonly LegendEntry[], heat: number): string | null {
  const ramp = entries.filter((e): e is LegendEntry & { heat: number } => e.kind === "ramp" && e.heat != null).sort((a, b) => a.heat - b.heat);
  if (!ramp.length) return null;
  const h = Math.max(0, Math.min(1, heat));
  for (let i = 1; i < ramp.length; i++) {
    if (h <= ramp[i].heat) {
      const k = (h - ramp[i - 1].heat) / (ramp[i].heat - ramp[i - 1].heat);
      const c0 = parseHex(ramp[i - 1].color);
      const c1 = parseHex(ramp[i].color);
      return toHex(c0.map((x, j) => Math.round(x + (c1[j] - x) * k)) as Rgb);
    }
  }
  return ramp[ramp.length - 1].color;
}
