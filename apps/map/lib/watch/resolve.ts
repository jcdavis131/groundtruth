// Resolvers turn a WatchItem into numbers with provenance. One resolver per
// item kind, kept in a registry so the next kind (company, when
// lib/companies lands) is registered rather than wired in.
//
// Everything upstream is injected through `Fetchers`, so this module never
// touches the network itself: the route composes it with lib/watch/fetchers
// (real sources), the tests with fixtures.
//
// A resolver never invents a value: a suppressed QCEW cell is null, a port
// without BTS statistics publishes no volume metrics, a missing series is a
// resolve failure with a sentence saying so.

import type { Provenance } from "@/lib/provenance/types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import type { Series } from "@/lib/series/types";
import type { HomeValue, JobsRow, PortStats, WpiPort, CrossingRow, VolumeStat } from "@/lib/economy/features";
import type { QcewTable, ZillowTable } from "@/lib/economy/sources";
import { itemLabel, windowMs, type RuleWindow, type WatchItem, type WatchKind } from "./model";

// ---------------------------------------------------------------- contracts

/** One latest-continuous reading for a site, already parsed (see lib/watch/fetchers). */
export interface GaugeLatest {
  param: string;
  value: number;
  unit: string;
  time: string;
  lon?: number;
  lat?: number;
  name?: string;
  upstreamUrl?: string;
}

/** Upstream access a resolver may use. Route handlers pass the real thing; tests pass fixtures. */
export interface Fetchers {
  zillow(kind: "zhviCounty" | "zhviState" | "zoriCounty"): Promise<ZillowTable>;
  qcewLatest(): Promise<QcewTable>;
  stateLookup(): Promise<Map<string, { stusab: string; name: string }>>;
  btsPortStats(): Promise<{ byWpi: Map<number, PortStats>; extraPorts: Array<{ port: WpiPort; stats: PortStats }>; year: number }>;
  /** World Port Index entry by id, from the bundled table (sync). */
  wpiPort(id: number): WpiPort | undefined;
  borderCrossings(): Promise<{ asOf: string; rows: CrossingRow[] }>;
  usgsLatest(site: string): Promise<GaugeLatest[]>;
  seriesGet(id: string): Promise<Series | null>;
}

export interface ResolveContext {
  /** Origin for globe permalinks, e.g. "https://embedding-atlas.example". */
  origin: string;
  /** Epoch ms "now" (injectable for tests). */
  now: number;
  /** Lookback used for `previous` / `change*` metrics on series-like items. */
  window?: RuleWindow;
  fetchers: Fetchers;
}

export interface Resolved {
  ok: true;
  kind: WatchKind;
  id: string;
  name: string;
  /** Metric id -> value; null when the upstream withheld the cell. */
  metrics: Record<string, number | null>;
  /** Same metric ids, value one window ago, when the resolver can look back. */
  previous?: Record<string, number | null>;
  /** ISO date / period the metrics describe. */
  asOf: string;
  provenance: Provenance[];
  /** Globe permalink. */
  link: string;
  geo?: [number, number];
  notes?: string[];
}

export interface ResolveFailure {
  ok: false;
  kind: WatchKind;
  id: string;
  name: string;
  error: string;
  link: string;
  geo?: [number, number];
}

export type ResolveResult = Resolved | ResolveFailure;

export type Resolver = (item: WatchItem, ctx: ResolveContext) => Promise<Resolved>;

const registry = new Map<WatchKind, Resolver>();

/** Register (or replace) the resolver for a kind. lib/companies registers "company" this way. */
export function registerResolver(kind: WatchKind, fn: Resolver): void {
  registry.set(kind, fn);
}

export function getResolver(kind: WatchKind): Resolver | undefined {
  return registry.get(kind);
}

// ---------------------------------------------------------------- links

