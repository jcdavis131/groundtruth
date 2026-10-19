// Pure builders and shared types for the trade, commerce and real-estate
// layers. Upstream rows in, GeoJSON features out; shared by the browser
// layers (lib/layers/trade.ts, commerce.ts, realestate.ts) and the server
// report (app/api/economy?op=report). Nothing here touches the network, the
// store or Cesium.
//
// Values are never invented: a suppressed QCEW cell stays null, a county
// Zillow does not model has no `home`, a port with no BTS statistics shows
// only what the World Port Index says about it.

import type { MultiPolygon, Point, Polygon } from "geojson";
import type { BaseProps, LayerFeature, LayerId } from "@/lib/layers/types";

// ---- Zillow (ZHVI typical home value, ZORI typical rent)

export interface HomeValue {
  /** County GEOID, state name or metro RegionID depending on the file. */
  id: string;
  name: string;
  state?: string;
  metro?: string;
  sizeRank: number;
  /** Month the latest value is for, e.g. "2026-07-31". */
  asOf: string;
  latest: number;
  /** Change over 12 / 60 months, percent; null when the older value is missing. */
  yoyPct: number | null;
  y5Pct: number | null;
  /** Last 25 months, oldest first. */
  monthly: Array<[string, number]>;
  /** Same month each year for the last 11 years, oldest first. */
  yearly: Array<[string, number]>;
}
export type RentValue = HomeValue;

// ---- BLS QCEW (jobs, employers, wages)

export interface JobsRow {
  area: string;
  /** "2026 Q1". */
  period: string;
  estabs: number | null;
  /** Third-month employment level of the quarter (the annual average when read from an annual slice). */
  emp: number | null;
  /** Total wages for the period, dollars. */
  wages: number | null;
  avgWeeklyWage: number | null;
  /** Over-the-year percent changes as BLS publishes them. */
  yoy: { estabs: number | null; emp: number | null; wages: number | null; avgWeeklyWage: number | null };
  /** BLS withheld the cell: any non-blank disclosure code (N, or the undocumented "-" that carries zeros). Every value above is null. */
  suppressed: boolean;
}

export interface SectorRow {
  code: string;
  title: string;
  estabs: number | null;
  emp: number | null;
  avgWeeklyWage: number | null;
  /** Employment location quotient vs the nation (1 = national share). */
  lq: number | null;
  yoyEmp: number | null;
  suppressed: boolean;
}

export const NAICS_SECTOR: Record<string, string> = {
  "11": "Agriculture, forestry, fishing",
  "21": "Mining, oil and gas",
  "22": "Utilities",
  "23": "Construction",
  "31-33": "Manufacturing",
  "42": "Wholesale trade",
  "44-45": "Retail trade",
  "48-49": "Transportation and warehousing",
  "51": "Information",
  "52": "Finance and insurance",
  "53": "Real estate and rental",
  "54": "Professional and technical services",
  "55": "Management of companies",
  "56": "Administrative and waste services",
  "61": "Educational services",
  "62": "Health care and social assistance",
  "71": "Arts, entertainment and recreation",
  "72": "Accommodation and food services",
  "81": "Other services",
  "99": "Unclassified",
};

// ---- Census TIGERweb polygons

export interface AreaPoly {
  geoid: string;
  name: string;
  stusab?: string;
  /** Internal point published by the Census Bureau (label anchor). */
  lon: number;
  lat: number;
  geometry: Polygon | MultiPolygon;
}

export type AreaLevel = "county" | "state";

export interface AreaExtra {
  geoid: string;
  level: AreaLevel;
  name: string;
  stusab?: string;
  stateName?: string;
  metro?: string;
  jobs?: JobsRow;
  home?: HomeValue;
  rent?: RentValue;
  /** The few largest areas in a response, by jobs and by home value; tagArea picks one as `labelled`. */
  topJobs?: boolean;
  topHome?: boolean;
  labelled?: boolean;
}

export interface AreaJoins {
  jobs: Map<string, JobsRow>;
  home: Map<string, HomeValue>;
  rent: Map<string, RentValue>;
  /** GEOID -> metro name (from Zillow's county file). */
  stateNames?: Map<string, string>;
}

