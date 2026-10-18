// Market-report assembly, lifted out of app/api/economy/route.ts.
//
// The route's private helpers were the only path to a MarketReport, so a
// server component that wanted one had to fetch its own origin over HTTP —
// a self-call that ISR cannot cache, that doubles the cold-render cost and
// that fails outright during `next build`. Everything a report needs now
// lives here; the route imports it and keeps its response shapes byte for
// byte.
//
// Three entry points, because a place is identified three different ways.
// marketReportAt(lon, lat) is what /api/economy?op=report answers with.
// marketReportForCounty(fips, identity) is what a county page needs: the
// identity comes from the offline manifest, so the county TIGER layer — whose
// outFields cannot include STUSAB without earning a 400 — never has to be
// supplemented by a second stateLookup() round-trip. marketReportForState is
// new; the repo has never had a state report path.
//
// There is deliberately no metro entry point. MarketReport.area.level is
// "county" | "state", so a metro cannot be represented here without lying
// about what the numbers are; the metro page composes its own section from
// Zillow metro rows and a county rollup that prints its own arithmetic.
//
// Every upstream is caught. With no egress the report still resolves: areas
// empty, sections marked not loaded, one caveat per source that did not
// answer, and an affordability estimate that is null rather than invented.

import type { Point } from "geojson";
import { cached } from "@/lib/server/cache";
import { bboxAround, haversine } from "@/lib/globe/geo";
import { pointInGeometry } from "@/lib/water/report";
import type { LayerFeature } from "@/lib/layers/types";
import type { Provenance } from "@/lib/provenance/types";
import type { SourceId } from "@/lib/provenance/sources";
import { dedupeProvenance } from "@/lib/provenance/collect";
import { qcewProvenance, tigerProvenance, zillowProvenance } from "./provenance";
import {
  buildAreas,
  buildCrossings,
  buildPorts,
  portSizeRank,
  type AreaJoins,
  type AreaLevel,
  type AreaPoly,
  type HomeValue,
  type PortStats,
  type SectorRow,
  type WpiPort,
} from "./features";
import {
  borderCrossings,
  btsIndicators,
  btsPortStats,
  fred,
  FRED_SERIES,
  metroRow,
  qcewLatest,
  qcewSectors,
  stateLookup,
  tigerCountyAt,
  tigerCountyByGeoid,
  tigerStateByGeoid,
  WPI,
  zillow,
  type PulseItem,
  type TigerDetail,
} from "./sources";
import { buildMarketReport, type MarketReport } from "./report";

const H = 3600_000;
const MAX_SPAN_DEG = 18;

type Bbox = [number, number, number, number];

/** A report plus the assembly's own bookkeeping: what answered, what did not, and when. */
export interface AssembledMarket {
  report: MarketReport;
  /** The polygon the report was built on, or null when TIGERweb did not answer. */
  area: AreaPoly | null;
  provenance: Provenance[];
  caveats: string[];
  /** Source ids that did not answer. Their fields are empty, never imputed. */
  failed: SourceId[];
  /** Release label per source: qcew period, ZHVI / ZORI month. */
  asOf: Record<string, string>;
  retrievedAt: string;
}

/** Clamp to MAX_SPAN_DEG around the centre and snap outward to a 1 degree grid. */
export function snapBbox(v: Bbox): Bbox {
  let [w, s, e, n] = v;
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  w = Math.max(w, cx - MAX_SPAN_DEG / 2, -180);
  e = Math.min(e, cx + MAX_SPAN_DEG / 2, 180);
  s = Math.max(s, cy - MAX_SPAN_DEG / 2, -90);
  n = Math.min(n, cy + MAX_SPAN_DEG / 2, 90);
  return [Math.floor(w), Math.floor(s), Math.ceil(e), Math.ceil(n)];
}

/** Generalization by box size: fine polygons for a city, coarse for a region. */
export function detailFor(b: Bbox): TigerDetail {
  const span = Math.max(b[2] - b[0], b[3] - b[1]);
  return span <= 2 ? "500K" : span <= 7 ? "5M" : "20M";
}

/**
 * The jobs, home value and rent tables for one area level.
 *
 * `opts.stateNames` lets a caller that already knows the state name — a place
 * page holding a manifest row — supply it instead of paying stateLookup(),
 * which is a TIGERweb round-trip. It is honoured at county level only: the
 * state level needs the lookup anyway, because Zillow's state file is keyed
 * by region name and TIGERweb gives us FIPS.
 *
 * Note the key. The lookup built from stateLookup() is keyed by two-digit
 * state FIPS, exactly as the route has always built it; buildAreas asks for
 * the area's own GEOID, so a supplied map should be keyed that way (a county
 * page passes one entry: its own five-digit FIPS -> its state name).
 */
