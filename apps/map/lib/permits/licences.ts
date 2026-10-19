// Business licences: the licensed premises five public registries publish,
// as points. Plain functions, shared by /api/permits?op=licences and the
// licences layer, tested on captured payloads.
//
// These registries list sole proprietors next to companies, often at a home
// address, so three rules hold here, before anything leaves the server:
//
//   1. The name shown is the trade name (DBA) the registry publishes, except
//      a trade name that is the registrant's own name when the registrant is
//      not a company (a sole proprietor trading under their own name): then
//      no name is shown and the dossier says why. The legal or registrant
//      name (Chicago legal_name, San Francisco ownership_name, Los Angeles
//      business_name, New York business_name and the SLA's legalname) is
//      requested for that comparison and to test for an entity form (LLC,
//      Inc, Corp, Ltd...): it is shown only when there is no DBA and it ends
//      in an entity form, and is discarded here otherwise. A trade name is
//      otherwise shown as published, and can still contain a person's name
//      (a first name in a shop's name, "Law Offices of ..."). Owner and
//      officer datasets (Chicago's Business Owners) are never read.
//   2. A record whose address carries an apartment or unit number (APT,
//      UNIT, a bare #) is withheld altogether: a heuristic for a business run
//      from a home, counted and labelled as a heuristic. A # after SUITE,
//      STE, FL, RM, STORE, SPACE, BLDG and the like is a commercial unit and stays.
//   3. Mailing addresses and phone numbers are never requested: every
//      registry is asked for named columns ($select).
//
// Nothing here is searchable by name through anything but the feature name
// (the trade name): no licensee, registrant or address field is on the search
// allowlist (lib/search/allowlist.ts).

import type { SourceId } from "@/lib/provenance/sources";
import { isoDate, str, type Bbox } from "@/lib/zoning/features";
import { finite, type CoverageState } from "./features";

export type LicenceSourceId = "nysla" | "chicago" | "sanfrancisco" | "losangeles" | "nycdcwp";

export interface LicenceRecord {
  id: string;
  source: LicenceSourceId;
  lon: number;
  lat: number;
  /** The trade name, or an entity's legal name when there is no trade name; absent otherwise. */
  name?: string;
  /** Why no name is shown. */
  nameNote?: string;
  /** Licence type or business category, as published. */
  category?: string;
  activity?: string;
  /** Licence, certificate or account number, as published. */
  number: string;
  status?: string;
  issued?: string;
  started?: string;
  expires?: string;
  address?: string;
  published: Record<string, string>;
}

type Row = Record<string, unknown>;

/** An entity form at the end of a registrant name: the name is a company's, not a person's. */
const ENTITY = /(?:^|[\s,.&])(?:L\.?L\.?C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|LIMITED|L\.?P|L\.?L\.?P|PLLC|P\.?C|PLC|TRUST)\.?\s*$/i;

export function isEntityName(name: string | undefined): boolean {
  return !!name && ENTITY.test(name.trim());
}

/**
 * The heuristic for a business run from a home: an apartment or unit number
 * in the address (APT, APARTMENT, UNIT, or a bare #), or a unit type the
 * registry gives as APT, UNIT or #. A # after SUITE, STE, FL, FLOOR, RM,
 * ROOM, STORE, SPACE, BLDG and the like is a commercial unit.
 */
