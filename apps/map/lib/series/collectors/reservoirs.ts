// Collector: Texas reservoir storage from the Texas Water Development Board.
//
//   snapshot:reservoir:texas:percent-full    statewide, capacity-weighted (estimate)
//   snapshot:reservoir:<slug>:percent-full   each of the ten largest reservoirs by
//                                            conservation capacity, as published
//
// The endpoint is the one /api/water?op=twdb proxies. Points are stamped with
// the upstream "timestamp" (the day the reading describes) so daily samples of
// the same reading collapse into one point; the statewide number is computed
// here from the published storage and capacity and is labelled an estimate
// with its formula.

import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { SeriesMeta } from "@/lib/series/types";
import type { Collector, CollectorContext, CollectorOutput } from "./types";

export const TWDB_URL = "https://www.waterdatafortexas.org/reservoirs/recent-conditions.json";
export const TOP_N = 10;

/** TWDB recent-conditions record (fields app/api/water/route.ts also reads). */
export interface TwdbReservoir {
  short_name?: string;
  full_name?: string;
  percent_full?: number | null;
  conservation_capacity?: number | null;
  conservation_storage?: number | null;
  gauge_location?: { type?: string; coordinates?: number[] } | null;
  timestamp?: string;
}

/** Lower-case slug safe for a series id segment. */
export function reservoirSlug(shortName: string): string {
  return shortName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The payload has been both an array and an object keyed by short name; accept either. */
export function twdbList(json: unknown): TwdbReservoir[] {
  // shape per https://www.waterdatafortexas.org/reservoirs (recent-conditions.json); unverified in sandbox
  if (Array.isArray(json)) return json as TwdbReservoir[];
  if (json && typeof json === "object") return Object.values(json as Record<string, TwdbReservoir>);
  return [];
}

/** Capacity-weighted statewide percent full, or null when nothing usable was published. */
export function statewidePercentFull(list: TwdbReservoir[]): { percent: number; capacity: number; n: number } | null {
  let cap = 0;
  let sto = 0;
  let n = 0;
  for (const r of list) {
    if (r.conservation_capacity == null || r.conservation_storage == null) continue;
    if (!(r.conservation_capacity > 0) || !Number.isFinite(r.conservation_storage)) continue;
    cap += r.conservation_capacity;
    sto += r.conservation_storage;
    n++;
  }
  if (cap <= 0 || n === 0) return null;
  return { percent: (100 * sto) / cap, capacity: cap, n };
}

/** The `n` largest reservoirs by conservation capacity that published a percent full. */
export function topByCapacity(list: TwdbReservoir[], n = TOP_N): TwdbReservoir[] {
  return list
    .filter((r) => r.short_name && r.percent_full != null && Number.isFinite(r.percent_full) && r.conservation_capacity != null)
    .sort((a, b) => (b.conservation_capacity ?? 0) - (a.conservation_capacity ?? 0))
    .slice(0, n);
}

/** Observation time: the published day at UTC midnight, else the sample time. */
export function readingTime(timestamp: string | undefined, now: number): number {
  if (!timestamp) return now;
  const t = Date.parse(timestamp.length === 10 ? `${timestamp}T00:00:00Z` : timestamp);
  return Number.isFinite(t) ? t : now;
}

export function reservoirOutputs(list: TwdbReservoir[], now: number): CollectorOutput[] {
  const out: CollectorOutput[] = [];
  const retrievedAt = new Date(now).toISOString();
  const state = statewidePercentFull(list);
  if (state) {
    const latest = list.map((r) => r.timestamp).filter((t): t is string => !!t).sort().at(-1);
    const meta: SeriesMeta = {
      id: "snapshot:reservoir:texas:percent-full",
      title: "Texas reservoirs, statewide percent full",
      unit: "%",
      frequency: "irregular",
      geo: { kind: "state", id: "48", name: "Texas" },
      provenance: provenance(source("twdb"), {
        kind: "estimate",
        retrievedAt,
        period: latest,
        method: `100 * sum(conservation_storage) / sum(conservation_capacity) over the ${state.n} reservoirs that published both`,
        notes: ["Capacity-weighted; TWDB's own statewide figure may use a different reservoir set."],
      }),
      tags: ["water", "reservoir", "texas"],
    };
    out.push({ meta, points: [{ t: readingTime(latest, now), v: Math.round(state.percent * 100) / 100 }] });
  }
  for (const r of topByCapacity(list)) {
    const slug = reservoirSlug(r.short_name!);
    const c = r.gauge_location?.coordinates;
    const meta: SeriesMeta = {
      id: `snapshot:reservoir:${slug}:percent-full`,
      title: `${r.full_name ?? r.short_name}, percent full`,
      unit: "%",
      frequency: "irregular",
      geo: { kind: "point", id: slug, name: r.full_name ?? r.short_name, lon: c?.[0], lat: c?.[1] },
      provenance: provenance(source("twdb"), {
        kind: "published",
        seriesId: r.short_name,
        upstreamUrl: TWDB_URL,
        retrievedAt,
        period: r.timestamp,
        notes: [`Conservation capacity ${Math.round(r.conservation_capacity ?? 0).toLocaleString("en-US")} ac-ft.`],
      }),
      tags: ["water", "reservoir", "texas"],
    };
    out.push({ meta, points: [{ t: readingTime(r.timestamp, now), v: r.percent_full! }] });
  }
  return out;
}

const ID = "reservoirs";
const TITLE = "Texas reservoirs";
const CADENCE = "3h";

export const reservoirsCollector: Collector = {
  id: ID,
  title: TITLE,
  cadence: CADENCE,
  describe() {
    return {
      id: ID,
      title: TITLE,
      cadence: CADENCE,
      seriesPrefix: "snapshot:reservoir:",
      sources: ["twdb"],
      note: `Statewide capacity-weighted percent full (estimate, formula in provenance) and the ${TOP_N} largest reservoirs as published by TWDB.`,
    };
  },
  async collect(ctx: CollectorContext) {
    const json = await ctx.fetchJson<unknown>(TWDB_URL, { timeoutMs: 30_000, signal: ctx.signal });
    const list = twdbList(json);
    const out = reservoirOutputs(list, ctx.now);
    ctx.log?.(`reservoirs: ${list.length} reservoirs published, ${out.length} series`);
    return out;
  },
};
