// Field registry for the screener: every metric a county, state, port, land
// crossing or country can be ranked or filtered by, read straight off the
// GeoJSON features the economy layers already build (lib/economy/features.ts)
// so the table and the globe never disagree.
//
// Adding a field is one object in the list for its entity kind. Getters
// return null when the upstream did not publish a value; nothing here fills
// a gap. Estimates (kind "estimate") say how they were computed in `method`
// and are tagged that way in CSV headers and provenance.

import type { Point } from "geojson";
import type { LayerFeature, LayerId } from "@/lib/layers/types";
import type { SourceId } from "@/lib/provenance/sources";
import type { AreaExtra, CountryExtra, CrossingExtra, PortExtra } from "@/lib/economy/features";
import { momentum } from "@/lib/economy/estimates";

export type EntityKind = "county" | "state" | "port" | "crossing" | "country";
export const ENTITY_KINDS: EntityKind[] = ["county", "state", "port", "crossing", "country"];

export type FieldKind = "number" | "string" | "pct" | "estimate";
export type FieldValue = number | string | null;

export interface FieldDef {
  /** Dotted key used in queries and CSV headers ("home.yoyPct"). */
  key: string;
  label: string;
  /** Unit as it appears in a CSV header ("USD", "%", "TEU", ""). */
  unit: string;
  kind: FieldKind;
  /** Registry id of the publisher, or of the inputs for an estimate. */
  source: SourceId;
  /** Estimates only: the arithmetic, in words. */
  method?: string;
  /** Shown in the table by default (the rest appear when a query uses them). */
  headline?: boolean;
  get: (f: LayerFeature) => FieldValue;
}

/** Field metadata without the getter, safe to send to a client. */
export type FieldMeta = Omit<FieldDef, "get">;

/** Layer the entity's features live on when the globe has them loaded. */
export const ENTITY_LAYERS: Record<EntityKind, LayerId[]> = {
  county: ["realestate", "commerce"],
  state: ["realestate", "commerce"],
  port: ["trade"],
  crossing: ["trade"],
  country: ["trade"],
};

/** Camera height that frames one entity of each kind, metres. */
export const ENTITY_HEIGHT: Record<EntityKind, number> = {
  county: 150_000,
  state: 1_200_000,
  port: 40_000,
  crossing: 30_000,
  country: 3_000_000,
};

const n = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);
const s = (v: string | null | undefined): string | null => (v == null || v === "" ? null : v);

// ---- counties and states (AreaExtra: Zillow home + rent, BLS QCEW jobs)

const area = (f: LayerFeature) => f.properties.extra as AreaExtra;

