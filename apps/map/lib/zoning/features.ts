// Zoning: what a city's own zoning GIS says about one point, and its district
// polygons around the view. Plain functions (no network, no Cesium, no React),
// shared by /api/zoning and the zoning layer, tested on payloads captured from
// each city's service (lib/zoning/fixtures).
//
// Which city a point is in comes from the Census TIGERweb incorporated place
// under it, never from a bounding box: Bellaire and West University Place sit
// inside Houston's box, have zoning, and must not be told they have none.
//
// Every value is the city's own. The one thing derived here is the colour
// family of a district (residential, commercial, industrial...), read from
// the category words the city publishes (Seattle's CATEGORY_DESC, Denver's
// ZONE_DIST_TYPE, San Antonio's BaseDescription, LA's ZONING_DESCRIPTION) or,
// for New York and Chicago, from the district letters their zoning codes
// define (R, C, M; RS, B, DX, PD...). A city that publishes neither gets a
// colour per district code, and the legend says so; nothing is guessed.

import type { MultiPolygon, Polygon } from "geojson";
import type { SourceId } from "@/lib/provenance/sources";

export type ZoningCityId =
  | "seattle"
  | "denver"
  | "nyc"
  | "chicago"
  | "dallas"
  | "sanantonio"
  | "austin"
  | "losangeles"
  | "sanfrancisco"
  | "houston";

/**
 * What the answer at a point is:
 *   district      a zoning district polygon holds the point
 *   right-of-way  the city maps the point as street right-of-way (San Antonio's UZROW)
 *   no-district   the city's layer has no polygon here: Austin leaves street
 *                 right-of-way out, and any layer can have gaps. Never "unzoned".
 *   no-ordinance  Houston: the city has no zoning ordinance
 *   not-covered   no zoning source is wired for the place under the point
 */
export type ZoningState = "district" | "right-of-way" | "no-district" | "no-ordinance" | "not-covered";

/** Colour family of a district; see the header for where it comes from. */
export type ZoningFamily =
  | "residential"
  | "mixed"
  | "commercial"
  | "downtown"
  | "industrial"
  | "planned"
  | "public"
  | "right-of-way"
  | "other"
  | "coded";

export type Bbox = [number, number, number, number];

/** A published zoning district hit at a point, before it becomes a record. */
export interface ZoningHit {
  /** The full district string as published ("DOC1 U/450-U", "[LF1-WH1-5][P2-FA][CPIO]"). */
  code: string;
  base?: string;
  /** The city's own plain description of the district. */
  label?: string;
  /** The city's own category words, verbatim. */
  category?: string;
  family: ZoningFamily;
  /** Overlays, special districts and combining districts, as published. */
  overlays: string[];
  ordinance?: string;
  /** ISO date the district took effect, where published. */
  effective?: string;
  caseNumber?: string;
  /** Link to the code chapter or section, as published by the city. */
  codeUrl?: string;
  /** Link to the ordinance or clerk record, as published. */
  recordUrl?: string;
  /** ISO date of the row's last edit, where published. */
  editedAt?: string;
  /** Further published fields, label -> value, shown in the dossier as they are. */
  published: Record<string, string>;
  /** Street right-of-way as the city maps it (San Antonio's UZROW). */
  rightOfWay?: boolean;
  /** Other distinct districts the point also touches (a boundary, overlapping rows). */
  alsoHere?: string[];
}

export interface ZoningRecord extends Partial<Omit<ZoningHit, "published" | "overlays">> {
  state: ZoningState;
  lon: number;
  lat: number;
  /** The Census incorporated place under the point (TIGERweb), when there is one. */
  place?: { geoid: string; name: string };
  city?: ZoningCityId;
  cityName?: string;
  overlays: string[];
  published: Record<string, string>;
  /** NYC: the tax lot under the point and its Zoning Tax Lot Database row. */
  lot?: { bbl: string };
  source?: SourceId;
  /** Who publishes it, for the dossier line. */
  publisher?: string;
  /** Plain statement of what the state means here. */
  note: string;
}

// ------------------------------------------------------------------ requests

export interface ArcgisRequest {
  kind: "arcgis";
  /** Layer URL (…/FeatureServer/0); the helper appends /query and f=geojson. */
  layer: string;
  params: Record<string, string>;
}
export interface SocrataRequest {
  kind: "socrata";
  url: string;
}
export type ZoningRequest = ArcgisRequest | SocrataRequest;