// ---- Ports (World Port Index + BTS Port Performance)

export interface WpiPort {
  id: number;
  name: string;
  alt?: string;
  locode?: string;
  country: string;
  region: string;
  water?: string;
  lat: number;
  lon: number;
  size: "very small" | "small" | "medium" | "large" | null;
  type?: string;
  use?: string;
  shelter?: string;
  channelM: number | null;
  anchorageM: number | null;
  cargoPierM: number | null;
  oilM: number | null;
  lngM: number | null;
  maxLengthM: number | null;
  maxDraftM: number | null;
  tidalRangeM: number | null;
  facilities: string[];
  repairs?: string;
  firstPortOfEntry?: boolean;
  pilotageCompulsory?: boolean;
  vts?: boolean;
  chart?: string;
}

export interface VolumeStat {
  total: number | null;
  imports: number | null;
  exports: number | null;
  domestic: number | null;
  foreign: number | null;
  empty: number | null;
  ranking: number | null;
  pctChange: number | null;
  /** [year, total] oldest first. */
  series: Array<[number, number]>;
}

export interface PortStats {
  portId: string;
  name: string;
  /** How the BTS authority was placed on the map (World Port Index entry or a city point). */
  position: string;
  /** Latest reporting year with statistics. */
  year: number;
  container?: VolumeStat;
  tonnage?: VolumeStat;
  dryBulk?: VolumeStat;
  vesselCalls: Array<[string, number]>;
  topCommodities: Array<[string, number]>;
  topFarm: Array<[string, number]>;
}

export interface PortExtra {
  wpi: WpiPort;
  stats?: PortStats;
  labelled?: boolean;
}

// ---- Land border crossings (BTS)

export interface CrossingMeasure {
  latest: number;
  latestDate: string;
  yoyPct: number | null;
  /** [month, value] oldest first, 25 months. */
  series: Array<[string, number]>;
}

export interface CrossingRow {
  code: string;
  name: string;
  state: string;
  border: string;
  lon: number;
  lat: number;
  asOf: string;
  measures: Record<string, CrossingMeasure>;
}

export type CrossingExtra = Omit<CrossingRow, "lon" | "lat" | "name"> & { labelled?: boolean };

// ---- Countries (Natural Earth + World Bank + WITS)

export interface WbValue {
  value: number;
  year: string;
}

export interface CountryStats {
  iso3: string;
  name: string;
  gdp?: WbValue;
  exports?: WbValue;
  imports?: WbValue;
  tradePct?: WbValue;
  teu?: WbValue;
}

export interface Partner {
  iso3: string;
  name: string;
  /** US$ thousands as WITS publishes. */
  value: number;
  sharePct: number | null;
  lon: number;
  lat: number;
}

export interface Partners {
  iso3: string;
  year: number;
  exportsTotal: number | null;
  importsTotal: number | null;
  exports: Partner[];
  imports: Partner[];
}

export interface CountryExtra {
  iso3: string;
  iso2?: string;
  lx: number;
  ly: number;
  pop?: number;
  popYear?: number;
  continent?: string;
  wb?: CountryStats;
  /** Loaded on selection (WITS). */
  partners?: Partners;
  /** Rank by total trade among countries with data (1 = largest). */
  rank?: number;
}

export interface CountryFeatureIn {
  type: "Feature";
  properties: { name: string; nameLong?: string; iso3: string; iso2?: string; wb?: string; lx: number; ly: number; pop?: number; popYear?: number; continent?: string };
  geometry: Polygon | MultiPolygon;
}

// ---- formatting (shared by dossiers and the report)