const AREA_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", unit: "", kind: "string", source: "census-tigerweb", headline: true, get: (f) => s(area(f).name) },
  { key: "geoid", label: "GEOID", unit: "", kind: "string", source: "census-tigerweb", get: (f) => s(area(f).geoid) },
  { key: "state", label: "State", unit: "", kind: "string", source: "census-tigerweb", headline: true, get: (f) => s(area(f).stusab ?? area(f).stateName) },
  { key: "metro", label: "Metro", unit: "", kind: "string", source: "zillow-zhvi", get: (f) => s(area(f).metro) },
  { key: "home.latest", label: "Typical home value", unit: "USD", kind: "number", source: "zillow-zhvi", headline: true, get: (f) => n(area(f).home?.latest) },
  { key: "home.yoyPct", label: "Home value 1-yr change", unit: "%", kind: "pct", source: "zillow-zhvi", headline: true, get: (f) => n(area(f).home?.yoyPct) },
  { key: "home.y5Pct", label: "Home value 5-yr change", unit: "%", kind: "pct", source: "zillow-zhvi", get: (f) => n(area(f).home?.y5Pct) },
  { key: "home.asOf", label: "Home value month", unit: "", kind: "string", source: "zillow-zhvi", get: (f) => s(area(f).home?.asOf) },
  { key: "rent.latest", label: "Typical rent", unit: "USD/month", kind: "number", source: "zillow-zori", headline: true, get: (f) => n(area(f).rent?.latest) },
  { key: "rent.yoyPct", label: "Rent 1-yr change", unit: "%", kind: "pct", source: "zillow-zori", get: (f) => n(area(f).rent?.yoyPct) },
  { key: "jobs.emp", label: "Jobs (third month of quarter)", unit: "jobs", kind: "number", source: "bls-qcew", headline: true, get: (f) => n(area(f).jobs?.emp) },
  { key: "jobs.estabs", label: "Establishments", unit: "count", kind: "number", source: "bls-qcew", get: (f) => n(area(f).jobs?.estabs) },
  { key: "jobs.wages", label: "Total quarterly wages", unit: "USD", kind: "number", source: "bls-qcew", get: (f) => n(area(f).jobs?.wages) },
  { key: "jobs.avgWeeklyWage", label: "Average weekly wage", unit: "USD/week", kind: "number", source: "bls-qcew", headline: true, get: (f) => n(area(f).jobs?.avgWeeklyWage) },
  { key: "jobs.yoy.emp", label: "Jobs over-the-year change", unit: "%", kind: "pct", source: "bls-qcew", headline: true, get: (f) => n(area(f).jobs?.yoy.emp) },
  { key: "jobs.yoy.estabs", label: "Establishments over-the-year change", unit: "%", kind: "pct", source: "bls-qcew", get: (f) => n(area(f).jobs?.yoy.estabs) },
  { key: "jobs.yoy.wages", label: "Total wages over-the-year change", unit: "%", kind: "pct", source: "bls-qcew", get: (f) => n(area(f).jobs?.yoy.wages) },
  { key: "jobs.yoy.avgWeeklyWage", label: "Weekly wage over-the-year change", unit: "%", kind: "pct", source: "bls-qcew", get: (f) => n(area(f).jobs?.yoy.avgWeeklyWage) },
  { key: "jobs.period", label: "QCEW quarter", unit: "", kind: "string", source: "bls-qcew", get: (f) => s(area(f).jobs?.period) },
  { key: "jobs.suppressed", label: "QCEW cell withheld", unit: "", kind: "string", source: "bls-qcew", get: (f) => (area(f).jobs ? String(area(f).jobs!.suppressed) : null) },
  {
    key: "priceToRent",
    label: "Price-to-rent",
    unit: "ratio",
    kind: "estimate",
    source: "zillow-zhvi",
    method: "typical home value / (typical rent × 12); Zillow ZHVI over ZORI, same month",
    headline: true,
    get: (f) => {
      const { home, rent } = area(f);
      return home && rent && rent.latest > 0 ? home.latest / (rent.latest * 12) : null;
    },
  },
  {
    key: "momentum",
    label: "Momentum index",
    unit: "index −1..1",
    kind: "estimate",
    source: "zillow-zhvi",
    method: momentum().formula,
    headline: true,
    get: (f) => {
      const { home, rent, jobs } = area(f);
      return n(momentum(home, rent, jobs).score);
    },
  },
  {
    key: "yearsOfWages",
    label: "Years of wages",
    unit: "years",
    kind: "estimate",
    source: "bls-qcew",
    method: "typical home value / (average weekly wage × 52); one average covered job, not a household",
    get: (f) => {
      const { home, jobs } = area(f);
      return home && jobs?.avgWeeklyWage != null && jobs.avgWeeklyWage > 0 ? home.latest / (jobs.avgWeeklyWage * 52) : null;
    },
  },
];

// ---- ports (World Port Index + BTS Port Performance)

const port = (f: LayerFeature) => f.properties.extra as PortExtra;