export function arcgisPoint(layer: string, lon: number, lat: number, outFields: readonly string[]): ArcgisRequest {
  return {
    kind: "arcgis",
    layer,
    params: {
      where: "1=1",
      geometry: `${lon},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: outFields.join(","),
      returnGeometry: "false",
    },
  };
}

/** Polygons in a box, generalised on the server to `offset` degrees. */
export function arcgisBox(layer: string, b: Bbox, outFields: readonly string[], offset: number): ArcgisRequest {
  const [w, s, e, n] = b;
  return {
    kind: "arcgis",
    layer,
    params: {
      where: "1=1",
      geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outSR: "4326",
      outFields: outFields.join(","),
      returnGeometry: "true",
      maxAllowableOffset: String(offset),
      geometryPrecision: "6",
    },
  };
}

/** SoQL `intersects` with a WKT point, asking for the named columns. */
export function socrataPoint(base: string, lon: number, lat: number, select: readonly string[]): SocrataRequest {
  const q = new URLSearchParams();
  q.set("$select", select.join(","));
  q.set("$where", `intersects(the_geom,'POINT (${lon} ${lat})')`);
  q.set("$limit", "10");
  return { kind: "socrata", url: `${base}.json?${q.toString()}` };
}

/** Polygons touching a box as GeoJSON, simplified by Socrata to `tolerance` degrees. */
export function socrataBox(base: string, b: Bbox, select: readonly string[], tolerance: number, limit: number): SocrataRequest {
  const [w, s, e, n] = b;
  const q = new URLSearchParams();
  q.set("$select", [...select, `simplify_preserve_topology(the_geom,${tolerance}) as the_geom`].join(","));
  q.set("$where", `intersects(the_geom,'POLYGON((${w} ${s},${e} ${s},${e} ${n},${w} ${n},${w} ${s}))')`);
  q.set("$limit", String(limit));
  return { kind: "socrata", url: `${base}.geojson?${q.toString()}` };
}

/** The URL a request reads, for provenance and for capturing fixtures. */
export function requestUrl(r: ZoningRequest): string {
  if (r.kind === "socrata") return r.url;
  return `${r.layer}/query?${new URLSearchParams({ f: "geojson", ...r.params }).toString()}`;
}

// ------------------------------------------------------------------ helpers

type Row = Record<string, unknown>;

/** A published string, trimmed; blank, whitespace-only and null are missing. */
export function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

/** An epoch-ms (ArcGIS) or ISO (Socrata) date as YYYY-MM-DD; anything else is missing. */
export function isoDate(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? new Date(v).toISOString().slice(0, 10) : undefined;
  const s = String(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : undefined;
}

function put(out: Record<string, string>, label: string, v: unknown): void {
  const s = str(v);
  if (s) out[label] = s;
}

/** Colour family from a city's own category words. Order matters: "Commercial Mixed Use" is mixed. */
export function familyFromWords(words: string | undefined): ZoningFamily {
  const w = (words ?? "").toLowerCase();
  if (!w) return "other";
  if (/right[- ]of[- ]way/.test(w)) return "right-of-way";
  if (/downtown/.test(w)) return "downtown";
  if (/mixed/.test(w)) return "mixed";
  if (/industr|manufactur/.test(w)) return "industrial";
  if (/planned/.test(w)) return "planned";
  if (/resid|family|dwelling/.test(w)) return "residential";
  if (/commerc|business|retail|office/.test(w)) return "commercial";
  if (/public|park|open space|institution|civic/.test(w)) return "public";
  return "other";
}

/** New York's Zoning Resolution names districts by letter: R residence, C commercial, M manufacturing. */
export function nycFamily(code: string): ZoningFamily {
  const c = code.toUpperCase();
  if (c.startsWith("PARK")) return "public";
  // Special mixed-use districts are written M1-xA/R y: manufacturing paired with a residence district.
  if (/^M\d.*\/R\d/.test(c)) return "mixed";
  if (c.startsWith("R")) return "residential";
  if (c.startsWith("C")) return "commercial";
  if (c.startsWith("M")) return "industrial";
  return "other";
}

/** Chicago's Zoning Ordinance district families, by the letters of the district class. */
export function chicagoFamily(code: string): ZoningFamily {
  const c = code.toUpperCase().trim();
  if (/^PMD\b/.test(c)) return "industrial";
  if (/^PD\b/.test(c)) return "planned";
  if (/^POS\b/.test(c)) return "public";
  if (/^D[CXRS]-/.test(c)) return "downtown";
  if (/^R[STM]-/.test(c)) return "residential";
  if (/^[BC]\d/.test(c)) return "commercial";
  if (/^M\d/.test(c)) return "industrial";
  return "other";
}

/** Distinct codes, first kept as the answer, the rest listed as also at this point. */
function firstDistinct<T extends { code: string }>(hits: T[]): T | null {
  if (!hits.length) return null;
  const codes = [...new Set(hits.map((h) => h.code))];
  const first = hits[0] as T & { alsoHere?: string[] };
  if (codes.length > 1) first.alsoHere = codes.slice(1);
  return first;
}

// ------------------------------------------------------------------ Seattle

export const SEATTLE_LAYER = "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/Current_Land_Use_Zoning_Detail_2/FeatureServer/0";
export const SEATTLE_POINT_FIELDS = [
  "ZONING", "BASE_ZONE", "CLASS_DESC", "CATEGORY_DESC", "ZONELUT", "ZONELUT_DESC", "DETAIL_DESC", "ZONING_DESC",
  "OVERLAY", "HISTORIC", "PEDESTRIAN", "SHORELINE", "LIGHTRAIL", "MHA", "MHA_VALUE", "IZ", "MIO_NAME", "CONTRACT",
  "ORDINANCE", "EFFECTIVE", "PUBLIC_DESCRIPTION", "CHAPTER", "CHAPTER_LINK",
] as const;
export const SEATTLE_POLYGON_FIELDS = ["OBJECTID", "ZONING", "CATEGORY_DESC"] as const;

export function seattleHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.ZONING);
    if (!code) continue;
    const overlays: string[] = [];
    const flag = (label: string, v: unknown) => {
      const s = str(v);
      if (s) overlays.push(`${label} ${s}`);
    };
    flag("overlay", r.OVERLAY);
    flag("historic district", r.HISTORIC);
    flag("pedestrian", r.PEDESTRIAN);
    flag("shoreline", r.SHORELINE);
    flag("light rail", r.LIGHTRAIL);
    flag("major institution", r.MIO_NAME);
    flag("contract rezone", r.CONTRACT);
    if (str(r.MHA) === "Y") overlays.push(str(r.MHA_VALUE) ? `MHA ${str(r.MHA_VALUE)}` : "MHA");
    if (str(r.IZ) === "Y") overlays.push("incentive zoning");
    const published: Record<string, string> = {};
    put(published, "what it allows (Seattle)", r.PUBLIC_DESCRIPTION);
    put(published, "detail", r.DETAIL_DESC);
    put(published, "class", r.CLASS_DESC);
    put(published, "code chapter", r.CHAPTER);
    hits.push({
      code,
      base: str(r.ZONELUT) ?? str(r.BASE_ZONE),
      label: str(r.ZONING_DESC) ?? str(r.ZONELUT_DESC),
      category: str(r.CATEGORY_DESC),
      family: familyFromWords(str(r.CATEGORY_DESC)),
      overlays,
      ordinance: str(r.ORDINANCE),
      effective: isoDate(r.EFFECTIVE),
      codeUrl: str(r.CHAPTER_LINK),
      published,
    });
  }
  return firstDistinct(hits);
}

// ------------------------------------------------------------------ Denver

export const DENVER_LAYER = "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_ZONE_ZONING_A/FeatureServer/209";
export const DENVER_POINT_FIELDS = [
  "ZONE_DISTRICT", "ZONE_DESCRIPTION", "ZONE_DIST_TYPE", "NBHD_CONTEXT", "ZCODE_VERSION", "OVERLAY_DISTRICT",
  "WAIVERS", "CONDITIONS", "PUD_NUM", "ORD_NUM", "ORD_YEAR", "HEIGHT_STORIES", "ADU", "NOTES",
] as const;
export const DENVER_POLYGON_FIELDS = ["OBJECTID", "ZONE_DISTRICT", "ZONE_DIST_TYPE"] as const;

export function denverHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.ZONE_DISTRICT);
    if (!code) continue;
    const ord = str(r.ORD_NUM);
    const year = str(r.ORD_YEAR);
    const overlays = [str(r.OVERLAY_DISTRICT)].filter((x): x is string => !!x);
    const published: Record<string, string> = {};
    put(published, "neighbourhood context", r.NBHD_CONTEXT);
    put(published, "zoning code version", r.ZCODE_VERSION);
    put(published, "waivers", r.WAIVERS);
    put(published, "conditions", r.CONDITIONS);
    put(published, "PUD", r.PUD_NUM);
    put(published, "height (stories)", r.HEIGHT_STORIES);
    put(published, "accessory dwelling units", r.ADU);
    put(published, "notes", r.NOTES);
    hits.push({
      code,
      label: str(r.ZONE_DESCRIPTION)?.replace(/\s+/g, " "),
      category: str(r.ZONE_DIST_TYPE),
      family: familyFromWords(str(r.ZONE_DIST_TYPE)),
      overlays,
      ordinance: ord ? (year ? `${ord} (${year})` : ord) : undefined,
      published,
    });
  }
  return firstDistinct(hits);
}

// ------------------------------------------------------------------ New York City

const NYC_DCP = "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/arcgis/rest/services";
export const NYC_ZD_LAYER = `${NYC_DCP}/nyzd/FeatureServer/0`;
/** MapPLUTO, asked for the BBL under a point and nothing else (the layer also carries owner names). */
export const NYC_PLUTO_LAYER = `${NYC_DCP}/MAPPLUTO/FeatureServer/0`;
export const NYC_PLUTO_FIELDS = ["BBL"] as const;
export const NYC_ZTLDB = "https://data.cityofnewyork.us/resource/fdkv-4t4z";
export const NYC_POLYGON_FIELDS = ["OBJECTID", "ZONEDIST"] as const;
/**
 * DCP's special purpose district, commercial overlay and limited-height
 * district layers, asked at the point when the Zoning Tax Lot Database cannot
 * answer for the lot: condominium billing lots (lot 75xx, which MapPLUTO
 * returns for a condo building) have no ZTLDB row, and a street has no lot.
 */
export const NYC_SP_LAYER = `${NYC_DCP}/nysp/FeatureServer/0`;
export const NYC_CO_LAYER = `${NYC_DCP}/nyco/FeatureServer/0`;
export const NYC_LH_LAYER = `${NYC_DCP}/nylh/FeatureServer/0`;

export function nycOverlayRequests(lon: number, lat: number): { sp: ArcgisRequest; co: ArcgisRequest; lh: ArcgisRequest } {
  return {
    sp: arcgisPoint(NYC_SP_LAYER, lon, lat, ["SDLBL", "SDNAME"]),
    co: arcgisPoint(NYC_CO_LAYER, lon, lat, ["OVERLAY"]),
    lh: arcgisPoint(NYC_LH_LAYER, lon, lat, ["LHLBL", "LHNAME"]),
  };
}

/** Why the overlays at a New York point come from DCP's point layers, not the tax lot's ZTLDB row. */
export const NYC_LOT_GAP = {
  condo: "the Zoning Tax Lot Database has no row for this BBL (condominium billing lots are not in it)",
  noLot: "MapPLUTO has no tax lot at this point",
  lotDown: "MapPLUTO did not answer this time, so the tax lot is unknown",
  ztldbDown: "the Zoning Tax Lot Database did not answer this time",
} as const;

/** The overlays, special districts and limited-height district DCP's point layers put at the point. */
export function withPointOverlays(hit: ZoningHit, sp: Row[], co: Row[], lh: Row[], why: string): ZoningHit {
  const distinct = (xs: Array<string | undefined>) => [...new Set(xs.filter((x): x is string => !!x))];
  const overlays = [
    ...distinct(co.map((r) => str(r.OVERLAY))).map((x) => `commercial overlay ${x}`),
    ...distinct(sp.map((r) => str(r.SDLBL))).map((x) => `special district ${x}`),
    ...distinct(lh.map((r) => str(r.LHLBL))).map((x) => `limited height ${x}`),
  ];
  const published: Record<string, string> = { ...hit.published };
  const names = distinct(sp.map((r) => str(r.SDNAME)));
  if (names.length) published["special purpose district"] = names.join(", ");
  published["overlays from"] = `DCP's special purpose district, commercial overlay and limited-height layers at this point: ${why}`;
  return { ...hit, overlays: [...hit.overlays, ...overlays], published };
}

/** Said when neither the ZTLDB nor DCP's point layers answered: unknown, not absent. */
export function overlaysUnknown(hit: ZoningHit, why: string): ZoningHit {
  return {
    ...hit,
    published: {
      ...hit.published,
      overlays: `unknown, not absent: ${why}, and DCP's overlay layers did not answer this time`,
    },
  };
}

export function nycDistrictHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.ZONEDIST);
    if (code) hits.push({ code, family: nycFamily(code), overlays: [], published: {} });
  }
  return firstDistinct(hits);
}