export function homeBased(address: string | undefined, unitType?: string): boolean {
  const u = (unitType ?? "").trim().toUpperCase();
  if (u === "APT" || u === "APARTMENT" || u === "UNIT" || u === "#") return true;
  const a = (address ?? "").toUpperCase();
  if (!a) return false;
  if (/\b(?:APT|APARTMENT|UNIT)(?=[\s#\d.]|$)/.test(a)) return true;
  // Every # that is not the number of a suite, floor, room, store or other commercial unit.
  for (const m of a.matchAll(/#/g)) {
    const before = a.slice(0, m.index).trimEnd();
    if (!/\b(?:SUITE|STE|FL|FLOOR|RM|ROOM|STORE|SHOP|SPACE|BLDG|BUILDING|BOOTH|STALL|KIOSK|PIER|DOCK|GATE|LEVEL|DEPT|OFFICE)$/.test(before)) return true;
  }
  return false;
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

function pointOf(v: unknown): [number, number] | null {
  const c = (v as { coordinates?: [unknown, unknown] } | null | undefined)?.coordinates;
  if (c) return lonLat(c[0], c[1]);
  const o = v as { latitude?: unknown; longitude?: unknown } | null | undefined;
  return o ? lonLat(o.longitude, o.latitude) : null;
}

function joinAddress(...parts: unknown[]): string | undefined {
  const s = parts.map(str).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return s || undefined;
}

/** Case, spacing and punctuation dropped: "Jane Q. Public" and "JANE Q PUBLIC" are one name. */
function nameKey(s: string): string {
  return s.normalize("NFKD").toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export const SAME_AS_REGISTRANT = "the trade name is the registrant's own name, and the registrant may be a person, so no name is shown";

/**
 * The trade name, unless it is the registrant's own name and the registrant
 * is not a company; else an entity's legal name. The note says why a name is
 * missing. The legal name itself is never returned unless it is an entity's.
 */
export function displayName(dba: unknown, legal: unknown): { name?: string; nameNote?: string } {
  const d = str(dba);
  const l = str(legal);
  if (d) {
    if (l && !isEntityName(l) && nameKey(d) !== "" && nameKey(d) === nameKey(l)) return { nameNote: SAME_AS_REGISTRANT };
    return { name: d };
  }
  if (isEntityName(l)) return { name: l };
  return { nameNote: l ? "no trade name published, and the registrant may be a person, so no name is shown" : "no name published" };
}

// ------------------------------------------------------------------ requests

export const LICENCE_LIMIT = 1000;

function withinBox(col: string, b: Bbox): string {
  const [w, s, e, n] = b;
  return `within_box(${col},${n},${w},${s},${e})`;
}

export const NYSLA = "https://data.ny.gov/resource/9s3h-dpkz";
export const NYSLA_SELECT = [
  "licensepermitid", "premisescounty", "type", "class", "description", "legalname", "dba", "actualaddressofpremises", "additionaladdressinformation",
  "city", "zipcode", "originalissuedate", "lastissuedate", "effectivedate", "expirationdate", "georeference",
] as const;
export const CHICAGO_LICENCES = "https://data.cityofchicago.org/resource/r5kz-chrr";
/** legal_name is requested only for displayName's comparison and entity test, and discarded there. */
export const CHICAGO_LICENCE_SELECT = [
  "license_id", "license_number", "doing_business_as_name", "legal_name", "address", "zip_code", "ward", "community_area_name", "license_description",
  "business_activity", "application_type", "license_start_date", "expiration_date", "date_issued", "license_status", "latitude", "longitude",
] as const;
/**
 * data.sf.gov, not data.sfgov.org: the old host 301-redirects every request
 * there, and its redirector answers any $select with a 403 (probed
 * 2026-09-26). The mailing address is never requested; ownership_name only
 * for displayName's comparison and entity test, and discarded there.
 */
export const SF_LICENCES = "https://data.sf.gov/resource/g8m3-pdis";
export const SF_LICENCE_SELECT = [
  "certificate_number", "uniqueid", "dba_name", "ownership_name", "full_business_address", "business_zip", "location_start_date", "dba_start_date", "self_reported_naics_code",
  "lic_code_description", "neighborhoods_analysis_boundaries", "supervisor_district", "business_corridor", "location",
] as const;
export const LA_LICENCES = "https://data.lacity.org/resource/6rrh-rzua";
export const LA_LICENCE_SELECT = [
  "location_account", "business_name", "dba_name", "street_address", "zip_code", "location_description", "naics", "primary_naics_description",
  "council_district", "location_start_date", "location_1",
] as const;
export const NYC_LICENCES = "https://data.cityofnewyork.us/resource/w7w3-xahh";
/** contact_phone is not requested. */
export const NYC_LICENCE_SELECT = [
  "license_nbr", "business_name", "dba_trade_name", "business_category", "license_type", "license_status", "license_creation_date", "lic_expir_dd",
  "address_building", "address_street_name", "unit_type", "apt_suite", "address_zip", "address_borough", "bbl", "latitude", "longitude",
] as const;

export function licenceRequestUrl(src: LicenceSourceId, b: Bbox, todayIso: string): string {
  const q = new URLSearchParams();
  const [w, s, e, n] = b;
  switch (src) {
    case "nysla":
      q.set("$select", NYSLA_SELECT.join(","));
      q.set("$where", withinBox("georeference", b));
      break;
    case "chicago":
      q.set("$select", CHICAGO_LICENCE_SELECT.join(","));
      q.set("$where", `${withinBox("location", b)} AND expiration_date > '${todayIso.slice(0, 10)}T00:00:00'`);
      break;
    case "sanfrancisco":
      q.set("$select", SF_LICENCE_SELECT.join(","));
      q.set("$where", `${withinBox("location", b)} AND location_end_date IS NULL`);
      break;
    case "losangeles":
      q.set("$select", LA_LICENCE_SELECT.join(","));
      q.set("$where", withinBox("location_1", b));
      break;
    case "nycdcwp":
      q.set("$select", NYC_LICENCE_SELECT.join(","));
      q.set("$where", `license_type='Premises' AND license_status='Active' AND latitude between ${s} and ${n} AND longitude between ${w} and ${e}`);
      break;
  }
  q.set("$limit", String(LICENCE_LIMIT));
  const base = { nysla: NYSLA, chicago: CHICAGO_LICENCES, sanfrancisco: SF_LICENCES, losangeles: LA_LICENCES, nycdcwp: NYC_LICENCES }[src];
  return `${base}.json?${q.toString()}`;
}

// ------------------------------------------------------------------ normalisers

type Partial_ = Omit<LicenceRecord, "id" | "source">;

function nysla(r: Row): Partial_ | null {
  const ll = pointOf(r.georeference);
  const number = str(r.licensepermitid);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "licence class", r.class);
  put(published, "licence type", r.type);
  put(published, "last issued", isoDate(r.lastissuedate));
  put(published, "effective", isoDate(r.effectivedate));
  put(published, "county", r.premisescounty);
  return {
    lon: ll[0],
    lat: ll[1],
    ...displayName(r.dba, r.legalname),
    category: str(r.description),
    number,
    issued: isoDate(r.originalissuedate),
    expires: isoDate(r.expirationdate),
    address: joinAddress(r.actualaddressofpremises, r.additionaladdressinformation, r.city, r.zipcode),
    published,
  };
}

function chicago(r: Row): Partial_ | null {
  const ll = lonLat(r.longitude, r.latitude);
  const number = str(r.license_number) ?? str(r.license_id);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "application type", r.application_type);
  put(published, "ward", r.ward);
  put(published, "community area", r.community_area_name);
  return {
    lon: ll[0],
    lat: ll[1],
    ...displayName(r.doing_business_as_name, r.legal_name),
    category: str(r.license_description),
    activity: str(r.business_activity),
    number,
    status: str(r.license_status),
    issued: isoDate(r.date_issued),
    started: isoDate(r.license_start_date),
    expires: isoDate(r.expiration_date),
    address: joinAddress(r.address, r.zip_code),
    published,
  };
}

function sanFrancisco(r: Row): Partial_ | null {
  const ll = pointOf(r.location);
  const number = str(r.certificate_number) ?? str(r.uniqueid);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "NAICS (self-reported)", r.self_reported_naics_code);
  put(published, "neighbourhood", r.neighborhoods_analysis_boundaries);
  put(published, "supervisor district", r.supervisor_district);
  put(published, "business corridor", r.business_corridor);
  return {
    lon: ll[0],
    lat: ll[1],
    ...displayName(r.dba_name, r.ownership_name),
    category: str(r.lic_code_description) ?? (str(r.self_reported_naics_code) ? `NAICS ${str(r.self_reported_naics_code)}` : undefined),
    number,
    started: isoDate(r.location_start_date) ?? isoDate(r.dba_start_date),
    address: joinAddress(r.full_business_address, r.business_zip),
    published,
  };
}

function losAngeles(r: Row): Partial_ | null {
  const ll = pointOf(r.location_1);
  const number = str(r.location_account);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "NAICS", r.naics);
  put(published, "council district", r.council_district);
  return {
    lon: ll[0],
    lat: ll[1],
    ...displayName(r.dba_name, r.business_name),
    category: str(r.primary_naics_description),
    number,
    started: isoDate(r.location_start_date),
    address: joinAddress(r.street_address, r.zip_code),
    published,
  };
}

function nycDcwp(r: Row): Partial_ | null {
  const ll = lonLat(r.longitude, r.latitude);
  const number = str(r.license_nbr);
  if (!ll || !number) return null;
  const published: Record<string, string> = {};
  put(published, "licence type", r.license_type);
  put(published, "borough", r.address_borough);
  put(published, "BBL", r.bbl);
  const unit = str(r.unit_type) ? `${str(r.unit_type)} ${str(r.apt_suite) ?? ""}` : str(r.apt_suite);
  return {
    lon: ll[0],
    lat: ll[1],
    ...displayName(r.dba_trade_name, r.business_name),
    category: str(r.business_category),
    number,
    status: str(r.license_status),
    issued: isoDate(r.license_creation_date),
    expires: isoDate(r.lic_expir_dd),
    address: joinAddress(r.address_building, r.address_street_name, unit, r.address_zip),
    published,
  };
}

export interface LicenceBuild {
  records: LicenceRecord[];
  /** Withheld by the home-based heuristic. */
  withheld: number;
}

export function buildLicences(src: LicenceSourceId, rows: Row[]): LicenceBuild {
  const records: LicenceRecord[] = [];
  const seen = new Map<string, number>();
  let withheld = 0;
  for (const r of rows) {
    const rec =
      src === "nysla" ? nysla(r) : src === "chicago" ? chicago(r) : src === "sanfrancisco" ? sanFrancisco(r) : src === "losangeles" ? losAngeles(r) : nycDcwp(r);
    if (!rec) continue;
    const unitType = src === "nycdcwp" ? str(r.unit_type) : undefined;
    if (homeBased(rec.address, unitType)) {
      withheld++;
      continue;
    }
    const base = `${src}:${rec.number}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    records.push({ id: n ? `${base}#${n + 1}` : base, source: src, ...rec });
  }
  return { records, withheld };
}

// ------------------------------------------------------------------ coverage

export interface LicenceSource {
  id: LicenceSourceId;
  name: string;
  source: SourceId;
  publisher: string;
  /** Where the registry has records. */
  bbox: Bbox;
  cadence: string;
}

export const LICENCE_SOURCES: Record<LicenceSourceId, LicenceSource> = {
  nysla: { id: "nysla", name: "New York State liquor licences", source: "ny-sla-licences", publisher: "New York State Liquor Authority", bbox: [-79.8, 40.49, -71.8, 45.02], cadence: "daily" },
  chicago: { id: "chicago", name: "Chicago business licences", source: "chicago-licences", publisher: "City of Chicago", bbox: [-87.95, 41.64, -87.52, 42.03], cadence: "daily" },
  sanfrancisco: { id: "sanfrancisco", name: "San Francisco registered business locations", source: "sf-business-locations", publisher: "City and County of San Francisco, Treasurer and Tax Collector", bbox: [-122.52, 37.7, -122.35, 37.84], cadence: "daily" },
  losangeles: { id: "losangeles", name: "Los Angeles active businesses", source: "la-active-businesses", publisher: "City of Los Angeles Office of Finance", bbox: [-118.67, 33.7, -118.15, 34.34], cadence: "monthly" },
  nycdcwp: { id: "nycdcwp", name: "New York City premises licences", source: "nyc-dcwp-licences", publisher: "NYC Department of Consumer and Worker Protection", bbox: [-74.26, 40.49, -73.7, 40.92], cadence: "weekly (rows last updated 2026-08-20)" },
};

export const LICENCE_SOURCE_IDS = Object.keys(LICENCE_SOURCES) as LicenceSourceId[];

export function licenceSourcesInBox(b: Bbox): LicenceSource[] {
  return Object.values(LICENCE_SOURCES).filter((s) => b[0] < s.bbox[2] && b[2] > s.bbox[0] && b[1] < s.bbox[3] && b[3] > s.bbox[1]);
}

export function licenceState(count: number): CoverageState {
  return count >= LICENCE_LIMIT ? "partial" : "covered";
}