const PORT_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", unit: "", kind: "string", source: "nga-wpi", headline: true, get: (f) => s(port(f).wpi.name) },
  { key: "country", label: "Country", unit: "", kind: "string", source: "nga-wpi", headline: true, get: (f) => s(port(f).wpi.country) },
  { key: "region", label: "WPI region", unit: "", kind: "string", source: "nga-wpi", get: (f) => s(port(f).wpi.region) },
  { key: "locode", label: "UN/LOCODE", unit: "", kind: "string", source: "nga-wpi", get: (f) => s(port(f).wpi.locode) },
  { key: "size", label: "Harbour size", unit: "", kind: "string", source: "nga-wpi", headline: true, get: (f) => s(port(f).wpi.size) },
  { key: "type", label: "Harbour type", unit: "", kind: "string", source: "nga-wpi", get: (f) => s(port(f).wpi.type) },
  { key: "channelM", label: "Channel depth", unit: "m", kind: "number", source: "nga-wpi", get: (f) => n(port(f).wpi.channelM) },
  { key: "maxDraftM", label: "Max draft", unit: "m", kind: "number", source: "nga-wpi", get: (f) => n(port(f).wpi.maxDraftM) },
  { key: "cargoPierM", label: "Cargo pier depth", unit: "m", kind: "number", source: "nga-wpi", get: (f) => n(port(f).wpi.cargoPierM) },
  { key: "anchorageM", label: "Anchorage depth", unit: "m", kind: "number", source: "nga-wpi", get: (f) => n(port(f).wpi.anchorageM) },
  { key: "oilM", label: "Oil terminal depth", unit: "m", kind: "number", source: "nga-wpi", get: (f) => n(port(f).wpi.oilM) },
  { key: "lngM", label: "LNG terminal depth", unit: "m", kind: "number", source: "nga-wpi", get: (f) => n(port(f).wpi.lngM) },
  { key: "tidalRangeM", label: "Tidal range", unit: "m", kind: "number", source: "nga-wpi", get: (f) => n(port(f).wpi.tidalRangeM) },
  { key: "bts.year", label: "BTS reporting year", unit: "", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.year) },
  { key: "bts.authority", label: "BTS port authority", unit: "", kind: "string", source: "bts-ports", get: (f) => s(port(f).stats?.name) },
  { key: "teu", label: "Containers", unit: "TEU", kind: "number", source: "bts-ports", headline: true, get: (f) => n(port(f).stats?.container?.total) },
  { key: "teu.imports", label: "Import containers", unit: "TEU", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.container?.imports) },
  { key: "teu.exports", label: "Export containers", unit: "TEU", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.container?.exports) },
  { key: "teu.empty", label: "Empty containers", unit: "TEU", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.container?.empty) },
  { key: "teu.rank", label: "Container rank (US)", unit: "rank", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.container?.ranking) },
  { key: "teu.yoyPct", label: "Containers year-over-year", unit: "%", kind: "pct", source: "bts-ports", headline: true, get: (f) => n(port(f).stats?.container?.pctChange) },
  { key: "tons", label: "Total tonnage", unit: "short tons", kind: "number", source: "bts-ports", headline: true, get: (f) => n(port(f).stats?.tonnage?.total) },
  { key: "tons.foreign", label: "Foreign tonnage", unit: "short tons", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.tonnage?.foreign) },
  { key: "tons.domestic", label: "Domestic tonnage", unit: "short tons", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.tonnage?.domestic) },
  { key: "tons.rank", label: "Tonnage rank (US)", unit: "rank", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.tonnage?.ranking) },
  { key: "tons.yoyPct", label: "Tonnage year-over-year", unit: "%", kind: "pct", source: "bts-ports", get: (f) => n(port(f).stats?.tonnage?.pctChange) },
  { key: "dryBulk", label: "Dry bulk", unit: "short tons", kind: "number", source: "bts-ports", get: (f) => n(port(f).stats?.dryBulk?.total) },
  { key: "dryBulk.yoyPct", label: "Dry bulk year-over-year", unit: "%", kind: "pct", source: "bts-ports", get: (f) => n(port(f).stats?.dryBulk?.pctChange) },
  {
    key: "teu.emptySharePct",
    label: "Empty container share",
    unit: "%",
    kind: "estimate",
    source: "bts-ports",
    method: "empty TEU / total TEU × 100, latest BTS reporting year",
    get: (f) => {
      const c = port(f).stats?.container;
      return c && c.empty != null && c.total != null && c.total > 0 ? (c.empty / c.total) * 100 : null;
    },
  },
];

// ---- land border crossings (BTS)

const crossing = (f: LayerFeature) => f.properties.extra as CrossingExtra;
const measure = (f: LayerFeature, m: string) => crossing(f).measures[m];

