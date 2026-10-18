// Superfund site boundaries and National Priorities List status for the
// Contaminated sites layer. Pure: the two requests, the label and date
// cleaners, and the row -> feature builders. The fetch lives in
// lib/permits/sources.ts and the route in app/api/permits (op=contaminants).
//
//   boundaries   EPA's FAC_Superfund_Site_Boundaries_EPA_Public (owner EPA_GEO):
//                site polygons as EPA regions map them, asked only with
//                polygons=1 (below 10 km), simplified on the server
//   status       EPA's NPL list with status and dates, joined to the boundaries
//                and to EMEF's Superfund (SEMS) points by EPA ID, never by box:
//                a site's listed point can sit outside a box its polygon enters
//
// Never requested: EPA staff contact name, email and phone, the street
// address, ZIP and address comment, the free-text feature name and
// description, and GIS_AREA (its units mix acres, square miles and null).
// A boundary is a regulatory area, not a contamination footprint. A site with
// no row on the NPL list is "not on EPA's NPL status list", never "not NPL";
// a status list that did not answer is "unknown", never "not listed".

import type { LayerFeature } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";
import type { Bbox } from "@/lib/zoning/features";
import type { ContaminantExtra } from "./contaminants";

export const NPL_BOUNDARIES = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FAC_Superfund_Site_Boundaries_EPA_Public/FeatureServer/0";
export const NPL_STATUS = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Superfund_National_Priorities_List_(NPL)_Sites_with_Status_Information/FeatureServer/0";

/** The layer's maxRecordCount (2026-10-15). A 22 km box holds tens of polygons. */
export const NPL_BOUNDARY_MAX = 2000;
/**
 * IN lists are chunked at this many ids. The status layer answers a GET of 80 ids (a 2,172-character
 * URL) and 404s at 90 (2,382), probed 2026-10-15; 50 leaves room.
 */
export const NPL_IN_CHUNK = 50;

/**
 * Superfund rows only. Keeps 2,113 of 2,114 polygons (2026-10-15): the one it drops is a single
 * "Michigan LUST" polygon, a state tank-program record in a Superfund layer (catalogued as an exclusion).
 */
export const NPL_BOUNDARY_WHERE = "EPA_PROGRAM IS NULL OR EPA_PROGRAM LIKE 'Superfund%'";

export const NPL_BOUNDARY_FIELDS = [
  "EPA_ID",
  "SITE_NAME",
  "NPL_STATUS_CODE",
  "FEDERAL_FACILITY_DETER_CODE",
  "SITE_FEATURE_TYPE",
  "SITE_FEATURE_SOURCE",
  "EPA_PROGRAM",
  "CITY_NAME",
  "COUNTY",
  "STATE_CODE",
  "FEATURE_INFO_URL",
  "URL_ALIAS_TXT",
  "LAST_CHANGE_DATE",
] as const;

/** City and County are not needed (the boundary has them); no narrative field is asked. */
export const NPL_STATUS_FIELDS = [
  "Site_EPA_ID",
  "Site_Name",
  "Site_Score",
  "SEMS_ID",
  "Status",
  "Proposed_Date",
  "Listing_Date",
  "Construction_Completion_Date",
  "Deletion_Date",
  "NOID_Date",
  "Site_has_had_a_Partial_Deletion",
  "Proposed_FR_Notice",
  "Final_FR_Notice",
  "Deletion_FR_Notice",
  "Site_Progress_Profile",
] as const;

export const NPL_CAVEAT =
  "Superfund site boundaries as EPA regions map them, with NPL status. A boundary is a regulatory area, not a contamination footprint. A site can have several overlapping mapped features (site area, ground boundary, extent of contamination). EPA does not vouch for the accuracy, completeness or currency of these boundaries, and they are not for liability or cost-recovery decisions. NPL status and dates are from EPA's NPL list. A site missing from that list is shown as such, not as 'not NPL'.";

