// Server-side readers for the economy route. Every source is public and
// keyless; each one is cached in memory for hours because the underlying
// tables change monthly or quarterly, and the edge cache in front of the
// route absorbs the rest.
//
//   Zillow Research CSVs      ZHVI typical home value, ZORI typical rent
//   BLS QCEW open-data CSVs   county / state establishments, jobs and wages
//   Census TIGERweb           generalized county and state polygons
//   BTS (Socrata)             border crossings, port performance, freight indicators
//   World Bank WDI + WITS     country indicators, bilateral partners
//   FRED                      fredgraph.csv, no key
//   NGA World Port Index      bundled snapshot (lib/economy/data)

import { bboxAround } from "@/lib/globe/geo";
import { cached } from "@/lib/server/cache";
import { polite, upstream, upstreamJson } from "@/lib/server/upstream";
import { cellNum, parseCsv } from "./csv";
import { parseQcewAreaTotal, qcewColumns, qcewLevels, type QcewQtr, type QcewTotalRow } from "./history/qcewCsv";
import { isWithheld } from "./qcewDisclosure";
import {
  NAICS_SECTOR,
  type AreaLevel,
  type AreaPoly,
  type CountryFeatureIn,
  type CountryStats,
  type CrossingMeasure,
  type CrossingRow,
  type HomeValue,
  type JobsRow,
  type Partner,
  type Partners,
  type PortStats,
  type SectorRow,
  type VolumeStat,
  type WpiPort,
} from "./features";
import wpiJson from "./data/wpi.json";
import countriesJson from "./data/countries.json";
import btsPortsJson from "./data/bts_ports.json";

export const WPI: { source: string; pulled: string; ports: WpiPort[] } = wpiJson as unknown as { source: string; pulled: string; ports: WpiPort[] };
export const COUNTRIES: { source: string; pulled: string; features: CountryFeatureIn[] } = countriesJson as unknown as {
  source: string;
  pulled: string;
  features: CountryFeatureIn[];
};
interface BtsPlacement {
  portId: string;
  name: string;
  state: string;
  city?: string;
  lon: number;
  lat: number;
  wpi?: number;
  locode?: string;
  position: string;
}
const BTS_PLACEMENTS: BtsPlacement[] = (btsPortsJson as unknown as { ports: BtsPlacement[] }).ports;

const H = 3600_000;

async function text(name: string, url: string, timeoutMs = 45_000): Promise<string> {
  const res = await upstream(name, url, { timeoutMs, headers: { accept: "text/csv,text/plain,*/*" } });
  return res.text();
}

// ---------------------------------------------------------------- Zillow

const ZILLOW_BASE = "https://files.zillowstatic.com/research/public_csvs";
export const ZILLOW_FILES = {
  zhviCounty: `${ZILLOW_BASE}/zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`,
  zhviState: `${ZILLOW_BASE}/zhvi/State_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`,
  zhviMetro: `${ZILLOW_BASE}/zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`,
  zoriCounty: `${ZILLOW_BASE}/zori/County_zori_uc_sfrcondomfr_sm_month.csv`,
  zoriMetro: `${ZILLOW_BASE}/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv`,
} as const;
export type ZillowKind = keyof typeof ZILLOW_FILES;

export interface ZillowTable {
  kind: ZillowKind;
  /** Last month column of the file. */
  asOf: string;
  /** County GEOID, state name, or metro RegionID ("US" for the national row). */
  rows: Map<string, HomeValue>;
  /** RegionName -> row (states and metros). */
  byName: Map<string, HomeValue>;
  /** "principal city|ST" -> row: the county file names metros in full ("Austin-Round Rock-San Marcos, TX"), the metro file short ("Austin, TX"). */
  byShort: Map<string, HomeValue>;
}

export function metroShortKey(name: string): string {
  const m = name.match(/^([^,]+),\s*([A-Z]{2})/);
  if (!m) return name;
  return `${m[1].split(/[-/]/)[0].trim().toLowerCase()}|${m[2]}`;
}

/** The metro row for a county's metro name, tolerant of Zillow's two naming styles. */
export function metroRow(table: ZillowTable, metroName: string | undefined): HomeValue | undefined {
  if (!metroName) return undefined;
  return table.byName.get(metroName) ?? table.byShort.get(metroShortKey(metroName));
}

