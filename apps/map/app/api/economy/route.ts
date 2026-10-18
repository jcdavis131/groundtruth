// Economy API: trade, commerce and real estate over public, keyless sources.
// CORS open and edge-cached like /api/water, so scripts and notebooks can use it.
//
//   /api/economy?op=areas&bbox=w,s,e,n        counties in the box joined with BLS QCEW
//                                             (jobs, wages) and Zillow (home values, rents)
//   /api/economy?op=areas&level=state         every state, same joins
//   /api/economy?op=sectors&fips=48029        private-sector NAICS mix for a county (or a
//                                             state: 48000), with location quotients
//   /api/economy?op=context&fips=48029        sector mix plus metro, state and US home values
//   /api/economy?op=msas                      every MSA: centroid, employment, most distinctive
//                                             occupation group (BLS OEWS, May 2025)
//   /api/economy?op=msa-jobs&msa=41700        occupation mix for one MSA: top 30 detailed
//                                             occupations + 22 major groups, wages, location quotients
//   /api/economy?op=ports&bbox=..&min=medium  World Port Index harbours in the box with BTS
//                                             Port Performance volumes where published
//   /api/economy?op=border                    every US land port of entry, 25 months of BTS counts
//   /api/economy?op=countries                 Natural Earth polygons joined with World Bank
//                                             GDP, exports, imports, trade/GDP, container TEU
//   /api/economy?op=partners&iso3=USA         top trading partners (WITS, latest year)
//   /api/economy?op=pulse                     national series: FRED + BTS freight indicators
//   /api/economy?op=report&lon=..&lat=..      the market report for a point, built server-side
//
// Every response carries `provenance` (one record per upstream release the
// numbers came from, estimates with their formula) and `generatedAt`; the
// tabular ops (areas, ports, border, countries, sectors, pulse) also answer
// `format=csv` with the same provenance as `#` footer lines. See docs/API.md.
//
// Bounding boxes are snapped outward to a one-degree grid so nearby callers
// share an entry; every upstream table is cached in memory for hours.

import type { NextRequest } from "next/server";
import { cached } from "@/lib/server/cache";
import { jsonError } from "@/lib/server/upstream";
import { badRequest, csv as csvResponse, ok, options, parseFormat, withCors, type CsvRow, type ResponseFormat } from "@/lib/server/respond";
import type { Provenance } from "@/lib/provenance/types";
import {
  btsBorderProvenance,
  btsPortsProvenance,
  naturalEarthProvenance,
  pulseProvenance,
  qcewProvenance,
  oewsProvenance,
  tigerProvenance,
  witsProvenance,
  worldBankProvenance,
  wpiProvenance,
  zillowProvenance,
} from "@/lib/economy/provenance";
import {
  AREA_COLUMNS,
  COUNTRY_COLUMNS,
  CROSSING_COLUMNS,
  flattenAreas,
  flattenCountries,
  flattenCrossings,
  flattenPorts,
  flattenPulse,
  flattenPulseSeries,
  flattenSectors,
  PORT_COLUMNS,
  PULSE_COLUMNS,
  PULSE_SERIES_COLUMNS,
  SECTOR_COLUMNS,
} from "@/lib/economy/flatten";
import {
  buildAreas,
  buildCountries,
  buildCrossings,
  buildPorts,
  portSizeRank,
  type AreaLevel,
  type HomeValue,
  type PortStats,
  type WpiPort,
} from "@/lib/economy/features";
import {
  borderCrossings,
  btsIndicators,
  btsPortStats,
  COUNTRIES,
  fred,
  FRED_SERIES,
  oewsMsaIndex,
  OEWS_AS_OF,
  oewsMsaJobs,
  qcewSectors,
  tigerCounties,
  tigerStates,
  witsPartners,
  worldBank,
  WPI,
  type PulseItem,
} from "@/lib/economy/sources";
// The assembly layer these ops used to keep private: a server component needs a
// MarketReport without an HTTP round-trip to its own origin. See lib/economy/assemble.ts.
import { areaContext, detailFor, joinsFor, marketReportAt, snapBbox, withStusab } from "@/lib/economy/assemble";

export const maxDuration = 60;

type Bbox = [number, number, number, number];

function parseBbox(raw: string | null): Bbox | null {
  const v = (raw ?? "").split(",").map(Number);
  if (v.length !== 4 || !v.every(Number.isFinite)) return null;
  return snapBbox(v as Bbox);
}