/** The BBL MapPLUTO returns for the point, as a 10-digit string; a missing or malformed one is null. */
export function plutoBbl(rows: Row[]): string | null {
  for (const r of rows) {
    const v = r.BBL;
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
    if (Number.isFinite(n) && n >= 1_000_000_000 && n < 6_000_000_000) return String(Math.round(n));
  }
  return null;
}

export function ztldbUrl(bbl: string): string {
  return `${NYC_ZTLDB}.json?bbl=${encodeURIComponent(bbl)}`;
}

/** Folds the Zoning Tax Lot Database row for the lot into the district answer. */
export function withZtldb(hit: ZoningHit, rows: Row[]): ZoningHit {
  const r = rows[0];
  if (!r) return hit;
  const districts = [r.zoning_district_1, r.zoning_district_2, r.zoning_district_3, r.zoning_district_4].map(str).filter((x): x is string => !!x);
  const overlays = [
    ...[r.commercial_overlay_1, r.commercial_overlay_2].map(str).filter((x): x is string => !!x).map((x) => `commercial overlay ${x}`),
    ...[r.special_district_1, r.special_district_2, r.special_district_3].map(str).filter((x): x is string => !!x).map((x) => `special district ${x}`),
  ];
  const lh = str(r.limited_height_district);
  if (lh) overlays.push(`limited height ${lh}`);
  const published: Record<string, string> = { ...hit.published };
  if (districts.length) published["districts on this tax lot"] = districts.join(", ");
  put(published, "zoning map", r.zoning_map_number);
  put(published, "zoning map code", r.zoning_map_code);
  return { ...hit, overlays: [...hit.overlays, ...overlays], published };
}

