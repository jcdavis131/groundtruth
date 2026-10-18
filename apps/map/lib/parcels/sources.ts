// Network side of /api/parcels. Server only: route handlers call these; the
// adapters, the cleaning rules and the feature builders stay pure in their
// own modules so they are tested against captured payloads.
//
// Politeness: one request per second per parcel host (a county server is not
// a CDN), a 5-minute pause for that host after a 429 or a 503, explicit
// outFields, a point or a box per query and nothing else. Every answer is
// cached (lib/server/cache.ts), and a failed refresh serves the last answer
// labelled stale rather than an empty map.
//
// Nothing here takes a name. A parcel is found from a point; Cook County's
// parcel-address table is then read by that parcel's 14-digit PIN, and
// Travis County's appraisal layer at the same point. No query is ever built
// from an owner field.

import type { MultiPolygon, Polygon } from "geojson";
import { cached } from "@/lib/server/cache";
import { arcgisQuery, envelope, truncated } from "@/lib/server/arcgis";
import { polite, UpstreamError, upstreamJson } from "@/lib/server/upstream";
import { retrying } from "@/lib/server/net";
import type { SourceId } from "@/lib/provenance/sources";
import type { LayerFeature } from "@/lib/layers/types";
import { adapterFor, COOK_ADDRESS_COLUMNS, ownsRow, STRATMAP_FIELDS, TCAD_URL, TRAVIS_GEOID, type ParcelAdapter } from "./adapters";
import { geometryBbox, pointInGeometry, ringsToGeometry } from "./esri";
import { buildOutlines } from "./features";
import { epochDate, join, text } from "./normalize";
import { isSuppressed, SUPPRESSED_NOTE } from "./suppressed";
import type { AdapterRef, CountyRef, IdentifiedParcel, NadAddress, PlssDescription } from "./types";

type Poly = Polygon | MultiPolygon;
type Props = Record<string, unknown>;
export interface Row {
  geometry: Poly | null;
  properties: Props;
}

const DAY = 24 * 3600_000;
export const IDENTIFY_TTL_MS = DAY;
export const OUTLINE_TTL_MS = 7 * DAY;
const COUNTY_TTL_MS = 30 * DAY;
const NAD_TTL_MS = 7 * DAY;
const PLSS_TTL_MS = 30 * DAY;

/** One request per second per parcel host; 5 minutes off after a 429 or 503. */
const GATE = { minIntervalMs: 1000, backoffMs: 5 * 60_000, backoffOn: [429, 503] as const };

/** Every upstream an answer was read from, for its provenance. */
export interface Used {
  sourceId: SourceId;
  url: string;
  seriesId: string;
  note?: string;
}

function isPoly(g: unknown): g is Poly {
  const t = (g as { type?: string } | null)?.type;
  return t === "Polygon" || t === "MultiPolygon";
}

const r5 = (x: number) => x.toFixed(5);

// ---------------------------------------------------------------- counties (TIGERweb)

export const TIGER_COUNTIES = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/82";
const TIGER_OPTS = { gate: "tigerweb", minIntervalMs: 150, timeoutMs: 15_000, tries: 2 };

function countyOf(p: Props | null | undefined): CountyRef | null {
  const geoid = text(p?.GEOID);
  if (!geoid || !/^\d{5}$/.test(geoid)) return null;
  return { geoid, name: text(p?.NAME) ?? geoid, basename: text(p?.BASENAME) ?? text(p?.NAME) ?? geoid, state: text(p?.STATE) ?? geoid.slice(0, 2) };
}

/** The county a point is in. Cached by the point to 1e-5 degrees for 30 days. */
export async function countyAt(lon: number, lat: number): Promise<CountyRef | null> {
  const r = await cached(`parcel-county:${r5(lon)},${r5(lat)}`, COUNTY_TTL_MS, async () => {
    const fc = await arcgisQuery(
      "census-tigerweb",
      TIGER_COUNTIES,
      { geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "GEOID,NAME,BASENAME,STATE", returnGeometry: "false" },
      TIGER_OPTS,
    );
    return countyOf(fc.features[0]?.properties as Props);
  });
  return r.value;
}

/** Every county a box touches. Cached by the (already snapped) box for 30 days. */
export async function countiesIn(bbox: [number, number, number, number]): Promise<CountyRef[]> {
  const r = await cached(`parcel-counties:${bbox.join(",")}`, COUNTY_TTL_MS, async () => {
    const fc = await arcgisQuery(
      "census-tigerweb",
      TIGER_COUNTIES,
      { where: "1=1", ...envelope(bbox), outFields: "GEOID,NAME,BASENAME,STATE", returnGeometry: "false" },
      TIGER_OPTS,
    );
    return fc.features.map((f) => countyOf(f.properties as Props)).filter((c): c is CountyRef => !!c);
  });
  return r.value;
}