/** Globe permalink in the shape lib/globe/share.ts writes: ?lat=&lon=&h=&layers=&sel=. */
export function globeLink(origin: string, opts: { geo?: [number, number]; h?: number; layers?: string[]; sel?: string }): string {
  const q = new URLSearchParams();
  if (opts.geo) {
    q.set("lat", opts.geo[1].toFixed(4));
    q.set("lon", opts.geo[0].toFixed(4));
    q.set("h", String(Math.round(opts.h ?? 120_000)));
  }
  if (opts.layers?.length) q.set("layers", opts.layers.join(","));
  if (opts.sel) q.set("sel", opts.sel);
  const s = q.toString();
  return `${origin.replace(/\/$/, "")}/${s ? "?" + s : ""}`;
}

const LINK_FOR: Record<WatchKind, (id: string) => { layers: string[]; sel?: string; h: number }> = {
  county: (id) => ({ layers: ["realestate", "commerce"], sel: `realestate:county:${id}`, h: 150_000 }),
  state: (id) => ({ layers: ["realestate", "commerce"], sel: `realestate:state:${id}`, h: 1_500_000 }),
  port: (id) => ({ layers: ["trade"], sel: `trade:port:${id}`, h: 60_000 }),
  crossing: (id) => ({ layers: ["trade"], sel: `trade:crossing:${id}`, h: 40_000 }),
  gauge: (id) => ({ layers: ["water"], sel: `water:usgs:${id}`, h: 30_000 }),
  series: () => ({ layers: [], h: 200_000 }),
  indicator: () => ({ layers: [], h: 200_000 }),
  company: (id) => ({ layers: ["companies"], sel: `companies:${id}`, h: 40_000 }),
};

export function linkFor(item: WatchItem, origin: string, geo?: [number, number]): string {
  const l = LINK_FOR[item.kind](bareId(item.kind, item.id));
  return globeLink(origin, { geo: geo ?? item.geo, h: l.h, layers: l.layers, sel: l.sel });
}

// ---------------------------------------------------------------- helpers

function homeMetrics(h: HomeValue | undefined, prefix: "home" | "rent", out: Record<string, number | null>) {
  if (!h) return;
  out[`${prefix}.latest`] = h.latest;
  out[`${prefix}.yoyPct`] = h.yoyPct;
  out[`${prefix}.y5Pct`] = h.y5Pct;
}

function jobsMetrics(j: JobsRow | undefined, out: Record<string, number | null>) {
  if (!j) return;
  out["jobs.emp"] = j.emp;
  out["jobs.estabs"] = j.estabs;
  out["jobs.wages"] = j.wages;
  out["jobs.avgWeeklyWage"] = j.avgWeeklyWage;
  out["jobs.yoy.emp"] = j.yoy.emp;
  out["jobs.yoy.estabs"] = j.yoy.estabs;
  out["jobs.yoy.wages"] = j.yoy.wages;
  out["jobs.yoy.avgWeeklyWage"] = j.yoy.avgWeeklyWage;
}

function volumeMetrics(v: VolumeStat | undefined, prefix: string, out: Record<string, number | null>) {
  if (!v) return;
  out[`${prefix}.total`] = v.total;
  out[`${prefix}.pctChange`] = v.pctChange;
  out[`${prefix}.ranking`] = v.ranking;
  out[`${prefix}.imports`] = v.imports;
  out[`${prefix}.exports`] = v.exports;
}

/** "Personal Vehicle Passengers" -> "personalVehiclePassengers". */
export function measureKey(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
}

/** USGS parameter codes to the short metric ids the panel offers. */
export const GAUGE_PARAM_METRIC: Record<string, string> = {
  "00065": "stage",
  "00060": "flow",
  "00010": "temp",
  "00300": "do",
  "00095": "conductance",
  "00400": "ph",
  "63680": "turbidity",
  "00062": "elevation",
  "00054": "storage",
};

/** Strip a layer-style prefix the globe uses ("port:123", "usgs:USGS-1") so a selection id works as an item id. */
export function bareId(kind: WatchKind, id: string): string {
  const prefixes: Partial<Record<WatchKind, string[]>> = {
    port: ["port:"],
    crossing: ["crossing:"],
    gauge: ["usgs:"],
    county: ["county:"],
    state: ["state:"],
    indicator: ["indicator:"],
  };
  for (const p of prefixes[kind] ?? []) if (id.startsWith(p)) return id.slice(p.length);
  return id;
}

