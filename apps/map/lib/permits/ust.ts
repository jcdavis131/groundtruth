// Leaking underground storage tanks, by county: EPA's UST Finder county
// layers (releases and facilities), for the `ust` layer. Pure: the requests,
// the county-name join and the row -> feature builder. The route lives in
// app/api/permits (op=ust), the layer in lib/layers/ust.ts.
//
// Only county aggregates are used. UST Finder's point layers (facilities and
// releases, layers 0 and 1) are never requested: many sites are private homes
// ('%RESIDENCE%' matches 4,615 releases), their geocodes are home addresses,
// and no field marks a residential site reliably. A county count carries no
// location below the county.
//
// The two county layers carry no FIPS code, so they are joined by county name
// and state; a name that does not match, or that is not unique in the answer,
// leaves that side null and is counted as unjoined. Counts are shown as EPA
// publishes them; nothing is derived by subtraction (13,179 releases nationally
// have an unknown status, yet some counties sum exactly, so the arithmetic is
// not trustworthy).

import type { LayerFeature } from "@/lib/layers/types";
import { recordText, withEmbedText } from "@/lib/catalog/recordText";
import type { Bbox } from "@/lib/zoning/features";

export const UST_FINDER = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/UST_Finder_Feature_Layer_2eb/FeatureServer";
/** Layer 3 Releases_by_County (drawn), layer 2 Facilities_by_County (joined). Layers 0 and 1 (points) are never asked. */
export const UST_LAYERS = { releases: 3, facilities: 2 } as const;
export const UST_MAX = 2000;

export const UST_RELEASE_FIELDS = ["Release_Count", "Open_Count", "No_Further_Action_Count", "County", "State", "POPULATION"] as const;
export const UST_FACILITY_FIELDS = ["Facility_Count", "NAME", "State", "POPULATION", "Open_USTs", "Closed_USTs", "TOS_USTs"] as const;

export const UST_CAVEAT =
  "EPA's national composite of state tank records as of 2018-2021 (tribal records to October 2025), counted by county: a snapshot, not current status. A release is a reported leak; 'no further action' means the state closed it, not that no contamination remains. Counts depend on how each state reported. Individual sites are not shown because many are private homes.";

/** The release layer's status-count nulls: what they most likely mean (catalogue card and place export). */
export const UST_RELEASE_NULLS =
  "Open and no-further-action counts: the layer never publishes a 0 in either field (505 and 225 nulls), so a null there most likely means 0 for many counties; it is kept null, and missingness is not random. Open: all 120 Kentucky counties plus 385 counties in 34 other states, 359 of which have release count = no-further-action count (0 left open). No further action: all 78 of Puerto Rico's plus 147 elsewhere (Kentucky 119, Washington 21, 7 others). Kalawao, HI and 8 other counties publish 0 releases with null status counts. Evidence in meta.nullPattern.";

/** The facility layer's tank-count nulls, by where they are (catalogue card and place export). */
export const UST_FACILITY_NULLS =
  "Tank counts: closed and temporarily-out-of-service tanks are null in 118 counties each (all 78 of Puerto Rico's, 38 California counties including Los Angeles, and Georgia's 13123 and 13125), open tanks in 80 (Puerto Rico and the same two Georgia counties). Kept null, never 0 (meta.nullCellNote).";