function measureFields(key: string, label: string, m: string, headline = false): FieldDef[] {
  return [
    { key, label: `${label} (latest month)`, unit: "per month", kind: "number", source: "bts-border", headline, get: (f) => n(measure(f, m)?.latest) },
    { key: `${key}.yoyPct`, label: `${label} year-over-year`, unit: "%", kind: "pct", source: "bts-border", headline, get: (f) => n(measure(f, m)?.yoyPct) },
  ];
}

const CROSSING_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", unit: "", kind: "string", source: "bts-border", headline: true, get: (f) => s(f.properties.name) },
  { key: "code", label: "Port code", unit: "", kind: "string", source: "bts-border", get: (f) => s(crossing(f).code) },
  { key: "state", label: "State", unit: "", kind: "string", source: "bts-border", headline: true, get: (f) => s(crossing(f).state) },
  { key: "border", label: "Border", unit: "", kind: "string", source: "bts-border", headline: true, get: (f) => s(crossing(f).border) },
  { key: "asOf", label: "Latest month", unit: "", kind: "string", source: "bts-border", get: (f) => s(crossing(f).asOf) },
  ...measureFields("trucks", "Trucks", "Trucks", true),
  ...measureFields("trains", "Trains", "Trains"),
  ...measureFields("buses", "Buses", "Buses"),
  ...measureFields("cars", "Personal vehicles", "Personal Vehicles", true),
  ...measureFields("pedestrians", "Pedestrians", "Pedestrians"),
  { key: "carPassengers", label: "Personal vehicle passengers (latest month)", unit: "per month", kind: "number", source: "bts-border", get: (f) => n(measure(f, "Personal Vehicle Passengers")?.latest) },
  { key: "busPassengers", label: "Bus passengers (latest month)", unit: "per month", kind: "number", source: "bts-border", get: (f) => n(measure(f, "Bus Passengers")?.latest) },
  { key: "trainPassengers", label: "Train passengers (latest month)", unit: "per month", kind: "number", source: "bts-border", get: (f) => n(measure(f, "Train Passengers")?.latest) },
  {
    key: "people",
    label: "People counted",
    unit: "per month",
    kind: "estimate",
    source: "bts-border",
    method: "sum of the passenger measures BTS published for the port (personal vehicle, bus and train passengers, pedestrians), latest month; a measure the port does not report is left out, not zeroed",
    get: (f) => {
      const keys = ["Personal Vehicle Passengers", "Bus Passengers", "Train Passengers", "Pedestrians"];
      const present = keys.map((k) => measure(f, k)?.latest).filter((v): v is number => v != null && Number.isFinite(v));
      return present.length ? present.reduce((a, b) => a + b, 0) : null;
    },
  },
];

// ---- countries (Natural Earth + World Bank WDI)

const country = (f: LayerFeature) => f.properties.extra as CountryExtra;

