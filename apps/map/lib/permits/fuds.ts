// Formerly Used Defense Sites (USACE FUDS, FY2024 data) for the Contaminated
// sites layer, as a fifth program beside EMEF's four. Pure: the requests, the
// normalisers and the row -> feature builders. The fetch lives in
// lib/permits/sources.ts and the route in app/api/permits (op=contaminants).
//
//   layer 1  property points            always
//   layer 2  cleanup projects           always; not drawn, listed in their property's record
//   layer 4  property polygons          with polygons=1 (below 10 km)
//   layer 3  munitions response sites   with polygons=1
//
// Never requested on any layer: CURRENTOWNER (free text holding private
// individuals' names, P.O. boxes and phone numbers) and FEATUREDESCRIPTION
// (unreviewed narratives); nor OFFICIALSITENAME. Property, site and project
// names are shown as USACE lists them, in the record and on the label only:
// they can carry a person's name ("BARTLETT PROPERTY") and are never searched
// or embedded. A property's listing is a program status, not a finding of
// contamination; a munitions response site marks where munitions may be
// present, not a confirmed hazard footprint.

import type { LayerFeature } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";
import type { Bbox } from "@/lib/zoning/features";
import type { ContaminantExtra } from "./contaminants";
import { epochDate } from "./npl";

export const FUDS = "https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/fuds/FeatureServer";

export type FudsLayerId = "properties" | "projects" | "mrs" | "property-polygons";

export interface FudsLayer {
  id: FudsLayerId;
  layer: 1 | 2 | 3 | 4;
  name: string;
  fields: readonly string[];
  /** Asked only with polygons=1. */
  polygons: boolean;
  geometry: boolean;
}

/** Per layer and box, as EMEF's cap. */
export const FUDS_MAX = 1000;

export const FUDS_LAYERS: readonly FudsLayer[] = [
  {
    id: "properties",
    layer: 1,
    name: "USACE FUDS properties",
    fields: ["FUDSUNIQUEPROPERTYNUMBER", "FEATURENAME", "STATUS", "ELIGIBILITY", "COUNTY", "STATE", "CLOSESTCITY", "USACEDISTRICT", "EMSMGMTACTIONPLANLINK", "FISCALYEAR"],
    polygons: false,
    geometry: true,
  },
  {
    id: "projects",
    layer: 2,
    name: "USACE FUDS projects",
    fields: [
      "FUDSPROPERTYID",
      "PROJECTNUMBER",
      "PROJECTSTATUS",
      "ENVRESTORATIONCATEGORY",
      "DERPPROGRAM",
      "ENVRESTORATIONPROJECTNAME",
      "RISKVALUEMRSPP",
      "REMEDYINPLACEDATE",
      "RESPONSECOMPLETEDATE",
      "SITECLOSEOUTDATE",
      "COSTTOCOMPLETE",
      "OVERLAPPINGFEDERALLANDAGENCY",
      "FEDERALLANDNAME",
    ],
    polygons: false,
    geometry: false,
  },
  {
    id: "property-polygons",
    layer: 4,
    name: "USACE FUDS property boundaries",
    fields: ["FUDSUNIQUEPROPERTYNUMBER", "FEATURENAME", "STATUS", "ELIGIBILITY", "HASPROJECTS", "COUNTY", "STATE", "CLOSESTCITY", "USACEDISTRICT", "EMSMGMTACTIONPLANLINK", "FISCALYEAR"],
    polygons: true,
    geometry: true,
  },
  {
    id: "mrs",
    layer: 3,
    name: "USACE FUDS munitions response sites",
    fields: ["FUDSPROPERTYID", "FUDSSITEID", "FEATURENAME", "PROJECTNUMBER", "PROJECTSTATUS", "DERPPROGRAM", "RELATIVEPRIORITY"],
    polygons: true,
    geometry: true,
  },
];

/** Never asked on any layer. */
export const FUDS_NEVER = ["CURRENTOWNER", "FEATUREDESCRIPTION", "OFFICIALSITENAME"] as const;