// ------------------------------------------------------------------ Chicago

export const CHICAGO_ZONING = "https://data.cityofchicago.org/resource/dj47-wfun";
export const CHICAGO_POINT_SELECT = ["zone_class", "zone_type", "pd_num", "pd_prefix", "ordinance", "ordinance_1", "edit_date", "clerk_url", "case_numbe"] as const;
export const CHICAGO_POLYGON_SELECT = ["zone_class"] as const;

export function chicagoHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.zone_class);
    if (!code) continue;
    const published: Record<string, string> = {};
    const pd = str(r.pd_num);
    if (pd && pd !== "0") put(published, "planned development", `${str(r.pd_prefix) ?? "PD"} ${pd}`);
    hits.push({
      code,
      family: chicagoFamily(code),
      overlays: [],
      ordinance: str(r.ordinance),
      effective: isoDate(r.ordinance_1),
      caseNumber: str(r.case_numbe),
      recordUrl: str((r.clerk_url as { url?: unknown } | undefined)?.url ?? r.clerk_url),
      editedAt: isoDate(r.edit_date),
      published,
    });
  }
  return firstDistinct(hits);
}

// ------------------------------------------------------------------ Dallas

export const DALLAS_ZONING = "https://www.dallasopendata.com/resource/f3t3-a5rd";
export const DALLAS_POINT_SELECT = ["zone_dist", "long_zone_dist", "pd_num", "ord_num", "effectivedate", "common_name", "case_number", "council_date", "notes"] as const;
export const DALLAS_POLYGON_SELECT = ["long_zone_dist", "zone_dist", "pd_num"] as const;

