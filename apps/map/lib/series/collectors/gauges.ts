// Collector: key USGS river gauges, relayed as published.
//
//   snapshot:gauge:<site>:00065   stage, ft
//   snapshot:gauge:<site>:00060   discharge, ft³/s
//
// The gauges are the ones freight and water people watch first: the
// Mississippi at Memphis and St. Louis (barge draft), the Ohio at Louisville,
// the Missouri at St. Joseph, the Columbia at The Dalles, the Colorado below
// Hoover, the Sacramento at Freeport and the Rio Grande at El Paso. Each point
// is stamped with the upstream observation time, not the collection time, so
// repeated samples of one reading merge into one point.

import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { Point, SeriesMeta } from "@/lib/series/types";
import { sleep, type Collector, type CollectorContext, type CollectorOutput } from "./types";

export interface WatchedGauge {
  /** USGS site number without the "USGS-" prefix. */
  site: string;
  name: string;
  river: string;
  lon: number;
  lat: number;
}

export const GAUGES: WatchedGauge[] = [
  { site: "07032000", name: "Mississippi River at Memphis, TN", river: "Mississippi", lon: -90.0776, lat: 35.1232 },
  { site: "07010000", name: "Mississippi River at St. Louis, MO", river: "Mississippi", lon: -90.1796, lat: 38.6289 },
  { site: "03294500", name: "Ohio River at Louisville, KY", river: "Ohio", lon: -85.7986, lat: 38.2803 },
  { site: "06818000", name: "Missouri River at St. Joseph, MO", river: "Missouri", lon: -94.8575, lat: 39.7525 },
  { site: "14105700", name: "Columbia River at The Dalles, OR", river: "Columbia", lon: -121.1725, lat: 45.6075 },
  { site: "09421500", name: "Colorado River below Hoover Dam, AZ-NV", river: "Colorado", lon: -114.7372, lat: 36.0153 },
  { site: "11447650", name: "Sacramento River at Freeport, CA", river: "Sacramento", lon: -121.5019, lat: 38.4561 },
  { site: "08364000", name: "Rio Grande at El Paso, TX", river: "Rio Grande", lon: -106.5406, lat: 31.8028 },
];

export const GAUGE_PARAMS: Record<string, { label: string; unit: string }> = {
  "00065": { label: "stage", unit: "ft" },
  "00060": { label: "discharge", unit: "ft³/s" },
};

export const USGS_LATEST = "https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous/items";

/** USGS OGC API feature (same shape app/api/water/route.ts reads). */
interface UsgsRow {
  properties?: {
    monitoring_location_id?: string;
    parameter_code?: string;
    time?: string;
    value?: string | number | null;
    unit_of_measure?: string;
    approval_status?: string;
  };
}

interface UsgsCollection {
  features?: UsgsRow[];
}

export function usgsLatestUrl(site: string, params: string[] = Object.keys(GAUGE_PARAMS)): string {
  // shape per https://api.waterdata.usgs.gov/ogcapi/v0/ (latest-continuous, property filters); unverified in sandbox
  const qs = new URLSearchParams({ f: "json", monitoring_location_id: `USGS-${site}`, parameter_code: params.join(",") });
  return `${USGS_LATEST}?${qs.toString()}`;
}

export interface GaugeReading {
  site: string;
  param: string;
  t: number;
  v: number;
  unit?: string;
  approval?: string;
}

/** Latest reading per (site, param) from a latest-continuous page; non-numeric or undated rows are dropped. */
export function parseGaugeRows(fc: UsgsCollection): GaugeReading[] {
  const best = new Map<string, GaugeReading>();
  for (const f of fc.features ?? []) {
    const p = f.properties;
    if (!p?.monitoring_location_id || !p.parameter_code || !p.time || p.value == null) continue;
    const v = Number(p.value);
    const t = Date.parse(p.time);
    if (!Number.isFinite(v) || !Number.isFinite(t)) continue;
    const site = p.monitoring_location_id.replace(/^USGS-/, "");
    const key = `${site}:${p.parameter_code}`;
    const cur = best.get(key);
    if (!cur || cur.t < t) best.set(key, { site, param: p.parameter_code, t, v, unit: p.unit_of_measure, approval: p.approval_status });
  }
  return [...best.values()];
}

/** Display unit: the upstream string when it sent one, else our table. */
export function gaugeUnit(param: string, upstream?: string): string {
  const table = GAUGE_PARAMS[param]?.unit;
  if (!upstream) return table ?? "";
  // USGS spells cubic feet per second "ft^3/s"; keep the table's typographic form for known codes.
  return table ?? upstream;
}

export function gaugeOutput(g: WatchedGauge, r: GaugeReading, now: number): CollectorOutput {
  const def = GAUGE_PARAMS[r.param];
  const meta: SeriesMeta = {
    id: `snapshot:gauge:${g.site}:${r.param}`,
    title: `${g.name}: ${def?.label ?? `parameter ${r.param}`}`,
    unit: gaugeUnit(r.param, r.unit),
    frequency: "irregular",
    geo: { kind: "gauge", id: `USGS-${g.site}`, name: g.name, lon: g.lon, lat: g.lat },
    provenance: provenance(source("usgs-water"), {
      kind: "published",
      seriesId: `${g.site}:${r.param}`,
      upstreamUrl: usgsLatestUrl(g.site, [r.param]),
      retrievedAt: new Date(now).toISOString(),
      revision: r.approval,
      notes: ["Latest continuous value as published; provisional until USGS approves it."],
    }),
    tags: ["water", "river", g.river.toLowerCase().replace(/\s+/g, "-"), def?.label ?? r.param],
  };
  const point: Point = { t: r.t, v: r.v };
  return { meta, points: [point] };
}

const ID = "gauges";
const TITLE = "Key USGS river gauges";
const CADENCE = "3h";

export const gaugesCollector: Collector = {
  id: ID,
  title: TITLE,
  cadence: CADENCE,
  timeoutMs: 60_000,
  describe() {
    return {
      id: ID,
      title: TITLE,
      cadence: CADENCE,
      seriesPrefix: "snapshot:gauge:",
      sources: ["usgs-water"],
      note: `Stage and discharge at ${GAUGES.length} gauges from USGS latest-continuous, stamped with the observation time.`,
    };
  },
  async collect(ctx: CollectorContext) {
    const out: CollectorOutput[] = [];
    const gap = ctx.politeDelayMs ?? 400;
    let failures = 0;
    let lastError: unknown;
    for (let i = 0; i < GAUGES.length; i++) {
      const g = GAUGES[i];
      if (i > 0) await sleep(gap, ctx.signal);
      try {
        const fc = await ctx.fetchJson<UsgsCollection>(usgsLatestUrl(g.site), { timeoutMs: 30_000, signal: ctx.signal });
        for (const r of parseGaugeRows(fc)) {
          if (r.site !== g.site) continue;
          out.push(gaugeOutput(g, r, ctx.now));
        }
      } catch (err) {
        failures++;
        lastError = err;
        ctx.log?.(`gauges: ${g.site} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (failures === GAUGES.length) throw lastError instanceof Error ? lastError : new Error("every gauge query failed");
    ctx.log?.(`gauges: ${out.length} readings from ${GAUGES.length - failures}/${GAUGES.length} sites`);
    return out;
  },
};