export function ustParams(which: keyof typeof UST_LAYERS, b: Bbox): Record<string, string> {
  const [w, s, e, n] = b;
  return {
    where: "1=1",
    geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    outFields: (which === "releases" ? UST_RELEASE_FIELDS : UST_FACILITY_FIELDS).join(","),
    // One geometry is enough: the releases layer's county outlines, simplified to about 1 km.
    returnGeometry: which === "releases" ? "true" : "false",
    ...(which === "releases" ? { maxAllowableOffset: "0.01", geometryPrecision: "3" } : {}),
    resultRecordCount: String(UST_MAX),
  };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
/** A published count; null, blank or anything not a non-negative integer is null (never 0). */
export function count(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;
}

/** County name + state, case- and space-insensitive. */
export function countyKey(county: unknown, state: unknown): string | null {
  const c = str(county)?.toLowerCase().replace(/\s+/g, " ");
  const s = str(state)?.toLowerCase().replace(/\s+/g, " ");
  return c && s ? `${c}|${s}` : null;
}

export interface UstFacilities {
  facilities: number | null;
  openTanks: number | null;
  closedTanks: number | null;
  tosTanks: number | null;
}

export interface UstExtra {
  releases: number | null;
  open: number | null;
  noFurtherAction: number | null;
  /** The facilities row; null when the facilities layer did not answer or the name did not join. */
  facilities: UstFacilities | null;
  /** Why `facilities` is null. */
  facilitiesMissing?: "unanswered" | "unjoined";
}

type Row = { id?: number | string; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null };

/**
 * Release counties as features, each with its facilities row joined by county name and state.
 * `facilities` null means the facilities layer did not answer. Returns the features and how many
 * counties on either side did not join.
 */
export function buildUst(releases: Row[], facilities: Row[] | null): { features: LayerFeature[]; unjoined: { releases: number; facilities: number } } {
  const fac = new Map<string, Record<string, unknown> | "ambiguous">();
  for (const r of facilities ?? []) {
    const k = countyKey(r.properties?.NAME, r.properties?.State);
    if (!k) continue;
    fac.set(k, fac.has(k) ? "ambiguous" : (r.properties ?? {}));
  }
  const relKeys = new Map<string, number>();
  for (const r of releases) {
    const k = countyKey(r.properties?.County, r.properties?.State);
    if (k) relKeys.set(k, (relKeys.get(k) ?? 0) + 1);
  }
  const features: LayerFeature[] = [];
  let unjoinedReleases = 0;
  const joined = new Set<string>();
  releases.forEach((r, i) => {
    const g = r.geometry;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return;
    const p = r.properties ?? {};
    const county = str(p.County);
    const state = str(p.State);
    const k = countyKey(county, state);
    const f = k && relKeys.get(k) === 1 ? fac.get(k) : undefined;
    const row = f && f !== "ambiguous" ? f : null;
    if (k && row) joined.add(k);
    else if (facilities) unjoinedReleases++;
    const x: UstExtra = {
      releases: count(p.Release_Count),
      open: count(p.Open_Count),
      noFurtherAction: count(p.No_Further_Action_Count),
      facilities: row ? { facilities: count(row.Facility_Count), openTanks: count(row.Open_USTs), closedTanks: count(row.Closed_USTs), tosTanks: count(row.TOS_USTs) } : null,
      ...(row ? {} : { facilitiesMissing: facilities ? ("unjoined" as const) : ("unanswered" as const) }),
    };
    const n = (v: number | null) => (v == null ? "not given" : v.toLocaleString("en-US"));
    features.push({
      type: "Feature",
      geometry: g,
      properties: {
        id: `ust:${k ?? r.id ?? i}`,
        layer: "ust",
        name: county && state ? `${county}, ${state}` : "county",
        kind: x.open == null ? "not-given" : "county",
        source: "EPA UST Finder",
        details: {
          county,
          state,
          "releases reported": n(x.releases),
          "open releases": n(x.open),
          "no further action": n(x.noFurtherAction),
          "UST facilities": x.facilities ? n(x.facilities.facilities) : x.facilitiesMissing === "unanswered" ? "unknown: the facilities layer did not answer" : "not joined (no unique county name match in EPA's facilities layer)",
          "open tanks": x.facilities ? n(x.facilities.openTanks) : undefined,
          "closed tanks": x.facilities ? n(x.facilities.closedTanks) : undefined,
          "temporarily out of service tanks": x.facilities ? n(x.facilities.tosTanks) : undefined,
          "county population (as EPA's layer gives it)": count(p.POPULATION) ?? undefined,
          "what this is": "county counts of reported leaks and tank facilities from state records as of 2018-2021: a snapshot, not current status; individual sites are not shown",
        },
        // The county and state only; the counts are measured quantities and are not embedded.
        extra: withEmbedText(x, recordText("ust-releases-county", { County: county, State: state })),
      },
    });
  });
  let unjoinedFacilities = 0;
  for (const [k, v] of fac) if (v === "ambiguous" || !joined.has(k)) unjoinedFacilities++;
  return { features, unjoined: { releases: unjoinedReleases, facilities: facilities ? unjoinedFacilities : 0 } };
}