function parseZillow(kind: ZillowKind, csv: string): ZillowTable {
  const rows = parseCsv(csv);
  const header = rows[0];
  const col = (n: string) => header.indexOf(n);
  const firstDate = header.findIndex((h) => /^\d{4}-\d{2}-\d{2}$/.test(h));
  const iName = col("RegionName");
  const iType = col("RegionType");
  const iState = col("State");
  const iStateName = col("StateName");
  const iMetro = col("Metro");
  const iRank = col("SizeRank");
  const iId = col("RegionID");
  const iSt = col("StateCodeFIPS");
  const iCo = col("MunicipalCodeFIPS");
  const out = new Map<string, HomeValue>();
  const byName = new Map<string, HomeValue>();
  const byShort = new Map<string, HomeValue>();
  for (const r of rows.slice(1)) {
    if (r.length < firstDate + 1) continue;
    let last = r.length - 1;
    while (last >= firstDate && !r[last]) last--;
    if (last < firstDate) continue;
    const latest = cellNum(r[last]);
    if (latest == null) continue;
    const at = (k: number) => (last - k >= firstDate ? cellNum(r[last - k]) : null);
    const v12 = at(12);
    const v60 = at(60);
    const monthly: Array<[string, number]> = [];
    for (let k = 24; k >= 0; k--) {
      const v = at(k);
      if (v != null) monthly.push([header[last - k], v]);
    }
    const yearly: Array<[string, number]> = [];
    for (let k = 120; k >= 0; k -= 12) {
      const v = at(k);
      if (v != null) yearly.push([header[last - k], v]);
    }
    const type = r[iType];
    const id =
      type === "county" && iSt >= 0 && iCo >= 0
        ? r[iSt].padStart(2, "0") + r[iCo].padStart(3, "0")
        : type === "country"
          ? "US"
          : type === "state"
            ? r[iName]
            : r[iId];
    const row: HomeValue = {
      id,
      name: r[iName],
      state: iState >= 0 ? r[iState] || undefined : iStateName >= 0 ? r[iStateName] || undefined : undefined,
      metro: iMetro >= 0 ? r[iMetro] || undefined : undefined,
      sizeRank: cellNum(r[iRank]) ?? 9999,
      asOf: header[last],
      latest,
      yoyPct: v12 ? ((latest - v12) / v12) * 100 : null,
      y5Pct: v60 ? ((latest - v60) / v60) * 100 : null,
      monthly,
      yearly,
    };
    out.set(id, row);
    byName.set(r[iName], row);
    if (type === "msa" && !byShort.has(metroShortKey(r[iName]))) byShort.set(metroShortKey(r[iName]), row);
  }
  return { kind, asOf: header[header.length - 1], rows: out, byName, byShort };
}

export function zillow(kind: ZillowKind): Promise<ZillowTable> {
  return cached("zillow:" + kind, 12 * H, async () => parseZillow(kind, await text("zillow", ZILLOW_FILES[kind], 60_000))).then((c) => c.value);
}

// ---------------------------------------------------------------- BLS QCEW

const QCEW = "https://data.bls.gov/cew/data/api";

export interface QcewTable {
  year: number;
  qtr: number;
  period: string;
  counties: Map<string, JobsRow>;
  /** Two-digit state FIPS -> row. */
  states: Map<string, JobsRow>;
  /**
   * Metropolitan statistical areas (agglvl 40) by QCEW C-code, C + the first
   * four digits of the CBSA code ("C1242" is Austin, CBSA 12420). These rows
   * follow the delineation in force for their period, so a series across
   * years can change boundaries under it.
   */
  metros: Map<string, JobsRow>;
  /** Micropolitan statistical areas (agglvl 80) by C-code, same keying as `metros`. */
  micros: Map<string, JobsRow>;
  national?: JobsRow;
}

/** One QCEW row as a JobsRow; a withheld row (any non-blank disclosure code) keeps its shape with every value null. */
export function qcewRow(r: Record<string, string>, period: string): JobsRow {
  const suppressed = isWithheld(r.disclosure_code);
  const c = qcewColumns(Object.keys(r));
  const n = (k: string) => (suppressed ? null : cellNum(r[k]));
  return {
    area: r.area_fips,
    period,
    estabs: n(c.estabs),
    emp: n(c.emp),
    wages: n(c.wages),
    avgWeeklyWage: n(c.avgWeeklyWage),
    yoy: {
      estabs: n(c.otyEstabsPct),
      emp: n(c.otyEmpPct),
      wages: n(c.otyWagesPct),
      avgWeeklyWage: n(c.otyAvgWeeklyWagePct),
    },
    suppressed,
  };
}

function objects(csv: string): Record<string, string>[] {
  const rows = parseCsv(csv);
  const h = rows[0];
  return rows.slice(1).filter((r) => r.length >= h.length - 1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""])));
}

/**
 * The all-ownership total rows (own_code 0) of one industry/10 slice: counties
 * (agglvl 70), states (50), metropolitan (40) and micropolitan (80) areas, and
 * the nation (10). Pure.
 */
export function parseQcewLatest(csv: string, year: number, qtr: number): QcewTable {
  const period = `${year} Q${qtr}`;
  const counties = new Map<string, JobsRow>();
  const states = new Map<string, JobsRow>();
  const metros = new Map<string, JobsRow>();
  const micros = new Map<string, JobsRow>();
  let national: JobsRow | undefined;
  for (const r of objects(csv)) {
    if (r.own_code !== "0") continue;
    if (r.agglvl_code === "70") counties.set(r.area_fips, qcewRow(r, period));
    else if (r.agglvl_code === "50") states.set(r.area_fips.slice(0, 2), qcewRow(r, period));
    else if (r.agglvl_code === "40") metros.set(r.area_fips, qcewRow(r, period));
    else if (r.agglvl_code === "80") micros.set(r.area_fips, qcewRow(r, period));
    else if (r.agglvl_code === "10") national = qcewRow(r, period);
  }
  return { year, qtr, period, counties, states, metros, micros, national };
}

