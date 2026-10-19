// Building permits: the permits seven city portals published as issued in
// the last days, as points. Plain functions (no network, no Cesium, no
// React), shared by /api/permits and the permits layer, tested on payloads
// captured from each portal (lib/permits/fixtures).
//
// What is asked for and what is dropped. Every request names its columns
// ($select, or outFields for Denver's ArcGIS layer), so an applicant, owner or
// contact name never reaches this server: Chicago's fifteen contact_N_name
// columns, New York's applicant, filing representative and owner columns,
// Austin's contractor_full_name and applicant columns are simply not
// requested. The contractor company Austin, Seattle and Denver publish is
// requested and kept as published, in the dossier only; it can be a sole
// trader's own name. Nothing searches it (lib/search/allowlist.ts).
//
// Numbers the portals send as text ("50000.0000", "") go through finite():
// blank and missing are undefined, never 0. Each valuation keeps the name of
// the column it came from ("reported cost", "estimated project cost"...),
// because the cities do not measure the same thing.

import type { SourceId } from "@/lib/provenance/sources";
import { isoDate, str, type Bbox } from "@/lib/zoning/features";

export type PermitCityId = "chicago" | "austin" | "seattle" | "denver" | "nyc" | "losangeles" | "sanfrancisco";

/** What a source answered for a box, distinct in the response and the layer note. */
export type CoverageState =
  | "covered" // answered; zero permits is a real zero
  | "partial" // answered, but hit its cap: the newest N of more
  | "stale" // the city's feed stopped updating
  | "no-feed" // the city publishes no record-level permits
  | "token-required" // the city's service now asks for a token
  | "not-wired" // a feed exists but is not usable here, with the reason
  | "error"; // did not answer this time: missing, not absent

export interface PermitRecord {
  /** `<city>:<permit number>`, suffixed when a city lists one number at several points. */
  id: string;
  city: PermitCityId;
  lon: number;
  lat: number;
  /** The permit number as the city publishes it. */
  number: string;
  /** Permit type, as published. */
  kind?: string;
  /** Work type or class, as published. */
  work?: string;
  description?: string;
  /** Dollars, in the column named by valuationLabel. */
  valuation?: number;
  valuationLabel?: string;
  fee?: number;
  status?: string;
  applied?: string;
  issued?: string;
  finaled?: string;
  expires?: string;
  /** The permit's site address, as published. */
  address?: string;
  /** The parcel key the city publishes on the permit. */
  parcel?: { scheme: "bbl" | "tcad" | "schednum" | "pin" | "blocklot"; id: string };
  /** Zoning the city prints on the permit (Los Angeles, Seattle). */
  zoning?: string;
  contractorCompany?: string;
  /** The city's own record page. */
  url?: string;
  published: Record<string, string>;
}

type Row = Record<string, unknown>;

