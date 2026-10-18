// HIFLD hospitals, as FEMA's Resilience Analysis and Planning Tool (RAPT)
// last copied them: HIFLD Open's own hospital service is gone ("Item does not
// exist", round 4), and this FeatureServer (owner FEMA_HQ_Preparedness_NIC,
// CORS *) is the last public copy. Pure: the field list, the national and box
// queries, the features and the click lines. The route is
// /api/infra?op=hospitals.
//
//   national  above 300 km: every hospital of the asked status in one pull
//             (8,140 open on 2026-10-16, five pages of 2,000), held a day, sent
//             as packed rows (id, name, city, state, type, status, beds, trauma,
//             county FIPS, lon, lat; about 1 MB) that the browser turns into
//             features with the short record: 8,140 built features would be
//             near the platform's 4.5 MB response limit
//   box       below: a box of at most 6 degrees with the full record, held a day
//
// Every query names its fields: TELEPHONE, TTL_STAFF, ALT_NAME and every other
// contact field are never requested. The address is the institution's, as its
// licensing source publishes it. BEDS = -999 (481 rows) and "NOT AVAILABLE"
// are "not published", never 0 and never a type.

import type { LayerFeature } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";
import { cmsDetails, cmsExtra, type CmsEntry, type CmsExtra } from "./cms";

export const HOSPITALS_URL = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Hospitals_RAPT/FeatureServer/6";
/** The layer's maxRecordCount (read 2026-10-16). */
export const HOSPITALS_PAGE = 2000;
/** National pages asked at most: 8,514 rows in all on 2026-10-16. */
export const HOSPITALS_MAX_PAGES = 6;
/**
 * The largest box answered with the full record, degrees a side (clamped around its centre). The
 * layer's 150 km box is about 2.7 degrees tall and, at Anchorage's latitude, 5.6 wide.
 */
export const HOSPITALS_BOX_MAX_DEG = 6;
/** A box wider or taller than this is answered with the national set (the layer asks the world box). */
export const HOSPITALS_NATIONAL_MIN_DEG = 20;

/** The full record (box tier). Never TELEPHONE, TTL_STAFF, ALT_NAME, POPULATION or VAL_METHOD. */
export const HOSPITAL_FIELDS = ["ID", "NAME", "ADDRESS", "CITY", "STATE", "ZIP", "TYPE", "STATUS", "COUNTYFIPS", "BEDS", "TRAUMA", "HELIPAD", "OWNER", "NAICS_DESC", "SOURCE", "SOURCEDATE", "VAL_DATE", "WEBSITE"] as const;
/** The short record (national tier): what the dot's colour, size and label need. */
export const HOSPITAL_NATIONAL_FIELDS = ["ID", "NAME", "CITY", "STATE", "TYPE", "STATUS", "BEDS", "TRAUMA", "COUNTYFIPS"] as const;

/** The packed national row: HOSPITAL_NATIONAL_FIELDS, then lon and lat. */
export const NATIONAL_COLUMNS = [...HOSPITAL_NATIONAL_FIELDS, "lon", "lat"] as const;
export type PackedRow = Array<string | number | null>;

/** f=geojson rows -> packed rows, values as FEMA sent them (points only). */
export function packNational(rows: ReadonlyArray<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>): PackedRow[] {
  const out: PackedRow[] = [];
  for (const r of rows) {
    if (!r.geometry || r.geometry.type !== "Point") continue;
    const p = r.properties ?? {};
    const [lon, lat] = r.geometry.coordinates;
    out.push([...HOSPITAL_NATIONAL_FIELDS.map((f) => (typeof p[f] === "string" || typeof p[f] === "number" ? (p[f] as string | number) : null)), lon, lat]);
  }
  return out;
}

/** Packed rows back to f=geojson-shaped rows, for buildHospitals(rows, true). */
export function unpackNational(rows: readonly PackedRow[]): Array<{ geometry: GeoJSON.Point; properties: Record<string, unknown> }> {
  const n = HOSPITAL_NATIONAL_FIELDS.length;
  return rows.map((r) => ({
    geometry: { type: "Point", coordinates: [Number(r[n]), Number(r[n + 1])] },
    properties: Object.fromEntries(HOSPITAL_NATIONAL_FIELDS.map((f, i) => [f, r[i]])),
  }));
}

export type HospitalStatus = "open" | "all";
export function hospitalWhere(status: HospitalStatus): string {
  return status === "open" ? "STATUS='OPEN'" : "1=1";
}

export const HOSPITALS_CAVEAT =
  "HIFLD's hospital layer as FEMA last copied it (data edited April 2026). Each hospital's details are as its state licensing source published them on the date shown, which can be years old. HIFLD's public site has closed; this is the last public copy. Not a list of emergency departments.";
export const HOSPITALS_ATTRIBUTION = "Homeland Infrastructure Foundation-Level Data (DHS Geospatial Management Office, Oak Ridge National Laboratory), via FEMA RAPT";
/** FeatureServer layer 6 editingInfo.dataLastEditDate (1776883606952), read 2026-10-16. */
export const HOSPITALS_DATA_EDIT = "2026-04-22";

