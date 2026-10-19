// BIA American Indian and Alaska Native Land Area Representation (AIAN-LAR):
// the outer extents of land held in trust or restricted fee for federally
// recognized tribes and individual Indians, as BIA's Division of Land Titles
// and Records publishes them (biamaps.geoplatform.gov, CORS echoes the
// origin; US federal work). Pure: the field list, the small-part rule, the
// feature builder and the caveats. The route is /api/land?op=tribal; the
// layer id is `tribal`, titled "Trust land (BIA)" so it never shares a name
// with the Census tribal areas fabric draws ("Tribal land").
//
// One national pull: 335 polygons at maxAllowableOffset 0.01 (about 580 kB).
//
// Small parts (Cam, 2026-10-17). BIA's geometry includes allotment-sized
// parts (Public Domain Allotments, homesteads and other parcels held for
// "tribes and individual Indians"): 3,009 of the 4,279 polygon parts at
// offset 0.01 are under 0.7 km2, about a 160-acre allotment. None carries a
// name or owner, but drawn beside a parcel layer such a part is one step from
// an individual's holding, so parts under TRIBAL_MIN_PART_KM2 are dropped from
// the response and the caveat says how many. Each feature's largest part is
// always kept, even under 0.7 km2 (TRIBAL_KEEP_LARGEST_PART; Cam kept this
// reading on 2026-10-17), and the caveat counts those small parts that are
// drawn (meta.keptSmallLargest, 82 on the fixture): 82 land areas (California
// rancherias, Narragansett, Mashpee Wampanoag, Poarch Creek, Chitimacha and
// others) are entirely under 0.7 km2, and dropping them would make a blank
// area read as no tribal land, the failure the caveat exists to deny. With the
// flag off, a land area with no part left is removed and listed by name in
// meta.hiddenAreas, never silently. Holes of a kept part are kept: dropping a
// small hole would paint fee land as trust land. Nothing here is ever joined
// to a parcel, a name or an address.
//
// CLASSIFICATION has no domain in the service ('1' for 333 rows, '3' for 2 on
// 2026-10-17): shown as BIA codes it, never given a guessed meaning. GISACRES
// is GIS acreage, not surveyed acreage.

import type { MultiPolygon, Polygon, Position } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import { ringsArea } from "@/lib/fabric/geo";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";

export const BIA_LAR_LAYER = "https://biamaps.geoplatform.gov/server/rest/services/DivLTR/BIA_AIAN_National_LAR/FeatureServer/0";
export const BIA_LAR_PAGE = "https://www.bia.gov/bia/ots/dltr";
/** The fields asked (named, never *). GlobalID is not asked. */
export const TRIBAL_FIELDS = ["LARID", "LARNAME", "CLASSIFICATION", "GISACRES", "REGION"] as const;
/** The national pull's simplification, degrees. */
export const TRIBAL_OFFSET = 0.01;
/** Parts smaller than this are dropped, except a land area's largest part (Cam, 2026-10-17). */
export const TRIBAL_MIN_PART_KM2 = 0.7;
/** Keep each land area's largest part whatever its size, so no named land area disappears (Cam kept this reading, 2026-10-17; see the header). */
export const TRIBAL_KEEP_LARGEST_PART = true;

export const TRIBAL_REFERENCE_ONLY =
  "This GIS Dataset is prepared strictly for illustrative and reference purposes only and should not be used, and is not intended for legal, survey, engineering or navigation purposes.";
export const TRIBAL_CAVEAT =
  "The Bureau of Indian Affairs' Land Area Representation: the outer extent of land held in trust or restricted fee for federally recognized tribes and individual Indians, compiled from BIA land title records. BIA prepares it for illustrative and reference purposes only, not for legal, survey or jurisdictional use. Land inside an outline can be in other ownership, and land outside can be trust land. BIA's layer has no Eastern Oklahoma region rows and no land in Oklahoma, and does not include every tribe's land, so a blank area does not mean there is no tribal land there. Alaska Native corporation lands are not trust land and are not shown; Census tribal areas are on the Field layer.";
export const TRIBAL_ATTRIBUTION =
  "Bureau of Indian Affairs, Office of Trust Services, Division of Land Titles and Records: American Indian and Alaska Native Land Area Representation (AIAN-LAR).";
export const TRIBAL_SOURCE_LABEL = "BIA AIAN Land Area Representation";
/** One colour for all BIA land areas (lightly filled, solid outline); fabric draws Census tribal areas unfilled, so the two never look alike. */
export const TRIBAL_COLOR = "#B45309";

/**
 * The caveat line for the small-part rule, from the counts of this answer: the parts dropped
 * (droppedParts), the small parts still drawn because each is its land area's only or largest
 * part (keptSmallLargest), and, with the flag off, the land areas left with nothing drawn.
 */