/** A number the portal may send as text; blank, null and non-numbers are undefined (Number("") is 0). */
export function finite(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = String(v).trim().replace(/^\$/, "").replace(/,/g, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const MAX_TEXT = 400;
/** Long free text is cut with an ellipsis, so the cut is visible. */
export function clip(v: unknown): string | undefined {
  const s = str(v)?.replace(/\s+/g, " ");
  if (!s) return undefined;
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s;
}

function put(out: Record<string, string>, label: string, v: unknown): void {
  const s = typeof v === "number" ? String(v) : str(v);
  if (s) out[label] = s;
}

function lonLat(lon: unknown, lat: unknown): [number, number] | null {
  const x = finite(lon);
  const y = finite(lat);
  if (x == null || y == null || Math.abs(x) > 180 || Math.abs(y) > 90 || (x === 0 && y === 0)) return null;
  return [x, y];
}

function joinAddress(...parts: unknown[]): string | undefined {
  const s = parts.map(str).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return s || undefined;
}

/** A Socrata url column arrives as { url }. */
function urlOf(v: unknown): string | undefined {
  const u = str((v as { url?: unknown } | null | undefined)?.url ?? v);
  return u && /^https?:\/\//.test(u) ? u : undefined;
}

// ------------------------------------------------------------------ requests

export interface PermitRequest {
  kind: "socrata" | "arcgis";
  url: string;
  params?: Record<string, string>;
}

/** Socrata's within_box takes the north-west then the south-east corner. */
function withinBox(col: string, b: Bbox): string {
  const [w, s, e, n] = b;
  return `within_box(${col},${n},${w},${s},${e})`;
}

function soql(base: string, select: readonly string[], where: string, order: string, limit: number): PermitRequest {
  const q = new URLSearchParams();
  q.set("$select", select.join(","));
  q.set("$where", where);
  q.set("$order", order);
  q.set("$limit", String(limit));
  return { kind: "socrata", url: `${base}.json?${q.toString()}` };
}

/** Newest first; the cap makes "the newest N" true when it is hit. */
export const PERMIT_LIMIT = 500;

export const CHICAGO_PERMITS = "https://data.cityofchicago.org/resource/ydr8-5enu";
export const CHICAGO_PERMIT_SELECT = [
  "id", "permit_", "permit_status", "permit_milestone", "permit_type", "review_type", "application_start_date", "issue_date", "processing_time",
  "street_number", "street_direction", "street_name", "work_type", "work_description", "total_fee", "reported_cost", "pin_list", "community_area", "ward", "latitude", "longitude",
] as const;

export const AUSTIN_PERMITS = "https://data.austintexas.gov/resource/3syk-w9eu";
export const AUSTIN_PERMIT_SELECT = [
  "permit_number", "permit_type_desc", "permit_class_mapped", "permit_class", "work_class", "description", "tcad_id", "applieddate", "issue_date",
  "status_current", "expiresdate", "completed_date", "total_job_valuation", "number_of_floors", "housing_units", "original_address1", "original_city", "original_zip",
  "council_district", "jurisdiction", "link", "latitude", "longitude", "contractor_trade", "contractor_company_name",
] as const;

export const SEATTLE_PERMITS = "https://data.seattle.gov/resource/76t5-zqzr";
export const SEATTLE_PERMIT_SELECT = [
  "permitnum", "permitclass", "permitclassmapped", "permittypemapped", "permittypedesc", "description", "housingunitsremoved", "housingunitsadded", "estprojectcost",
  "applieddate", "issueddate", "expiresdate", "completeddate", "statuscurrent", "originaladdress1", "originalzip", "contractorcompanyname", "link", "latitude", "longitude", "zoning",
] as const;

export const NYC_PERMITS = "https://data.cityofnewyork.us/resource/rbx6-tga4";
export const NYC_PERMIT_SELECT = [
  "job_filing_number", "work_permit", "filing_reason", "house_no", "street_name", "borough", "block", "lot", "bin", "bbl", "work_on_floor", "work_type",
  "job_description", "estimated_job_costs", "approved_date", "issued_date", "expired_date", "permit_status", "tracking_number", "latitude", "longitude", "community_board", "nta",
] as const;

export const LA_PERMITS = "https://data.lacity.org/resource/pi9x-tg5x";
export const LA_PERMIT_SELECT = [
  "permit_nbr", "primary_address", "zip_code", "zone", "cpa", "cnc", "permit_group", "permit_type", "permit_sub_type", "use_desc", "submitted_date", "issue_date",
  "cofo_date", "du_changed", "adu_changed", "square_footage", "status_desc", "valuation", "construction", "height", "work_desc", "lat", "lon",
] as const;

/**
 * data.sf.gov, not data.sfgov.org: the old host 301-redirects every request
 * there, and its redirector answers any $select with a 403 (probed
 * 2026-09-26). Asked for SF_KEEP.
 */
export const SF_PERMITS = "https://data.sf.gov/resource/i98e-djp9";

export const DENVER_PERMITS = "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/arcgis/rest/services/ODC_DEV_RESIDENTIALCONSTPERMIT_P/FeatureServer/316";
export const DENVER_PERMIT_FIELDS = [
  "PERMIT_NUM", "DATE_RECEIVED", "DATE_ISSUED", "FINAL_DATE", "CANCEL", "CLASS", "UNITS", "VALUATION", "PERMIT_FEE", "CONTRACTOR_NAME", "ADDRESS", "SCHEDNUM", "NEIGHBORHOOD", "CO_REQUIRED", "DATE_CO_ISSUED",
] as const;

/** Floating timestamp for SoQL comparisons. */
function floating(sinceIso: string): string {
  return `${sinceIso.slice(0, 10)}T00:00:00`;
}

export function permitRequest(city: PermitCityId, b: Bbox, sinceIso: string): PermitRequest {
  const since = floating(sinceIso);
  switch (city) {
    case "chicago":
      return soql(CHICAGO_PERMITS, CHICAGO_PERMIT_SELECT, `${withinBox("location", b)} AND issue_date > '${since}'`, "issue_date DESC", PERMIT_LIMIT);
    case "austin":
      return soql(AUSTIN_PERMITS, AUSTIN_PERMIT_SELECT, `${withinBox("location", b)} AND issue_date > '${since}'`, "issue_date DESC", PERMIT_LIMIT);
    case "seattle":
      // Unissued permits sort first on issueddate DESC unless they are left out.
      return soql(SEATTLE_PERMITS, SEATTLE_PERMIT_SELECT, `${withinBox("location1", b)} AND issueddate IS NOT NULL AND issueddate > '${since}'`, "issueddate DESC", PERMIT_LIMIT);
    case "nyc": {
      const [w, s, e, n] = b;
      return soql(NYC_PERMITS, NYC_PERMIT_SELECT, `latitude between ${s} and ${n} AND longitude between ${w} and ${e} AND issued_date > '${since}'`, "issued_date DESC", PERMIT_LIMIT);
    }
    case "losangeles":
      return soql(LA_PERMITS, LA_PERMIT_SELECT, `${withinBox("geolocation", b)} AND issue_date > '${since}'`, "issue_date DESC", PERMIT_LIMIT);
    case "sanfrancisco":
      return soql(SF_PERMITS, SF_KEEP, `${withinBox("location", b)} AND issued_date > '${since}'`, "issued_date DESC", PERMIT_LIMIT);
    case "denver": {
      const [w, s, e, n] = b;
      return {
        kind: "arcgis",
        url: DENVER_PERMITS,
        params: {
          where: `DATE_ISSUED >= DATE '${sinceIso.slice(0, 10)}'`,
          geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
          geometryType: "esriGeometryEnvelope",
          inSR: "4326",
          spatialRel: "esriSpatialRelIntersects",
          outSR: "4326",
          outFields: DENVER_PERMIT_FIELDS.join(","),
          orderByFields: "DATE_ISSUED DESC",
          resultRecordCount: String(PERMIT_LIMIT),
          returnGeometry: "true",
        },
      };
    }
  }
}

export function permitRequestUrl(r: PermitRequest): string {
  if (r.kind === "socrata") return r.url;
  return `${r.url}/query?${new URLSearchParams({ f: "geojson", ...(r.params ?? {}) }).toString()}`;
}

// ------------------------------------------------------------------ normalisers

/** New York's feed has carried rows shifted by a column, "Permit is not yet issued" in the id fields. */
export function nycShifted(r: Row): boolean {
  return [r.job_filing_number, r.work_permit, r.issued_date].some((v) => typeof v === "string" && /not yet issued/i.test(v));
}

function chicago(r: Row): Omit<PermitRecord, "id" | "city"> | null {
  const ll = lonLat(r.longitude, r.latitude);
  const number = str(r.permit_);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "review type", r.review_type);
  put(published, "milestone", r.permit_milestone);
  put(published, "processing time (days)", r.processing_time);
  put(published, "community area", r.community_area);
  put(published, "ward", r.ward);
  const pins = str(r.pin_list);
  return {
    lon: ll[0],
    lat: ll[1],
    number,
    kind: str(r.permit_type),
    work: str(r.work_type),
    description: clip(r.work_description),
    valuation: finite(r.reported_cost),
    valuationLabel: "reported cost",
    fee: finite(r.total_fee),
    status: str(r.permit_status),
    applied: isoDate(r.application_start_date),
    issued: isoDate(r.issue_date),
    address: joinAddress(r.street_number, r.street_direction, r.street_name),
    parcel: pins ? { scheme: "pin", id: pins.replace(/\s*\|\s*/g, ", ") } : undefined,
    published,
  };
}

function austin(r: Row): Omit<PermitRecord, "id" | "city"> | null {
  const ll = lonLat(r.longitude, r.latitude);
  const number = str(r.permit_number);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "class", r.permit_class);
  put(published, "residential or commercial", r.permit_class_mapped);
  put(published, "floors", finite(r.number_of_floors));
  put(published, "housing units", finite(r.housing_units));
  put(published, "contractor trade", r.contractor_trade);
  put(published, "council district", r.council_district);
  put(published, "jurisdiction", r.jurisdiction);
  const tcad = str(r.tcad_id);
  return {
    lon: ll[0],
    lat: ll[1],
    number,
    kind: str(r.permit_type_desc),
    work: str(r.work_class),
    description: clip(r.description),
    valuation: finite(r.total_job_valuation),
    valuationLabel: "total job valuation",
    status: str(r.status_current),
    applied: isoDate(r.applieddate),
    issued: isoDate(r.issue_date),
    finaled: isoDate(r.completed_date),
    expires: isoDate(r.expiresdate),
    address: joinAddress(r.original_address1, r.original_zip),
    parcel: tcad ? { scheme: "tcad", id: tcad } : undefined,
    contractorCompany: str(r.contractor_company_name),
    url: urlOf(r.link),
    published,
  };
}