export function dallasHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.long_zone_dist) ?? str(r.zone_dist);
    if (!code) continue;
    const published: Record<string, string> = {};
    put(published, "planned development", r.pd_num);
    put(published, "common name", r.common_name);
    put(published, "council date", isoDate(r.council_date));
    put(published, "notes", r.notes);
    hits.push({
      code,
      base: str(r.zone_dist),
      family: /^PD\b|^PD-/i.test(code) ? "planned" : "coded",
      overlays: [],
      ordinance: str(r.ord_num),
      effective: isoDate(r.effectivedate),
      caseNumber: str(r.case_number),
      published,
    });
  }
  return firstDistinct(hits);
}

// ------------------------------------------------------------------ San Antonio

export const SANANTONIO_LAYER = "https://services.arcgis.com/g1fRTDLeMgspWrYp/arcgis/rest/services/COSA_Zoning/FeatureServer/12";
export const SANANTONIO_POINT_FIELDS = [
  "Zoning", "ZoningDetail", "Base", "BaseDescription", "SpecDistrict", "SpecDistrictDescription", "SpecCondition", "SpecConditionDetail", "CaseNo", "OrdinanceKey", "ModifiedDate",
] as const;
export const SANANTONIO_POLYGON_FIELDS = ["OBJECTID", "Zoning", "Base", "BaseDescription"] as const;

export function sanAntonioHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.ZoningDetail) ?? str(r.Zoning);
    if (!code) continue;
    const rightOfWay = str(r.Base)?.toUpperCase() === "UZROW";
    const overlays: string[] = [];
    const sd = str(r.SpecDistrict);
    if (sd) overlays.push(str(r.SpecDistrictDescription) ? `${sd}: ${str(r.SpecDistrictDescription)}` : sd);
    const sc = str(r.SpecCondition);
    if (sc) overlays.push(str(r.SpecConditionDetail) ? `${sc}: ${str(r.SpecConditionDetail)}` : sc);
    const published: Record<string, string> = {};
    put(published, "ordinance key", r.OrdinanceKey);
    hits.push({
      code,
      base: str(r.Base),
      label: str(r.BaseDescription),
      category: str(r.BaseDescription),
      family: rightOfWay ? "right-of-way" : familyFromWords(str(r.BaseDescription)),
      overlays,
      caseNumber: str(r.CaseNo),
      editedAt: isoDate(r.ModifiedDate),
      published,
      rightOfWay,
    });
  }
  // A zoned district wins over the right-of-way polygon it borders.
  hits.sort((a, b) => Number(!!a.rightOfWay) - Number(!!b.rightOfWay));
  return firstDistinct(hits);
}

// ------------------------------------------------------------------ Austin

export const AUSTIN_LAYER = "https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/PLANNINGCADASTRE_zoning_small_map_scale/FeatureServer/0";
export const AUSTIN_POINT_FIELDS = ["ZONING_ZTYPE", "ZONING_BASE", "MODIFIED_DATE"] as const;
export const AUSTIN_POLYGON_FIELDS = ["OBJECTID", "ZONING_ZTYPE", "ZONING_BASE"] as const;

export function austinHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.ZONING_ZTYPE);
    if (!code) continue;
    hits.push({ code, base: str(r.ZONING_BASE), family: "coded", overlays: [], editedAt: isoDate(r.MODIFIED_DATE), published: {} });
  }
  return firstDistinct(hits);
}

// ------------------------------------------------------------------ Los Angeles

export const LA_LAYER = "https://maps.lacity.org/lahub/rest/services/City_Planning_Department/MapServer/8";
export const LA_POINT_FIELDS = ["ZONE_CMPLT", "ZONE_CLASS", "ZONE_UNDER", "ZONING_DESCRIPTION"] as const;
export const LA_POLYGON_FIELDS = ["OBJECTID", "ZONE_CMPLT", "ZONING_DESCRIPTION"] as const;

export function losAngelesHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.ZONE_CMPLT);
    if (!code) continue;
    const published: Record<string, string> = {};
    put(published, "zone class", r.ZONE_CLASS);
    put(published, "underlying zone", r.ZONE_UNDER);
    hits.push({
      code,
      label: str(r.ZONING_DESCRIPTION),
      category: str(r.ZONING_DESCRIPTION),
      family: familyFromWords(str(r.ZONING_DESCRIPTION)),
      overlays: [],
      published,
    });
  }
  return firstDistinct(hits);
}

// ------------------------------------------------------------------ San Francisco

/**
 * data.sf.gov, not data.sfgov.org: the old host 301-redirects every request
 * there, and its redirector answers any $select with a 403 (probed
 * 2026-09-26). Without the_geom a point answer is a few hundred bytes (197 at
 * City Hall), not the district's whole outline.
 */
export const SF_ZONING = "https://data.sf.gov/resource/3i4a-hu95";
export const SF_POINT_SELECT = ["zoning", "zoning_sim", "districtna", "gen", "url", "codesectio"] as const;
export const SF_POLYGON_SELECT = ["zoning", "zoning_sim", "gen"] as const;