export function smallPartsCaveat(droppedParts: number, keptSmallLargest: number, hidden: number, keepLargest: boolean = TRIBAL_KEEP_LARGEST_PART): string {
  const dropped = `${droppedParts.toLocaleString("en-US")} polygon part${droppedParts === 1 ? "" : "s"} under ${TRIBAL_MIN_PART_KM2} km2 (about the size of a 160-acre allotment) ${droppedParts === 1 ? "is" : "are"} dropped and not drawn`;
  const rest = keepLargest
    ? keptSmallLargest
      ? `${keptSmallLargest.toLocaleString("en-US")} part${keptSmallLargest === 1 ? "" : "s"} under ${TRIBAL_MIN_PART_KM2} km2 ${keptSmallLargest === 1 ? "is" : "are"} drawn, because each is its land area's only or largest part, so no land area disappears`
      : `no part under ${TRIBAL_MIN_PART_KM2} km2 is drawn, and every land area keeps a part, so no land area disappears`
    : `${hidden} land area${hidden === 1 ? "" : "s"} entirely under that size ${hidden === 1 ? "is" : "are"} not drawn and ${hidden === 1 ? "is" : "are"} listed by name in meta.hiddenAreas`;
  return `${dropped}; ${rest}. Nothing here is joined to parcels, names or addresses.`;
}

type Ring = Position[];
type Part = Ring[];

const partKm2 = (p: Part) => ringsArea([p[0] as number[][]]);

export interface TribalFilterResult {
  /** The features with their small parts removed (a feature with nothing left is dropped). */
  features: Array<{ geometry: Polygon | MultiPolygon; properties: Record<string, unknown> }>;
  /** Polygon parts dropped (outer rings with their holes). */
  droppedParts: number;
  /** Parts kept although under the floor, because they are their land area's largest. */
  keptSmallLargest: number;
  /** Land areas with nothing drawn (only when keepLargest is off). */
  hiddenAreas: Array<{ LARID: string | null; LARNAME: string | null; REGION: string | null }>;
}

/** The small-part rule over f=geojson rows. Pure; the threshold and the keep-largest flag are parameters so both readings are tested. */
export function filterTribalParts(
  rows: ReadonlyArray<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>,
  minKm2: number = TRIBAL_MIN_PART_KM2,
  keepLargest: boolean = TRIBAL_KEEP_LARGEST_PART,
): TribalFilterResult {
  const features: TribalFilterResult["features"] = [];
  const hiddenAreas: TribalFilterResult["hiddenAreas"] = [];
  let droppedParts = 0;
  let keptSmallLargest = 0;
  for (const r of rows) {
    const g = r.geometry;
    const p = r.properties ?? {};
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) continue;
    const parts: Part[] = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    const areas = parts.map(partKm2);
    let largest = 0;
    areas.forEach((a, i) => {
      if (a > areas[largest]) largest = i;
    });
    const kept: Part[] = [];
    parts.forEach((part, i) => {
      if (areas[i] >= minKm2) kept.push(part);
      else if (keepLargest && i === largest) {
        kept.push(part);
        keptSmallLargest++;
      } else droppedParts++;
    });
    if (!kept.length) {
      hiddenAreas.push({ LARID: str(p.LARID), LARNAME: str(p.LARNAME), REGION: str(p.REGION) });
      continue;
    }
    // The largest kept part first, so a renderer that labels the first ring labels the biggest.
    kept.sort((a, b) => partKm2(b) - partKm2(a));
    features.push({ geometry: kept.length === 1 ? { type: "Polygon", coordinates: kept[0] } : { type: "MultiPolygon", coordinates: kept }, properties: p });
  }
  return { features, droppedParts, keptSmallLargest, hiddenAreas };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/** The centre of a ring's bounding box: a label point on the largest part. */
function ringAnchor(ring: Ring): [number, number] | undefined {
  if (!ring.length) return undefined;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [Number(((w + e) / 2).toFixed(5)), Number(((s + n) / 2).toFixed(5))];
}

export interface TribalExtra {
  larid: string | null;
  region: string | null;
  /** CLASSIFICATION as BIA codes it (the service publishes no meaning for it). */
  classification: string | null;
  gisAcres: number | null;
  embedText?: string;
}

/** The click lines for one land area. */
export function tribalDetails(p: Readonly<Record<string, unknown>>): Record<string, string> {
  const acres = num(p.GISACRES);
  const cls = str(p.CLASSIFICATION);
  return {
    "BIA region": str(p.REGION) ?? "not published",
    classification: cls ? `${cls} (as BIA codes it; the service publishes no meaning for the code)` : "not published",
    "GIS acres": acres == null ? "not published" : `${Math.round(acres).toLocaleString("en-US")} (GIS acres, not surveyed acreage)`,
    "LAR id": str(p.LARID) ?? "not published",
    "BIA says": TRIBAL_REFERENCE_ONLY,
    "not this": "Census tribal statistical areas (on the Field layer); and never a statement about jurisdiction",
    "BIA land titles and records page": BIA_LAR_PAGE,
  };
}

/** LAR features after the small-part rule, labelled by LARNAME on their largest part. */
export function buildTribal(rows: TribalFilterResult["features"]): LayerFeature<Polygon | MultiPolygon>[] {
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const p = r.properties;
    const id = str(p.LARID);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const first = r.geometry.type === "Polygon" ? r.geometry.coordinates[0] : r.geometry.coordinates[0]?.[0];
    const extra: TribalExtra = { larid: id, region: str(p.REGION), classification: str(p.CLASSIFICATION), gisAcres: num(p.GISACRES) };
    out.push({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        id: `lar:${id}`,
        layer: "tribal",
        name: str(p.LARNAME) ?? id,
        kind: "lar",
        source: TRIBAL_SOURCE_LABEL,
        details: tribalDetails(p),
        extra: withEmbedText(extra, recordText("bia-lar", p)),
        anchor: first ? ringAnchor(first) : undefined,
      },
    });
  }
  return out;
}