/**
 * Latest non-null point, and the latest non-null point at least `win` ms
 * older than it (the "one window ago" reference). Points newer than `now`
 * are ignored so a replayed clock reads the past honestly.
 */
export function latestAndPrevious(points: Series["points"], now: number, win: number): { latest?: { t: number; v: number }; previous?: { t: number; v: number } } {
  let latest: { t: number; v: number } | undefined;
  let previous: { t: number; v: number } | undefined;
  for (const p of points) {
    if (p.v == null || !Number.isFinite(p.v) || p.t > now) continue;
    if (!latest || p.t >= latest.t) latest = { t: p.t, v: p.v };
  }
  if (!latest) return {};
  const ref = latest.t - win;
  for (const p of points) {
    if (p.v == null || !Number.isFinite(p.v) || p.t > ref) continue;
    if (!previous || p.t >= previous.t) previous = { t: p.t, v: p.v };
  }
  return { latest, previous };
}

// ---------------------------------------------------------------- resolvers

async function resolveArea(item: WatchItem, ctx: ResolveContext): Promise<Resolved> {
  const f = ctx.fetchers;
  const isCounty = item.kind === "county";
  const id = bareId(item.kind, item.id);
  if (isCounty ? !/^\d{5}$/.test(id) : !/^\d{2}$/.test(id)) throw new Error(`${item.kind} id must be ${isCounty ? "a 5-digit county GEOID" : "a 2-digit state FIPS"}`);
  const [home, rent, qcew, states] = await Promise.all([
    f.zillow(isCounty ? "zhviCounty" : "zhviState").catch(() => null),
    isCounty ? f.zillow("zoriCounty").catch(() => null) : Promise.resolve(null),
    f.qcewLatest().catch(() => null),
    f.stateLookup().catch(() => null),
  ]);
  const state = states?.get(id.slice(0, 2));
  const h = isCounty ? home?.rows.get(id) : state ? home?.byName.get(state.name) : undefined;
  const r = rent?.rows.get(id);
  const j = isCounty ? qcew?.counties.get(id) : qcew?.states.get(id);
  if (!h && !j) throw new Error(`no Zillow or QCEW row for ${item.kind} ${id}` + (!home && !qcew ? " (both upstreams failed)" : ""));
  const metrics: Record<string, number | null> = {};
  const prov: Provenance[] = [];
  const notes: string[] = [];
  homeMetrics(h, "home", metrics);
  homeMetrics(r, "rent", metrics);
  jobsMetrics(j, metrics);
  if (h) prov.push(provenance(source("zillow-zhvi"), { kind: "published", period: h.asOf, seriesId: isCounty ? `county:${id}` : `state:${h.name}` }));
  if (r) prov.push(provenance(source("zillow-zori"), { kind: "published", period: r.asOf, seriesId: `county:${id}` }));
  if (j) {
    prov.push(provenance(source("bls-qcew"), { kind: "published", period: j.period, seriesId: j.area, notes: j.suppressed ? ["cell withheld by BLS (disclosure code N)"] : undefined }));
    if (j.suppressed) notes.push("BLS withheld this area's employment cell; jobs metrics are null.");
  }
  if (h && r && r.latest > 0) {
    metrics.priceToRent = h.latest / (r.latest * 12);
    prov.push(provenance(source("zillow-zhvi"), { kind: "estimate", method: "ZHVI / (ZORI x 12)", period: h.asOf }));
  }
  const name = item.name ?? (h ? (isCounty && state ? `${h.name}, ${state.stusab}` : h.name) : isCounty ? `county ${id}` : (state?.name ?? `state ${id}`));
  const asOf = h?.asOf ?? j?.period ?? "";
  return { ok: true, kind: item.kind, id, name, metrics, asOf, provenance: prov, link: linkFor(item, ctx.origin), geo: item.geo, notes: notes.length ? notes : undefined };
}