export async function joinsFor(
  level: AreaLevel,
  opts: { stateNames?: Map<string, string> } = {},
): Promise<{ joins: AreaJoins; sources: string[]; asOf: Record<string, string>; failed: SourceId[] }> {
  const sources: string[] = [];
  const asOf: Record<string, string> = {};
  const failed: SourceId[] = [];
  const named = level === "county" && !!opts.stateNames;
  const joins: AreaJoins = { jobs: new Map(), home: new Map(), rent: new Map(), stateNames: new Map() };
  const [q, h, r, states] = await Promise.all([
    qcewLatest().catch(() => null),
    zillow(level === "county" ? "zhviCounty" : "zhviState").catch(() => null),
    level === "county" ? zillow("zoriCounty").catch(() => null) : Promise.resolve(null),
    named ? Promise.resolve(null) : stateLookup().catch(() => null),
  ]);
  if (q) {
    sources.push("BLS QCEW");
    asOf.qcew = q.period;
    joins.jobs = level === "county" ? q.counties : q.states;
  } else failed.push("bls-qcew");
  if (h) {
    sources.push("Zillow ZHVI");
    asOf.zhvi = h.asOf;
    if (level === "county") joins.home = h.rows;
    else if (states) {
      // The state file is keyed by name; TIGERweb gives us FIPS.
      for (const [fips, s] of states) {
        const row = h.byName.get(s.name);
        if (row) joins.home.set(fips, row);
      }
    }
  } else failed.push("zillow-zhvi");
  if (r) {
    sources.push("Zillow ZORI");
    asOf.zori = r.asOf;
    joins.rent = r.rows;
  } else if (level === "county") failed.push("zillow-zori");
  if (named) for (const [fips, name] of opts.stateNames!) joins.stateNames!.set(fips, name);
  else if (states && level === "county") for (const [fips, s] of states) joins.stateNames!.set(fips, s.name);
  else if (!states && !named) failed.push("census-tigerweb");
  return { joins, sources, asOf, failed };
}

/** County polygons carry only a state FIPS prefix; give them the USPS code for labels. */
export async function withStusab(polys: AreaPoly[]): Promise<AreaPoly[]> {
  const states = await stateLookup().catch(() => null);
  if (!states) return polys;
  return polys.map((p) => (p.stusab ? p : { ...p, stusab: states.get(p.geoid.slice(0, 2))?.stusab }));
}

// ---------------------------------------------------------------- trade

const SIZE_MIN: Record<string, number> = { large: 3, medium: 2, small: 1, all: 0 };

/**
 * Harbours in a box. Same cache key and value shape as the route's op, so the
 * two share one entry rather than each paying for the BTS table.
 */