/** Newest quarter BLS has published: walk back from the current quarter until a file answers. */
export function qcewLatest(): Promise<QcewTable> {
  return cached("qcew:latest", 6 * H, async () => {
    const now = new Date();
    let y = now.getUTCFullYear();
    let q = Math.floor(now.getUTCMonth() / 3) + 1;
    let lastErr: unknown = null;
    for (let k = 0; k < 8; k++) {
      try {
        const csv = await polite("bls", 300, 60_000, () => text("bls-qcew", `${QCEW}/${y}/${q}/industry/10.csv`));
        const table = parseQcewLatest(csv, y, q);
        if (table.counties.size > 100) return table;
      } catch (err) {
        lastErr = err;
      }
      q--;
      if (q === 0) {
        q = 4;
        y--;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("BLS QCEW: no quarter answered");
  }).then((c) => c.value);
}

/**
 * The total row and the private-sector NAICS sector rows of one area slice:
 * county SSCCC (sectors at agglvl 74), state SS000 (54), US000 (14) or a
 * metropolitan C-code (44). Micropolitan C-codes and CS-codes publish a total
 * only, so their sector list is empty. Pure.
 */
export function parseQcewSectors(csv: string, fips: string, period: string): { total?: JobsRow; sectors: SectorRow[] } {
  const levels = qcewLevels(fips);
  const sectors: SectorRow[] = [];
  let total: JobsRow | undefined;
  for (const r of objects(csv)) {
    if (r.own_code === "0" && r.industry_code === "10" && levels.total.includes(r.agglvl_code)) total = qcewRow(r, period);
    if (r.own_code !== "5" || levels.sector == null || r.agglvl_code !== levels.sector) continue;
    const suppressed = isWithheld(r.disclosure_code);
    const c = qcewColumns(Object.keys(r));
    const n = (k: string) => (suppressed ? null : cellNum(r[k]));
    sectors.push({
      code: r.industry_code,
      title: NAICS_SECTOR[r.industry_code] ?? r.industry_code,
      estabs: n(c.estabs),
      emp: n(c.emp),
      avgWeeklyWage: n(c.avgWeeklyWage),
      lq: n(c.lqEmp),
      yoyEmp: n(c.otyEmpPct),
      suppressed,
    });
  }
  sectors.sort((a, b) => (b.emp ?? -1) - (a.emp ?? -1));
  return { total, sectors };
}

/** Private-sector NAICS sector rows for one county, state, the nation or a metro C-code, from the same quarter as qcewLatest. */
export async function qcewSectors(fips: string): Promise<{ period: string; total?: JobsRow; sectors: SectorRow[] }> {
  const table = await qcewLatest();
  return cached("qcew:area:" + fips, 12 * H, async () => {
    const csv = await polite("bls", 300, 60_000, () => text("bls-qcew", `${QCEW}/${table.year}/${table.qtr}/area/${fips}.csv`));
    return { period: table.period, ...parseQcewSectors(csv, fips, table.period) };
  }).then((c) => c.value);
}

// ---------------------------------------------------------------- TIGERweb

const TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023/State_County/MapServer";
const TIGER_LAYER: Record<AreaLevel, Record<"500K" | "5M" | "20M", number>> = {
  county: { "500K": 11, "5M": 12, "20M": 13 },
  state: { "500K": 7, "5M": 8, "20M": 9 },
};
export type TigerDetail = "500K" | "5M" | "20M";

interface TigerFeature {
  properties: { GEOID: string; NAME: string; STUSAB?: string; STATE?: string; CENTLAT: string; CENTLON: string };
  geometry: AreaPoly["geometry"] | null;
}

async function tigerQuery(layer: number, params: Record<string, string>): Promise<TigerFeature[]> {
  // County layers carry STATE (FIPS) but no STUSAB; asking for a missing field is a 400.
  const county = layer >= 10;
  const qs = new URLSearchParams({
    where: "1=1",
    outFields: county ? "GEOID,NAME,STATE,CENTLAT,CENTLON" : "GEOID,NAME,STUSAB,CENTLAT,CENTLON",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
    ...params,
  });
  const j = await polite("tigerweb", 150, 30_000, () =>
    upstreamJson<{ features?: TigerFeature[]; error?: { message: string } }>("tigerweb", `${TIGER}/${layer}/query?${qs}`, { timeoutMs: 40_000 }),
  );
  if (j.error) throw new Error("TIGERweb: " + j.error.message);
  return j.features ?? [];
}

function toPoly(f: TigerFeature): AreaPoly | null {
  if (!f.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) return null;
  const lat = Number(f.properties.CENTLAT);
  const lon = Number(f.properties.CENTLON);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { geoid: f.properties.GEOID, name: f.properties.NAME, stusab: f.properties.STUSAB || undefined, lon, lat, geometry: f.geometry };
}

/** Every state (52 incl. DC and PR) at 1:20M. */
export function tigerStates(): Promise<AreaPoly[]> {
  return cached("tiger:states", 24 * H, async () => (await tigerQuery(TIGER_LAYER.state["20M"], {})).map(toPoly).filter((x): x is AreaPoly => !!x)).then(
    (c) => c.value,
  );
}

/** Counties intersecting a bbox at the given generalization. */
export function tigerCounties(bbox: [number, number, number, number], detail: TigerDetail): Promise<AreaPoly[]> {
  const key = `tiger:counties:${detail}:${bbox.join(",")}`;
  return cached(key, 24 * H, async () => {
    const [w, s, e, n] = bbox;
    const feats = await tigerQuery(TIGER_LAYER.county[detail], {
      geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    });
    return feats.map(toPoly).filter((x): x is AreaPoly => !!x);
  }).then((c) => c.value);
}

/** The county containing a point, at 1:20M. */
export function tigerCountyAt(lon: number, lat: number): Promise<AreaPoly | null> {
  const key = `tiger:at:${lon.toFixed(3)},${lat.toFixed(3)}`;
  return cached(key, 24 * H, async () => {
    const feats = await tigerQuery(TIGER_LAYER.county["20M"], {
      geometry: JSON.stringify({ x: lon, y: lat }),
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
    });
    return feats.map(toPoly).find((x): x is AreaPoly => !!x) ?? null;
  }).then((c) => c.value);
}

const COUNTY_FIPS_RE = /^[0-9]{5}$/;

/**
 * One county's generalized polygon by 5-digit FIPS, at 1:20M.
 *
 * The returned AreaPoly.stusab is ALWAYS undefined. County TIGER layers carry
 * STATE (the 2-digit FIPS) but no STUSAB, so tigerQuery cannot ask for the
 * field without earning a 400 — see its outFields above. Callers take the
 * postal abbreviation and the state name from lib/places/registry instead;
 * routing identity through stateLookup() would re-add exactly the round-trip
 * the offline manifest exists to remove.
 *
 * Resolves to null rather than throwing when TIGERweb is unreachable, answers
 * with nothing, or answers with a different county, so a place page can render
 * the geometry section as unavailable instead of returning a 500. It throws
 * only on a malformed FIPS, which is a programming error and must be caught
 * before it can reach the query string.
 *
 * `fallback` is the county's Census internal point from the manifest. It is
 * used only if the attribute query comes back empty.
 */
export async function tigerCountyByGeoid(fips: string, fallback?: { lon: number; lat: number }): Promise<AreaPoly | null> {
  if (!COUNTY_FIPS_RE.test(fips)) throw new Error(`tigerCountyByGeoid: expected a 5-digit county FIPS, got ${JSON.stringify(fips)}`);
  return cached(`tiger:geoid:${fips}`, 24 * H, async () => {
    // tigerQuery writes where:"1=1" first and spreads ...params after it, so
    // this override wins. The equality check below is the guard against that
    // ordering ever changing: without it a spread that lost would quietly
    // return the first of all 3,235 counties instead of the one asked for.
    const feats = await tigerQuery(TIGER_LAYER.county["20M"], { where: `GEOID='${fips}'` });
    const exact = feats.map(toPoly).find((x): x is AreaPoly => !!x && x.geoid === fips);
    if (exact) return exact;
    if (feats.length > 0 || !fallback) return null;
    // The internal point is guaranteed to lie inside its own polygon, so a
    // small bbox around it contains the county even when the attribute query
    // is unsupported. One extra request, and only on the empty path.
    const near = await tigerCounties(bboxAround(fallback.lat, fallback.lon, 30_000), "20M");
    return near.find((c) => c.geoid === fips) ?? null;
  })
    .then((c) => c.value)
    .catch(() => null);
}

/**
 * One state's generalized polygon by 2-digit state FIPS. A filter over the
 * tigerStates() 24 h cache, so it costs no additional upstream request.
 * Unlike the county layer, the state layer does carry STUSAB.
 */
export function tigerStateByGeoid(stateFips: string): Promise<AreaPoly | null> {
  return tigerStates()
    .then((all) => all.find((s) => s.geoid === stateFips) ?? null)
    .catch(() => null);
}

/** State FIPS -> USPS abbreviation and name, from the states layer. */
export async function stateLookup(): Promise<Map<string, { stusab: string; name: string }>> {
  const states = await tigerStates();
  return new Map(states.map((s) => [s.geoid, { stusab: s.stusab ?? "", name: s.name }]));
}

// ---------------------------------------------------------------- BTS Socrata

const BTS = "https://data.bts.gov/resource";
const MEASURES = ["Trucks", "Trains", "Buses", "Personal Vehicles", "Pedestrians", "Personal Vehicle Passengers", "Train Passengers", "Bus Passengers"];

interface BorderRaw {
  port_code: string;
  port_name: string;
  state: string;
  border: string;
  date: string;
  measure: string;
  value: string;
  latitude?: string;
  longitude?: string;
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** Every land port of entry with 25 months of counts per measure. */
export function borderCrossings(): Promise<{ asOf: string; rows: CrossingRow[] }> {
  return cached("bts:border", 6 * H, async () => {
    const from = new Date();
    from.setUTCDate(1);
    from.setUTCMonth(from.getUTCMonth() - 26);
    const where = `date >= '${from.toISOString().slice(0, 10)}' AND measure in(${MEASURES.map((m) => `'${m}'`).join(",")})`;
    const qs = new URLSearchParams({
      $select: "port_code,port_name,state,border,date,measure,value,latitude,longitude",
      $where: where,
      $limit: "60000",
    });
    const raw = await polite("bts", 250, 60_000, () => upstreamJson<BorderRaw[]>("bts-border", `${BTS}/keg4-3bc2.json?${qs}`, { timeoutMs: 45_000 }));
    const ports = new Map<string, { row: Omit<CrossingRow, "measures" | "asOf">; series: Map<string, Map<string, number>> }>();
    let asOf = "";
    for (const r of raw) {
      const lat = Number(r.latitude);
      const lon = Number(r.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const v = Number(r.value);
      if (!Number.isFinite(v)) continue;
      let p = ports.get(r.port_code);
      if (!p) {
        p = { row: { code: r.port_code, name: r.port_name, state: r.state, border: r.border, lon, lat }, series: new Map() };
        ports.set(r.port_code, p);
      }
      let m = p.series.get(r.measure);
      if (!m) {
        m = new Map();
        p.series.set(r.measure, m);
      }
      const mk = monthKey(r.date);
      m.set(mk, (m.get(mk) ?? 0) + v);
      if (mk > asOf) asOf = mk;
    }
    const rows: CrossingRow[] = [];
    for (const p of ports.values()) {
      const measures: Record<string, CrossingMeasure> = {};
      for (const [name, m] of p.series) {
        const series = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-25) as Array<[string, number]>;
        if (!series.length) continue;
        const [latestDate, latest] = series[series.length - 1];
        const yearAgo = series.find((s) => s[0] === shiftMonth(latestDate, -12));
        measures[name] = { latest, latestDate, yoyPct: yearAgo && yearAgo[1] > 0 ? ((latest - yearAgo[1]) / yearAgo[1]) * 100 : null, series };
      }
      if (Object.keys(measures).length) rows.push({ ...p.row, asOf: measures.Trucks?.latestDate ?? asOf, measures });
    }
    return { asOf, rows };
  }).then((c) => c.value);
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

interface PortRaw {
  cargo_type: string;
  port_id: string;
  port_name: string;
  reporting_year: string;
  trade_type: string;
  units: string;
  port_ranking?: string;
  percent_change?: string;
  volume?: string;
}

function volumeStat(rows: PortRaw[], cargo: string): VolumeStat | undefined {
  const mine = rows.filter((r) => r.cargo_type === cargo);
  if (!mine.length) return undefined;
  const years = [...new Set(mine.map((r) => Number(r.reporting_year)))].sort((a, b) => a - b);
  const latest = years[years.length - 1];
  const pick = (t: string) => mine.find((r) => Number(r.reporting_year) === latest && r.trade_type === t);
  const v = (t: string) => cellNum(pick(t)?.volume);
  const tot = pick("TOTAL");
  const series: Array<[number, number]> = [];
  for (const y of years) {
    const r = mine.find((x) => Number(x.reporting_year) === y && x.trade_type === "TOTAL");
    const n = cellNum(r?.volume);
    if (n != null) series.push([y, n]);
  }
  return {
    total: v("TOTAL"),
    imports: v("IMPORTS"),
    exports: v("EXPORTS"),
    domestic: v("DOMESTIC"),
    foreign: v("FOREIGN"),
    empty: v("EMPTY"),
    ranking: cellNum(tot?.port_ranking),
    pctChange: cellNum(tot?.percent_change),
    series,
  };
}

/** BTS Port Performance statistics keyed by World Port Index id, plus authorities placed at a city. */
export function btsPortStats(): Promise<{ byWpi: Map<number, PortStats>; extraPorts: Array<{ port: WpiPort; stats: PortStats }>; year: number }> {
  return cached("bts:ports", 24 * H, async () => {
    const raw = await polite("bts", 250, 60_000, () => upstreamJson<PortRaw[]>("bts-ports", `${BTS}/5rpz-kgm9.json?$limit=20000`, { timeoutMs: 45_000 }));
    const byPort = new Map<string, PortRaw[]>();
    for (const r of raw) {
      let a = byPort.get(r.port_id);
      if (!a) {
        a = [];
        byPort.set(r.port_id, a);
      }
      a.push(r);
    }
    const byWpi = new Map<number, PortStats>();
    const extraPorts: Array<{ port: WpiPort; stats: PortStats }> = [];
    let maxYear = 0;
    for (const p of BTS_PLACEMENTS) {
      const rows = byPort.get(p.portId);
      if (!rows) continue;
      const year = Math.max(...rows.map((r) => Number(r.reporting_year)).filter(Number.isFinite));
      maxYear = Math.max(maxYear, year);
      const top = (cargo: string) =>
        rows
          .filter((r) => r.cargo_type === cargo && Number(r.reporting_year) === year && r.trade_type !== "TOTAL")
          .map((r): [string, number] => [r.trade_type, cellNum(r.volume) ?? 0])
          .filter((x) => x[1] > 0)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5);
      const stats: PortStats = {
        portId: p.portId,
        name: p.name,
        position: p.position,
        year,
        container: volumeStat(rows, "CONTAINER"),
        tonnage: volumeStat(rows, "TOTAL TONNAGE"),
        dryBulk: volumeStat(rows, "DRY BULK"),
        vesselCalls: top("VESSEL CALLS"),
        topCommodities: top("TOP 5 COMMODITIES"),
        topFarm: top("TOP 5 FOOD/FARM COMMODITIES"),
      };
      if (p.wpi != null) {
        const prev = byWpi.get(p.wpi);
        // Two BTS ids on one harbour (Boston): keep the one with more data.
        if (!prev || (stats.tonnage?.total ?? 0) > (prev.tonnage?.total ?? 0)) byWpi.set(p.wpi, stats);
      } else {
        extraPorts.push({
          port: {
            id: -Number(p.portId),
            name: p.name.replace(/,\s*[A-Z]{2}.*$/, "").replace(/\bPort of\b|\bPort Authority\b/gi, "").trim() || p.name,
            country: "United States",
            region: p.state,
            lat: p.lat,
            lon: p.lon,
            size: null,
            channelM: null,
            anchorageM: null,
            cargoPierM: null,
            oilM: null,
            lngM: null,
            maxLengthM: null,
            maxDraftM: null,
            tidalRangeM: null,
            facilities: [],
          },
          stats,
        });
      }
    }
    return { byWpi, extraPorts, year: maxYear };
  }).then((c) => c.value);
}

export interface PulseItem {
  id: string;
  label: string;
  value: number;
  unit: string;
  date: string;
  prev: number | null;
  prevDate: string | null;
  changePct: number | null;
  source: string;
  /** [date, value] oldest first. */
  series: Array<[string, number]>;
}

interface IndicatorRaw {
  indicator: string;
  measure1?: string;
  date: string;
  value1: string;
  units: string;
  source?: string;
}

const BTS_INDICATORS: Array<{ indicator: string; measure1?: string; label: string; id: string }> = [
  { indicator: "Capacity of Containerships Calling at U.S. Ports (in TEUs)", label: "containership capacity calling at US ports (weekly)", id: "bts-capacity" },
  { indicator: "Number of Containerships Awaiting Berths at all U.S. Ports", measure1: "All U.S. Container Ports", label: "containerships waiting for a berth", id: "bts-berths" },
  { indicator: "Freight Rates in $ per 40ft Container from Shanghai to LA", label: "Shanghai → LA, $ per 40 ft box", id: "bts-shanghai-la" },
  { indicator: "Containerized Imports at U.S. Ports in TEUs", label: "containerized imports, TEU (monthly)", id: "bts-imports-teu" },
  { indicator: "Freight Transportation Services Index", label: "freight transportation services index", id: "bts-tsi" },
  { indicator: "U.S. Class I Rail Intermodal Units", label: "rail intermodal units (weekly)", id: "bts-intermodal" },
  { indicator: "Total Business: Inventory to Sales Ratio", label: "business inventory-to-sales ratio", id: "bts-inv-sales" },
  { indicator: "U.S. Diesel Sales Prices  (in Dollars per Gallon)", label: "diesel, $ per gallon", id: "bts-diesel" },
];

export function btsIndicators(): Promise<PulseItem[]> {
  return cached("bts:indicators", 6 * H, async () => {
    const names = BTS_INDICATORS.map((i) => `'${i.indicator.replace(/'/g, "''")}'`).join(",");
    const qs = new URLSearchParams({
      $select: "indicator,measure1,date,value1,units,source",
      $where: `indicator in(${names})`,
      $order: "date DESC",
      $limit: "6000",
    });
    const raw = await polite("bts", 250, 60_000, () => upstreamJson<IndicatorRaw[]>("bts-indicators", `${BTS}/y5ut-ibwt.json?${qs}`, { timeoutMs: 45_000 }));
    const out: PulseItem[] = [];
    for (const spec of BTS_INDICATORS) {
      const rows = raw
        .filter((r) => r.indicator === spec.indicator && (spec.measure1 ? r.measure1 === spec.measure1 : !r.measure1))
        .map((r) => ({ date: r.date.slice(0, 10), value: Number(r.value1), units: r.units, source: r.source }))
        .filter((r) => Number.isFinite(r.value))
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      if (!rows.length) continue;
      const last = rows[rows.length - 1];
      const prev = rows.length > 1 ? rows[rows.length - 2] : null;
      out.push({
        id: spec.id,
        label: spec.label,
        value: last.value,
        unit: last.units,
        date: last.date,
        prev: prev?.value ?? null,
        prevDate: prev?.date ?? null,
        changePct: prev && prev.value !== 0 ? ((last.value - prev.value) / Math.abs(prev.value)) * 100 : null,
        source: last.source ? `BTS Supply Chain Indicators (${last.source.slice(0, 60)})` : "BTS Supply Chain Indicators",
        series: rows.slice(-26).map((r): [string, number] => [r.date, r.value]),
      });
    }
    return out;
  }).then((c) => c.value);
}

// ---------------------------------------------------------------- FRED

export const FRED_SERIES: Array<{ id: string; label: string; unit: string }> = [
  { id: "MORTGAGE30US", label: "30-year fixed mortgage rate", unit: "%" },
  { id: "RSXFS", label: "retail sales ex food services (monthly)", unit: "$ millions" },
  { id: "BOPGSTB", label: "goods and services trade balance (monthly)", unit: "$ millions" },
  { id: "DCOILWTICO", label: "WTI crude oil", unit: "$ per barrel" },
  { id: "UNRATE", label: "unemployment rate", unit: "%" },
  { id: "HOUST", label: "housing starts (annual rate)", unit: "thousands" },
  { id: "PERMIT", label: "building permits (annual rate)", unit: "thousands" },
  { id: "MSPUS", label: "median sales price of houses sold (quarterly)", unit: "$" },
  { id: "CSUSHPINSA", label: "Case-Shiller US home price index", unit: "index, Jan 2000 = 100" },
  { id: "TOTALSA", label: "vehicle sales (annual rate)", unit: "millions" },
];

export function fred(id: string): Promise<PulseItem | null> {
  const spec = FRED_SERIES.find((s) => s.id === id);
  return cached("fred:" + id, 1 * H, async () => {
    const csv = await polite("fred", 200, 60_000, () => text("fred", `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`, 20_000));
    const rows = parseCsv(csv)
      .slice(1)
      .map((r) => [r[0], cellNum(r[1])] as [string, number | null])
      .filter((r): r is [string, number] => r[1] != null && /^\d{4}-\d{2}-\d{2}$/.test(r[0]));
    if (!rows.length) return null;
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const item: PulseItem = {
      id,
      label: spec?.label ?? id,
      value: last[1],
      unit: spec?.unit ?? "",
      date: last[0],
      prev: prev?.[1] ?? null,
      prevDate: prev?.[0] ?? null,
      changePct: prev && prev[1] !== 0 ? ((last[1] - prev[1]) / Math.abs(prev[1])) * 100 : null,
      source: `FRED ${id}`,
      series: rows.slice(-60),
    };
    return item;
  }).then((c) => c.value);
}

// ---------------------------------------------------------------- World Bank + WITS

const WB_IND: Array<{ code: string; key: keyof Omit<CountryStats, "iso3" | "name"> }> = [
  { code: "NY.GDP.MKTP.CD", key: "gdp" },
  { code: "BX.GSR.GNFS.CD", key: "exports" },
  { code: "BM.GSR.GNFS.CD", key: "imports" },
  { code: "NE.TRD.GNFS.ZS", key: "tradePct" },
  { code: "IS.SHP.GOOD.TU", key: "teu" },
];

interface WbRow {
  countryiso3code: string;
  country: { value: string };
  date: string;
  value: number | null;
}

function wbIndicator(code: string): Promise<WbRow[]> {
  return cached("wb:" + code, 24 * H, async () => {
    const j = await polite("worldbank", 150, 60_000, () =>
      upstreamJson<[unknown, WbRow[]]>("worldbank", `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&mrnev=1&per_page=400`, {
        timeoutMs: 25_000,
      }),
    );
    return Array.isArray(j[1]) ? j[1] : [];
  }).then((c) => c.value);
}

/** Most recent value per country for each indicator; indicators that fail are simply absent. */
export async function worldBank(): Promise<{ stats: Map<string, CountryStats>; failed: string[] }> {
  const results = await Promise.allSettled(WB_IND.map((i) => wbIndicator(i.code)));
  const stats = new Map<string, CountryStats>();
  const failed: string[] = [];
  results.forEach((res, i) => {
    const spec = WB_IND[i];
    if (res.status !== "fulfilled") {
      failed.push(spec.code);
      return;
    }
    for (const r of res.value) {
      if (r.value == null || !r.countryiso3code) continue;
      let s = stats.get(r.countryiso3code);
      if (!s) {
        s = { iso3: r.countryiso3code, name: r.country.value };
        stats.set(r.countryiso3code, s);
      }
      s[spec.key] = { value: r.value, year: r.date };
    }
  });
  return { stats, failed };
}

interface SdmxSeries {
  observations: Record<string, [number | null, ...unknown[]]>;
}
interface Sdmx {
  dataSets: Array<{ series: Record<string, SdmxSeries> }>;
  structure: { dimensions: { series: Array<{ id: string; values: Array<{ id: string; name: string }> }> } };
}

async function witsSide(iso3: string, year: number, indicator: "XPRT-TRD-VL" | "MPRT-TRD-VL"): Promise<Map<string, number> | null> {
  const url = `https://wits.worldbank.org/API/V1/SDMX/V21/datasource/tradestats-trade/reporter/${iso3.toLowerCase()}/year/${year}/partner/all/product/Total/indicator/${indicator}?format=JSON`;
  try {
    const j = await polite("wits", 300, 60_000, () => upstreamJson<Sdmx>("wits", url, { timeoutMs: 30_000 }));
    const dims = j.structure.dimensions.series;
    const pi = dims.findIndex((d) => d.id === "PARTNER");
    const partners = dims[pi].values;
    const out = new Map<string, number>();
    for (const [k, s] of Object.entries(j.dataSets[0].series)) {
      const idx = Number(k.split(":")[pi]);
      const obs = Object.values(s.observations)[0];
      const v = obs?.[0];
      if (v == null || !Number.isFinite(v)) continue;
      out.set(partners[idx].id, v);
    }
    return out;
  } catch (err) {
    if (err instanceof Error && /404/.test(err.message)) return null;
    throw err;
  }
}

const countryIndex = new Map<string, { name: string; lx: number; ly: number }>(COUNTRIES.features.map((f) => [f.properties.iso3, { name: f.properties.name, lx: f.properties.lx, ly: f.properties.ly }]));

/** Top trading partners of a country (WITS TradeStats, latest year published). */
export function witsPartners(iso3: string): Promise<Partners | null> {
  return cached("wits:" + iso3, 24 * H, async () => {
    const thisYear = new Date().getUTCFullYear();
    for (let year = thisYear - 1; year >= thisYear - 4; year--) {
      const [x, m] = await Promise.all([witsSide(iso3, year, "XPRT-TRD-VL"), witsSide(iso3, year, "MPRT-TRD-VL")]);
      if (!x && !m) continue;
      const list = (side: Map<string, number> | null): { total: number | null; top: Partner[] } => {
        if (!side) return { total: null, top: [] };
        const total = side.get("WLD") ?? null;
        const top: Partner[] = [];
        for (const [code, value] of side) {
          const c = countryIndex.get(code);
          if (!c || code === iso3) continue;
          top.push({ iso3: code, name: c.name, value, sharePct: total ? (value / total) * 100 : null, lon: c.lx, lat: c.ly });
        }
        top.sort((a, b) => b.value - a.value);
        return { total, top: top.slice(0, 15) };
      };
      const ex = list(x);
      const im = list(m);
      return { iso3, year, exportsTotal: ex.total, importsTotal: im.total, exports: ex.top, imports: im.top } satisfies Partners;
    }
    return null;
  }).then((c) => c.value);
}

// ---------------------------------------------------------------- History readers
//
// The readers above keep only what the globe needs (latest value, 25 months,
// 11 yearly points) so the county table stays small. The research routes need
// the whole history, so these variants keep every column / quarter / week.
// Parsers live in lib/economy/history so they can be tested on fixtures.

import { parseZillowHistory, type ZillowHistoryTable } from "./history/zillowCsv";

/** Full monthly history of one Zillow file (every region, every month column). Cached 6 h. */
export function zillowHistory(kind: ZillowKind): Promise<ZillowHistoryTable> {
  return cached("zillow:history:" + kind, 6 * H, async () => parseZillowHistory(kind, await text("zillow", ZILLOW_FILES[kind], 60_000))).then(
    (c) => c.value,
  );
}

/** Where a QCEW area slice lives (`qtr` "a" is the annual-average slice); exported so provenance can cite the exact file. */
export function qcewAreaUrl(fips: string, year: number, qtr: QcewQtr): string {
  return `${QCEW}/${year}/${qtr}/area/${fips}.csv`;
}

/**
 * Industry 10 row for one area and period from the per-area BLS slice:
 * all covered employment (ownership 0) unless `own` names another ownership
 * ("5" is private). Areas: county SSCCC, state SS000, US000, a metropolitan
 * or micropolitan C-code, or a CS-code. `qtr` "a" reads the annual averages.
 * Null when the file has no such row. One BLS request per area-period, gated
 * to about three per second and cached 12 h; a period BLS has not published
 * yet raises an UpstreamError.
 */
export function qcewAreaTotal(fips: string, year: number, qtr: QcewQtr, opts: { own?: string } = {}): Promise<QcewTotalRow | null> {
  const own = opts.own ?? "0";
  return cached(`qcew:area-total:${fips}:${year}:${qtr}:${own}`, 12 * H, async () => {
    const csv = await polite("bls", 300, 60_000, () => text("bls-qcew", qcewAreaUrl(fips, year, qtr)));
    return parseQcewAreaTotal(csv, fips, year, qtr, { own });
  }).then((c) => c.value);
}

/** Every (date, value) row of a FRED series; missing values ('.') are null. Cached 6 h. */
export function fredSeries(id: string): Promise<Array<[string, number | null]>> {
  return cached("fred:series:" + id, 6 * H, async () => {
    const csv = await polite("fred", 200, 60_000, () => text("fred", `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}`, 20_000));
    return parseCsv(csv)
      .slice(1)
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r[0] ?? ""))
      .map((r): [string, number | null] => [r[0], cellNum(r[1])]);
  }).then((c) => c.value);
}

// ---------------------------------------------------------------- TIGERweb county points (screener)

/** A county or state with its Census internal point but no polygon. */
export type AreaPoint = Omit<AreaPoly, "geometry">;

interface TigerPointFeature {
  properties: { GEOID: string; NAME: string; STATE?: string; STUSAB?: string; CENTLAT: string; CENTLON: string };
}

/**
 * Every county (and county equivalent) with its Census internal point and
 * no geometry: what a nationwide screen needs without pulling 3,000 polygons.
 * Pages through the 1:20M county layer with returnGeometry=false; the USPS
 * state code is filled from the states layer because county rows carry
 * only the state FIPS. Cached 24 h (boundaries change once a year).
 */
export function tigerCountyPoints(): Promise<AreaPoint[]> {
  return cached("tiger:county-points", 24 * H, async () => {
    // shape per https://tigerweb.geo.census.gov/arcgis/sdk/rest/query.html (resultOffset / resultRecordCount paging); unverified in sandbox
    const page = 2000;
    const out: AreaPoint[] = [];
    for (let offset = 0; offset < 10 * page; offset += page) {
      const qs = new URLSearchParams({
        where: "1=1",
        outFields: "GEOID,NAME,STATE,CENTLAT,CENTLON",
        returnGeometry: "false",
        outSR: "4326",
        f: "geojson",
        orderByFields: "GEOID",
        resultOffset: String(offset),
        resultRecordCount: String(page),
      });
      const j = await polite("tigerweb", 150, 30_000, () =>
        upstreamJson<{ features?: TigerPointFeature[]; error?: { message: string } }>("tigerweb", `${TIGER}/${TIGER_LAYER.county["20M"]}/query?${qs}`, { timeoutMs: 40_000 }),
      );
      if (j.error) throw new Error("TIGERweb: " + j.error.message);
      const feats = j.features ?? [];
      for (const f of feats) {
        const lat = Number(f.properties.CENTLAT);
        const lon = Number(f.properties.CENTLON);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !f.properties.GEOID) continue;
        out.push({ geoid: f.properties.GEOID, name: f.properties.NAME, lon, lat });
      }
      if (feats.length < page) break;
    }
    const states = await stateLookup().catch(() => null);
    return out.map((p) => (states ? { ...p, stusab: states.get(p.geoid.slice(0, 2))?.stusab } : p));
  }).then((c) => c.value);
}

// ---------------------------------------------------------------- BLS OEWS MSA occupations (bundled, keyless)

// The implementation lives in ./oews so that a caller who only needs the
// bundled occupation tables does not pay this module's static JSON imports.
// Re-exported here because every existing caller reaches for it by this name.
export { OEWS_AS_OF, oewsMsaIndex, oewsMsaJobs } from "./oews";