interface OpResult {
  data: unknown;
  meta: Record<string, unknown>;
  ttlS: number;
  /** One record per upstream release the payload was read or computed from. */
  provenance: Provenance[];
  caveats?: string[];
  /** Tabular ops: how to flatten `data` for `format=csv`. Absent means CSV is not offered for this op. */
  csv?: () => { rows: CsvRow[]; columns: readonly string[]; filename: string };
}

/** When a cached value was fetched: now minus its age. */
function retrievedAt(ageMs: number): string {
  return new Date(Date.now() - ageMs).toISOString();
}

async function opAreas(level: AreaLevel, bbox: Bbox | null): Promise<OpResult> {
  const key = `areas:${level}:${bbox ? bbox.join(",") : "all"}`;
  const r = await cached(key, 6 * 3600_000, async () => {
    const polys = level === "state" ? await tigerStates() : await withStusab(await tigerCounties(bbox!, detailFor(bbox!)));
    const { joins, sources, asOf } = await joinsFor(level);
    // Neutral features carrying jobs, home and rent; each browser layer dresses its own copy.
    const features = buildAreas(polys, level, joins);
    return {
      features,
      sources,
      asOf,
      polygons: polys.length,
      detail: level === "state" ? "20M" : detailFor(bbox!),
    };
  });
  const at = retrievedAt(r.age);
  const provenance: Provenance[] = [tigerProvenance(at, r.value.detail)];
  if (r.value.asOf.qcew) provenance.push(qcewProvenance(r.value.asOf.qcew, at, { notes: [`${level} rows, all ownerships, all industries`] }));
  if (r.value.asOf.zhvi) provenance.push(zillowProvenance(level === "county" ? "zhviCounty" : "zhviState", r.value.asOf.zhvi, at));
  if (r.value.asOf.zori) provenance.push(zillowProvenance("zoriCounty", r.value.asOf.zori, at));
  return {
    data: { type: "FeatureCollection", features: r.value.features },
    meta: { source: r.value.sources.join(" + ") + " + Census TIGERweb", asOf: r.value.asOf, level, bbox, polygons: r.value.polygons, detail: r.value.detail, cacheAge: r.age },
    ttlS: 3600,
    provenance,
    csv: () => ({ rows: flattenAreas(r.value.features), columns: AREA_COLUMNS, filename: `economy-areas-${level}${bbox ? "-" + bbox.join("_") : ""}.csv` }),
  };
}

/** What a county dossier needs beyond the feature: sector mix and the metro / state / US home values. */
async function opContext(fips: string): Promise<OpResult> {
  const c = await areaContext(fips);
  // The envelope has always carried slimmed Zillow rows; areaContext returns the full ones for server components.
  const slim = (h: HomeValue | null) => (h ? { name: h.name, latest: h.latest, yoyPct: h.yoyPct, yearly: h.yearly } : null);
  return {
    data: {
      period: c.period ?? undefined,
      sectors: c.sectors,
      metroHome: slim(c.metroHome),
      stateHome: slim(c.stateHome),
      usHome: slim(c.usHome),
    },
    meta: { source: "BLS QCEW + Zillow ZHVI", fips },
    ttlS: 6 * 3600,
    provenance: c.provenance,
  };
}

async function opSectors(fips: string): Promise<OpResult> {
  const s = await qcewSectors(fips);
  return {
    data: s,
    meta: { source: "BLS QCEW", fips },
    ttlS: 6 * 3600,
    provenance: [qcewProvenance(s.period, new Date().toISOString(), { area: fips, sectors: true })],
    csv: () => ({ rows: flattenSectors(fips, s.period, s.sectors), columns: SECTOR_COLUMNS, filename: `economy-sectors-${fips}.csv` }),
  };
}

/** Every MSA with its centroid, employment and most distinctive occupation group. Static for the vintage. */
async function opMsas(): Promise<OpResult> {
  const r = oewsMsaIndex();
  return {
    data: r,
    meta: { source: r.source, asOf: r.asOf, count: r.msas.length },
    ttlS: 24 * 3600,
    provenance: [oewsProvenance(r.asOf, new Date().toISOString())],
  };
}

