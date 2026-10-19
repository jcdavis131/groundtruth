// Releases API: when the tables the app relays change, which release is
// loaded now, and what moved since the last one. CORS open and edge-cached
// like /api/economy so a notebook can call it.
//
//   /api/releases?op=calendar[&from=YYYY-MM-DD&to=YYYY-MM-DD]
//       release windows in the range (default: the next 30 days), sorted;
//       every window says whether it is official or approximate and links the
//       publisher's schedule page when there is one
//   /api/releases?op=vintages
//       the current vintage of every loaded upstream table: period, inferred
//       release window, when we read it
//   /api/releases?op=movers&table=zillow|qcew|border|ports[&metric=..][&n=20][&min=0][&format=csv]
//       top N up / down since the previous release, arithmetic over published values
//
// Every response is an Enveloped<T> (lib/provenance/types.ts). Cached 1 h;
// the underlying tables are cached for hours by lib/economy/sources.ts and
// only refetched from upstream when their own TTL runs out.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError, num } from "@/lib/server/upstream";
import type { Enveloped, Provenance } from "@/lib/provenance/types";
import { provenance } from "@/lib/provenance/types";
import { source } from "@/lib/provenance/sources";
import { borderCrossings, btsIndicators, btsPortStats, fred, FRED_SERIES, qcewLatest, WPI, zillow, type ZillowKind } from "@/lib/economy/sources";
import type { PortStats } from "@/lib/economy/features";
import { isoDate, upcomingReleases, utcDay, type ReleaseOccurrence } from "@/lib/releases/calendar";
import { describeVintages, type VintageInputs, type VintageRecord } from "@/lib/releases/vintage";
import {
  borderMovers,
  MOVER_TABLES,
  moversCsv,
  PORT_METRICS,
  portMovers,
  QCEW_METRICS,
  qcewMovers,
  zillowMovers,
  type MoverTable,
  type MoversResult,
  type PortMetric,
  type QcewMetric,
} from "@/lib/releases/movers";

export const maxDuration = 60;

const H = 3600_000;
const TTL_S = 3600;
const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function envelope<T>(data: T, prov: Provenance[], caveats: string[] = []): Enveloped<T> {
  return { data, provenance: prov, generatedAt: new Date().toISOString(), caveats: caveats.length ? caveats : undefined };
}

function respond(body: unknown, ttlS = TTL_S) {
  return NextResponse.json(body, {
    headers: { ...CORS, "cache-control": `public, max-age=0, s-maxage=${ttlS}, stale-while-revalidate=${ttlS}` },
  });
}

function respondText(text: string, filename: string, ttlS = TTL_S) {
  return new Response(text, {
    headers: {
      ...CORS,
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": `public, max-age=0, s-maxage=${ttlS}, stale-while-revalidate=${ttlS}`,
    },
  });
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: CORS });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// ---------------------------------------------------------------- calendar