export function fmtUsd(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)} tn`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(1)} bn`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)} m`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} bn`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)} m`;
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
}

// ---- builders

const SIZE_RANK: Record<string, number> = { large: 3, medium: 2, small: 1, "very small": 0 };

function base(layer: LayerId, id: string, name: string, kind: string, source: string): BaseProps {
  return { id, layer, name, kind, source };
}

/**
 * TIGERweb polygons joined with QCEW and Zillow -> one neutral feature per
 * area carrying every join. tagArea() then dresses a copy for a layer.
 */
export function buildAreas(polys: AreaPoly[], level: AreaLevel, joins: AreaJoins): LayerFeature<Polygon | MultiPolygon>[] {
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  for (const p of polys) {
    const jobs = joins.jobs.get(p.geoid);
    const home = joins.home.get(p.geoid);
    const rent = joins.rent.get(p.geoid);
    if (!jobs && !home) continue;
    const stateName = joins.stateNames?.get(p.geoid) ?? (level === "state" ? p.name : undefined);
    const extra: AreaExtra = { geoid: p.geoid, level, name: p.name, stusab: p.stusab, stateName, metro: home?.metro, jobs, home, rent };
    out.push({
      type: "Feature",
      geometry: p.geometry,
      properties: { ...base("realestate", `${level}:${p.geoid}`, p.name, level, "Census TIGERweb"), anchor: [p.lon, p.lat], extra },
    });
  }
  // Standing labels: the dozen largest by employment and by home value (all states).
  const n = level === "state" ? 60 : 12;
  const x = (f: LayerFeature) => f.properties.extra as AreaExtra;
  [...out]
    .sort((a, b) => (x(b).jobs?.emp ?? 0) - (x(a).jobs?.emp ?? 0))
    .slice(0, n)
    .forEach((f) => (x(f).topJobs = true));
  [...out]
    .sort((a, b) => (x(b).home?.latest ?? 0) - (x(a).home?.latest ?? 0))
    .slice(0, n)
    .forEach((f) => (x(f).topHome = true));
  return out;
}

/** A layer-specific copy of a neutral area feature, or null when the layer has nothing to show there. */
export function tagArea(f: LayerFeature<Polygon | MultiPolygon>, layer: "commerce" | "realestate"): LayerFeature<Polygon | MultiPolygon> | null {
  const x = f.properties.extra as AreaExtra;
  const { jobs, home, rent, level } = x;
  if (layer === "commerce" && !jobs) return null;
  if (layer === "realestate" && !home) return null;
  const details: BaseProps["details"] = {};
  if (layer === "commerce" && jobs) {
    details.period = jobs.period;
    details.jobs = jobs.suppressed ? "withheld by BLS" : fmtNum(jobs.emp);
    details["jobs YoY"] = fmtPct(jobs.yoy.emp);
    details.employers = fmtNum(jobs.estabs);
    details["avg wage/wk"] = jobs.avgWeeklyWage != null ? fmtUsd(jobs.avgWeeklyWage) : "n/a";
    details["wage YoY"] = fmtPct(jobs.yoy.avgWeeklyWage);
    details["wages/qtr"] = fmtUsd(jobs.wages);
    if (home) details["home value"] = `${fmtUsd(home.latest)} (${fmtPct(home.yoyPct)} 1-yr)`;
  }
  if (layer === "realestate" && home) {
    details["home value"] = fmtUsd(home.latest);
    details["1-yr change"] = fmtPct(home.yoyPct);
    details["5-yr change"] = fmtPct(home.y5Pct);
    details["as of"] = monthLabel(home.asOf);
    if (rent) {
      details.rent = `${fmtUsd(rent.latest)}/mo`;
      details["rent 1-yr"] = fmtPct(rent.yoyPct);
      details["price/rent"] = (home.latest / (rent.latest * 12)).toFixed(1) + "× annual rent";
    }
    if (home.metro) details.metro = home.metro;
    if (jobs?.avgWeeklyWage != null) details["avg wage/wk"] = fmtUsd(jobs.avgWeeklyWage);
  }
  const name = level === "state" ? x.name : x.stusab ? `${x.name}, ${x.stusab}` : x.name;
  return {
    type: "Feature",
    geometry: f.geometry,
    properties: {
      ...f.properties,
      ...base(layer, f.properties.id, name, level, layer === "commerce" ? "BLS QCEW · Census TIGERweb" : "Zillow Research · Census TIGERweb"),
      details,
      extra: { ...x, labelled: layer === "commerce" ? !!x.topJobs : !!x.topHome },
    },
  };
}

/** World Port Index entries (already filtered to the view) with BTS statistics where matched. */
export function buildPorts(ports: WpiPort[], stats: Map<number, PortStats>): LayerFeature<Point>[] {
  return ports.map((w) => {
    const s = stats.get(w.id);
    const details: BaseProps["details"] = {
      size: w.size ?? undefined,
      type: w.type,
      use: w.use,
      country: w.country,
      LOCODE: w.locode,
      water: w.water,
      channel: w.channelM ? `${w.channelM.toFixed(1)} m` : undefined,
      "max draft": w.maxDraftM ? `${w.maxDraftM.toFixed(1)} m` : undefined,
      "cargo pier": w.cargoPierM ? `${w.cargoPierM.toFixed(1)} m` : undefined,
      "oil depth": w.oilM ? `${w.oilM.toFixed(1)} m` : undefined,
      "LNG depth": w.lngM ? `${w.lngM.toFixed(1)} m` : undefined,
      facilities: w.facilities.length ? w.facilities.join(", ") : undefined,
      repairs: w.repairs && w.repairs !== "Unknown" && w.repairs !== "None" ? w.repairs : undefined,
      shelter: w.shelter && w.shelter !== "Unknown" ? w.shelter : undefined,
      pilotage: w.pilotageCompulsory ? "compulsory" : undefined,
    };
    if (s) {
      if (s.container?.total != null) {
        details[`TEU ${s.year}`] = fmtNum(s.container.total);
        if (s.container.ranking != null) details["TEU rank"] = `#${s.container.ranking} US · ${fmtPct(s.container.pctChange)} YoY`;
      }
      if (s.tonnage?.total != null) {
        details[`tons ${s.year}`] = fmtNum(s.tonnage.total);
        if (s.tonnage.ranking != null) details["tons rank"] = `#${s.tonnage.ranking} US · ${fmtPct(s.tonnage.pctChange)} YoY`;
      }
      if (s.topCommodities.length) details["top cargo"] = s.topCommodities.slice(0, 3).map(([n]) => n).join(", ");
      details.authority = s.name;
      details.placed = s.position;
    }
    const extra: PortExtra = { wpi: w, stats: s };
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [w.lon, w.lat, 0] },
      properties: {
        ...base("trade", `port:${w.id}`, w.name, "port", s ? "NGA World Port Index · BTS Port Performance" : "NGA World Port Index"),
        details,
        extra,
      },
    };
  });
}

