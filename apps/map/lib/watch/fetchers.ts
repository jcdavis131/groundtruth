// The real `Fetchers` for lib/watch/resolve: the economy tables the app
// already caches, the series store, and one small USGS call per gauge.
// Server only (pulls in the bundled World Port Index and node:fs).

import { cached } from "@/lib/server/cache";
import { polite, upstreamJson } from "@/lib/server/upstream";
import { borderCrossings, btsPortStats, qcewLatest, stateLookup, WPI, zillow } from "@/lib/economy/sources";
import { defaultStore } from "@/lib/series/store";
import type { Fetchers, GaugeLatest } from "./resolve";

// Same collection the water layer reads for the map; here filtered to one site.
// shape per https://api.waterdata.usgs.gov/ogcapi/v0/collections/latest-continuous ; unverified in sandbox
const USGS = "https://api.waterdata.usgs.gov/ogcapi/v0/collections";
const GAUGE_PARAMS = "00060,00065,00010,00300,00095,00400,63680,00062,00054";

interface UsgsRow {
  properties: {
    monitoring_location_id: string;
    parameter_code: string;
    time: string;
    value: string | null;
    unit_of_measure: string;
  };
  geometry: { type: "Point"; coordinates: [number, number] } | null;
}

/** Parse a latest-continuous FeatureCollection into per-parameter readings (pure; exported for tests). */
export function parseUsgsLatest(features: UsgsRow[], upstreamUrl?: string): GaugeLatest[] {
  const out: GaugeLatest[] = [];
  for (const f of features) {
    const p = f.properties;
    if (p.value == null) continue;
    const value = Number(p.value);
    if (!Number.isFinite(value)) continue;
    out.push({ param: p.parameter_code, value, unit: p.unit_of_measure, time: p.time, lon: f.geometry?.coordinates[0], lat: f.geometry?.coordinates[1], upstreamUrl });
  }
  return out;
}

async function usgsLatest(site: string): Promise<GaugeLatest[]> {
  const qs = new URLSearchParams({ f: "json", limit: "50", monitoring_location_id: site, parameter_code: GAUGE_PARAMS });
  const url = `${USGS}/latest-continuous/items?${qs}`;
  const r = await cached("watch:usgs:" + site, 5 * 60_000, () =>
    polite("usgs-water", 400, 30_000, () => upstreamJson<{ features: UsgsRow[] }>("usgs-water", url, { timeoutMs: 30_000 })),
  );
  return parseUsgsLatest(r.value.features ?? [], url);
}

const wpiById = new Map(WPI.ports.map((p) => [p.id, p]));

export const defaultFetchers: Fetchers = {
  zillow: (kind) => zillow(kind),
  qcewLatest,
  stateLookup,
  btsPortStats,
  wpiPort: (id) => wpiById.get(id),
  borderCrossings,
  usgsLatest,
  seriesGet: (id) => defaultStore().get(id),
};