export const FUDS_CAVEAT =
  "USACE's Formerly Used Defense Sites inventory, FY2024 data: properties the Department of Defense once used and USACE is responsible for investigating and cleaning up. A property's listing is a program status, not a finding of contamination at the point. Only about 3,000 of 10,123 properties have a mapped boundary; the rest are points. A munitions response site marks where munitions may be present, not a confirmed hazard footprint. USACE describes the data as preliminary and not for legal use. Property names are as USACE lists them and can include a person's name; they are not searchable.";

export function fudsParams(l: FudsLayer, b: Bbox): Record<string, string> {
  const [w, s, e, n] = b;
  return {
    where: "1=1",
    geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    outFields: l.fields.join(","),
    returnGeometry: l.geometry ? "true" : "false",
    ...(l.polygons ? { maxAllowableOffset: "0.0005", geometryPrecision: "5" } : {}),
    resultRecordCount: String(FUDS_MAX),
  };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** FISCALYEAR is '2024' on layer 1 and 2024 on layer 4: a four-digit year either way, else null (never Number('') = 0). */
export function fiscalYear(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 1900 && v <= 2100 ? v : null;
  const s = str(v);
  return s && /^\d{4}$/.test(s) ? Number(s) : null;
}

export type FudsStatus = "with-projects" | "without-projects" | "all-closed-out";

/** Layer 1 and layer 4 word STATUS differently; both map to one enum. Anything else is null. */
const STATUS: Record<string, FudsStatus> = {
  "properties with projects": "with-projects",
  "properties without projects": "without-projects",
  "properties with all projects at site closeout": "all-closed-out",
  hasprojects: "with-projects",
  noprojects: "without-projects",
  allcloseout: "all-closed-out",
};

export function fudsStatus(v: unknown): FudsStatus | null {
  const s = str(v)?.toLowerCase();
  return s ? (STATUS[s] ?? null) : null;
}

const STATUS_TEXT: Record<FudsStatus, string> = {
  "with-projects": "has cleanup projects",
  "without-projects": "no cleanup projects",
  "all-closed-out": "every project at site closeout",
};

/** Environmental restoration category tokens USACE uses, expanded; any other token is shown as USACE codes it. */
const CATEGORY: Record<string, string> = {
  MMRP: "military munitions",
  HTRW: "hazardous, toxic and radioactive waste",
  CON: "containerized",
  "BD/DR": "building demolition and debris removal",
  PRP: "potentially responsible party (a non-DoD party also responsible)",
};

export function categoryText(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const tokens = s.replace("BD/DR", "BD\u0000DR").split("/").map((t) => t.replace("\u0000", "/"));
  return tokens.map((t) => (CATEGORY[t] ? `${t} (${CATEGORY[t]})` : `${t} (as USACE codes it)`)).join(" + ");
}

/** "Response Complete" and "Response Complete and Site Closeout" are completion values. */
export function completed(status: string | null): boolean {
  return !!status && /^response complete/i.test(status);
}

/**
 * USACE's cost-to-complete estimate. 0 is kept only on a completed project; on an open one a 0
 * is not an estimate and becomes null ("not given"). Null stays null.
 */
export function costToComplete(v: unknown, status: string | null): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v === 0) return completed(status) ? 0 : null;
  return v;
}