export function portSizeRank(p: WpiPort): number {
  return p.size ? (SIZE_RANK[p.size] ?? 0) : 0;
}

/** BTS land border crossings -> one feature per port of entry. */
export function buildCrossings(rows: CrossingRow[]): LayerFeature<Point>[] {
  return rows.map((r) => {
    const m = r.measures;
    const line = (k: string) => (m[k] ? `${fmtNum(m[k].latest)} (${fmtPct(m[k].yoyPct)} YoY)` : undefined);
    const details: BaseProps["details"] = {
      border: r.border,
      month: monthLabel(r.asOf),
      "trucks/mo": line("Trucks"),
      "trains/mo": line("Trains"),
      "buses/mo": line("Buses"),
      "cars/mo": line("Personal Vehicles"),
      "walkers/mo": line("Pedestrians"),
      "in cars": m["Personal Vehicle Passengers"] ? fmtNum(m["Personal Vehicle Passengers"].latest) : undefined,
      "on trains": m["Train Passengers"] ? fmtNum(m["Train Passengers"].latest) : undefined,
      "on buses": m["Bus Passengers"] ? fmtNum(m["Bus Passengers"].latest) : undefined,
      "port code": r.code,
    };
    const extra: CrossingExtra = { code: r.code, state: r.state, border: r.border, asOf: r.asOf, measures: r.measures };
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [r.lon, r.lat, 0] },
      properties: {
        ...base("trade", `crossing:${r.code}`, `${r.name}, ${r.state}`, "crossing", "BTS Border Crossing Entry Data"),
        details,
        extra,
      },
    };
  });
}