function seattle(r: Row): Omit<PermitRecord, "id" | "city"> | null {
  const ll = lonLat(r.longitude, r.latitude);
  const number = str(r.permitnum);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "class", r.permitclass);
  put(published, "residential or not", r.permitclassmapped);
  put(published, "type (mapped)", r.permittypemapped);
  const added = finite(r.housingunitsadded);
  const removed = finite(r.housingunitsremoved);
  if (added) put(published, "housing units added", added);
  if (removed) put(published, "housing units removed", removed);
  return {
    lon: ll[0],
    lat: ll[1],
    number,
    kind: str(r.permittypedesc),
    work: str(r.permittypemapped),
    description: clip(r.description),
    valuation: finite(r.estprojectcost),
    valuationLabel: "estimated project cost",
    status: str(r.statuscurrent),
    applied: isoDate(r.applieddate),
    issued: isoDate(r.issueddate),
    finaled: isoDate(r.completeddate),
    expires: isoDate(r.expiresdate),
    address: joinAddress(r.originaladdress1, r.originalzip),
    zoning: str(r.zoning),
    contractorCompany: str(r.contractorcompanyname),
    url: urlOf(r.link),
    published,
  };
}

function nyc(r: Row): Omit<PermitRecord, "id" | "city"> | null {
  if (nycShifted(r)) return null;
  const ll = lonLat(r.longitude, r.latitude);
  const number = str(r.work_permit) ?? str(r.job_filing_number);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "job filing", r.job_filing_number);
  put(published, "work on floor", r.work_on_floor);
  put(published, "BIN", r.bin);
  put(published, "tracking number", r.tracking_number);
  put(published, "community board", r.community_board);
  put(published, "neighbourhood (NTA)", r.nta);
  put(published, "approved", isoDate(r.approved_date));
  const bbl = str(r.bbl);
  return {
    lon: ll[0],
    lat: ll[1],
    number,
    kind: str(r.work_type),
    work: str(r.filing_reason),
    description: clip(r.job_description),
    valuation: finite(r.estimated_job_costs),
    valuationLabel: "estimated job costs",
    status: str(r.permit_status),
    issued: isoDate(r.issued_date),
    expires: isoDate(r.expired_date),
    address: joinAddress(r.house_no, r.street_name, r.borough),
    parcel: bbl ? { scheme: "bbl", id: bbl } : undefined,
    published,
  };
}