async function portsIn(bbox: Bbox, min: string): Promise<LayerFeature<Point>[]> {
  const minRank = SIZE_MIN[min] ?? 2;
  const r = await cached(`ports:${bbox.join(",")}:${minRank}`, 6 * H, async () => {
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
  return r.value.features;
}

interface TradeAssembly {
  features: LayerFeature[];
  loaded: boolean;
}

/**
 * The ports and land crossings a report should consider, and nothing else.
 * The BTS border table is the whole country — roughly 60,000 rows across 25
 * months — so it is filtered to the 260 km the report's own trade section
 * uses before it is ever handed to buildMarketReport.
 */
async function tradeAssembly(lon: number, lat: number): Promise<TradeAssembly> {
  const [ports, border] = await Promise.all([
    portsIn(snapBbox(bboxAround(lat, lon, 220_000)), "medium").catch(() => null),
    borderCrossings()
      .then((b) => buildCrossings(b.rows))
      .catch(() => null),
  ]);
  const features: LayerFeature[] = [];
  if (ports) features.push(...ports);
  if (border) features.push(...border.filter((f) => haversine(lat, lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) <= 260_000));
  return { features, loaded: !!(ports || border) };
}

/** The port and crossing features within the report's own radii of a point. */
export async function tradeNear(lon: number, lat: number): Promise<LayerFeature[]> {
  return (await tradeAssembly(lon, lat)).features;
}

// ---------------------------------------------------------------- pulse

/** The full national pulse: every FRED series plus the BTS freight indicators. */
async function nationalPulse(): Promise<{ items: PulseItem[]; ok: boolean; failed: string[] }> {
  try {
    const [fredItems, bts] = await Promise.all([Promise.allSettled(FRED_SERIES.map((s) => fred(s.id))), btsIndicators().catch(() => [] as PulseItem[])]);
    const items: PulseItem[] = [];
    const failed: string[] = [];
    fredItems.forEach((r, i) => {
      if (r.status === "fulfilled" && r.value) items.push(r.value);
      else failed.push(FRED_SERIES[i].id);
    });
    items.push(...bts);
    return { items, ok: true, failed };
  } catch {
    return { items: [], ok: false, failed: FRED_SERIES.map((s) => s.id) };
  }
}

/**
 * The one national series a place report cannot do without.
 * buildMarketReport looks for id === "MORTGAGE30US" in src.pulse and silently
 * nulls the affordability estimate when it is absent, so a place page always
 * asks for it even though it does not show the rest of the pulse.
 */
async function mortgagePulse(): Promise<{ items: PulseItem[]; ok: boolean }> {
  const m = await fred("MORTGAGE30US").catch(() => null);
  return { items: [m].filter((x): x is PulseItem => !!x), ok: !!m };
}

const NO_RATE = "FRED did not answer for the 30-year mortgage rate (MORTGAGE30US), so the monthly payment estimate is omitted rather than computed from a stale rate.";

// ---------------------------------------------------------------- reports

interface Core {
  lon: number;
  lat: number;
  now: number;
  area: AreaPoly | null;
  areas: LayerFeature[];
  areasLoaded: boolean;
  sectors: SectorRow[];
  metroHome: HomeValue | null;
  usHome: HomeValue | null;
  pulse: PulseItem[];
  pulseLoaded: boolean;
  caveats: string[];
  asOf: Record<string, string>;
  failed: SourceId[];
  trade: Promise<TradeAssembly>;
}

/** Shared tail: attach trade, build the report, union the provenance. */
async function finish(c: Core): Promise<AssembledMarket> {
  const at = new Date(c.now).toISOString();
  const t = await c.trade;
  const report = buildMarketReport(
    c.lon,
    c.lat,
    {
      areas: c.areas,
      trade: t.features,
      loaded: { areas: c.areasLoaded, trade: t.loaded, pulse: c.pulseLoaded },
      pulse: c.pulse,
      sectors: c.sectors,
      metroHome: c.metroHome,
      usHome: c.usHome,
      caveats: c.caveats,
    },
    c.now,
  );
  // The report already carries per-section provenance; the envelope repeats the union plus the polygon source.
  const provenance = dedupeProvenance([c.area ? [tigerProvenance(at)] : [], report.provenance]);
  return { report, area: c.area, provenance, caveats: report.caveats, failed: c.failed, asOf: c.asOf, retrievedAt: at };
}

/** One caveat per source that did not answer, in the words the screener uses. */
function failureCaveats(failed: SourceId[]): string[] {
  return failed.map((id) => `${id} did not answer; its fields are empty.`);
}

/** The market report for a point on the map: what /api/economy?op=report serves. */
export async function marketReportAt(lon: number, lat: number, opts: { now?: number } = {}): Promise<AssembledMarket> {
  const now = opts.now ?? Date.now();
  const trade = tradeAssembly(lon, lat);
  const caveats: string[] = [];
  const county = await tigerCountyAt(lon, lat).catch(() => null);
  const areas: LayerFeature[] = [];
  let metroHome: HomeValue | null = null;
  let usHome: HomeValue | null = null;
  let sectors: SectorRow[] = [];
  let asOf: Record<string, string> = {};
  let failed: SourceId[] = [];
  if (county) {
    const [j, metro] = await Promise.all([joinsFor("county"), zillow("zhviMetro").catch(() => null)]);
    const polys = await withStusab([county]);
    areas.push(...buildAreas(polys, "county", j.joins));
    asOf = j.asOf;
    failed = j.failed;
    const home = j.joins.home.get(county.geoid);
    if (metro) {
      asOf.zhviMetro = metro.asOf;
      usHome = metro.rows.get("US") ?? null;
      if (home?.metro) metroHome = metroRow(metro, home.metro) ?? null;
    }
    sectors = (await qcewSectors(county.geoid).catch(() => null))?.sectors ?? [];
  } else caveats.push("No US county under this point (TIGERweb); home values and jobs cover the United States only.");
  const pulse = await nationalPulse();
  if (!pulse.ok) caveats.push("National series (FRED / BTS) did not answer.");
  return finish({ lon, lat, now, area: county, areas, areasLoaded: !!county, sectors, metroHome, usHome, pulse: pulse.items, pulseLoaded: pulse.ok, caveats, asOf, failed, trade });
}

/**
 * The market report for a county named by FIPS.
 *
 * `identity` is a row from the offline place manifest. When it is supplied the
 * report is anchored on its Census internal point and withStusab() is skipped
 * entirely: the county TIGER layer's outFields are "GEOID,NAME,STATE,CENTLAT,
 * CENTLON" with no STUSAB, so tigerCountyByGeoid always returns stusab
 * undefined, and routing that through stateLookup() would re-add exactly the
 * TIGERweb round-trip the manifest exists to remove.
 *
 * Resolves with area null and sections marked not loaded when TIGERweb is
 * unreachable, so the page renders "unavailable, here is why" rather than a
 * 404 on an upstream outage. It never rejects.
 */
export async function marketReportForCounty(
  fips: string,
  identity: { name: string; stusab: string; stateName: string; lon: number; lat: number } | null,
  opts: { now?: number } = {},
): Promise<AssembledMarket> {
  const now = opts.now ?? Date.now();
  const caveats: string[] = [];
  const failed: SourceId[] = [];
  const centroid = identity ? { lon: identity.lon, lat: identity.lat } : undefined;
  let poly = await tigerCountyByGeoid(fips, centroid).catch(() => null);
  if (!poly && identity) poly = await tigerCountyAt(identity.lon, identity.lat).catch(() => null);
  if (!poly) {
    failed.push("census-tigerweb");
    caveats.push(`Census TIGERweb did not return a polygon for county ${fips}; the sections that need one are unavailable rather than estimated.`);
  }

  // The manifest's internal point lies inside the county's own polygon, but
  // the 1:20M generalization can shave a narrow or coastal county enough to
  // exclude it. Anchoring the report somewhere the polygon does not contain
  // would lose the area entirely, so say so and use TIGERweb's own point.
  const useIdentity = !!identity && (!poly || pointInGeometry(identity.lon, identity.lat, poly.geometry));
  if (identity && poly && !useIdentity) {
    caveats.push(`The manifest internal point for county ${fips} falls outside the generalized 1:20M polygon; the report is anchored on the TIGERweb internal point instead.`);
  }
  const lon = useIdentity ? identity!.lon : (poly?.lon ?? identity?.lon ?? 0);
  const lat = useIdentity ? identity!.lat : (poly?.lat ?? identity?.lat ?? 0);
  const locatable = !!identity || !!poly;
  if (!locatable) caveats.push(`County ${fips} is not in the offline place manifest and TIGERweb did not answer, so there is no point to report on.`);

  const trade = locatable ? tradeAssembly(lon, lat) : Promise.resolve({ features: [], loaded: false });
  const stateNames = identity ? new Map([[fips, identity.stateName]]) : undefined;
  const [j, metro] = await Promise.all([joinsFor("county", stateNames ? { stateNames } : {}), zillow("zhviMetro").catch(() => null)]);
  failed.push(...j.failed);
  const asOf = { ...j.asOf };
  const polys: AreaPoly[] = poly ? [{ ...poly, stusab: poly.stusab ?? identity?.stusab, name: poly.name || identity?.name || fips }] : [];
  const areas = buildAreas(polys, "county", j.joins);
  const home = j.joins.home.get(fips);
  let metroHome: HomeValue | null = null;
  let usHome: HomeValue | null = null;
  if (metro) {
    asOf.zhviMetro = metro.asOf;
    usHome = metro.rows.get("US") ?? null;
    if (home?.metro) metroHome = metroRow(metro, home.metro) ?? null;
  }
  const sectors = (await qcewSectors(fips).catch(() => null))?.sectors ?? [];
  const pulse = await mortgagePulse();
  if (!pulse.ok) caveats.push(NO_RATE);
  caveats.push(...failureCaveats(j.failed));
  return finish({ lon, lat, now, area: poly, areas, areasLoaded: !!poly, sectors, metroHome, usHome, pulse: pulse.items, pulseLoaded: pulse.ok, caveats, asOf, failed, trade });
}

/**
 * The market report for a whole state. MarketReport.area.level is
 * "county" | "state", so this is the widest thing the type can honestly
 * describe — there is no metro level and this must not be asked for one.
 *
 * Zillow publishes ZORI for counties and metros only, so every rent field is
 * structurally null here; the caveat says that in words rather than letting
 * an empty row read as "no rents are paid in Texas".
 */
export async function marketReportForState(
  stateFips: string,
  identity: { usps: string; name: string; lon: number; lat: number },
  opts: { now?: number } = {},
): Promise<AssembledMarket> {
  const now = opts.now ?? Date.now();
  const fips = stateFips.slice(0, 2);
  const caveats: string[] = [];
  const failed: SourceId[] = [];
  const poly = await tigerStateByGeoid(fips).catch(() => null);
  if (!poly) {
    failed.push("census-tigerweb");
    caveats.push(`Census TIGERweb did not return a polygon for state ${fips}; the sections that need one are unavailable rather than estimated.`);
  }
  const useIdentity = !poly || pointInGeometry(identity.lon, identity.lat, poly.geometry);
  if (poly && !useIdentity) caveats.push(`The manifest centroid for ${identity.usps} falls outside the generalized 1:20M state polygon; the report is anchored on the TIGERweb internal point instead.`);
  const lon = useIdentity ? identity.lon : poly!.lon;
  const lat = useIdentity ? identity.lat : poly!.lat;

  const trade = tradeAssembly(lon, lat);
  const [j, metro] = await Promise.all([joinsFor("state"), zillow("zhviMetro").catch(() => null)]);
  failed.push(...j.failed);
  const asOf = { ...j.asOf };
  const polys: AreaPoly[] = poly ? [{ ...poly, stusab: poly.stusab ?? identity.usps, name: poly.name || identity.name }] : [];
  const areas = buildAreas(polys, "state", j.joins);
  const usHome = metro?.rows.get("US") ?? null;
  if (metro) asOf.zhviMetro = metro.asOf;
  const sectors = (await qcewSectors(`${fips}000`).catch(() => null))?.sectors ?? [];
  const pulse = await mortgagePulse();
  if (!pulse.ok) caveats.push(NO_RATE);
  caveats.push("Zillow publishes its rent index (ZORI) for counties and metros only, so statewide rent and price-to-rent are empty here, not zero.");
  caveats.push(...failureCaveats(j.failed));
  return finish({ lon, lat, now, area: poly, areas, areasLoaded: !!poly, sectors, metroHome: null, usHome, pulse: pulse.items, pulseLoaded: pulse.ok, caveats, asOf, failed, trade });
}

/**
 * Sector mix plus the metro, state and US home values for one area — what a
 * county dossier needs beyond its own feature. Full Zillow rows, so a caller
 * that wants the 25-month array has it; the API route slims them itself.
 */
export async function areaContext(fips: string): Promise<{
  period: string | null;
  sectors: SectorRow[];
  metroHome: HomeValue | null;
  stateHome: HomeValue | null;
  usHome: HomeValue | null;
  provenance: Provenance[];
}> {
  const isState = fips.endsWith("000");
  const geoid = isState ? fips.slice(0, 2) : fips;
  const [sectors, county, metro, state, states] = await Promise.all([
    qcewSectors(fips).catch(() => null),
    isState ? Promise.resolve(null) : zillow("zhviCounty").catch(() => null),
    zillow("zhviMetro").catch(() => null),
    zillow("zhviState").catch(() => null),
    stateLookup().catch(() => null),
  ]);
  const home = county?.rows.get(geoid);
  const stateName = states?.get(geoid.slice(0, 2))?.name;
  const at = new Date().toISOString();
  const provenance: Provenance[] = [];
  if (sectors) provenance.push(qcewProvenance(sectors.period, at, { area: fips, sectors: true }));
  if (home) provenance.push(zillowProvenance("zhviCounty", county?.asOf, at));
  if (metro) provenance.push(zillowProvenance("zhviMetro", metro.asOf, at, ["metro and United States rows"]));
  if (state && stateName) provenance.push(zillowProvenance("zhviState", state.asOf, at));
  return {
    period: sectors?.period ?? null,
    sectors: sectors?.sectors ?? [],
    metroHome: home?.metro && metro ? (metroRow(metro, home.metro) ?? null) : null,
    stateHome: stateName ? (state?.byName.get(stateName) ?? null) : null,
    usHome: metro?.rows.get("US") ?? null,
    provenance,
  };
}