/** Natural Earth countries joined with World Bank indicators. */
export function buildCountries(countries: CountryFeatureIn[], wb: Map<string, CountryStats>): LayerFeature<Polygon | MultiPolygon>[] {
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  for (const c of countries) {
    const p = c.properties;
    const s = wb.get(p.iso3);
    const details: BaseProps["details"] = {};
    if (s) {
      if (s.gdp) details.GDP = `${fmtUsd(s.gdp.value)} (${s.gdp.year})`;
      if (s.exports) details.exports = `${fmtUsd(s.exports.value)} (${s.exports.year})`;
      if (s.imports) details.imports = `${fmtUsd(s.imports.value)} (${s.imports.year})`;
      if (s.exports && s.imports && s.exports.year === s.imports.year) {
        const bal = s.exports.value - s.imports.value;
        details.balance = `${bal >= 0 ? "+" : "−"}${fmtUsd(Math.abs(bal))} goods & services`;
      }
      if (s.tradePct) details["trade / GDP"] = `${s.tradePct.value.toFixed(0)}% (${s.tradePct.year})`;
      if (s.teu) details.TEU = `${fmtNum(s.teu.value)} containers (${s.teu.year})`;
    }
    if (p.pop) details.population = `${fmtNum(p.pop)}${p.popYear ? ` (${p.popYear})` : ""}`;
    const extra: CountryExtra = { iso3: p.iso3, iso2: p.iso2, lx: p.lx, ly: p.ly, pop: p.pop, popYear: p.popYear, continent: p.continent, wb: s };
    out.push({
      type: "Feature",
      geometry: c.geometry,
      properties: {
        ...base("trade", `country:${p.iso3}`, p.name, "country", s ? "World Bank WDI · Natural Earth" : "Natural Earth"),
        anchor: [p.lx, p.ly],
        details,
        extra,
      },
    });
  }
  const total = (f: LayerFeature) => {
    const w = (f.properties.extra as CountryExtra).wb;
    return (w?.exports?.value ?? 0) + (w?.imports?.value ?? 0);
  };
  [...out]
    .filter((f) => total(f) > 0)
    .sort((a, b) => total(b) - total(a))
    .forEach((f, i) => ((f.properties.extra as CountryExtra).rank = i + 1));
  return out;
}

/** Great-circle polyline between two points, n segments, degrees in / degrees out. */
export function greatCircle(lon1: number, lat1: number, lon2: number, lat2: number, n = 32): Array<[number, number]> {
  const d2r = Math.PI / 180;
  const φ1 = lat1 * d2r;
  const λ1 = lon1 * d2r;
  const φ2 = lat2 * d2r;
  const λ2 = lon2 * d2r;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (d === 0) return [[lon1, lat1], [lon2, lat2]];
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    pts.push([Math.atan2(y, x) / d2r, Math.atan2(z, Math.sqrt(x * x + y * y)) / d2r]);
  }
  return pts;
}

// ---- MSA occupations (BLS OEWS, keyless bulk) ----

/** One occupation row inside an MSA: SOC code, title, employment, mean annual wage, location quotient. */
export interface MsaOccupation {
  /** SOC code, e.g. "15-1252". The universal taxonomy key shared with O*NET. */
  c: string;
  t: string;
  e: number;
  w: number | null;
  lq: number | null;
}

/** Occupation mix for one metropolitan statistical area. */
export interface MsaJobs {
  msa: string;
  name: string;
  /** Top 30 detailed occupations by employment. */
  top: MsaOccupation[];
  /** All 22 SOC major groups by employment. */
  major: MsaOccupation[];
}

/** One row of the MSA index: the point plotted on the globe. */
export interface MsaIndexEntry {
  /** 5-digit CBSA code, e.g. "41700". */
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  emp: number | null;
  /** Most distinctive SOC major group (highest location quotient): code, title, LQ. */
  dom: string;
  domT: string;
  domLq: number | null;
}

export interface MsaExtra {
  msa: string;
  name: string;
  state: string;
  emp: number | null;
  /** Distinctive major group, for the aside to lead with. */
  domT: string;
  domLq: number | null;
}