export function sanFranciscoHit(rows: Row[]): ZoningHit | null {
  const hits: ZoningHit[] = [];
  for (const r of rows) {
    const code = str(r.zoning) ?? str(r.zoning_sim);
    if (!code) continue;
    const published: Record<string, string> = {};
    put(published, "planning code section", r.codesectio);
    hits.push({
      code,
      label: str(r.districtna),
      category: str(r.gen),
      family: familyFromWords(str(r.gen)),
      overlays: [],
      codeUrl: str(r.url),
      published,
    });
  }
  return firstDistinct(hits);
}

// ------------------------------------------------------------------ registry

export interface ZoningCity {
  id: ZoningCityId;
  name: string;
  state: string;
  /** Census TIGERweb GEOID of the incorporated place. */
  placeGeoid: string;
  /** null for Houston, which has no zoning source because it has no zoning. */
  source: SourceId | null;
  publisher: string;
  /** A rough box around the city; it only picks which services a polygon box asks. */
  bbox: Bbox;
  /** Whether district polygons are drawn (a point answer is always available). */
  polygons: boolean;
  /** Said in coverage lists and the dossier. */
  note?: string;
}

export const ZONING_CITIES: Record<ZoningCityId, ZoningCity> = {
  seattle: { id: "seattle", name: "Seattle", state: "WA", placeGeoid: "5363000", source: "seattle-zoning", publisher: "City of Seattle", bbox: [-122.46, 47.48, -122.22, 47.74], polygons: true },
  denver: { id: "denver", name: "Denver", state: "CO", placeGeoid: "0820000", source: "denver-zoning", publisher: "City and County of Denver", bbox: [-105.11, 39.61, -104.6, 39.92], polygons: true },
  nyc: {
    id: "nyc",
    name: "New York City",
    state: "NY",
    placeGeoid: "3651000",
    source: "nyc-dcp-zoning",
    publisher: "NYC Department of City Planning",
    bbox: [-74.26, 40.49, -73.7, 40.92],
    polygons: true,
    note: "District at the point from DCP's zoning districts; overlays, special districts and limited-height districts from the Zoning Tax Lot Database row of the lot under it, or, where the lot has no row (condominium billing lots) or there is no lot, from DCP's overlay layers at the point.",
  },
  chicago: { id: "chicago", name: "Chicago", state: "IL", placeGeoid: "1714000", source: "chicago-zoning", publisher: "City of Chicago", bbox: [-87.95, 41.64, -87.52, 42.03], polygons: true },
  dallas: { id: "dallas", name: "Dallas", state: "TX", placeGeoid: "4819000", source: "dallas-zoning", publisher: "City of Dallas", bbox: [-97.0, 32.61, -96.46, 33.03], polygons: true },
  sanantonio: { id: "sanantonio", name: "San Antonio", state: "TX", placeGeoid: "4865000", source: "sanantonio-zoning", publisher: "City of San Antonio", bbox: [-98.81, 29.21, -98.22, 29.74], polygons: true },
  austin: {
    id: "austin",
    name: "Austin",
    state: "TX",
    placeGeoid: "4805000",
    source: "austin-zoning",
    publisher: "City of Austin",
    bbox: [-97.94, 30.08, -97.56, 30.52],
    polygons: true,
    note: "Austin's zoning polygons leave street right-of-way out, so a point in a street has no district polygon.",
  },
  losangeles: { id: "losangeles", name: "Los Angeles", state: "CA", placeGeoid: "0644000", source: "la-zoning", publisher: "City of Los Angeles Department of City Planning", bbox: [-118.67, 33.7, -118.15, 34.34], polygons: true },
  sanfrancisco: {
    id: "sanfrancisco",
    name: "San Francisco",
    state: "CA",
    placeGeoid: "0667000",
    source: "sf-zoning",
    publisher: "San Francisco Planning Department",
    bbox: [-122.52, 37.7, -122.35, 37.84],
    polygons: true,
  },
  houston: {
    id: "houston",
    name: "Houston",
    state: "TX",
    placeGeoid: "4835000",
    source: null,
    publisher: "City of Houston",
    bbox: [-95.79, 29.52, -95.01, 30.12],
    polygons: false,
    note: "Houston has no zoning ordinance. Deed restrictions and the development rules in Chapter 42 of the City Code apply instead.",
  },
};

export const ZONING_CITY_IDS = Object.keys(ZONING_CITIES) as ZoningCityId[];

export function cityByGeoid(geoid: string | undefined): ZoningCity | null {
  if (!geoid) return null;
  return Object.values(ZONING_CITIES).find((c) => c.placeGeoid === geoid) ?? null;
}

/** The point request for a city (New York's lot lookup is separate). */
export function pointRequest(id: ZoningCityId, lon: number, lat: number): ZoningRequest | null {
  switch (id) {
    case "seattle":
      return arcgisPoint(SEATTLE_LAYER, lon, lat, SEATTLE_POINT_FIELDS);
    case "denver":
      return arcgisPoint(DENVER_LAYER, lon, lat, DENVER_POINT_FIELDS);
    case "nyc":
      return arcgisPoint(NYC_ZD_LAYER, lon, lat, ["ZONEDIST"]);
    case "chicago":
      return socrataPoint(CHICAGO_ZONING, lon, lat, CHICAGO_POINT_SELECT);
    case "dallas":
      return socrataPoint(DALLAS_ZONING, lon, lat, DALLAS_POINT_SELECT);
    case "sanantonio":
      return arcgisPoint(SANANTONIO_LAYER, lon, lat, SANANTONIO_POINT_FIELDS);
    case "austin":
      return arcgisPoint(AUSTIN_LAYER, lon, lat, AUSTIN_POINT_FIELDS);
    case "losangeles":
      return arcgisPoint(LA_LAYER, lon, lat, LA_POINT_FIELDS);
    case "sanfrancisco":
      return socrataPoint(SF_ZONING, lon, lat, SF_POINT_SELECT);
    case "houston":
      return null;
  }
}