function losAngeles(r: Row): Omit<PermitRecord, "id" | "city"> | null {
  const ll = lonLat(r.lon, r.lat);
  const number = str(r.permit_nbr);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "permit group", r.permit_group);
  put(published, "use", r.use_desc);
  put(published, "square footage", finite(r.square_footage));
  put(published, "dwelling units changed", r.du_changed);
  put(published, "ADUs changed", r.adu_changed);
  put(published, "construction", r.construction);
  put(published, "height", r.height);
  put(published, "community plan area", r.cpa);
  put(published, "neighbourhood council", r.cnc);
  put(published, "certificate of occupancy", isoDate(r.cofo_date));
  return {
    lon: ll[0],
    lat: ll[1],
    number,
    kind: str(r.permit_type),
    work: str(r.permit_sub_type),
    description: clip(r.work_desc),
    valuation: finite(r.valuation),
    valuationLabel: "valuation",
    status: str(r.status_desc),
    applied: isoDate(r.submitted_date),
    issued: isoDate(r.issue_date),
    address: joinAddress(r.primary_address, r.zip_code),
    zoning: str(r.zone),
    published,
  };
}

/** The San Francisco fields asked for ($select). */
export const SF_KEEP = [
  "permit_number", "permit_type_definition", "description", "status", "filed_date", "issued_date", "completed_date", "estimated_cost", "revised_cost",
  "existing_use", "proposed_use", "existing_units", "proposed_units", "number_of_existing_stories", "number_of_proposed_stories", "street_number",
  "street_number_suffix", "street_name", "street_suffix", "unit", "unit_suffix", "block", "lot", "zipcode", "adu", "site_permit",
  "neighborhoods_analysis_boundaries", "supervisor_district", "location",
] as const;