async function resolvePort(item: WatchItem, ctx: ResolveContext): Promise<Resolved> {
  const f = ctx.fetchers;
  const id = bareId("port", item.id);
  const wpiId = Number(id);
  if (!Number.isInteger(wpiId) || wpiId <= 0) throw new Error("port id must be a World Port Index number");
  const wpi = f.wpiPort(wpiId);
  const stats = await f.btsPortStats().catch(() => null);
  const s = stats?.byWpi.get(wpiId) ?? stats?.extraPorts.find((x) => x.port.id === wpiId)?.stats;
  const port = wpi ?? stats?.extraPorts.find((x) => x.port.id === wpiId)?.port;
  if (!port) throw new Error(`no World Port Index entry ${wpiId}`);
  const metrics: Record<string, number | null> = {};
  const prov: Provenance[] = [provenance(source("nga-wpi"), { kind: "published", seriesId: String(wpiId) })];
  const notes: string[] = [];
  if (s) {
    volumeMetrics(s.container, "container", metrics);
    volumeMetrics(s.tonnage, "tonnage", metrics);
    volumeMetrics(s.dryBulk, "dryBulk", metrics);
    prov.push(provenance(source("bts-ports"), { kind: "published", period: String(s.year), seriesId: s.portId }));
  } else notes.push(stats ? "BTS publishes no Port Performance statistics for this harbour; only the World Port Index describes it." : "BTS Port Performance did not answer; volumes unavailable this run.");
  const geo: [number, number] = item.geo ?? [port.lon, port.lat];
  return { ok: true, kind: "port", id, name: item.name ?? port.name, metrics, asOf: s ? String(s.year) : "", provenance: prov, link: linkFor(item, ctx.origin, geo), geo, notes: notes.length ? notes : undefined };
}

async function resolveCrossing(item: WatchItem, ctx: ResolveContext): Promise<Resolved> {
  const id = bareId("crossing", item.id);
  if (!/^\d{3,6}$/.test(id)) throw new Error("crossing id must be a BTS port code (digits)");
  const b = await ctx.fetchers.borderCrossings();
  const row = b.rows.find((r) => r.code === id);
  if (!row) throw new Error(`no BTS border crossing with port code ${id}`);
  const metrics: Record<string, number | null> = {};
  for (const [measure, m] of Object.entries(row.measures)) {
    const k = measureKey(measure);
    metrics[`${k}.latest`] = m.latest;
    metrics[`${k}.yoyPct`] = m.yoyPct;
  }
  const geo: [number, number] = item.geo ?? [row.lon, row.lat];
  return {
    ok: true,
    kind: "crossing",
    id,
    name: item.name ?? `${row.name}, ${row.state}`,
    metrics,
    asOf: row.asOf,
    provenance: [provenance(source("bts-border"), { kind: "published", period: row.asOf, seriesId: row.code })],
    link: linkFor(item, ctx.origin, geo),
    geo,
  };
}

async function resolveGauge(item: WatchItem, ctx: ResolveContext): Promise<Resolved> {
  const id = bareId("gauge", item.id);
  if (!/^[A-Z]{2,6}-[A-Za-z0-9]{4,20}$/.test(id)) throw new Error('gauge id must be a USGS monitoring location id such as "USGS-08180800"');
  const rows = await ctx.fetchers.usgsLatest(id);
  if (!rows.length) throw new Error(`USGS has no latest continuous readings for ${id}`);
  const metrics: Record<string, number | null> = {};
  let asOf = "";
  let geo = item.geo;
  let name = item.name;
  for (const r of rows) {
    metrics[`p${r.param}`] = r.value;
    const short = GAUGE_PARAM_METRIC[r.param];
    if (short) metrics[short] = r.value;
    if (r.time > asOf) asOf = r.time;
    if (!geo && r.lon != null && r.lat != null) geo = [r.lon, r.lat];
    if (!name && r.name) name = r.name;
  }
  return {
    ok: true,
    kind: "gauge",
    id,
    name: name ?? id,
    metrics,
    asOf,
    provenance: [provenance(source("usgs-water"), { kind: "published", seriesId: id, period: asOf, upstreamUrl: rows[0].upstreamUrl })],
    link: linkFor(item, ctx.origin, geo),
    geo,
  };
}