/** The colour classes the globe draws, from HIFLD's TYPE words. */
export const HOSPITAL_TYPE_CLASS: Record<string, string> = {
  "GENERAL ACUTE CARE": "general",
  "CRITICAL ACCESS": "critical-access",
  CHILDREN: "children",
  PSYCHIATRIC: "psychiatric",
  "LONG TERM CARE": "long-term",
  REHABILITATION: "rehabilitation",
  MILITARY: "military",
  WOMEN: "women",
  SPECIAL: "special",
  "CHRONIC DISEASE": "chronic",
};

type Row = { geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.trim().toUpperCase() !== "NOT AVAILABLE" ? v.trim() : null);
/** BEDS as published; -999 (and any negative) is "not published". */
export function bedsOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}
const day = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? new Date(v).toISOString().slice(0, 10) : null);
const yesNo = (v: unknown): string | null => (v === "Y" ? "yes" : v === "N" ? "no" : null);
const isLink = (v: string | null): v is string => !!v && /^https?:\/\//i.test(v);

export interface HospitalExtra {
  type: string | null;
  /** The globe's colour class; "unknown" when HIFLD publishes NOT AVAILABLE. */
  typeClass: string;
  status: string | null;
  beds: number | null;
  trauma: string | null;
  /** The national tier's short record: the full one loads below 300 km. */
  short: boolean;
  /** CMS's row joined by street address and ZIP (round 8; box tier only): null when there is no unambiguous match. */
  cms?: CmsExtra | null;
}

/** The CMS join the box tier reads (lib/infra/data/cms-hospitals.json): a row per HIFLD ID, and the CMS dataset's modified date. */
export interface CmsLookup {
  rows: Readonly<Record<string, CmsEntry>>;
  modified: string | null;
}

/**
 * HIFLD rows (f=geojson) as point features. `short` rows carry only the national fields. With `cms`
 * (the box tier), each full record gets CMS's star rating lines and extra.cms; the record text that is
 * embedded (TYPE, TRAUMA, HELIPAD, STATE) never changes with it.
 */
export function buildHospitals(rows: readonly Row[], short = false, cms?: CmsLookup): LayerFeature[] {
  const out: LayerFeature[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const g = r.geometry;
    if (!g || g.type !== "Point") continue;
    const [lon, lat] = g.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = r.properties ?? {};
    const id = str(p.ID);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const type = str(p.TYPE);
    const beds = bedsOf(p.BEDS);
    const trauma = str(p.TRAUMA);
    const status = str(p.STATUS);
    const typeClass = type ? (HOSPITAL_TYPE_CLASS[type] ?? "other") : "unknown";
    const city = str(p.CITY);
    const state = str(p.STATE);
    const details: Record<string, string | null> = {
      "HIFLD id": id,
      type: type ? type.toLowerCase() : "type not published",
      status: status ? status.toLowerCase() : "not published",
      beds: beds == null ? "not published" : beds.toLocaleString("en-US"),
      trauma: trauma ?? "not published",
      county: str(p.COUNTYFIPS) ? `FIPS ${str(p.COUNTYFIPS)}` : null,
      place: [city, state].filter(Boolean).join(", ") || null,
    };
    if (short) details["full record"] = "descend below 300 km for the address, owner type, helipad, source, dates and CMS star rating";
    else {
      const source = str(p.SOURCE);
      const sourceDate = day(p.SOURCEDATE);
      Object.assign(details, {
        address: [str(p.ADDRESS), city, [state, str(p.ZIP)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
        helipad: yesNo(p.HELIPAD) ?? "not published",
        "owner type": str(p.OWNER) ?? "not published",
        "NAICS industry": str(p.NAICS_DESC),
        source: source ? `${source}${sourceDate ? `, as of ${sourceDate}` : ""}` : sourceDate ? `as of ${sourceDate}` : "not published",
        "location checked against imagery": day(p.VAL_DATE) ?? "not published",
        website: isLink(str(p.WEBSITE)) ? str(p.WEBSITE) : null,
      });
    }
    const cmsRow = !short && cms ? cms.rows[id] : undefined;
    const cx = !short && cms ? (cmsRow ? cmsExtra(cmsRow) : null) : undefined;
    if (cx !== undefined && cms) Object.assign(details, cmsDetails(cx, status, cms.modified));
    const extra: HospitalExtra = { type, typeClass, status, beds, trauma, short, ...(cx !== undefined ? { cms: cx } : {}) };
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat, 0] },
      properties: {
        id: `hifld-hosp:${id}`,
        layer: "hospitals",
        // A licensed hospital's published name is an institution's (round-5 decision, flagged for review).
        name: str(p.NAME) ?? `Hospital ${id}`,
        kind: typeClass,
        source: "HIFLD hospitals (FEMA RAPT)",
        details: Object.fromEntries(Object.entries(details).filter(([, v]) => v != null)) as Record<string, string>,
        extra: short
          ? extra
          : withEmbedText(extra, recordText("hifld-hospitals", { TYPE: type, TRAUMA: trauma, HELIPAD: yesNo(p.HELIPAD), CITY: city, STATE: state }, str(p.NAME))),
      },
    });
  }
  return out;
}