function sanFrancisco(r: Row): Omit<PermitRecord, "id" | "city"> | null {
  const loc = r.location as { coordinates?: [unknown, unknown] } | undefined;
  const ll = lonLat(loc?.coordinates?.[0], loc?.coordinates?.[1]);
  const number = str(r.permit_number);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "existing use", r.existing_use);
  put(published, "proposed use", r.proposed_use);
  put(published, "existing units", finite(r.existing_units));
  put(published, "proposed units", finite(r.proposed_units));
  put(published, "existing stories", finite(r.number_of_existing_stories));
  put(published, "proposed stories", finite(r.number_of_proposed_stories));
  put(published, "estimated cost", finite(r.estimated_cost));
  put(published, "ADU", r.adu);
  put(published, "site permit", r.site_permit);
  put(published, "neighbourhood", r.neighborhoods_analysis_boundaries);
  put(published, "supervisor district", r.supervisor_district);
  const revised = finite(r.revised_cost);
  const estimated = finite(r.estimated_cost);
  const block = str(r.block);
  const lot = str(r.lot);
  return {
    lon: ll[0],
    lat: ll[1],
    number,
    kind: str(r.permit_type_definition),
    description: clip(r.description),
    valuation: revised ?? estimated,
    valuationLabel: revised != null ? "revised cost" : estimated != null ? "estimated cost" : undefined,
    status: str(r.status),
    applied: isoDate(r.filed_date),
    issued: isoDate(r.issued_date),
    finaled: isoDate(r.completed_date),
    address: joinAddress(r.street_number, r.street_number_suffix, r.street_name, r.street_suffix, r.unit ? `unit ${str(r.unit)}${str(r.unit_suffix) ?? ""}` : undefined, r.zipcode),
    parcel: block && lot ? { scheme: "blocklot", id: `${block}/${lot}` } : undefined,
    published,
  };
}

function denver(r: Row, geometry: GeoJSON.Geometry | null): Omit<PermitRecord, "id" | "city"> | null {
  const pt = geometry?.type === "Point" ? geometry.coordinates : null;
  const ll = pt ? lonLat(pt[0], pt[1]) : null;
  const number = str(r.PERMIT_NUM);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "neighbourhood", r.NEIGHBORHOOD);
  put(published, "units", finite(r.UNITS));
  put(published, "certificate of occupancy required", r.CO_REQUIRED);
  put(published, "certificate of occupancy issued", isoDate(r.DATE_CO_ISSUED));
  const cancelled = str(r.CANCEL);
  const sched = str(r.SCHEDNUM);
  return {
    lon: ll[0],
    lat: ll[1],
    number,
    kind: "Residential construction permit",
    work: str(r.CLASS),
    valuation: finite(r.VALUATION),
    valuationLabel: "valuation",
    fee: finite(r.PERMIT_FEE),
    status: cancelled ? `cancelled (${cancelled})` : isoDate(r.FINAL_DATE) ? "finaled" : undefined,
    applied: isoDate(r.DATE_RECEIVED),
    issued: isoDate(r.DATE_ISSUED),
    finaled: isoDate(r.FINAL_DATE),
    address: str(r.ADDRESS),
    parcel: sched ? { scheme: "schednum", id: sched } : undefined,
    contractorCompany: str(r.CONTRACTOR_NAME),
    published,
  };
}

