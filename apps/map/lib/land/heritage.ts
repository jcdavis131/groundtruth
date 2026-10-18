// National heritage (round 4): four small, current NPS services under
// services1.arcgis.com/fBc8EJBxQRMcHlei, drawn by the `heritage` layer.
//
//   units         NPS Land Resources Division's authorised unit boundaries
//                 (layer 2, polygons by box) and their centroids (layer 0, one
//                 national pull), 437 each
//   nha           National Heritage Areas (WASO_NHA_Map2026), 62, one national pull
//   battlefields  American Battlefield Protection Program survey areas: Civil War,
//                 Revolutionary War and War of 1812 study areas (layers 0, 5, 8)
//                 and core areas (1, 6, 9); the resurvey and Potential National
//                 Register layers are left out, so nothing reads as "listed"
//   whs           World Heritage Sites with an NPS boundary (35 rows), grouped by
//                 inscription: the nine Frank Lloyd Wright rows are one site
//
// Pure: field lists, URLs and the builders. No owner or person field is ever
// requested (WHS SiteOwner, NHA EDIT_BY / ORIGINATOR stay at the source).

import type { Geometry, MultiPolygon, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";

export const NPS_ARCGIS = "https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services";
export const NPS_LRD = `${NPS_ARCGIS}/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer`;
export const NPS_NHA = `${NPS_ARCGIS}/WASO_NHA_Map2026/FeatureServer/0`;
export const NPS_ABPP = `${NPS_ARCGIS}/ABPP_Battlefield_Boundaries/FeatureServer`;
export const NPS_WHS = `${NPS_ARCGIS}/World_Heritage_Sites/FeatureServer/0`;

export type HeritageKind = "units" | "nha" | "battlefields" | "whs";
export const HERITAGE_KINDS: readonly HeritageKind[] = ["units", "nha", "battlefields", "whs"];
export function isHeritageKind(v: unknown): v is HeritageKind {
  return typeof v === "string" && (HERITAGE_KINDS as readonly string[]).includes(v);
}

export const UNIT_FIELDS = ["UNIT_CODE", "UNIT_NAME", "UNIT_TYPE", "STATE", "REGION", "DATE_EDIT"] as const;
export const NHA_FIELDS = ["name", "UNIT", "url", "description", "vintage"] as const;
export const ABPP_FIELDS = ["SITE", "NAME", "WAR", "STATE", "BOUNDARY", "Acres"] as const;
export const WHS_FIELDS = ["RESNAME", "UNIT", "WHS_Ref", "WHS_Link", "WebLink"] as const;

/** ABPP layers used: study areas and core areas of three wars (PotNR and resurvey layers are not). */
export const ABPP_LAYERS = [
  { id: 0, war: "Civil War", boundary: "study" },
  { id: 1, war: "Civil War", boundary: "core" },
  { id: 5, war: "Revolutionary War", boundary: "study" },
  { id: 6, war: "Revolutionary War", boundary: "core" },
  { id: 8, war: "War of 1812", boundary: "study" },
  { id: 9, war: "War of 1812", boundary: "core" },
] as const;

/** Above this camera height the units are drawn as centroids; below, as their boundaries. */
export const UNITS_POLYGON_MAX_M = 250_000;

export const UNITS_CAVEAT = "Outlines are NPS's authorised unit boundaries. Not all land inside is federally owned; for ownership and access, see Public lands.";
/** NPS's own definition (item df1ac91b3c874467b5ebc31783718451, read 2026-10-16), quoted. */
export const ABPP_STUDY_DEFINITION =
  "NPS: the draft Update to the Report on the Nation's Civil War Battlefields \"defined 'study area' as the maximum delineation of a battlefield, providing the tactical context of the battle and including all places related or contributing to the battle event. The Battlefield Boundary is where troops deployed and maneuvered before, during, and after the engagement.\"";
export const ABPP_CAVEAT =
  "Battlefield boundaries are survey boundaries, not property lines: most of the land inside is private and not open to visitors. Core areas are drawn as ABPP delineates them, inside the study area.";
export const NHA_CAVEAT = "A heritage area is a partnership region, not federal land.";
export const WHS_CAVEAT = "World Heritage Sites with an NPS-published boundary, one site per inscription (a serial inscription's components are drawn together); the UNESCO page is linked as the service gives it.";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const https = (v: unknown): string | null => {
  const s = str(v);
  return s && /^https?:\/\//.test(s) ? s : null;
};
const isPoly = (g: Geometry | null | undefined): g is Polygon | MultiPolygon => !!g && (g.type === "Polygon" || g.type === "MultiPolygon");
const date = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? new Date(v).toISOString().slice(0, 10) : null);

type Row = { geometry: Geometry | null; properties: Record<string, unknown> | null };

export interface HeritageExtra {
  kind: "unit" | "nha" | "battlefield" | "whs";
  /** Units: the unit type; battlefields: the war; NHA and WHS: null. */
  group: string | null;
  /** Battlefields: study or core. */
  boundary?: "study" | "core";
  shape: "point" | "polygon";
}