export function hitFor(id: ZoningCityId, rows: Row[]): ZoningHit | null {
  switch (id) {
    case "seattle":
      return seattleHit(rows);
    case "denver":
      return denverHit(rows);
    case "nyc":
      return nycDistrictHit(rows);
    case "chicago":
      return chicagoHit(rows);
    case "dallas":
      return dallasHit(rows);
    case "sanantonio":
      return sanAntonioHit(rows);
    case "austin":
      return austinHit(rows);
    case "losangeles":
      return losAngelesHit(rows);
    case "sanfrancisco":
      return sanFranciscoHit(rows);
    case "houston":
      return null;
  }
}

/** Generalisation for district outlines, degrees (~3 m). */
export const POLYGON_OFFSET = 0.00003;
/** Socrata answers at most this many outlines per box. */
export const POLYGON_LIMIT = 1500;

export function polygonRequest(id: ZoningCityId, b: Bbox): ZoningRequest | null {
  switch (id) {
    case "seattle":
      return arcgisBox(SEATTLE_LAYER, b, SEATTLE_POLYGON_FIELDS, POLYGON_OFFSET);
    case "denver":
      return arcgisBox(DENVER_LAYER, b, DENVER_POLYGON_FIELDS, POLYGON_OFFSET);
    case "nyc":
      return arcgisBox(NYC_ZD_LAYER, b, NYC_POLYGON_FIELDS, POLYGON_OFFSET);
    case "chicago":
      return socrataBox(CHICAGO_ZONING, b, CHICAGO_POLYGON_SELECT, POLYGON_OFFSET, POLYGON_LIMIT);
    case "dallas":
      return socrataBox(DALLAS_ZONING, b, DALLAS_POLYGON_SELECT, POLYGON_OFFSET, POLYGON_LIMIT);
    case "sanantonio":
      return arcgisBox(SANANTONIO_LAYER, b, SANANTONIO_POLYGON_FIELDS, POLYGON_OFFSET);
    case "austin":
      return arcgisBox(AUSTIN_LAYER, b, AUSTIN_POLYGON_FIELDS, POLYGON_OFFSET);
    case "losangeles":
      return arcgisBox(LA_LAYER, b, LA_POLYGON_FIELDS, POLYGON_OFFSET);
    case "sanfrancisco":
      return socrataBox(SF_ZONING, b, SF_POLYGON_SELECT, POLYGON_OFFSET, POLYGON_LIMIT);
    case "houston":
      return null;
  }
}

/** The code and colour family of one outline, per city. */
export function polygonCode(id: ZoningCityId, p: Row): { code: string; family: ZoningFamily; category?: string } | null {
  switch (id) {
    case "seattle": {
      const code = str(p.ZONING);
      return code ? { code, family: familyFromWords(str(p.CATEGORY_DESC)), category: str(p.CATEGORY_DESC) } : null;
    }
    case "denver": {
      const code = str(p.ZONE_DISTRICT);
      return code ? { code, family: familyFromWords(str(p.ZONE_DIST_TYPE)), category: str(p.ZONE_DIST_TYPE) } : null;
    }
    case "nyc": {
      const code = str(p.ZONEDIST);
      return code ? { code, family: nycFamily(code) } : null;
    }
    case "chicago": {
      const code = str(p.zone_class);
      return code ? { code, family: chicagoFamily(code) } : null;
    }
    case "dallas": {
      const code = str(p.long_zone_dist) ?? str(p.zone_dist);
      return code ? { code, family: /^PD\b|^PD-/i.test(code) ? "planned" : "coded" } : null;
    }
    case "sanantonio": {
      const code = str(p.Zoning);
      if (!code) return null;
      const row = str(p.Base)?.toUpperCase() === "UZROW";
      return { code, family: row ? "right-of-way" : familyFromWords(str(p.BaseDescription)), category: str(p.BaseDescription) };
    }
    case "austin": {
      const code = str(p.ZONING_ZTYPE);
      return code ? { code, family: "coded" } : null;
    }
    case "losangeles": {
      const code = str(p.ZONE_CMPLT);
      return code ? { code, family: familyFromWords(str(p.ZONING_DESCRIPTION)), category: str(p.ZONING_DESCRIPTION) } : null;
    }
    case "sanfrancisco": {
      const code = str(p.zoning) ?? str(p.zoning_sim);
      return code ? { code, family: familyFromWords(str(p.gen)), category: str(p.gen) } : null;
    }
    case "houston":
      return null;
  }
}

// ------------------------------------------------------------------ records

/** "5363000" -> Seattle. */
export interface PlaceHit {
  geoid: string;
  name: string;
}

