"use client";
// The browser's copy of the daily flow percentiles for the gauges it has
// loaded. The emergence bridge asks for the sites it has not seen yet (in
// batches, through /api/water?op=normals) and reads a gauge's condition from
// here; nothing is ever assumed for a site whose table has not arrived.

import type { LayerFeature } from "@/lib/layers/types";
import type { GaugeExtra } from "@/lib/layers/water";
import { FLOOD_CATEGORIES, flowPercentile, monthDay, type FlowNormals } from "./condition";
import type { FeatureCondition } from "./emergence";

const BATCH = 100;
/** site -> normals, or null when USGS publishes none for the day. */
const table = new Map<string, FlowNormals | null>();
const asked = new Set<string>();
let calendarKey = "";

function flowOf(f: LayerFeature): { site: string; value: number; time: string } | null {
  if (f.properties.layer !== "water") return null;
  const x = f.properties.extra as GaugeExtra | undefined;
  const r = x?.readings?.["00060"];
  if (!x || !r || !Number.isFinite(r.value) || !/^USGS-\d+$/.test(x.site)) return null;
  // The statistics are in cubic feet per second; skip anything reported otherwise.
  if (r.unit && !/ft|cfs/i.test(r.unit)) return null;
  return { site: x.site.slice(5), value: r.value, time: r.time };
}

function floodOf(f: LayerFeature): boolean {
  if (f.properties.layer !== "water") return false;
  const c = (f.properties.extra as GaugeExtra | undefined)?.flood?.category;
  return !!c && FLOOD_CATEGORIES.has(c.toLowerCase());
}

/** A gauge's condition: its flow's percentile for the day, and whether its forecast point is in flood. */
export function conditionOf(f: LayerFeature): FeatureCondition | null {
  const flow = flowOf(f);
  const flooding = floodOf(f);
  if (!flow && !flooding) return null;
  const n = flow ? table.get(flow.site) : undefined;
  return { pct: flow && n ? flowPercentile(flow.value, n) : null, flooding };
}

export function normalsFor(site: string): FlowNormals | null | undefined {
  return table.get(site.replace(/^USGS-/, ""));
}

/**
 * Ask for the tables of any loaded gauges not asked about yet. Resolves true
 * when new tables arrived (the caller recomputes); failures leave the sites
 * unasked so a later tick retries.
 */
export async function ensureNormals(features: Iterable<LayerFeature>): Promise<boolean> {
  const { month, day } = monthDay();
  const key = `${month}-${day}`;
  if (key !== calendarKey) {
    calendarKey = key;
    table.clear();
    asked.clear();
  }
  const want: string[] = [];
  for (const f of features) {
    const flow = flowOf(f);
    if (flow && !asked.has(flow.site)) {
      asked.add(flow.site);
      want.push(flow.site);
    }
  }
  if (!want.length) return false;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  let got = false;
  for (let i = 0; i < want.length; i += BATCH) {
    const batch = want.slice(i, i + BATCH);
    try {
      const r = await fetch(`/api/water?op=normals&date=${mm}-${dd}&sites=${batch.join(",")}`);
      const j = (await r.json()) as { data?: Record<string, FlowNormals | null> };
      if (!r.ok || !j.data) throw new Error(String(r.status));
      for (const s of batch) table.set(s, j.data[s] ?? null);
      got = true;
    } catch {
      for (const s of batch) asked.delete(s);
    }
  }
  return got;
}