function parseDay(raw: string | null): number | null {
  if (raw == null || raw === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return NaN;
  const ms = Date.parse(raw + "T00:00:00Z");
  return Number.isFinite(ms) && isoDate(ms) === raw ? ms : NaN;
}

function opCalendar(fromRaw: string | null, toRaw: string | null) {
  const today = utcDay(Date.now());
  const fromP = parseDay(fromRaw);
  const toP = parseDay(toRaw);
  if (Number.isNaN(fromP) || Number.isNaN(toP)) return bad("from and to must be real dates written YYYY-MM-DD");
  const from = fromP ?? today;
  let to = toP ?? from + 30 * DAY_MS;
  if (to < from) return bad("to must not be before from");
  if (to - from > MAX_RANGE_DAYS * DAY_MS) to = from + MAX_RANGE_DAYS * DAY_MS;
  const items: ReleaseOccurrence[] = upcomingReleases(from, to);
  const data = items.map((o) => ({
    id: o.entry.id,
    sourceId: o.entry.sourceId,
    seriesId: o.entry.seriesId,
    title: o.entry.title,
    cadence: o.entry.cadence,
    rule: o.entry.rule,
    precision: o.precision,
    window: o.window,
    scheduleUrl: o.entry.scheduleUrl,
    covers: o.entry.covers,
    notes: o.entry.notes,
  }));
  const seen = new Set<string>();
  const prov: Provenance[] = [];
  for (const o of items) {
    if (seen.has(o.entry.id)) continue;
    seen.add(o.entry.id);
    prov.push(
      provenance(source(o.entry.sourceId), {
        kind: "estimate",
        seriesId: o.entry.seriesId,
        upstreamUrl: o.entry.scheduleUrl,
        method: `release window from the rule "${o.entry.rule}" (${o.precision}); the publisher's schedule page is the authority`,
      }),
    );
  }
  return respond(
    envelope({ from: isoDate(from), to: isoDate(to), count: data.length, releases: data }, prov, [
      "Approximate windows are inferred from each publisher's usual cadence, not read from a schedule; official ones follow a posted cadence but can still move around holidays.",
    ]),
  );
}

// ---------------------------------------------------------------- vintages

const VINTAGE_ZILLOW: ZillowKind[] = ["zhviCounty", "zoriCounty", "zhviMetro"];

async function vintageInputs(): Promise<{ inputs: VintageInputs; failed: string[] }> {
  const failed: string[] = [];
  const stamp = () => new Date().toISOString();
  const [zillows, q, b, p, freds, bts] = await Promise.all([
    Promise.allSettled(VINTAGE_ZILLOW.map((k) => zillow(k))),
    qcewLatest().catch(() => null),
    borderCrossings().catch(() => null),
    btsPortStats().catch(() => null),
    Promise.allSettled(FRED_SERIES.map((s) => fred(s.id))),
    btsIndicators().catch(() => null),
  ]);
  const inputs: VintageInputs = { now: stamp() };
  inputs.zillow = [];
  zillows.forEach((r, i) => {
    if (r.status === "fulfilled") inputs.zillow!.push({ kind: VINTAGE_ZILLOW[i], asOf: r.value.asOf, rows: r.value.rows.size, retrievedAt: stamp() });
    else failed.push(`zillow:${VINTAGE_ZILLOW[i]}`);
  });
  if (q) inputs.qcew = { period: q.period, year: q.year, qtr: q.qtr, counties: q.counties.size, retrievedAt: stamp() };
  else failed.push("bls-qcew");
  if (b) inputs.border = { asOf: b.asOf, ports: b.rows.length, retrievedAt: stamp() };
  else failed.push("bts-border");
  if (p) inputs.ports = { year: p.year, ports: p.byWpi.size + p.extraPorts.length, retrievedAt: stamp() };
  else failed.push("bts-ports");
  inputs.fred = [];
  freds.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) inputs.fred!.push({ id: r.value.id, date: r.value.date, label: r.value.label, retrievedAt: stamp() });
    else failed.push(`fred:${FRED_SERIES[i].id}`);
  });
  if (bts) inputs.btsIndicators = bts.map((i) => ({ id: i.id, date: i.date, label: i.label, retrievedAt: stamp() }));
  else failed.push("bts-supply-chain");
  // USDM: the water route reads a feature service that returns only the class,
  // so the map date is inferred from the Thursday cycle; no fetch from here.
  inputs.usdm = { retrievedAt: stamp() };
  return { inputs, failed };
}

async function opVintages() {
  const r = await cached("releases:vintages", 1 * H, async () => {
    const { inputs, failed } = await vintageInputs();
    return { records: describeVintages(inputs), failed };
  });
  const prov: Provenance[] = r.value.records.map((v: VintageRecord) =>
    provenance(source(v.sourceId as Parameters<typeof source>[0]), {
      kind: "published",
      seriesId: v.seriesId,
      period: v.period ?? undefined,
      releasedAt: v.releasedAt,
      retrievedAt: v.retrievedAt,
      notes: v.releaseWindow ? [`release window ${v.releaseWindow.earliest}..${v.releaseWindow.latest} (${v.basis}, ${v.precision})`] : undefined,
    }),
  );
  const caveats = [
    "retrievedAt is when this server last read the table from its in-memory cache; the upstream fetch can be up to the table's own TTL (1 to 24 h) older.",
    "Release windows with basis 'rule' are inferred from the release calendar, not read from the publisher.",
  ];
  if (r.value.failed.length) caveats.push(`Tables that did not answer: ${r.value.failed.join(", ")}.`);
  return respond(envelope({ count: r.value.records.length, vintages: r.value.records, failed: r.value.failed, cacheAge: r.age }, prov, caveats));
}