/** The incorporated place TIGERweb returns for a point (layer 28); null outside every one. */
export function parsePlace(rows: Row[]): PlaceHit | null {
  for (const r of rows) {
    const geoid = str(r.GEOID);
    const name = str(r.NAME) ?? str(r.BASENAME);
    if (geoid && name) return { geoid, name };
  }
  return null;
}

function rounded(x: number): number {
  return Number(x.toFixed(6));
}

/** The answer for a point outside every wired city. */
export function notCoveredRecord(lon: number, lat: number, place: PlaceHit | null): ZoningRecord {
  return {
    state: "not-covered",
    lon: rounded(lon),
    lat: rounded(lat),
    place: place ?? undefined,
    overlays: [],
    published: {},
    note: place
      ? `No zoning source is wired for ${place.name}. Covered: ${coveredCityNames()}.`
      : `The point is not inside an incorporated place (TIGERweb), where county rules, if any, apply. Covered cities: ${coveredCityNames()}.`,
  };
}

export function houstonRecord(lon: number, lat: number, place: PlaceHit): ZoningRecord {
  const c = ZONING_CITIES.houston;
  return {
    state: "no-ordinance",
    lon: rounded(lon),
    lat: rounded(lat),
    place,
    city: c.id,
    cityName: c.name,
    publisher: c.publisher,
    overlays: [],
    published: {},
    note: c.note!,
  };
}

/** A city's hit (or its absence) as the record the route returns. */
export function cityRecord(id: ZoningCityId, lon: number, lat: number, place: PlaceHit, hit: ZoningHit | null, lot?: { bbl: string }): ZoningRecord {
  const c = ZONING_CITIES[id];
  const base = {
    lon: rounded(lon),
    lat: rounded(lat),
    place,
    city: c.id,
    cityName: c.name,
    source: c.source ?? undefined,
    publisher: c.publisher,
    lot,
  };
  if (!hit) {
    return {
      ...base,
      state: "no-district",
      overlays: [],
      published: {},
      note:
        id === "austin"
          ? `${c.note} An empty answer here is a street right-of-way or a gap in the layer; it does not mean the land is unzoned.`
          : `${c.name}'s zoning layer has no district polygon at this point: a street, water or a gap in the layer. It does not mean the land is unzoned.`,
    };
  }
  const { published, overlays, rightOfWay, ...rest } = hit;
  return {
    ...base,
    ...rest,
    state: rightOfWay ? "right-of-way" : "district",
    overlays,
    published,
    note: rightOfWay
      ? `${c.name} maps this point as street right-of-way (${hit.code}${hit.label ? `, "${hit.label}"` : ""}), which its zoning map leaves unzoned; the lots on either side carry their own districts.`
      : `Zoning as ${c.publisher} publishes it in its GIS. The adopted zoning map and code govern; this is not a zoning verification letter.`,
  };
}

export function coveredCityNames(): string {
  return ZONING_CITY_IDS.filter((id) => id !== "houston")
    .map((id) => ZONING_CITIES[id].name)
    .join(", ");
}

// ------------------------------------------------------------------ outlines

export interface ZoningOutlineExtra {
  city: ZoningCityId;
  code: string;
  family: ZoningFamily;
  category?: string;
}

type Poly = Polygon | MultiPolygon;
function isPoly(g: GeoJSON.Geometry | null | undefined): g is Poly {
  return !!g && (g.type === "Polygon" || g.type === "MultiPolygon");
}

/** A stable id for an outline: the service's object id where it sends one, else code + first vertex. */
function outlineId(id: ZoningCityId, f: { id?: number | string; properties: Row; geometry: Poly }, code: string): string {
  const oid = f.id ?? f.properties.OBJECTID;
  if (oid != null && oid !== "") return `${id}:${oid}`;
  const ring = f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0]?.[0];
  const v = ring?.[0];
  return `${id}:${code}:${v ? `${v[0].toFixed(5)},${v[1].toFixed(5)}` : "?"}`;
}

/**
 * District outlines as plain GeoJSON features (the route's `data`); the layer
 * turns them into globe features. Rows without a code or a polygon are dropped.
 */
export function buildOutlines(
  id: ZoningCityId,
  features: Array<{ id?: number | string; geometry: GeoJSON.Geometry | null; properties: Row | null }>,
): Array<{ type: "Feature"; id: string; geometry: Poly; properties: ZoningOutlineExtra }> {
  const out: Array<{ type: "Feature"; id: string; geometry: Poly; properties: ZoningOutlineExtra }> = [];
  const seen = new Set<string>();
  for (const f of features) {
    if (!isPoly(f.geometry)) continue;
    const props = f.properties ?? {};
    const pc = polygonCode(id, props);
    if (!pc) continue;
    const fid = outlineId(id, { id: f.id, properties: props, geometry: f.geometry }, pc.code);
    if (seen.has(fid)) continue;
    seen.add(fid);
    out.push({ type: "Feature", id: fid, geometry: f.geometry, properties: { city: id, code: pc.code, family: pc.family, category: pc.category } });
  }
  return out;
}

/** Cities whose rough box meets a box. */
export function citiesInBox(b: Bbox): ZoningCity[] {
  const [w, s, e, n] = b;
  return Object.values(ZONING_CITIES).filter((c) => {
    const [cw, cs, ce, cn] = c.bbox;
    return w < ce && e > cw && s < cn && n > cs;
  });
}