/** Occupation mix for one MSA: top 30 detailed occupations + the 22 major groups, with wages and location quotients. */
async function opMsaJobs(msa: string): Promise<OpResult> {
  const now = new Date().toISOString();
  const j = oewsMsaJobs(msa);
  if (!j) {
    return {
      data: null,
      meta: { source: "BLS OEWS", msa, error: "unknown MSA code" },
      ttlS: 3600,
      provenance: [oewsProvenance(OEWS_AS_OF, now, { msa })],
      caveats: [`No OEWS row for MSA ${msa} in the ${OEWS_AS_OF} release.`],
    };
  }
  return {
    data: j,
    meta: { source: j.source, asOf: j.asOf, msa },
    ttlS: 24 * 3600,
    provenance: [oewsProvenance(j.asOf, now, { msa })],
  };
}

const SIZE_MIN: Record<string, number> = { large: 3, medium: 2, small: 1, all: 0 };

async function opPorts(bbox: Bbox, min: string): Promise<OpResult> {
  const minRank = SIZE_MIN[min] ?? 2;
  const key = `ports:${bbox.join(",")}:${minRank}`;
  const r = await cached(key, 6 * 3600_000, async () => {
    const [w, s, e, n] = bbox;
    const inBox = (p: WpiPort) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n;
    const stats = await btsPortStats().catch(() => null);
    const byWpi = stats?.byWpi ?? new Map<number, PortStats>();
    const ports = WPI.ports.filter((p) => inBox(p) && (portSizeRank(p) >= minRank || byWpi.has(p.id)));
    const extras = (stats?.extraPorts ?? []).filter((x) => inBox(x.port));
    const statMap = new Map(byWpi);
    for (const x of extras) statMap.set(x.port.id, x.stats);
    const features = buildPorts([...ports, ...extras.map((x) => x.port)], statMap);
    return { features, bts: !!stats, btsYear: stats?.year, withStats: features.filter((f) => (f.properties.extra as { stats?: unknown }).stats).length };
  });
  const at = retrievedAt(r.age);
  const provenance: Provenance[] = [wpiProvenance(at, WPI.pulled)];
  if (r.value.bts) provenance.push(btsPortsProvenance(r.value.btsYear, at));
  return {
    data: { type: "FeatureCollection", features: r.value.features },
    meta: {
      source: r.value.bts ? "NGA World Port Index + BTS Port Performance" : "NGA World Port Index",
      wpiPulled: WPI.pulled,
      btsYear: r.value.btsYear,
      withStats: r.value.withStats,
      bbox,
      min,
      cacheAge: r.age,
    },
    ttlS: 6 * 3600,
    provenance,
    csv: () => ({ rows: flattenPorts(r.value.features), columns: PORT_COLUMNS, filename: `economy-ports-${bbox.join("_")}.csv` }),
  };
}

async function opBorder(): Promise<OpResult> {
  const b = await borderCrossings();
  const features = buildCrossings(b.rows);
  return {
    data: { type: "FeatureCollection", features },
    meta: { source: "BTS Border Crossing Entry Data", asOf: b.asOf, ports: b.rows.length },
    ttlS: 6 * 3600,
    provenance: [btsBorderProvenance(b.asOf, new Date().toISOString())],
    csv: () => ({ rows: flattenCrossings(features), columns: CROSSING_COLUMNS, filename: "economy-border-crossings.csv" }),
  };
}

async function opCountries(): Promise<OpResult> {
  const r = await cached("countries", 12 * 3600_000, async () => {
    const wb = await worldBank();
    return { features: buildCountries(COUNTRIES.features, wb.stats), failed: wb.failed, withData: [...wb.stats.keys()].length };
  });
  return {
    data: { type: "FeatureCollection", features: r.value.features },
    meta: { source: "Natural Earth + World Bank WDI", nePulled: COUNTRIES.pulled, indicatorsFailed: r.value.failed, countriesWithData: r.value.withData, cacheAge: r.age },
    ttlS: 12 * 3600,
    provenance: [naturalEarthProvenance(retrievedAt(r.age), COUNTRIES.pulled), worldBankProvenance(retrievedAt(r.age))],
    caveats: r.value.failed.length ? [`World Bank indicators that did not answer: ${r.value.failed.join(", ")}`] : undefined,
    csv: () => ({ rows: flattenCountries(r.value.features), columns: COUNTRY_COLUMNS, filename: "economy-countries.csv" }),
  };
}

async function opPartners(iso3: string): Promise<OpResult> {
  const p = await witsPartners(iso3);
  return { data: p, meta: { source: "World Bank WITS TradeStats", iso3, units: "US$ thousands" }, ttlS: 24 * 3600, provenance: [witsProvenance(iso3, p?.year, new Date().toISOString())] };
}