function seriesResolver(kind: "series" | "indicator"): Resolver {
  return async (item, ctx) => {
    const id = kind === "indicator" ? `indicator:${bareId("indicator", item.id)}` : item.id;
    const s = await ctx.fetchers.seriesGet(id);
    if (!s) {
      throw new Error(kind === "indicator" ? `indicator ${item.id} has not been computed yet (no "${id}" series in the store)` : `no series "${id}" in the store`);
    }
    const win = windowMs(ctx.window);
    const { latest, previous } = latestAndPrevious(s.points, ctx.now, win);
    if (!latest) throw new Error(`series "${id}" has no published points`);
    const metrics: Record<string, number | null> = { value: latest.v, previous: previous?.v ?? null, change: previous ? latest.v - previous.v : null, changePct: previous && previous.v !== 0 ? ((latest.v - previous.v) / Math.abs(previous.v)) * 100 : null };
    const prev: Record<string, number | null> | undefined = previous ? { value: previous.v } : undefined;
    const geo = item.geo ?? (s.geo?.lon != null && s.geo?.lat != null ? ([s.geo.lon, s.geo.lat] as [number, number]) : undefined);
    const notes: string[] = [];
    if (!previous) notes.push(`no point ${ctx.window ?? "7d"} before the latest; change metrics are null.`);
    return {
      ok: true,
      kind,
      id: item.id,
      name: item.name ?? s.title,
      metrics,
      previous: prev,
      asOf: new Date(latest.t).toISOString(),
      provenance: [{ ...s.provenance, seriesId: s.provenance.seriesId ?? s.id, period: new Date(latest.t).toISOString().slice(0, 10) }],
      link: linkFor(item, ctx.origin, geo),
      geo,
      notes: notes.length ? notes : undefined,
    };
  };
}

/** Placeholder until lib/companies registers the real resolver via registerResolver("company", fn). */
const resolveCompanyStub: Resolver = async (item, ctx) => {
  throw new Error(`company ${itemLabel(item)}: not resolved yet (no company resolver registered; origin ${ctx.origin})`);
};

registerResolver("county", resolveArea);
registerResolver("state", resolveArea);
registerResolver("port", resolvePort);
registerResolver("crossing", resolveCrossing);
registerResolver("gauge", resolveGauge);
registerResolver("series", seriesResolver("series"));
registerResolver("indicator", seriesResolver("indicator"));
if (!registry.has("company")) registerResolver("company", resolveCompanyStub);

// ---------------------------------------------------------------- entry points

/** Resolve one item; failures become a ResolveFailure, never a throw. */
export async function resolveItem(item: WatchItem, ctx: ResolveContext): Promise<ResolveResult> {
  const fn = registry.get(item.kind);
  const fail = (error: string): ResolveFailure => ({ ok: false, kind: item.kind, id: item.id, name: itemLabel(item), error, link: linkFor(item, ctx.origin), geo: item.geo });
  if (!fn) return fail(`no resolver registered for kind "${item.kind}"`);
  try {
    return await fn(item, ctx);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/** Resolve every item, in order, with a concurrency cap so a long list stays polite. */
export async function resolveAll(items: WatchItem[], ctx: ResolveContext, concurrency = 4): Promise<ResolveResult[]> {
  const out: ResolveResult[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await resolveItem(items[i], ctx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

/** Every distinct provenance record across results (by source id + seriesId + period + kind). */
export function collectProvenance(results: ResolveResult[]): Provenance[] {
  const seen = new Map<string, Provenance>();
  for (const r of results) {
    if (!r.ok) continue;
    for (const p of r.provenance) {
      const k = `${p.source.id}|${p.seriesId ?? ""}|${p.period ?? ""}|${p.kind}|${p.method ?? ""}`;
      if (!seen.has(k)) seen.set(k, p);
    }
  }
  return [...seen.values()];
}
