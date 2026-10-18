// Readers and converters that turn what the app already fetches into
// lib/series Series with provenance. The pure parts (parsers, converters)
// are exported so they can be tested on fixtures; the fetchers wrap them in
// cached() + polite() so an indicator refresh never stampedes an upstream.

import { cached } from "@/lib/server/cache";
import { polite, upstream, upstreamJson } from "@/lib/server/upstream";
import { parseCsv, cellNum } from "@/lib/economy/csv";
import type { PulseItem } from "@/lib/economy/sources";
import type { CrossingRow, PortStats } from "@/lib/economy/features";
import { provenance, type Provenance } from "@/lib/provenance/types";
import { source, type SourceId } from "@/lib/provenance/sources";
import type { Frequency, Point, Series, SeriesMeta } from "@/lib/series/types";
import type { Indicator } from "./types";
import { indicatorSeriesId } from "./types";

const H = 3600_000;
const DAY = 86_400_000;

/** Parse "YYYY-MM-DD", "YYYY-MM", "YYYY" or a full ISO time to epoch ms (UTC). Null when it is none of those. */
export function dateMs(s: string): number | null {
  if (/^\d{4}$/.test(s)) return Date.UTC(Number(s), 0, 1);
  if (/^\d{4}-\d{2}$/.test(s)) return Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, 1);
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + "T00:00:00Z" : s);
  return Number.isFinite(t) ? t : null;
}