/** Rows (or ArcGIS features) from one city as permit records; rows without a number or a point are dropped. */
export function buildPermits(city: PermitCityId, features: Array<{ geometry: GeoJSON.Geometry | null; properties: Row | null }>): PermitRecord[] {
  const out: PermitRecord[] = [];
  const seen = new Map<string, number>();
  for (const f of features) {
    const r = f.properties ?? {};
    let rec: Omit<PermitRecord, "id" | "city"> | null = null;
    switch (city) {
      case "chicago":
        rec = chicago(r);
        break;
      case "austin":
        rec = austin(r);
        break;
      case "seattle":
        rec = seattle(r);
        break;
      case "nyc":
        rec = nyc(r);
        break;
      case "losangeles":
        rec = losAngeles(r);
        break;
      case "sanfrancisco":
        rec = sanFrancisco(r);
        break;
      case "denver":
        rec = denver(r, f.geometry);
        break;
    }
    if (!rec) continue;
    const base = `${city}:${rec.number}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ id: n ? `${base}#${n + 1}` : base, city, ...rec });
  }
  return out;
}

// ------------------------------------------------------------------ coverage

export interface PermitCity {
  id: PermitCityId;
  name: string;
  source: SourceId;
  publisher: string;
  bbox: Bbox;
  /** How often the city refreshes the feed, as its portal states. */
  cadence: string;
}

export const PERMIT_CITIES: Record<PermitCityId, PermitCity> = {
  chicago: { id: "chicago", name: "Chicago", source: "chicago-permits", publisher: "City of Chicago", bbox: [-87.95, 41.64, -87.52, 42.03], cadence: "daily" },
  austin: { id: "austin", name: "Austin", source: "austin-permits", publisher: "City of Austin", bbox: [-97.94, 30.08, -97.56, 30.52], cadence: "daily" },
  seattle: { id: "seattle", name: "Seattle", source: "seattle-permits", publisher: "City of Seattle", bbox: [-122.46, 47.48, -122.22, 47.74], cadence: "daily" },
  denver: { id: "denver", name: "Denver", source: "denver-permits", publisher: "City and County of Denver", bbox: [-105.11, 39.61, -104.6, 39.92], cadence: "daily (residential only)" },
  nyc: { id: "nyc", name: "New York City", source: "nyc-dob-permits", publisher: "NYC Department of Buildings", bbox: [-74.26, 40.49, -73.7, 40.92], cadence: "daily" },
  losangeles: { id: "losangeles", name: "Los Angeles", source: "la-permits", publisher: "City of Los Angeles", bbox: [-118.67, 33.7, -118.15, 34.34], cadence: "weekly" },
  sanfrancisco: { id: "sanfrancisco", name: "San Francisco", source: "sf-permits", publisher: "City and County of San Francisco", bbox: [-122.52, 37.7, -122.35, 37.84], cadence: "several times an hour" },
};

export const PERMIT_CITY_IDS = Object.keys(PERMIT_CITIES) as PermitCityId[];

/** Cities with a permit story but no usable feed here: stated, never shown as an empty map. */
export const PERMIT_GAPS: Array<{ name: string; bbox: Bbox; state: CoverageState; reason: string }> = [
  { name: "Dallas", bbox: [-97.0, 32.61, -96.46, 33.03], state: "stale", reason: "the city's permit feeds stopped: Socrata in August 2020, the ArcGIS layer at fiscal year 2024" },
  { name: "Houston", bbox: [-95.79, 29.52, -95.01, 30.12], state: "no-feed", reason: "Houston publishes monthly permit counts only, no permit records" },
  { name: "San Antonio", bbox: [-98.81, 29.21, -98.22, 29.74], state: "not-wired", reason: "the city's permit table mixes lon/lat and State Plane coordinates in text columns and its newest rows carry none" },
  { name: "Denver (commercial)", bbox: [-105.11, 39.61, -104.6, 39.92], state: "token-required", reason: "Denver's commercial construction permit layer answered 'Token Required' on 2026-09-26; residential permits are shown" },
];

function meets(a: Bbox, b: Bbox): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

export function permitCitiesInBox(b: Bbox): PermitCity[] {
  return Object.values(PERMIT_CITIES).filter((c) => meets(c.bbox, b));
}

export function permitGapsInBox(b: Bbox): typeof PERMIT_GAPS {
  return PERMIT_GAPS.filter((g) => meets(g.bbox, b));
}

/** "partial" when the newest PERMIT_LIMIT came back (there may be more), else "covered". */
export function answeredState(count: number, capped: boolean): CoverageState {
  return capped || count >= PERMIT_LIMIT ? "partial" : "covered";
}