const COUNTRY_FIELDS: FieldDef[] = [
  { key: "name", label: "Name", unit: "", kind: "string", source: "natural-earth", headline: true, get: (f) => s(f.properties.name) },
  { key: "iso3", label: "ISO3", unit: "", kind: "string", source: "natural-earth", get: (f) => s(country(f).iso3) },
  { key: "continent", label: "Continent", unit: "", kind: "string", source: "natural-earth", headline: true, get: (f) => s(country(f).continent) },
  { key: "pop", label: "Population (Natural Earth estimate)", unit: "people", kind: "number", source: "natural-earth", get: (f) => n(country(f).pop) },
  { key: "gdp", label: "GDP, current US$", unit: "USD", kind: "number", source: "worldbank-wdi", headline: true, get: (f) => n(country(f).wb?.gdp?.value) },
  { key: "gdp.year", label: "GDP year", unit: "", kind: "string", source: "worldbank-wdi", get: (f) => s(country(f).wb?.gdp?.year) },
  { key: "exports", label: "Exports of goods and services", unit: "USD", kind: "number", source: "worldbank-wdi", headline: true, get: (f) => n(country(f).wb?.exports?.value) },
  { key: "imports", label: "Imports of goods and services", unit: "USD", kind: "number", source: "worldbank-wdi", headline: true, get: (f) => n(country(f).wb?.imports?.value) },
  { key: "tradePct", label: "Trade share of GDP", unit: "%", kind: "pct", source: "worldbank-wdi", get: (f) => n(country(f).wb?.tradePct?.value) },
  { key: "teu", label: "Container port traffic", unit: "TEU", kind: "number", source: "worldbank-wdi", get: (f) => n(country(f).wb?.teu?.value) },
  { key: "rank", label: "Trade rank", unit: "rank", kind: "number", source: "worldbank-wdi", get: (f) => n(country(f).rank) },
  {
    key: "balance",
    label: "Trade balance",
    unit: "USD",
    kind: "estimate",
    source: "worldbank-wdi",
    method: "exports − imports of goods and services, current US$, only when both are for the same year",
    headline: true,
    get: (f) => {
      const w = country(f).wb;
      return w?.exports && w.imports && w.exports.year === w.imports.year ? w.exports.value - w.imports.value : null;
    },
  },
  {
    key: "balancePctGdp",
    label: "Trade balance share of GDP",
    unit: "%",
    kind: "estimate",
    source: "worldbank-wdi",
    method: "(exports − imports) / GDP × 100, all three for the same year",
    get: (f) => {
      const w = country(f).wb;
      if (!w?.exports || !w.imports || !w.gdp || w.gdp.value <= 0) return null;
      if (w.exports.year !== w.imports.year || w.exports.year !== w.gdp.year) return null;
      return ((w.exports.value - w.imports.value) / w.gdp.value) * 100;
    },
  },
  {
    key: "gdpPerCapita",
    label: "GDP per person",
    unit: "USD",
    kind: "estimate",
    source: "worldbank-wdi",
    method: "World Bank GDP (current US$) / Natural Earth population estimate; the two years differ, so read it as a rough scale",
    get: (f) => {
      const x = country(f);
      return x.wb?.gdp && x.pop && x.pop > 0 ? x.wb.gdp.value / x.pop : null;
    },
  },
];

export const FIELDS: Record<EntityKind, FieldDef[]> = {
  county: AREA_FIELDS,
  state: AREA_FIELDS,
  port: PORT_FIELDS,
  crossing: CROSSING_FIELDS,
  country: COUNTRY_FIELDS,
};

/** Every field for an entity kind, in registry order. */
export function fieldsFor(kind: EntityKind): FieldDef[] {
  return FIELDS[kind];
}

export function fieldByKey(kind: EntityKind, key: string): FieldDef | undefined {
  return FIELDS[kind].find((f) => f.key === key);
}

/** Metadata for a client: everything but the getter. */
export function fieldMeta(kind: EntityKind): FieldMeta[] {
  return FIELDS[kind].map((f) => {
    const meta: FieldMeta = { key: f.key, label: f.label, unit: f.unit, kind: f.kind, source: f.source };
    if (f.method) meta.method = f.method;
    if (f.headline) meta.headline = true;
    return meta;
  });
}

export function isEntityKind(v: unknown): v is EntityKind {
  return typeof v === "string" && (ENTITY_KINDS as string[]).includes(v);
}

/** Which registry a feature belongs to, from the `kind` the economy builders stamp on it. */
export function entityKindOf(f: LayerFeature): EntityKind | null {
  const k = f.properties.kind;
  return isEntityKind(k) ? k : null;
}

/** Where to fly for a feature: the polygon anchor or the point itself. */
export function featureGeo(f: LayerFeature): [number, number] | null {
  if (f.properties.anchor) return [f.properties.anchor[0], f.properties.anchor[1]];
  if (f.geometry.type === "Point") {
    const [lon, lat] = (f.geometry as Point).coordinates;
    return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
  }
  return null;
}

/** Markdown table of the registry for docs/SCREENER.md; a test keeps the doc in sync. */
export function fieldTableMarkdown(kind: EntityKind): string {
  const lines = ["| key | label | unit | kind | source | method |", "|---|---|---|---|---|---|"];
  for (const f of FIELDS[kind]) {
    const esc = (v: string) => v.replace(/\|/g, "\\|");
    lines.push(`| \`${f.key}\` | ${esc(f.label)} | ${esc(f.unit)} | ${f.kind} | ${f.source} | ${f.method ? esc(f.method) : ""} |`);
  }
  return lines.join("\n");
}