export function nplBoundaryParams(b: Bbox): Record<string, string> {
  const [w, s, e, n] = b;
  return {
    where: NPL_BOUNDARY_WHERE,
    geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    outFields: NPL_BOUNDARY_FIELDS.join(","),
    returnGeometry: "true",
    // Mandatory: the NJ box is 7.98 MB raw and 130 KB at this offset; Hudson River PCBs alone is 211k vertices.
    maxAllowableOffset: "0.0005",
    geometryPrecision: "5",
    resultRecordCount: String(NPL_BOUNDARY_MAX),
  };
}

/** EPA IDs are letters and digits (NJD980654131); anything else never reaches a where clause. */
export const EPA_ID_RE = /^[A-Z0-9]{9,14}$/;

/** One status query per chunk of at most NPL_IN_CHUNK ids. */
export function nplStatusParams(ids: string[]): Array<Record<string, string>> {
  const clean = [...new Set(ids.filter((id) => EPA_ID_RE.test(id)))].sort();
  const out: Array<Record<string, string>> = [];
  for (let i = 0; i < clean.length; i += NPL_IN_CHUNK) {
    const chunk = clean.slice(i, i + NPL_IN_CHUNK);
    out.push({
      where: `Site_EPA_ID IN (${chunk.map((id) => `'${id}'`).join(",")})`,
      outFields: NPL_STATUS_FIELDS.join(","),
      returnGeometry: "false",
    });
  }
  return out;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** EPA's domain labels carry trailing and doubled spaces ('Currently on the Final NPL   ', 'Not a  Federal Facility'). */
export function cleanLabel(v: unknown): string | null {
  const s = str(v);
  return s ? s.replace(/\s+/g, " ") : null;
}

/** 'MM/DD/YYYY' -> 'YYYY-MM-DD'; null, blank or anything that is not a real date -> null. */
export function mdyDate(v: unknown): string | null {
  const s = str(v);
  const m = s?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** Epoch ms -> ISO date; null, blank or non-finite -> null (never 1970-01-01). */
export function epochDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString().slice(0, 10);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };
function plain(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, " ")
    .trim();
}