/** NPS unit boundaries (layer 2) or centroids (layer 0), named as NPS names the unit. */
export function buildUnits(rows: readonly Row[], shape: "point" | "polygon"): LayerFeature[] {
  const out: LayerFeature[] = [];
  for (const r of rows) {
    const p = r.properties ?? {};
    const code = str(p.UNIT_CODE);
    const g = r.geometry;
    if (!code || !g || (shape === "point" ? g.type !== "Point" : !isPoly(g))) continue;
    const type = str(p.UNIT_TYPE);
    const edited = date(p.DATE_EDIT);
    const extra: HeritageExtra = { kind: "unit", group: type, shape };
    out.push({
      type: "Feature",
      geometry: g,
      properties: {
        id: `nps-unit:${shape === "point" ? "pt" : "bnd"}:${code}`,
        layer: "heritage",
        name: str(p.UNIT_NAME) ?? code,
        kind: "unit",
        source: "NPS Land Resources Division",
        details: {
          "unit type": type ?? "not given",
          "unit code": code,
          state: str(p.STATE),
          "NPS region": str(p.REGION),
          boundary: edited ? `boundary edited ${edited}` : "edit date not given",
          "nps.gov": `https://www.nps.gov/${code.toLowerCase()}/`,
          "what this is": "NPS's authorised unit boundary: a designation, not a statement that all land inside is federal",
        },
        extra,
      },
    });
  }
  return out;
}

/** National Heritage Areas, with NPS's description shown as NPS serves it (never embedded). */
export function buildNha(rows: readonly Row[]): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    const p = r.properties ?? {};
    if (!isPoly(r.geometry)) return;
    const name = str(p.name) ?? "National Heritage Area, unnamed in source";
    const unit = str(p.UNIT);
    const extra: HeritageExtra = { kind: "nha", group: null, shape: "polygon" };
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `nps-nha:${unit ?? i}`,
        layer: "heritage",
        name,
        kind: "nha",
        source: "NPS National Heritage Areas",
        details: {
          "about (NPS)": str(p.description),
          "heritage area site": https(p.url),
          "what this is": "a partnership region designated by Congress, not federal land",
        },
        extra,
      },
    });
  });
  return out;
}

/** ABPP study and core areas, named as ABPP names the battle. */
export function buildBattlefields(rows: readonly Row[], layer: (typeof ABPP_LAYERS)[number]): LayerFeature[] {
  const out: LayerFeature[] = [];
  rows.forEach((r, i) => {
    const p = r.properties ?? {};
    if (!isPoly(r.geometry)) return;
    const site = str(p.SITE);
    const acres = typeof p.Acres === "number" && Number.isFinite(p.Acres) && p.Acres > 0 ? p.Acres : null;
    const extra: HeritageExtra = { kind: "battlefield", group: layer.war, boundary: layer.boundary, shape: "polygon" };
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `abpp:${layer.id}:${site ?? i}`,
        layer: "heritage",
        name: `${str(p.NAME) ?? site ?? "battlefield"}${layer.boundary === "core" ? " (core area)" : ""}`,
        kind: layer.boundary === "core" ? "battlefield-core" : "battlefield-study",
        source: "NPS American Battlefield Protection Program",
        details: {
          site: site ?? "not given",
          war: layer.war,
          "survey area": layer.boundary === "core" ? "core area" : "study area",
          state: str(p.STATE),
          acres: acres == null ? "not given" : Math.round(acres).toLocaleString("en-US"),
          "what this is": "a survey boundary, not a property line: most land inside is private and not open to visitors",
        },
        extra,
      },
    });
  });
  return out;
}

/** The inscription a WHS row belongs to: "1496rev-007" -> "1496rev" (a serial site's component suffix dropped). */
export function inscriptionOf(ref: string): string {
  return ref.replace(/-\d+$/, "");
}

/**
 * World Heritage Sites, one feature per inscription (rows grouped by WHS_Ref without its component
 * suffix, polygons joined into one MultiPolygon). A blank name reads "unnamed in source".
 */
export function buildWhs(rows: readonly Row[]): LayerFeature[] {
  const groups = new Map<string, { rows: Row[]; polys: Polygon["coordinates"][] }>();
  rows.forEach((r, i) => {
    if (!isPoly(r.geometry)) return;
    const ref = str(r.properties?.WHS_Ref);
    const key = ref ? inscriptionOf(ref) : `unref:${i}`;
    if (!groups.has(key)) groups.set(key, { rows: [], polys: [] });
    const g = groups.get(key)!;
    g.rows.push(r);
    if (r.geometry.type === "Polygon") g.polys.push(r.geometry.coordinates);
    else g.polys.push(...r.geometry.coordinates);
  });
  const out: LayerFeature[] = [];
  for (const [key, g] of groups) {
    const p = g.rows[0].properties ?? {};
    const name = str(p.RESNAME) ?? "World Heritage Site, unnamed in source";
    const components = [...new Set(g.rows.map((r) => str(r.properties?.UNIT)).filter((x): x is string => !!x))];
    const extra: HeritageExtra = { kind: "whs", group: null, shape: "polygon" };
    out.push({
      type: "Feature",
      geometry: { type: "MultiPolygon", coordinates: g.polys },
      properties: {
        id: `whs:${key}`,
        layer: "heritage",
        name,
        kind: "whs",
        source: "NPS World Heritage Sites",
        details: {
          "whs ref": key.startsWith("unref:") ? "not given" : key,
          components: g.rows.length > 1 ? `${g.rows.length} boundaries in this inscription${components.length ? `: ${components.join("; ")}` : ""}` : undefined,
          "UNESCO page": https(p.WHS_Link),
          "site page": https(p.WebLink),
        },
        extra,
      },
    });
  }
  return out;
}