async function opPulse(series = false): Promise<OpResult> {
  const [fredItems, bts] = await Promise.all([Promise.allSettled(FRED_SERIES.map((s) => fred(s.id))), btsIndicators().catch(() => [] as PulseItem[])]);
  const items: PulseItem[] = [];
  const failed: string[] = [];
  fredItems.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value) items.push(r.value);
    else failed.push(FRED_SERIES[i].id);
  });
  items.push(...bts);
  return {
    data: items,
    meta: { source: "FRED + BTS Supply Chain Indicators", failed, count: items.length },
    ttlS: 1800,
    provenance: pulseProvenance(items, new Date().toISOString()),
    caveats: failed.length ? [`FRED series that did not answer: ${failed.join(", ")}`] : undefined,
    csv: () =>
      series
        ? { rows: flattenPulseSeries(items), columns: PULSE_SERIES_COLUMNS, filename: "economy-pulse-series.csv" }
        : { rows: flattenPulse(items), columns: PULSE_COLUMNS, filename: "economy-pulse.csv" },
  };
}

async function opReport(lon: number, lat: number, origin: string): Promise<OpResult> {
  const m = await marketReportAt(lon, lat);
  const globe = `${origin}/?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&h=150000&layers=realestate,commerce,trade&market=1`;
  return {
    data: m.report,
    meta: { source: "zillow+qcew+tigerweb+bts+fred", county: m.area?.geoid ?? null, globe },
    ttlS: 900,
    provenance: m.provenance,
    caveats: m.report.caveats,
  };
}

/** JSON envelope, or CSV when asked and the op is tabular. */
function respond(r: OpResult, format: ResponseFormat = "json", op = "") {
  if (format === "csv") {
    if (!r.csv) return badRequest(`format=csv is not offered for op=${op}; tabular ops are areas, sectors, ports, border, countries, pulse`);
    const t = r.csv();
    return csvResponse(t.rows, { columns: [...t.columns], filename: t.filename, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
  }
  return ok(r.data, { meta: r.meta, provenance: r.provenance, caveats: r.caveats, ttlS: r.ttlS });
}

const bad = badRequest;

export const OPTIONS = options;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const op = q.get("op") ?? "";
  const format = parseFormat(req);
  try {
    switch (op) {
      case "areas": {
        const level = q.get("level") === "state" ? "state" : "county";
        const b = level === "county" ? parseBbox(q.get("bbox")) : null;
        if (level === "county" && !b) return bad("bbox=w,s,e,n required for level=county");
        return respond(await opAreas(level, b), format, op);
      }
      case "sectors": {
        const fips = q.get("fips") ?? "";
        if (!/^(\d{5}|US000)$/.test(fips)) return bad("fips=SSCCC (county) or SS000 (state) required");
        return respond(await opSectors(fips), format, op);
      }
      case "msas":
        return respond(await opMsas());
      case "msa-jobs": {
        const msa = q.get("msa") ?? "";
        if (!/^\d{5}$/.test(msa)) return bad("msa=5-digit CBSA code required");
        return respond(await opMsaJobs(msa));
      }
      case "context": {
        const fips = q.get("fips") ?? "";
        if (!/^\d{5}$/.test(fips)) return bad("fips=SSCCC (county) or SS000 (state) required");
        return respond(await opContext(fips), format, op);
      }
      case "ports": {
        const b = parseBbox(q.get("bbox"));
        if (!b) return bad("bbox=w,s,e,n required");
        const min = q.get("min") ?? "medium";
        if (!(min in SIZE_MIN)) return bad("min=large | medium | small | all");
        return respond(await opPorts(b, min), format, op);
      }
      case "border":
        return respond(await opBorder(), format, op);
      case "countries":
        return respond(await opCountries(), format, op);
      case "partners": {
        const iso3 = (q.get("iso3") ?? "").toUpperCase();
        if (!/^[A-Z]{3}$/.test(iso3)) return bad("iso3=USA required");
        return respond(await opPartners(iso3), format, op);
      }
      case "pulse":
        return respond(await opPulse(q.get("series") === "1"), format, op);
      case "report": {
        const lon = Number(q.get("lon"));
        const lat = Number(q.get("lat"));
        if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return bad("lon and lat required");
        return respond(await opReport(lon, lat, req.nextUrl.origin), format, op);
      }
      default:
        return bad("unknown op: areas | sectors | context | msas | msa-jobs | ports | border | countries | partners | pulse | report");
    }
  } catch (err) {
    return withCors(jsonError(err));
  }
}