/** Only an https link on an epa.gov host is kept. */
export function epaLink(href: string | null): string | null {
  if (!href) return null;
  try {
    const u = new URL(href);
    if (u.protocol !== "https:") return null;
    const h = u.hostname.toLowerCase();
    return h === "epa.gov" || h.endsWith(".epa.gov") ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface NplNotice {
  kind: string;
  text: string;
  url: string | null;
}

/** An HTML anchor field -> its text and, when it is an https epa.gov link, its href. No HTML passes through. */
export function anchor(v: unknown, kind: string): NplNotice | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/<a\s[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
  const text = plain(m ? m[2] : s);
  const url = m ? epaLink(m[1]) : null;
  if (!text && !url) return null;
  return { kind, text: text || kind, url };
}

export interface NplStatus {
  /** As EPA's list words it: 'NPL Site', 'Proposed NPL Site', 'Deleted NPL Site'. */
  status: string | null;
  /** Hazard Ranking System score; null when not given. */
  score: number | null;
  proposed: string | null;
  listed: string | null;
  constructionComplete: string | null;
  deleted: string | null;
  /** Notice of intent to delete. */
  noticeOfIntentToDelete: string | null;
  /** Yes/No as the list gives it; null when absent (never read as no). */
  partialDeletion: boolean | null;
  notices: NplNotice[];
}

const NOTICE_FIELDS: Array<[string, string]> = [
  ["Proposed_FR_Notice", "proposed rule (Federal Register)"],
  ["Final_FR_Notice", "final rule (Federal Register)"],
  ["Deletion_FR_Notice", "deletion notice (Federal Register)"],
  ["Site_Progress_Profile", "site progress profile (EPA)"],
];

/** The NPL list's rows by EPA ID. */
export function buildNplStatus(rows: Array<{ properties: Record<string, unknown> | null }>): Map<string, NplStatus> {
  const out = new Map<string, NplStatus>();
  for (const r of rows) {
    const p = r.properties ?? {};
    const id = str(p.Site_EPA_ID);
    if (!id) continue;
    const score = typeof p.Site_Score === "number" && Number.isFinite(p.Site_Score) ? p.Site_Score : null;
    const partial = anchor(p.Site_has_had_a_Partial_Deletion, "partial deletion")?.text.toLowerCase();
    out.set(id, {
      status: cleanLabel(p.Status),
      score,
      proposed: mdyDate(p.Proposed_Date),
      listed: mdyDate(p.Listing_Date),
      constructionComplete: mdyDate(p.Construction_Completion_Date),
      deleted: mdyDate(p.Deletion_Date),
      noticeOfIntentToDelete: mdyDate(p.NOID_Date),
      partialDeletion: partial === "yes" ? true : partial === "no" ? false : null,
      notices: NOTICE_FIELDS.map(([f, kind]) => anchor(p[f], kind)).filter((x): x is NplNotice => !!x),
    });
  }
  return out;
}

/** 'NPL Site' -> 'final'; the list's three words, or the word as published. */
export function nplShort(s: NplStatus | null | undefined): string | null {
  if (!s?.status) return null;
  const t = s.status.toLowerCase();
  if (t === "npl site") return "final";
  if (t === "proposed npl site") return "proposed";
  if (t === "deleted npl site") return "deleted";
  return s.status;
}

/**
 * The status as a feature carries it:
 *   NplStatus    the site's row on EPA's NPL list
 *   null         the list answered and has no row for this EPA ID
 *   undefined    the list did not answer: unknown
 */
export type NplJoin = NplStatus | null | undefined;

/** EPA ID -> its join. */
export type NplLookup = (epaId: string) => NplJoin;

/**
 * A lookup over the rows the list answered. Ids in `unknown` (a chunk of the IN query that did not
 * answer) are undefined; "all" means the list did not answer at all.
 */
export function nplLookup(found: Map<string, NplStatus>, unknown: ReadonlySet<string> | "all" = new Set()): NplLookup {
  return (id) => (unknown === "all" || unknown.has(id) ? undefined : (found.get(id) ?? null));
}

/** Dossier lines for a site's NPL list row (or its absence). */
export function nplDetails(epaId: string | null, join: NplJoin): Record<string, string | number | undefined> {
  if (join === undefined) return { "NPL list": epaId ? "unknown: EPA's NPL status list did not answer this time" : undefined };
  if (join === null) return { "NPL list": "not on EPA's NPL status list" };
  const d: Record<string, string | number | undefined> = {
    "NPL list": join.status ?? "on EPA's NPL list, status not given",
    "HRS score": join.score ?? undefined,
    "proposed to the NPL": join.proposed ?? undefined,
    "listed on the NPL": join.listed ?? undefined,
    "construction complete": join.constructionComplete ?? undefined,
    "notice of intent to delete": join.noticeOfIntentToDelete ?? undefined,
    "deleted from the NPL": join.deleted ?? undefined,
    "partial deletion": join.partialDeletion == null ? undefined : join.partialDeletion ? "yes" : "no",
  };
  for (const n of join.notices) d[n.kind] = n.url ?? n.text;
  return d;
}

/** Decoded labels for the two coded fields, from the layer's own domains (lib/server/arcgis codedDomains). */
export interface NplDomains {
  status: Map<string, string>;
  federal: Map<string, string>;
}

/** A code -> EPA's label, cleaned; a code the domain does not hold is shown as published. Null stays null. */
export function decode(map: Map<string, string> | undefined, code: string | null): string | null {
  if (!code) return null;
  const label = cleanLabel(map?.get(code));
  return label ?? code;
}

/**
 * Site page: FEATURE_INFO_URL when https; else URL_ALIAS_TXT, which is published both as a bare
 * host and path ('www.epa.gov/superfund/rockaway-boro-wellfield') and as a full https URL; else null.
 */
export function sitePage(info: unknown, alias: unknown): string | null {
  const a = str(info);
  if (a && /^https:\/\/\S+$/i.test(a)) return a;
  const b = str(alias);
  if (b && /^https:\/\/\S+$/i.test(b)) return b;
  if (b && /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(b)) return `https://${b}`;
  return null;
}

export interface NplBoundaryExtra extends ContaminantExtra {
  shape: "boundary";
  /** NPL_STATUS_CODE as published (A, D, F, N, O, P, R, S, W); null when not given. */
  nplCode: string | null;
  npl: NplJoin;
  /** How many mapped features this EPA ID has in the answer. */
  siteFeatures: number;
}

type Row = { id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null };

/** Boundary rows -> features. Several polygons can share an EPA ID; they are not merged, each says how many there are. */
export function buildNplBoundaries(rows: Row[], domains: NplDomains | null, lookup: NplLookup): LayerFeature[] {
  const perSite = new Map<string, number>();
  for (const r of rows) {
    const id = str(r.properties?.EPA_ID);
    if (id) perSite.set(id, (perSite.get(id) ?? 0) + 1);
  }
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    const g = r.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return;
    const p = r.properties ?? {};
    const epaId = str(p.EPA_ID);
    const code = str(p.NPL_STATUS_CODE);
    const ff = str(p.FEDERAL_FACILITY_DETER_CODE);
    const join: NplJoin = epaId ? lookup(epaId) : null;
    const n = epaId ? (perSite.get(epaId) ?? 1) : 1;
    const type = cleanLabel(p.SITE_FEATURE_TYPE);
    const from = cleanLabel(p.SITE_FEATURE_SOURCE);
    const x: NplBoundaryExtra = { program: "sems", programId: epaId ?? undefined, shape: "boundary", nplCode: code, npl: join, siteFeatures: n };
    out.push({
      type: "Feature",
      geometry: g,
      properties: {
        id: `npl:${epaId ?? "site"}:${r.id ?? i}`,
        layer: "contaminants",
        name: epaId ? `Superfund ${epaId}` : "Superfund site boundary",
        kind: "npl",
        source: "EPA Superfund site boundaries",
        details: {
          program: "Superfund site boundary, as an EPA region maps it",
          "site (as EPA publishes it)": cleanLabel(p.SITE_NAME),
          "EPA ID": epaId,
          "EPA program (as published)": cleanLabel(p.EPA_PROGRAM),
          "NPL status (boundary layer)": code ? decode(domains?.status, code) : "status not given",
          "federal facility": ff ? decode(domains?.federal, ff) : "not given",
          ...nplDetails(epaId, join),
          "this feature": [type ?? "type not given", from ? `drawn from ${from}` : null].filter(Boolean).join(", "),
          "mapped features for this site here": n > 1 ? `${n} (they can overlap: site area, ground boundary, extent of contamination)` : 1,
          city: cleanLabel(p.CITY_NAME),
          county: cleanLabel(p.COUNTY),
          state: cleanLabel(p.STATE_CODE),
          "last changed (EPA)": epochDate(p.LAST_CHANGE_DATE),
          "EPA site page": sitePage(p.FEATURE_INFO_URL, p.URL_ALIAS_TXT),
          "what this is": "a Superfund site boundary as an EPA region maps it: a regulatory area, not a contamination footprint",
        },
        // Never SITE_NAME, never the EPA ID (matched by letters).
        extra: withEmbedText(
          x,
          recordText("npl-boundaries", {
            NPL_STATUS_CODE: code ? decode(domains?.status, code) : null,
            FEDERAL_FACILITY_DETER_CODE: ff ? decode(domains?.federal, ff) : null,
            EPA_PROGRAM: cleanLabel(p.EPA_PROGRAM),
            SITE_FEATURE_TYPE: type,
            CITY_NAME: cleanLabel(p.CITY_NAME),
            COUNTY: cleanLabel(p.COUNTY),
            STATE_CODE: cleanLabel(p.STATE_CODE),
          }),
        ),
      },
    });
  });
  return out;
}

/** EMEF's Superfund points gain their NPL list row (or its absence) in the record and the label. */
export function attachNpl(features: LayerFeature[], lookup: NplLookup): LayerFeature[] {
  return features.map((f) => {
    const x = f.properties.extra as ContaminantExtra;
    if (x.program !== "sems") return f;
    const id = x.programId ?? null;
    const join: NplJoin = id ? lookup(id) : null;
    return {
      ...f,
      properties: { ...f.properties, details: { ...f.properties.details, ...nplDetails(id, join) }, extra: { ...x, npl: join } },
    };
  });
}