// ---------------------------------------------------------------- movers

async function computeMovers(table: MoverTable, metric: string, n: number, min: number): Promise<MoversResult> {
  const retrievedAt = new Date().toISOString();
  switch (table) {
    case "zillow": {
      const kind: ZillowKind = metric === "zoriCounty" ? "zoriCounty" : "zhviCounty";
      const t = await zillow(kind);
      return zillowMovers({ kind, asOf: t.asOf, rows: t.rows.values() }, { n, minBefore: min, retrievedAt });
    }
    case "qcew": {
      const [q, z] = await Promise.all([qcewLatest(), zillow("zhviCounty").catch(() => null)]);
      const names = new Map<string, string>();
      if (z) for (const [geoid, h] of z.rows) names.set(geoid, h.state ? `${h.name}, ${h.state}` : h.name);
      return qcewMovers({ period: q.period, counties: q.counties.values() }, names, metric as QcewMetric, { n, minBefore: min, retrievedAt });
    }
    case "border": {
      const b = await borderCrossings();
      return borderMovers(b, metric, { n, minBefore: min, retrievedAt });
    }
    case "ports": {
      const p = await btsPortStats();
      const coords = new Map(WPI.ports.map((w) => [w.id, { lon: w.lon, lat: w.lat }]));
      const ports: Array<{ stats: PortStats; lon?: number; lat?: number }> = [];
      for (const [wpi, stats] of p.byWpi) ports.push({ stats, ...coords.get(wpi) });
      for (const x of p.extraPorts) ports.push({ stats: x.stats, lon: x.port.lon, lat: x.port.lat });
      return portMovers({ year: p.year, ports }, metric as PortMetric, { n, minBefore: min, retrievedAt });
    }
  }
}

const BORDER_MEASURES = ["Trucks", "Trains", "Buses", "Personal Vehicles", "Pedestrians", "Personal Vehicle Passengers", "Train Passengers", "Bus Passengers"];
const ZILLOW_METRICS = ["zhviCounty", "zoriCounty"];

function metricFor(table: MoverTable, raw: string | null): string | null {
  const allowed: readonly string[] = table === "zillow" ? ZILLOW_METRICS : table === "qcew" ? QCEW_METRICS : table === "border" ? BORDER_MEASURES : PORT_METRICS;
  if (raw == null || raw === "") return allowed[0];
  return allowed.includes(raw) ? raw : null;
}

async function opMovers(q: URLSearchParams) {
  const table = q.get("table") ?? "";
  if (!(MOVER_TABLES as string[]).includes(table)) return bad(`table must be one of ${MOVER_TABLES.join(" | ")}`);
  const metric = metricFor(table as MoverTable, q.get("metric"));
  if (!metric) return bad(`metric for ${table} must be one of the published measures (see docs/RELEASES.md)`);
  const n = Math.floor(num(q.get("n"), 20, 1, 200));
  const min = num(q.get("min"), 0, 0, 1e12);
  const key = `releases:movers:${table}:${metric}:${n}:${min}`;
  const r = await cached(key, 1 * H, () => computeMovers(table as MoverTable, metric, n, min));
  if (q.get("format") === "csv") return respondText(moversCsv(r.value), `movers-${table}-${metric}-${r.value.period.replace(/\s+/g, "")}.csv`);
  const caveats = [
    "before/after are published values; the differences are plain arithmetic (see provenance.method).",
    "Percent moves on small bases are noisy; pass min= to ignore rows whose previous value is below a floor.",
  ];
  if (table === "qcew") caveats.push("BLS publishes the over-the-year percent but not the year-earlier level in the newest file, so before and changeAbs are null.");
  return respond(envelope({ ...r.value, provenance: undefined, cacheAge: r.age }, [r.value.provenance], caveats));
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  try {
    switch (op) {
      case "calendar":
        return opCalendar(q.get("from"), q.get("to"));
      case "vintages":
        return await opVintages();
      case "movers":
        return await opMovers(q);
      default:
        return bad("unknown op: calendar | vintages | movers");
    }
  } catch (err) {
    const res = jsonError(err);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  }
}
