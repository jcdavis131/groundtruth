// Public schools: NCES EDGE administrative data for school year 2024-25
// (the Common Core of Data directory and membership), from NCES's own
// MapServer (CORS echoes the origin). Pure: the field list, the features and
// the click lines. The route is /api/civic?op=schools: a box of at most
// 0.2 degrees (the civic box, about 11 km) below 25 km, US only.
//
// No race, sex or grade-level enrollment cell is read: at a small school a
// cell can identify a child. Enrollment (TOTAL), free and reduced-price lunch
// (TOTFRL), FTE teachers and the student-teacher ratio are shown as NCES
// publishes them; any negative is one of CCD's reporting codes (-1 not
// reported, -2 not applicable, and others), shown as such and never as 0.
// A full virtual school's point is its administrative address. Schools NCES
// marks Inactive or Future are not drawn (counted in the note).

import type { LayerFeature } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";

export const NCES_SCHOOLS = "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/EDGE_ADMINDATA_PUBLICSCH_2425/MapServer/1";
/** The layer's maxRecordCount (read 2026-10-16). */
export const NCES_PAGE = 2000;
export const NCES_MAX_PAGES = 2;

/** Every field asked. Never PHONE, LSTREET2, the grade counts (PK..AE), the sex totals or any race/ethnicity cell. */
export const SCHOOL_FIELDS = [
  "NCESSCH",
  "SCH_NAME",
  "LEA_NAME",
  "LSTREET1",
  "LCITY",
  "LSTATE",
  "LZIP",
  "GSLO",
  "GSHI",
  "SCHOOL_LEVEL",
  "SCHOOL_TYPE_TEXT",
  "CHARTER_TEXT",
  "VIRTUAL",
  "SY_STATUS_TEXT",
  "ULOCALE",
  "TOTAL",
  "TOTFRL",
  "STUTERATIO",
  "FTE",
  "CNTY",
  "NMCNTY",
] as const;

/** NCES statuses not drawn: the school is not operating this year. */
export const NOT_OPERATING = new Set(["Inactive", "Future"]);

export const SCHOOLS_CAVEAT =
  "NCES Common Core of Data for school year 2024-25, as states reported it. Enrollment is the October count. A virtual school's point is its office. Public schools only; private schools are not on this layer.";
export const SCHOOLS_ATTRIBUTION = "U.S. Department of Education, National Center for Education Statistics, Education Demographic and Geographic Estimates (EDGE) / Common Core of Data, school year 2024-25";