/** Points from [dateString, value] rows; rows with unparsable dates are dropped, sorted by time. */
export function pointsFromRows(rows: Array<[string, number]>): Point[] {
  const out: Point[] = [];
  for (const [d, v] of rows) {
    const t = dateMs(d);
    if (t == null || !Number.isFinite(v)) continue;
    out.push({ t, v });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Series metadata for an indicator with a given provenance. */
export function metaFor(ind: Pick<Indicator, "id" | "title" | "unit" | "cadence" | "geo" | "category">, prov: Provenance): SeriesMeta {
  return { id: indicatorSeriesId(ind.id), title: ind.title, unit: ind.unit, frequency: ind.cadence, geo: ind.geo, provenance: prov, tags: [ind.category, "indicator"] };
}

// ---------------------------------------------------------------- FRED / BTS pulse items

/** A PulseItem (fred(), btsIndicators()) as a Series. */
export function seriesFromPulse(ind: Indicator, item: PulseItem, opts: { sourceId: SourceId; upstreamUrl?: string; retrievedAt?: string }): Series {
  const prov = provenance(source(opts.sourceId), {
    seriesId: ind.seriesId,
    upstreamUrl: opts.upstreamUrl,
    period: item.date,
    kind: "published",
    retrievedAt: opts.retrievedAt,
    notes: item.source ? [`upstream label: ${item.source}`] : undefined,
  });
  return { ...metaFor(ind, prov), points: pointsFromRows(item.series) };
}

// ---------------------------------------------------------------- BTS border crossings

/** Find one port of entry by BTS port code, falling back to a name + state match. */
export function findCrossing(rows: CrossingRow[], code: string, name: RegExp, state: string): CrossingRow | undefined {
  return rows.find((r) => r.code === code) ?? rows.find((r) => name.test(r.name) && r.state === state);
}

/** Monthly counts of one measure at one crossing as a Series. */
export function seriesFromCrossing(ind: Indicator, row: CrossingRow, measure: string, retrievedAt?: string): Series {
  const m = row.measures[measure];
  const prov = provenance(source("bts-border"), {
    seriesId: ind.seriesId,
    upstreamUrl: "https://data.bts.gov/resource/keg4-3bc2.json",
    period: m?.latestDate,
    kind: "published",
    retrievedAt,
    notes: ["Monthly sum of BTS daily port-level counts; the latest month may be revised."],
  });
  return { ...metaFor(ind, prov), points: pointsFromRows(m?.series ?? []) };
}

// ---------------------------------------------------------------- BTS port statistics

/** Sum annual container TEU across ports, keeping only years every port reported. */
export function sumContainerSeries(stats: PortStats[]): Array<[string, number]> {
  if (!stats.length) return [];
  const byYear = new Map<number, number[]>();
  for (const s of stats) {
    for (const [y, v] of s.container?.series ?? []) {
      const arr = byYear.get(y) ?? [];
      arr.push(v);
      byYear.set(y, arr);
    }
  }
  return [...byYear.entries()]
    .filter(([, vs]) => vs.length === stats.length)
    .sort((a, b) => a[0] - b[0])
    .map(([y, vs]) => [String(y), vs.reduce((a, b) => a + b, 0)]);
}

/** Combined annual container TEU of several BTS ports as a Series (an estimate: the sum is ours). */
export function seriesFromPorts(ind: Indicator, stats: PortStats[], retrievedAt?: string): Series {
  const rows = sumContainerSeries(stats);
  const prov = provenance(source("bts-ports"), {
    seriesId: ind.seriesId,
    upstreamUrl: "https://data.bts.gov/resource/5rpz-kgm9.json",
    period: rows.length ? rows[rows.length - 1][0] : undefined,
    kind: "estimate",
    retrievedAt,
    method: `sum of BTS Port Performance container TEU (TOTAL) for ports ${stats.map((s) => s.portId).join(" + ")} by reporting year`,
  });
  return { ...metaFor(ind, prov), points: pointsFromRows(rows) };
}

// ---------------------------------------------------------------- USGS daily values

const USGS = "https://api.waterdata.usgs.gov/ogcapi/v0/collections";

/** One feature of the USGS OGC "daily" collection. Same shape /api/water?op=history reads. */
export interface UsgsDailyFeature {
  properties: {
    monitoring_location_id: string;
    parameter_code: string;
    statistic_id?: string;
    time: string;
    value: string | null;
    unit_of_measure?: string;
    approval_status?: string;
  };
}

/** Daily-mean (statistic 00003) rows from a USGS daily-values response, [date, value] oldest first. */
export function parseUsgsDaily(features: UsgsDailyFeature[], statistic = "00003"): { rows: Array<[string, number]>; unit?: string; approval?: string } {
  const rows: Array<[string, number]> = [];
  let unit: string | undefined;
  let approval: string | undefined;
  for (const f of features) {
    const p = f.properties;
    if (p.value == null || (p.statistic_id ?? "00003") !== statistic) continue;
    const v = Number(p.value);
    if (!Number.isFinite(v)) continue;
    rows.push([p.time.slice(0, 10), v]);
    unit = unit ?? p.unit_of_measure;
    approval = p.approval_status ?? approval;
  }
  return { rows: rows.sort((a, b) => (a[0] < b[0] ? -1 : 1)), unit, approval };
}

/**
 * USGS daily values for one site and parameter over the last `days` days,
 * cached for an hour (the daily collection updates once a day).
 */
export function usgsDaily(site: string, param: string, now: number, days = 400): Promise<{ rows: Array<[string, number]>; unit?: string; approval?: string; url: string }> {
  const to = new Date(now).toISOString().slice(0, 10);
  const from = new Date(now - days * DAY).toISOString().slice(0, 10);
  const qs = new URLSearchParams({ f: "json", limit: "5000", monitoring_location_id: site, parameter_code: param, datetime: `${from}/${to}` });
  const url = `${USGS}/daily/items?${qs}`;
  return cached(`indicator:usgs:${site}:${param}:${to}`, 1 * H, async () => {
    const j = await polite("usgs-water", 400, 30_000, () => upstreamJson<{ features: UsgsDailyFeature[] }>("usgs-water", url, { timeoutMs: 40_000 }));
    return { ...parseUsgsDaily(j.features ?? []), url };
  }).then((c) => c.value);
}

/** A USGS gauge parameter as a Series. */
export async function seriesFromUsgs(ind: Indicator, site: string, param: string, now: number): Promise<Series> {
  const r = await usgsDaily(site, param, now);
  const prov = provenance(source("usgs-water"), {
    seriesId: ind.seriesId,
    upstreamUrl: r.url,
    period: r.rows.length ? r.rows[r.rows.length - 1][0] : undefined,
    kind: "published",
    revision: r.approval,
    notes: ["Daily mean (USGS statistic 00003). Recent days are provisional until USGS approves them."],
  });
  return { ...metaFor(ind, prov), points: pointsFromRows(r.rows) };
}

// ---------------------------------------------------------------- TWDB statewide storage

const TWDB_STATEWIDE_CSV = "https://www.waterdatafortexas.org/reservoirs/statewide.csv";
const TWDB_RECENT_JSON = "https://www.waterdatafortexas.org/reservoirs/recent-conditions.json";

/**
 * Statewide CSV: a comment preamble, then a header row with at least
 * `date` and `percent_full` columns (also conservation_storage and
 * conservation_capacity), one row per day.
 * shape per https://www.waterdatafortexas.org/reservoirs/statewide; unverified in sandbox
 */
export function parseTwdbStatewideCsv(csv: string): Array<[string, number]> {
  const lines = parseCsv(csv).filter((r) => r.length && !r[0].startsWith("#"));
  const header = lines.findIndex((r) => r.some((c) => c.trim().toLowerCase() === "percent_full"));
  if (header < 0) return [];
  const cols = lines[header].map((c) => c.trim().toLowerCase());
  const di = cols.indexOf("date");
  const pi = cols.indexOf("percent_full");
  if (di < 0) return [];
  const out: Array<[string, number]> = [];
  for (const r of lines.slice(header + 1)) {
    const v = cellNum(r[pi]);
    const d = (r[di] ?? "").trim().slice(0, 10);
    if (v == null || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    out.push([d, v]);
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** The subset of a TWDB recent-conditions record the fallback needs. */
export interface TwdbRecent {
  short_name: string;
  conservation_capacity: number | null;
  conservation_storage: number | null;
  timestamp?: string;
  tags?: string[];
}

/**
 * Statewide percent full from the recent-conditions list: total storage over
 * total capacity of every reservoir that reports both. An estimate, and not
 * exactly TWDB's statewide figure (they weight by the same totals but over a
 * curated list), so it is labelled as such.
 */
export function statewideFromRecent(list: TwdbRecent[]): { pct: number; date: string; n: number; storage: number; capacity: number } | null {
  let storage = 0;
  let capacity = 0;
  let n = 0;
  let date = "";
  for (const r of list) {
    if (r.conservation_storage == null || r.conservation_capacity == null || r.conservation_capacity <= 0) continue;
    storage += r.conservation_storage;
    capacity += r.conservation_capacity;
    n++;
    const d = (r.timestamp ?? "").slice(0, 10);
    if (d > date) date = d;
  }
  if (!n || capacity <= 0) return null;
  return { pct: (storage / capacity) * 100, date: date || new Date().toISOString().slice(0, 10), n, storage, capacity };
}

/** Texas statewide reservoir storage, percent of conservation capacity. */
export function twdbStatewide(ind: Indicator, now: number): Promise<Series> {
  const day = new Date(now).toISOString().slice(0, 10);
  return cached(`indicator:twdb:statewide:${day}`, 6 * H, async () => {
    try {
      const res = await polite("twdb", 500, 60_000, () => upstream("twdb", TWDB_STATEWIDE_CSV, { timeoutMs: 30_000, headers: { accept: "text/csv,*/*" } }));
      const rows = parseTwdbStatewideCsv(await res.text()).slice(-400);
      if (!rows.length) throw new Error("twdb statewide csv: no rows");
      const prov = provenance(source("twdb"), {
        seriesId: ind.seriesId,
        upstreamUrl: TWDB_STATEWIDE_CSV,
        period: rows[rows.length - 1][0],
        kind: "published",
        notes: ["TWDB statewide figure: storage of the monitored reservoirs as a share of their combined conservation capacity."],
      });
      return { ...metaFor(ind, prov), points: pointsFromRows(rows) };
    } catch (err) {
      // Fall back to the list the water layer already reads and sum it ourselves.
      const json = await upstreamJson<TwdbRecent[] | Record<string, TwdbRecent>>("twdb", TWDB_RECENT_JSON, { timeoutMs: 30_000 });
      const list = Array.isArray(json) ? json : Object.values(json);
      const s = statewideFromRecent(list);
      if (!s) throw err instanceof Error ? err : new Error("twdb: no statewide data");
      const prov = provenance(source("twdb"), {
        seriesId: ind.seriesId,
        upstreamUrl: TWDB_RECENT_JSON,
        period: s.date,
        kind: "estimate",
        method: `sum(conservation_storage) / sum(conservation_capacity) over ${s.n} reservoirs in recent-conditions.json = ${s.storage.toFixed(0)} / ${s.capacity.toFixed(0)} acre-feet`,
        notes: [`Statewide CSV unavailable (${err instanceof Error ? err.message.slice(0, 80) : "error"}); computed from the per-reservoir list instead.`],
      });
      return { ...metaFor(ind, prov), points: [{ t: dateMs(s.date) ?? now, v: s.pct }] };
    }
  }).then((c) => c.value);
}

/** Cache TTL for a cadence: about a tenth of the publication interval, floored at an hour and capped at a day. */
export function ttlForCadence(freq: Frequency): number {
  switch (freq) {
    case "5min":
    case "hourly":
    case "irregular":
    case "daily":
      return 1 * H;
    case "weekly":
      return 3 * H;
    case "monthly":
    case "quarterly":
      return 6 * H;
    case "annual":
      return 24 * H;
  }
}