/** An https link to USACE's FUDS portal only. */
export function portalLink(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname.toLowerCase() === "fudsportal.usace.army.mil" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A date as an ISO day, marked "(planned)" when after `now`: open projects carry USACE's projected dates. */
function dateText(v: unknown, now: number): string | null {
  const d = epochDate(v);
  if (!d) return null;
  return typeof v === "number" && v > now ? `${d} (planned)` : d;
}

export interface FudsProject {
  property: string;
  number: string | null;
  /** As USACE lists it; can be a person's or a place's name; never searched. */
  name: string | null;
  category: string | null;
  categoryText: string | null;
  program: string | null;
  status: string | null;
  risk: string | null;
  remedyInPlace: string | null;
  responseComplete: string | null;
  siteCloseout: string | null;
  /** USD; null when not given (see costToComplete). */
  costToComplete: number | null;
  federalLand: string | null;
}

/** Project rows grouped by FUDSPROPERTYID. */
export function buildFudsProjects(rows: Array<{ properties: Record<string, unknown> | null }>, now: number): Map<string, FudsProject[]> {
  const out = new Map<string, FudsProject[]>();
  for (const r of rows) {
    const p = r.properties ?? {};
    const property = str(p.FUDSPROPERTYID);
    if (!property) continue;
    const status = str(p.PROJECTSTATUS);
    const agency = str(p.OVERLAPPINGFEDERALLANDAGENCY);
    const land = str(p.FEDERALLANDNAME);
    const prog = str(p.DERPPROGRAM);
    const project: FudsProject = {
      property,
      number: str(p.PROJECTNUMBER),
      name: str(p.ENVRESTORATIONPROJECTNAME),
      category: str(p.ENVRESTORATIONCATEGORY),
      categoryText: categoryText(p.ENVRESTORATIONCATEGORY),
      program: prog ? prog.toUpperCase() : null,
      status,
      risk: str(p.RISKVALUEMRSPP),
      remedyInPlace: dateText(p.REMEDYINPLACEDATE, now),
      responseComplete: dateText(p.RESPONSECOMPLETEDATE, now),
      siteCloseout: dateText(p.SITECLOSEOUTDATE, now),
      costToComplete: costToComplete(p.COSTTOCOMPLETE, status),
      federalLand: land || agency ? [land, agency ? `(${agency})` : null].filter(Boolean).join(" ") : null,
    };
    const list = out.get(property) ?? [];
    list.push(project);
    out.set(property, list);
  }
  for (const list of out.values()) list.sort((a, z) => (a.number ?? "").localeCompare(z.number ?? ""));
  return out;
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** One project as a dossier line. */
export function projectLine(p: FudsProject): string {
  return [
    p.categoryText,
    p.program ? `program ${p.program}` : null,
    p.status ? `status ${p.status}` : "status not given",
    p.remedyInPlace ? `remedy in place ${p.remedyInPlace}` : null,
    p.responseComplete ? `response complete ${p.responseComplete}` : null,
    p.siteCloseout ? `site closeout ${p.siteCloseout}` : null,
    p.risk ? `risk value ${p.risk}` : null,
    p.costToComplete == null ? "cost to complete not given" : p.costToComplete === 0 ? "cost to complete $0 (complete)" : `cost to complete ${usd(p.costToComplete)} (USACE estimate)`,
    p.federalLand ? `overlapping federal land ${p.federalLand}` : null,
    p.name ? `named ${p.name} (as USACE lists it)` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

export interface FudsExtra extends ContaminantExtra {
  program: "fuds";
  shape: "point" | "property" | "mrs";
  fudsStatus: FudsStatus | null;
  /** Projects on the property; null when the project layer did not answer (unknown, not none). */
  projects?: FudsProject[] | null;
}

type Row = { id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null };

function propertyFeature(r: Row, i: number, shape: "point" | "property", projects: Map<string, FudsProject[]> | null): LayerFeature | null {
  const g = r.geometry;
  if (!g) return null;
  if (shape === "point" && g.type !== "Point") return null;
  if (shape === "property" && g.type !== "Polygon" && g.type !== "MultiPolygon") return null;
  if (g.type === "Point" && !(Number.isFinite(g.coordinates[0]) && Number.isFinite(g.coordinates[1]))) return null;
  const p = r.properties ?? {};
  const num = str(p.FUDSUNIQUEPROPERTYNUMBER);
  const status = fudsStatus(p.STATUS);
  const list = num && projects ? (projects.get(num) ?? []) : null;
  const x: FudsExtra = { program: "fuds", programId: num ?? undefined, shape, fudsStatus: status, projects: list };
  const details: Record<string, string | number | null | undefined> = {
    program: "Formerly Used Defense Site (USACE FUDS)",
    "property (as USACE lists it)": str(p.FEATURENAME),
    "FUDS property number": num,
    status: status ? `${STATUS_TEXT[status]} (USACE: ${str(p.STATUS)})` : str(p.STATUS) ? `${str(p.STATUS)} (as USACE words it)` : "not given",
    eligibility: str(p.ELIGIBILITY),
    "has projects (USACE)": shape === "property" ? str(p.HASPROJECTS) : undefined,
    county: str(p.COUNTY),
    state: str(p.STATE)?.toUpperCase() ?? null,
    "closest city": str(p.CLOSESTCITY),
    "USACE district": str(p.USACEDISTRICT)?.toUpperCase() ?? null,
    "data fiscal year": fiscalYear(p.FISCALYEAR),
    "USACE FUDS portal": portalLink(p.EMSMGMTACTIONPLANLINK),
    drawn: shape === "property" ? "the property's boundary as USACE maps it" : "the property's point (USACE has no boundary for it in this box, or boundaries were not asked)",
  };
  if (list == null) details.projects = "unknown: USACE's project layer did not answer this time";
  else if (!list.length) details.projects = "none listed in this box's answer";
  else list.forEach((pr, k) => (details[`project ${pr.number ?? k + 1}`] = projectLine(pr)));
  details["what this is"] = "a property in USACE's FUDS program: a program status, not a finding of contamination here";
  return {
    type: "Feature",
    geometry: g,
    properties: {
      id: `fuds:${shape}:${num ?? r.id ?? i}`,
      layer: "contaminants",
      name: num ? `FUDS ${num}` : "FUDS property",
      kind: "fuds",
      source: "USACE FUDS",
      details,
      // Never FEATURENAME or the site name, never the property number (matched by letters).
      extra: withEmbedText(
        x,
        recordText("fuds-properties", {
          STATUS: status ? STATUS_TEXT[status] : str(p.STATUS),
          ELIGIBILITY: str(p.ELIGIBILITY),
          CLOSESTCITY: str(p.CLOSESTCITY),
          COUNTY: str(p.COUNTY),
          STATE: str(p.STATE)?.toUpperCase(),
          USACEDISTRICT: str(p.USACEDISTRICT)?.toUpperCase(),
          FISCALYEAR: fiscalYear(p.FISCALYEAR),
        }),
      ),
    },
  };
}

/**
 * Property points and (with polygons) property boundaries, each with its projects. A point whose
 * property has a boundary in the answer is not drawn: one property, one symbol.
 */
export function buildFudsProperties(points: Row[], polygons: Row[] | null, projects: Map<string, FudsProject[]> | null): LayerFeature[] {
  const out: LayerFeature[] = [];
  const drawn = new Set<string>();
  (polygons ?? []).forEach((r, i) => {
    const f = propertyFeature(r, i, "property", projects);
    if (!f) return;
    const num = (f.properties.extra as FudsExtra).programId;
    if (num) drawn.add(num);
    out.push(f);
  });
  const seen = new Set<string>();
  points.forEach((r, i) => {
    const num = str(r.properties?.FUDSUNIQUEPROPERTYNUMBER);
    if (num && (drawn.has(num) || seen.has(num))) return;
    const f = propertyFeature(r, i, "point", projects);
    if (!f) return;
    if (num) seen.add(num);
    out.push(f);
  });
  return out;
}

/** Munitions response site polygons. */
export function buildFudsMrs(rows: Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    const g = r.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return;
    const p = r.properties ?? {};
    const property = str(p.FUDSPROPERTYID);
    const project = str(p.PROJECTNUMBER);
    const prog = str(p.DERPPROGRAM);
    const x: FudsExtra = { program: "fuds", programId: property ?? undefined, shape: "mrs", fudsStatus: null };
    out.push({
      type: "Feature",
      geometry: g,
      properties: {
        id: `fuds:mrs:${project ?? r.id ?? i}`,
        layer: "contaminants",
        name: project ? `FUDS MRS ${project}` : "FUDS munitions response site",
        kind: "fuds",
        source: "USACE FUDS",
        details: {
          program: "Munitions response site (USACE FUDS)",
          "munitions response site (as USACE lists it)": str(p.FEATURENAME),
          "FUDS property number": property,
          "site id": str(p.FUDSSITEID),
          "FUDS project number": project,
          status: str(p.PROJECTSTATUS) ?? "not given",
          "restoration program": prog ? prog.toUpperCase() : null,
          "relative priority": str(p.RELATIVEPRIORITY) ?? "not given",
          "what this is": "where munitions may be present, as USACE maps it: not a confirmed hazard footprint",
        },
        extra: withEmbedText(x, recordText("fuds-mrs", { PROJECTSTATUS: str(p.PROJECTSTATUS), DERPPROGRAM: prog ? prog.toUpperCase() : null, RELATIVEPRIORITY: str(p.RELATIVEPRIORITY) })),
      },
    });
  });
  return out;
}