// ---------------------------------------------------------------- adapter reads

/** The parcel rows at a point from a query adapter, with their outlines. */
async function queryPoint(a: ParcelAdapter, county: CountyRef | null, lon: number, lat: number): Promise<Row[]> {
  const fc = await arcgisQuery(
    a.sourceId,
    a.url(county),
    {
      where: "1=1",
      geometry: `${lon},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: a.outFields.join(","),
      returnGeometry: "true",
      outSR: "4326",
      // About half a metre: an outline to draw, not a survey.
      maxAllowableOffset: "0.000005",
      geometryPrecision: "6",
    },
    { gate: a.host, timeoutMs: 20_000, tries: 2, ...GATE },
  );
  return fc.features.map((f) => ({ geometry: isPoly(f.geometry) ? f.geometry : null, properties: (f.properties ?? {}) as Props }));
}

interface IdentifyJson {
  results?: Array<{ layerId?: number; attributes?: Props; geometry?: { rings?: unknown } }>;
  error?: { code?: number; message?: string };
}

/**
 * TxGIO StratMap answers only `identify`. Values come back as strings (blanks
 * as " "), geometry as Esri rings in the request's spatial reference.
 */
async function stratmapIdentify(a: ParcelAdapter, geometry: string, geometryType: string, extent: [number, number, number, number], withGeometry: boolean, offset: number): Promise<Row[]> {
  const [w, s, e, n] = extent;
  const qs = new URLSearchParams({
    f: "json",
    geometry,
    geometryType,
    sr: "4326",
    layers: "all:0",
    tolerance: "0",
    mapExtent: `${w},${s},${e},${n}`,
    imageDisplay: "800,800,96",
    returnGeometry: withGeometry ? "true" : "false",
    maxAllowableOffset: String(offset),
    geometryPrecision: "6",
  });
  const url = `${a.url(null)}/identify?${qs.toString()}`;
  const j = await retrying(
    () => polite(a.host, GATE.minIntervalMs, GATE.backoffMs, () => upstreamJson<IdentifyJson>(a.sourceId, url, { timeoutMs: 25_000 }), GATE.backoffOn),
    2,
  );
  if (j.error) throw new UpstreamError(a.sourceId, j.error.code ?? 502, `${a.sourceId}: ${j.error.message ?? "identify failed"}`);
  return (j.results ?? [])
    .filter((r) => r.layerId == null || r.layerId === 0)
    .map((r) => ({ geometry: withGeometry ? ringsToGeometry(r.geometry?.rings) : null, properties: pick(r.attributes ?? {}, STRATMAP_FIELDS) }));
}

/** Keep only the listed keys: identify cannot choose its fields, so the rest are dropped here. */
function pick(p: Props, keys: readonly string[]): Props {
  const out: Props = {};
  for (const k of keys) if (k in p) out[k] = p[k];
  return out;
}

/** Raw parcel rows at a point for an adapter (exported for the fixture capture script). */
export async function rowsAt(a: ParcelAdapter, county: CountyRef | null, lon: number, lat: number): Promise<Row[]> {
  if (a.kind === "identify") {
    const d = 0.002;
    return stratmapIdentify(a, `${lon},${lat}`, "esriGeometryPoint", [lon - d, lat - d, lon + d, lat + d], true, 0.000005);
  }
  return queryPoint(a, county, lon, lat);
}

export const COOK_ADDRESSES = "https://datacatalog.cookcountyil.gov/resource/3723-97qp.json";

/** Cook County's parcel-address row for one 14-digit PIN (the newest year), or null. */
export async function cookAddressRow(pin14: string): Promise<Props | null> {
  if (!/^\d{14}$/.test(pin14)) return null;
  const qs = new URLSearchParams({ pin: pin14, $select: COOK_ADDRESS_COLUMNS.join(","), $order: "year DESC", $limit: "1" });
  const rows = await retrying(
    () =>
      polite("datacatalog.cookcountyil.gov", GATE.minIntervalMs, GATE.backoffMs, () => upstreamJson<Props[]>("cook-parcels", `${COOK_ADDRESSES}?${qs.toString()}`, { timeoutMs: 15_000 }), GATE.backoffOn),
    2,
  );
  return Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? rows[0] : null;
}

/**
 * The Travis Central Appraisal District's record link from TCAD's public
 * layer at the same point, kept only when that parcel is the same one:
 * StratMap's Travis PROP_ID is TCAD's geo_id (0208030201 for the Capitol
 * grounds, TCAD PROP_ID 197003).
 */
export function tcadLinkFor(rows: Props[], stratmapPropId: string): string | undefined {
  for (const p of rows) {
    const link = text(p?.hyperlink);
    if ((text(p?.geo_id) === stratmapPropId || text(p?.PROP_ID) === stratmapPropId) && link && /^https:\/\//.test(link)) return link;
  }
  return undefined;
}

async function tcadLink(lon: number, lat: number, propId: string): Promise<string | undefined> {
  const fc = await arcgisQuery(
    "tcad-parcels",
    TCAD_URL,
    { where: "1=1", geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "PROP_ID,geo_id,hyperlink", returnGeometry: "false" },
    { gate: "gis.traviscountytx.gov", timeoutMs: 12_000, tries: 1, ...GATE },
  );
  return tcadLinkFor(fc.features.map((f) => f.properties as Props), propId);
}

export function adapterRef(a: ParcelAdapter): AdapterRef {
  return { id: a.id, name: a.name, publisher: a.publisher, coverage: a.coverage, ownerPublished: a.ownerPublished };
}

export interface ParcelsAt {
  county: CountyRef | null;
  adapter: ParcelAdapter | null;
  parcels: IdentifiedParcel[];
  notes: string[];
  used: Used[];
}

/** The parcel records at a point: county -> adapter -> rows -> records, with the second hops and the suppression list. */
export async function parcelsAt(lon: number, lat: number): Promise<ParcelsAt> {
  const used: Used[] = [];
  const county = await countyAt(lon, lat);
  used.push({ sourceId: "census-tigerweb", url: TIGER_COUNTIES, seriesId: "tigerWMS_Current layer 82 (counties)", note: county ? `county ${county.geoid}` : "no county at this point" });
  if (!county) return { county, adapter: null, parcels: [], notes: ["This point is not in a U.S. county (TIGERweb found none), so no parcel source applies."], used };
  const a = adapterFor(county);
  if (!a) {
    return {
      county,
      adapter: null,
      parcels: [],
      notes: [`No keyless public parcel service is wired for ${county.name} yet (README, "Parcels & ownership", lists what is).`],
      used,
    };
  }
  const rows = await rowsAt(a, county, lon, lat);
  used.push({ sourceId: a.sourceId, url: a.url(county), seriesId: a.kind === "identify" ? "MapServer identify, layer 0" : "layer query at the point" });
  const notes: string[] = [];
  const parcels: IdentifiedParcel[] = [];
  for (const row of rows.slice(0, 12)) {
    let extra: Props | null | undefined;
    if (a.id === "il-cook") {
      const pin = text(row.properties.PIN14) ?? "";
      extra = await cookAddressRow(pin).catch(() => null);
      used.push({ sourceId: "cook-parcels", url: COOK_ADDRESSES, seriesId: "Assessor - Parcel Addresses (3723-97qp), by PIN" });
    }
    const record = a.normalize(row.properties, { county, extra });
    if (!record.parcelId) continue;
    if (isSuppressed(a.id, record.parcelId)) {
      if (!notes.includes(SUPPRESSED_NOTE)) notes.push(SUPPRESSED_NOTE);
      continue;
    }
    if (a.id === "tx-stratmap" && county.geoid === TRAVIS_GEOID && !record.link) {
      const link = await tcadLink(lon, lat, record.parcelId).catch(() => undefined);
      used.push({ sourceId: "tcad-parcels", url: TCAD_URL, seriesId: "TCAD_public layer 0, record link at the point" });
      if (link) record.link = { url: link, label: "Travis Central Appraisal District record" };
    }
    parcels.push({ record, geometry: row.geometry });
  }
  if (!rows.length) notes.push(`${a.name} has no parcel at this point (a street, water, or ground its source does not cover: ${a.coverage}).`);
  return { county, adapter: a, parcels, notes, used };
}

// ---------------------------------------------------------------- outlines

export interface OutlineSet {
  adapter: ParcelAdapter;
  county: CountyRef;
  features: LayerFeature[];
  truncated: boolean;
}

/**
 * How long a box waits for one parcel service. Past it the caller gets a
 * partial answer naming the service that did not answer, the query finishes
 * in the background and is cached for the next ask, and the route stays
 * inside its 60 s (Columbus, Ohio took 23 s for one box in probing).
 */
export const OUTLINE_DEADLINE_MS = 30_000;

/**
 * One adapter's outlines in a box, cached for a week. Attributes other than id
 * and use are dropped before caching. Rows of a county another adapter answers
 * for (StratMap's Harris rows) are dropped too, by `ownsRow`: that rule reads
 * only the row, never the counties TIGERweb found for the box, so the cached
 * set is the same whichever request filled it.
 */
export async function outlinesFor(a: ParcelAdapter, county: CountyRef, bbox: [number, number, number, number]): Promise<{ value: OutlineSet; age: number }> {
  const url = a.url(county);
  const r = await cached(`parcel-outlines:${a.id}:${url}:${bbox.join(",")}`, OUTLINE_TTL_MS, async () => {
    const fields = [a.idField, ...(a.useField ? [a.useField] : [])];
    if (a.kind === "identify") {
      const [w, s, e, n] = bbox;
      const rows = await stratmapIdentify(a, JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }), "esriGeometryEnvelope", bbox, true, 0.00001);
      const features = buildOutlines(
        rows.filter((row) => ownsRow(a, row.properties)).map((row) => ({ geometry: row.geometry, properties: pick(row.properties, fields) })),
        a,
      );
      // The record limit is about what the service sent, before any row was left to another adapter.
      return { adapter: a, county, features, truncated: rows.length >= a.maxRecords };
    }
    const fc = await arcgisQuery(
      a.sourceId,
      url,
      {
        where: "1=1",
        ...envelope(bbox),
        outFields: [...fields, ...(a.countyField ? [a.countyField] : [])].join(","),
        returnGeometry: "true",
        // About a metre: enough to draw lot lines at street scale.
        maxAllowableOffset: "0.00001",
        geometryPrecision: "6",
        resultRecordCount: String(a.maxRecords),
      },
      { gate: a.host, timeoutMs: 25_000, tries: 2, ...GATE },
    );
    const features = buildOutlines(
      fc.features
        .filter((f) => ownsRow(a, (f.properties ?? {}) as Props))
        .map((f) => ({ geometry: f.geometry, properties: pick((f.properties ?? {}) as Props, fields) })),
      a,
    );
    return { adapter: a, county, features, truncated: truncated(fc) || fc.features.length >= a.maxRecords };
  }, { deadlineMs: OUTLINE_DEADLINE_MS, coolMs: 60_000 });
  return { value: r.value, age: r.age };
}

// ---------------------------------------------------------------- NAD address points

export const NAD_URL = "https://services.arcgis.com/xOi1kZaI0eWDREZv/ArcGIS/rest/services/Address_Points_from_National_Address_Database_view/FeatureServer/0";
export const NAD_FIELDS = ["AddNo_Full", "StNam_Full", "SubAddress", "Unit", "Post_City", "State", "Zip_Code", "Addr_Type", "Parcel_ID", "NAD_Source", "DateUpdate"] as const;

/** Metres between two lon/lat points (equirectangular; fine at parcel scale). */
function metres(a: [number, number], b: [number, number]): number {
  const k = Math.PI / 180;
  const x = (b[0] - a[0]) * k * Math.cos(((a[1] + b[1]) / 2) * k);
  const y = (b[1] - a[1]) * k;
  return Math.hypot(x, y) * 6_371_008.8;
}

/** How far from the clicked point an address may be when none is on the parcel (or there is no parcel). */
export const NAD_NEAR_M = 40;

/**
 * NAD rows -> address points: the ones inside the parcel's outline; when
 * none is (NAD places some points at a driveway or a street entrance), or
 * there is no parcel, the ones within NAD_NEAR_M of the clicked point,
 * marked as near rather than on it. Nearest first.
 */
export function nadAddresses(rows: Array<{ geometry: unknown; properties: Props | null }>, point: [number, number], parcel: Poly | null, max = 12): NadAddress[] {
  const all: Array<{ a: NadAddress; d: number }> = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const g = r.geometry as { type?: string; coordinates?: number[] } | null;
    if (g?.type !== "Point" || !Array.isArray(g.coordinates)) continue;
    const [lon, lat] = g.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = r.properties ?? {};
    const street = join([p.AddNo_Full, p.StNam_Full, text(p.SubAddress) ?? text(p.Unit)]);
    if (!street) continue;
    const address = join([street, p.Post_City, join([p.State, p.Zip_Code])], ", ")!;
    if (seen.has(address)) continue;
    seen.add(address);
    all.push({
      d: metres(point, [lon, lat]),
      a: {
        address,
        lon,
        lat,
        onParcel: parcel ? pointInGeometry(lon, lat, parcel) : false,
        ...(text(p.NAD_Source) ? { source: text(p.NAD_Source) } : {}),
        ...(epochDate(p.DateUpdate) ? { updated: epochDate(p.DateUpdate) } : {}),
        ...(text(p.Addr_Type) && text(p.Addr_Type) !== "Unknown" ? { type: text(p.Addr_Type) } : {}),
        ...(text(p.Parcel_ID) ? { parcelId: text(p.Parcel_ID) } : {}),
      },
    });
  }
  const on = all.filter((x) => x.a.onParcel);
  const kept = on.length ? on : all.filter((x) => x.d <= NAD_NEAR_M);
  return kept
    .sort((x, y) => x.d - y.d)
    .slice(0, max)
    .map((x) => x.a);
}

/**
 * NAD address points on the parcel (or near the point). NAD's hosted layer
 * is slow (7 s for an 80 m radius in probing, and a box query timed out), so
 * callers give it a deadline; the query keeps running and its answer is
 * cached for the next ask.
 */
export async function nadNear(lon: number, lat: number, parcel: Poly | null, deadlineMs: number): Promise<{ value: NadAddress[]; age: number }> {
  let cx = lon, cy = lat, radius = 45;
  if (parcel) {
    const [w, s, e, n] = geometryBbox(parcel);
    cx = (w + e) / 2;
    cy = (s + n) / 2;
    radius = Math.min(250, Math.max(30, metres([w, s], [e, n]) / 2 + 10));
  }
  const key = `nad:${r5(cx)},${r5(cy)},${Math.round(radius)}`;
  const r = await cached(
    key,
    NAD_TTL_MS,
    async () => {
      const fc = await arcgisQuery(
        "usdot-nad",
        NAD_URL,
        {
          where: "1=1",
          geometry: `${cx},${cy}`,
          geometryType: "esriGeometryPoint",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          distance: String(Math.round(radius)),
          units: "esriSRUnit_Meter",
          outFields: NAD_FIELDS.join(","),
          returnGeometry: "true",
          outSR: "4326",
          resultRecordCount: "200",
        },
        { gate: "services.arcgis.com", timeoutMs: 40_000, tries: 1, ...GATE },
      );
      return fc.features.map((f) => ({ geometry: f.geometry, properties: f.properties as Props }));
    },
    { deadlineMs, coolMs: 60_000 },
  );
  return { value: nadAddresses(r.value, [lon, lat], parcel), age: r.age };
}

// ---------------------------------------------------------------- BLM PLSS

export const PLSS_URL = "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer";

/** State FIPS of the 30 Public Land Survey System states; elsewhere BLM has no township grid to ask. */
export const PLSS_STATES: ReadonlySet<string> = new Set([
  "01", "02", "04", "05", "06", "08", "12", "16", "17", "18", "19", "20", "22", "26", "27",
  "28", "29", "30", "31", "32", "35", "38", "39", "40", "41", "46", "49", "53", "55", "56",
]);

export function parsePlss(township: Props | null | undefined, section: Props | null | undefined): PlssDescription | null {
  if (!township && !section) return null;
  const out: PlssDescription = {
    state: text(township?.STATEABBR),
    meridian: text(township?.PRINMER),
    township: text(township?.TWNSHPLAB),
    plssId: text(township?.PLSSID) ?? text(section?.PLSSID),
    section: text(section?.FRSTDIVLAB) ?? text(section?.FRSTDIVNO),
    sectionType: text(section?.FRSTDIVTXT),
    firstDivisionId: text(section?.FRSTDIVID),
  };
  for (const k of Object.keys(out) as Array<keyof PlssDescription>) if (out[k] === undefined) delete out[k];
  return Object.keys(out).length ? out : null;
}

/** The PLSS township and section at a point (two layer queries), cached 30 days. */
export async function plssAt(lon: number, lat: number, deadlineMs: number): Promise<{ value: PlssDescription | null; age: number }> {
  const r = await cached(
    `plss:${lon.toFixed(4)},${lat.toFixed(4)}`,
    PLSS_TTL_MS,
    async () => {
      const q = (layer: number, outFields: string) =>
        arcgisQuery(
          "blm-plss",
          `${PLSS_URL}/${layer}`,
          { where: "1=1", geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields, returnGeometry: "false" },
          { gate: "gis.blm.gov", timeoutMs: 15_000, tries: 2, ...GATE },
        );
      const [t, s] = await Promise.all([q(1, "STATEABBR,PRINMER,TWNSHPLAB,PLSSID"), q(2, "PLSSID,FRSTDIVID,FRSTDIVNO,FRSTDIVLAB,FRSTDIVTXT")]);
      return parsePlss(t.features[0]?.properties as Props, s.features[0]?.properties as Props);
    },
    { deadlineMs, coolMs: 60_000 },
  );
  return r;
}