/** The globe's colour class from NCES's SCHOOL_LEVEL; the published word stays in the click. */
export function levelClass(level: string | null): "elementary" | "middle" | "high" | "other" {
  switch (level) {
    case "Elementary":
    case "Prekindergarten":
      return "elementary";
    case "Middle":
      return "middle";
    case "High":
    case "Secondary":
      return "high";
    default:
      return "other";
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** A CCD number: the value when it is 0 or more, else the reporting code it stands for. */
export function ccd(v: unknown): { value: number | null; code: string | null } {
  if (typeof v !== "number" || !Number.isFinite(v)) return { value: null, code: "not published" };
  if (v >= 0) return { value: v, code: null };
  if (v === -1) return { value: null, code: "not reported" };
  if (v === -2) return { value: null, code: "not applicable" };
  return { value: null, code: `not published (NCES code ${v})` };
}

const shown = (v: unknown, fmt: (n: number) => string = (n) => n.toLocaleString("en-US")) => {
  const c = ccd(v);
  return c.value != null ? fmt(c.value) : c.code!;
};

/** CCD's one-letter codes in the text fields: M missing, N not applicable. */
const word = (v: string | null): string | null => (v === "M" ? "not reported" : v === "N" ? "not applicable" : v);

/** The free and reduced-price lunch share: two published counts, never a negative and never over a zero enrollment. */
export function frlShare(total: unknown, frl: unknown): string {
  const t = ccd(total);
  const f = ccd(frl);
  if (t.value == null) return `enrollment ${t.code}`;
  if (f.value == null) return f.code!;
  if (t.value === 0) return "no enrollment reported";
  return `${((f.value / t.value) * 100).toFixed(1)} % (${f.value.toLocaleString("en-US")} of ${t.value.toLocaleString("en-US")})`;
}

export interface SchoolExtra {
  level: string | null;
  levelClass: ReturnType<typeof levelClass>;
  charter: boolean;
  /** NCES says Full Virtual: the point is an office. */
  virtual: boolean;
  status: string | null;
}

type Row = { geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null };

/** NCES rows (f=geojson) as point features, operating schools only; `hidden` counts the Inactive and Future ones. */
export function buildSchools(rows: readonly Row[]): { features: LayerFeature[]; hidden: number } {
  const features: LayerFeature[] = [];
  const seen = new Set<string>();
  let hidden = 0;
  for (const r of rows) {
    const g = r.geometry;
    if (!g || g.type !== "Point") continue;
    const [lon, lat] = g.coordinates;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const p = r.properties ?? {};
    const id = str(p.NCESSCH);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const status = str(p.SY_STATUS_TEXT);
    if (status && NOT_OPERATING.has(status)) {
      hidden++;
      continue;
    }
    const level = str(p.SCHOOL_LEVEL);
    const charter = str(p.CHARTER_TEXT) === "Yes";
    const virtualWord = word(str(p.VIRTUAL));
    const virtual = virtualWord === "Full Virtual";
    const lo = str(p.GSLO);
    const hi = str(p.GSHI);
    const state = str(p.LSTATE);
    const details: Record<string, string | null> = {
      "NCES school id": id,
      district: str(p.LEA_NAME),
      grades: lo && hi ? (lo === hi ? lo : `${lo} to ${hi}`) : "not published",
      level: level ?? "not published",
      type: str(p.SCHOOL_TYPE_TEXT),
      charter: word(str(p.CHARTER_TEXT)),
      virtual: virtualWord,
      status,
      locale: str(p.ULOCALE),
      enrollment: shown(p.TOTAL),
      "free or reduced-price lunch": frlShare(p.TOTAL, p.TOTFRL),
      "students per FTE teacher": shown(p.STUTERATIO, (n) => n.toFixed(1)),
      "FTE teachers": shown(p.FTE, (n) => n.toFixed(1)),
      address: [str(p.LSTREET1), str(p.LCITY), [state, str(p.LZIP)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
      county: str(p.NMCNTY) ? `${str(p.NMCNTY)} (${str(p.CNTY) ?? "no FIPS"})` : str(p.CNTY),
      "NCES page": `https://nces.ed.gov/ccd/schoolsearch/school_detail.asp?ID=${id}`,
      "what the point is": virtual ? "a full virtual school's administrative address, not where students are" : null,
    };
    const extra: SchoolExtra = { level, levelClass: levelClass(level), charter, virtual, status };
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat, 0] },
      properties: {
        id: `nces:${id}`,
        layer: "schools",
        // A public school's name is an institution's (round-5 decision, flagged for review).
        name: str(p.SCH_NAME) ?? `School ${id}`,
        kind: extra.levelClass,
        source: "NCES EDGE public schools 2024-25",
        details: Object.fromEntries(Object.entries(details).filter(([, v]) => v != null)) as Record<string, string>,
        extra: withEmbedText(
          extra,
          recordText("nces-public-schools", {
            SCHOOL_LEVEL: level,
            SCHOOL_TYPE_TEXT: str(p.SCHOOL_TYPE_TEXT),
            CHARTER_TEXT: word(str(p.CHARTER_TEXT)),
            VIRTUAL: virtualWord,
            SY_STATUS_TEXT: status,
            ULOCALE: str(p.ULOCALE),
            GSLO: lo,
            GSHI: hi,
            LCITY: str(p.LCITY),
            NMCNTY: str(p.NMCNTY),
            LSTATE: state,
          }, str(p.SCH_NAME)),
        ),
      },
    });
  }
  return { features, hidden };
}
