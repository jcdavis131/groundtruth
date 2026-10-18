// Collector: earthquakes in the past day, counted by magnitude bucket.
//
//   snapshot:quakes:world:m2.5   M >= 2.5 worldwide in the trailing 24 h
//   snapshot:quakes:world:m4.5   M >= 4.5 worldwide
//   snapshot:quakes:conus:m2.5   M >= 2.5 inside the lower-48 box
//   snapshot:quakes:conus:m4.5   M >= 4.5 inside the lower-48 box
//
// One fetch of the USGS 2.5_day GeoJSON feed (the same feed the earthquakes
// layer draws). The point is stamped with the sample time because the value
// is a trailing-window count, not an observation at an instant.

import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { SeriesMeta } from "@/lib/series/types";
import type { Collector, CollectorContext, CollectorOutput } from "./types";

export const QUAKE_FEED_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson";

/** Lower-48 bounding box [w, s, e, n]; generous on purpose so offshore events count. */
export const CONUS_BBOX: [number, number, number, number] = [-125.5, 24, -66, 49.5];

export const MAG_BUCKETS = [2.5, 4.5] as const;

/** USGS summary feed feature fields this collector reads. */
interface QuakeFeature {
  properties?: { mag?: number | null };
  geometry?: { coordinates?: number[] } | null;
}

interface QuakeFeed {
  metadata?: { generated?: number; count?: number };
  features?: QuakeFeature[];
}

export interface QuakeCounts {
  world: Record<string, number>;
  conus: Record<string, number>;
}

export function inConus(lon: number, lat: number, box = CONUS_BBOX): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

/** Count features per bucket; events with no magnitude or no position are skipped. */
export function countQuakes(feed: QuakeFeed, buckets: readonly number[] = MAG_BUCKETS): QuakeCounts {
  const world: Record<string, number> = {};
  const conus: Record<string, number> = {};
  for (const b of buckets) {
    world[bucketKey(b)] = 0;
    conus[bucketKey(b)] = 0;
  }
  for (const f of feed.features ?? []) {
    const mag = f.properties?.mag;
    const c = f.geometry?.coordinates;
    if (mag == null || !Number.isFinite(mag) || !c || c.length < 2) continue;
    const us = inConus(c[0], c[1]);
    for (const b of buckets) {
      if (mag < b) continue;
      world[bucketKey(b)]++;
      if (us) conus[bucketKey(b)]++;
    }
  }
  return { world, conus };
}

export function bucketKey(minMag: number): string {
  return `m${minMag}`;
}

export function quakeOutputs(counts: QuakeCounts, now: number, generated?: number): CollectorOutput[] {
  const out: CollectorOutput[] = [];
  const retrievedAt = new Date(now).toISOString();
  const releasedAt = generated != null && Number.isFinite(generated) ? new Date(generated).toISOString() : undefined;
  const regions: Array<{ key: keyof QuakeCounts; geo: SeriesMeta["geo"]; label: string }> = [
    { key: "world", geo: { kind: "world", id: "world", name: "World" }, label: "worldwide" },
    { key: "conus", geo: { kind: "us", id: "conus", name: "Contiguous United States" }, label: "in the contiguous US" },
  ];
  for (const region of regions) {
    for (const b of MAG_BUCKETS) {
      const meta: SeriesMeta = {
        id: `snapshot:quakes:${region.key}:${bucketKey(b)}`,
        title: `Earthquakes M ≥ ${b} ${region.label}, past 24 h`,
        unit: "count",
        frequency: "irregular",
        geo: region.geo,
        provenance: provenance(source("usgs-earthquakes"), {
          kind: "snapshot",
          seriesId: "2.5_day",
          upstreamUrl: QUAKE_FEED_URL,
          retrievedAt,
          releasedAt,
          method: `features with mag >= ${b}${region.key === "conus" ? ` and epicentre inside lon ${CONUS_BBOX[0]}..${CONUS_BBOX[2]}, lat ${CONUS_BBOX[1]}..${CONUS_BBOX[3]}` : ""} in the USGS 2.5_day feed`,
          notes: ["Trailing 24 h window at sample time; the feed is revised as events are reviewed."],
        }),
        tags: ["earthquakes", "hazard", region.key],
      };
      out.push({ meta, points: [{ t: now, v: counts[region.key][bucketKey(b)] }] });
    }
  }
  return out;
}

const ID = "quakes";
const TITLE = "Earthquakes, past day";
const CADENCE = "3h";

export const quakesCollector: Collector = {
  id: ID,
  title: TITLE,
  cadence: CADENCE,
  describe() {
    return {
      id: ID,
      title: TITLE,
      cadence: CADENCE,
      seriesPrefix: "snapshot:quakes:",
      sources: ["usgs-earthquakes"],
      note: `Counts of M >= ${MAG_BUCKETS.join(" and M >= ")} events in the trailing 24 h, worldwide and for the contiguous US.`,
    };
  },
  async collect(ctx: CollectorContext) {
    const feed = await ctx.fetchJson<QuakeFeed>(QUAKE_FEED_URL, { timeoutMs: 30_000, signal: ctx.signal });
    const counts = countQuakes(feed);
    ctx.log?.(`quakes: ${feed.features?.length ?? 0} features, world m2.5 ${counts.world["m2.5"]} m4.5 ${counts.world["m4.5"]}`);
    return quakeOutputs(counts, ctx.now, feed.metadata?.generated);
  },
};
