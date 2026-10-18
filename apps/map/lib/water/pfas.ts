// PFAS in public drinking water: EPA's fifth Unregulated Contaminant
// Monitoring Rule (UCMR 5, 2023-2025), as EPA's PFAS Analytic Tools publish
// it, drawn on each water system's service area as EPA maps it. Pure: the
// requests, the four states, and the system -> feature builder. The route
// lives in app/api/water (op=pfas), the layer in lib/layers/pfas.ts.
//
//   EPA Community Water System Service Area Boundaries   the geography
//   EPA PFAS Analytic Tools, layer 1 (UCMR results)       the results
//
// The op is polygon-first: the systems whose service areas meet the box,
// then any system EPA places in the box by its estimated location only (no
// polygon), and then one group-by of their UCMR 5 results by PWSID. A result
// belongs to a water system, sampled where treated water enters the
// distribution system, never to a tap: it is drawn on the service area or as
// a ring at EPA's estimated location, never a pin. Each system is in exactly
// one of four states, none of them null-as-zero:
//
//   detected       at least one result at or above UCMR 5's reporting level
//   not-detected   sampled, every result below it: a result, not a gap
//   not-in-ucmr5   no UCMR 5 rows (most systems serving under 3,300 people
//                  were sampled only as a representative 800)
//   unknown        EPA's results did not answer: never drawn as not-detected
//
// Hazard Index rows (null value and date) are excluded by the request; no
// result is compared with any health limit; UCMR 3 rows are not used.

import type { LayerFeature } from "@/lib/layers/types";

export const CWS_BOUNDARIES = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Water_System_Boundaries/FeatureServer/0";
export const PAT = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/PFAS_Analytic_Tools_Layers/FeatureServer/1";

export const UCMR5 = "UCMR 5 (2023-2025)";
/** The service areas' maxRecordCount (2026-10-15); an 11 km box holds tens. */
export const CWS_MAX = 2000;
/**
 * PWSIDs per results query. The GET 404s past about 2,300 characters (100 PWSIDs, 2,509; 80
 * answered at 2,149), and one system answers up to ~38 groups against the layer's 2,000 cap.
 */
export const PAT_IN_CHUNK = 30;
/** Above this many bytes of service-area features, ask again once, coarser (the PAD-US precedent). */
export const PFAS_MAX_BYTES = 1_500_000;
export const PFAS_OFFSET = "0.0005";
export const PFAS_OFFSET_COARSE = "0.002";

export const CWS_FIELDS = [
  "PWSID",
  "PWS_Name",
  "Population_Served_Count",
  "Pop_Cat_5",
  "Service_Area_Type",
  "Symbology_Field",
  "Original_Data_Provider",
  "Data_Provider_Type",
  "Primacy_Agency",
  "Detailed_Facility_Report",
] as const;

export const PFAS_CAVEAT =
  "UCMR 5 results for public water systems, 2023-2025: samples taken where treated water enters the distribution system, not at any tap. A system is drawn on its service area as EPA maps it (state-sourced or modelled, as marked), or at an estimated location when EPA has no boundary for it. 'Detected' means at or above UCMR 5's minimum reporting level; the value shown is the highest single result in ng/L, not an average and not a comparison with any health limit. A system with no results here may not have been selected: of systems serving fewer than 3,300 people, EPA sampled a representative 800. Results are not a statement about current water quality.";

export const CWS_CAVEAT =
  "Service areas are EPA's Community Water System boundaries: 25,375 are sourced from the system or state and 19,240 are modelled by EPA (2026-10-15); a modelled boundary is marked and drawn dashed.";

const envelope = (b: [number, number, number, number]) => {
  const [w, s, e, n] = b;
  return {
    geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  };
};

/** Step 1: the service areas that meet the box; geometry only with polygons. */
export function cwsParams(b: [number, number, number, number], polygons: boolean, offset = PFAS_OFFSET): Record<string, string> {
  return {
    where: "1=1",
    ...envelope(b),
    outSR: "4326",
    outFields: CWS_FIELDS.join(","),
    returnGeometry: polygons ? "true" : "false",
    ...(polygons ? { maxAllowableOffset: offset, geometryPrecision: "5" } : {}),
    resultRecordCount: String(CWS_MAX),
  };
}

const COUNT = [{ statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" }];

/** Step 2: systems EPA places in the box by an estimated location (found whether or not they have a polygon). */
export function patCentroidParams(b: [number, number, number, number]): Record<string, string> {
  return {
    where: `UCMR_Cycle='${UCMR5}'`,
    ...envelope(b),
    groupByFieldsForStatistics: "F_PWS_ID,PWS_Name,State,UCMR_Geolocation_Method,Latitude,Longitude,Population_Served",
    outStatistics: JSON.stringify(COUNT),
    returnGeometry: "false",
  };
}

/** PWSIDs are two letters (or digits) and seven digits ('PA1460073'); nothing else reaches a where clause. */
export const PWSID_RE = /^[A-Z0-9]{2}[0-9]{7}$/;

/** Step 3: per PWSID, contaminant and above/below the MRL, the count and the highest value, in chunks. */
export function patResultsParams(ids: string[]): Array<Record<string, string>> {
  const clean = [...new Set(ids.filter((id) => PWSID_RE.test(id)))].sort();
  const out: Array<Record<string, string>> = [];
  for (let i = 0; i < clean.length; i += PAT_IN_CHUNK) {
    const chunk = clean.slice(i, i + PAT_IN_CHUNK);
    out.push({
      // Equality on the cycle (not LIKE); IS NOT NULL drops the Hazard Index rows.
      where: `UCMR_Cycle='${UCMR5}' AND F_PWS_ID IN (${chunk.map((id) => `'${id}'`).join(",")}) AND Result_At_or_Above_UCMR_MRL IS NOT NULL`,
      groupByFieldsForStatistics: "F_PWS_ID,PWS_Name,State,Contaminant,Result_At_or_Above_UCMR_MRL,UCMR_Geolocation_Method,Latitude,Longitude,Population_Served",
      outStatistics: JSON.stringify([...COUNT, { statisticType: "max", onStatisticField: "Analytical_Result_Value__ng_L_", outStatisticFieldName: "mx" }]),
      returnGeometry: "false",
    });
  }
  return out;
}

/** The PWSIDs a chunk's where clause asks for. */
export function chunkIds(where: string): string[] {
  return (where.match(/'([A-Z0-9]{9})'/g) ?? []).map((x) => x.slice(1, -1));
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  return null;
}

export type PfasState = "detected" | "not-detected" | "not-in-ucmr5" | "unknown";

export interface PfasResult {
  contaminant: string;
  /** Highest single result at or above the MRL, ng/L; null when no result reached it (or EPA gives no value). */
  maxNgL: number | null;
  /** Results at or above the MRL. */
  detections: number;
  /** All results for this contaminant (at or above, and below). */
  results: number;
}

export interface PatPlace {
  lon: number;
  lat: number;
  /** As EPA words it: 'Estimated Water System Service Area Centroid', 'Centroid of ZIP Code(s) served', ... */
  method: string;
}

export interface PfasSystem {
  pwsid: string;
  name: string | null;
  state: PfasState;
  population: number | null;
  /** Primacy agency or PAT's state, trimmed. */
  stateCode: string | null;
  results: PfasResult[];
  /** EPA's estimated location; null when PAT has none (null coordinates or method). */
  place: PatPlace | null;
  /** The service-area row; null when EPA has no polygon for the system. */
  area: { modelled: boolean | null; provider: string | null; providerType: string | null; type: string | null; popCategory: string | null; echo: string | null; geometry: GeoJSON.Geometry | null } | null;
}

type Fc = Array<{ geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null }>;
type Attrs = Array<Record<string, unknown>>;

function placeOf(a: Record<string, unknown>): PatPlace | null {
  const lon = num(a.Longitude);
  const lat = num(a.Latitude);
  const method = str(a.UCMR_Geolocation_Method);
  if (lon == null || lat == null || !method || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lon === 0 && lat === 0)) return null;
  return { lon, lat, method };
}

function echoLink(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname === "echo.epa.gov" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Systems in the box from the three answers. `results` is null when every results chunk failed;
 * `unknownIds` holds the PWSIDs of chunks that did not answer (or were cut at the cap).
 */
export function buildPfasSystems(cws: Fc | null, centroids: Attrs | null, results: Attrs | null, unknownIds: ReadonlySet<string>): PfasSystem[] {
  const sys = new Map<string, PfasSystem>();
  const get = (id: string): PfasSystem => {
    let s = sys.get(id);
    if (!s) {
      s = { pwsid: id, name: null, state: "unknown", population: null, stateCode: null, results: [], place: null, area: null };
      sys.set(id, s);
    }
    return s;
  };
  for (const f of cws ?? []) {
    const p = f.properties ?? {};
    const id = str(p.PWSID);
    if (!id || !PWSID_RE.test(id)) continue;
    const s = get(id);
    s.name ??= str(p.PWS_Name);
    s.population ??= num(p.Population_Served_Count);
    s.stateCode ??= str(p.Primacy_Agency);
    const sym = str(p.Symbology_Field);
    s.area = {
      modelled: sym === "Modeled" ? true : sym === "System Sourced" ? false : null,
      provider: str(p.Original_Data_Provider),
      providerType: str(p.Data_Provider_Type),
      type: str(p.Service_Area_Type),
      popCategory: str(p.Pop_Cat_5),
      echo: echoLink(p.Detailed_Facility_Report),
      // A system can have more than one polygon row; the first is kept, the count of rows is not a result.
      geometry: s.area?.geometry ?? f.geometry ?? null,
    };
  }
  for (const a of centroids ?? []) {
    const id = str(a.F_PWS_ID);
    if (!id || !PWSID_RE.test(id)) continue;
    const s = get(id);
    s.name ??= str(a.PWS_Name);
    s.population ??= num(a.Population_Served);
    s.stateCode ??= str(a.State);
    s.place ??= placeOf(a);
  }
  const per = new Map<string, Map<string, PfasResult>>();
  for (const a of results ?? []) {
    const id = str(a.F_PWS_ID);
    const c = str(a.Contaminant);
    const yes = str(a.Result_At_or_Above_UCMR_MRL);
    if (!id || !c || !yes || !sys.has(id)) continue;
    const s = sys.get(id)!;
    s.name ??= str(a.PWS_Name);
    s.population ??= num(a.Population_Served);
    s.stateCode ??= str(a.State);
    s.place ??= placeOf(a);
    const m = per.get(id) ?? new Map<string, PfasResult>();
    per.set(id, m);
    const r = m.get(c) ?? { contaminant: c, maxNgL: null, detections: 0, results: 0 };
    m.set(c, r);
    const n = num(a.n) ?? 0;
    r.results += n;
    if (yes === "Yes") {
      r.detections += n;
      const mx = num(a.mx);
      if (mx != null) r.maxNgL = r.maxNgL == null ? mx : Math.max(r.maxNgL, mx);
    }
  }
  for (const s of sys.values()) {
    const m = per.get(s.pwsid);
    if (m) {
      s.results = [...m.values()].sort((a, z) => (z.maxNgL ?? -1) - (a.maxNgL ?? -1) || z.detections - a.detections || a.contaminant.localeCompare(z.contaminant));
      s.state = s.results.some((r) => r.detections > 0) ? "detected" : "not-detected";
    } else {
      s.state = results == null || unknownIds.has(s.pwsid) ? "unknown" : "not-in-ucmr5";
    }
  }
  return [...sys.values()].sort((a, z) => (z.population ?? -1) - (a.population ?? -1) || a.pwsid.localeCompare(z.pwsid));
}

/** The legend's bins for a system's highest single result, ng/L. Measured values, not a risk scale. */
export const PFAS_BINS: ReadonlyArray<{ from: number; label: string }> = [
  { from: 0, label: "under 5 ng/L" },
  { from: 5, label: "5 to 10 ng/L" },
  { from: 10, label: "10 to 20 ng/L" },
  { from: 20, label: "20 ng/L or more" },
];

export function pfasBin(maxNgL: number | null): number | null {
  if (maxNgL == null) return null;
  let k = 0;
  PFAS_BINS.forEach((b, i) => {
    if (maxNgL >= b.from) k = i;
  });
  return k;
}

/** The system's highest single result across contaminants (ng/L), or null. */
export function highest(s: PfasSystem): number | null {
  let m: number | null = null;
  for (const r of s.results) if (r.maxNgL != null) m = m == null ? r.maxNgL : Math.max(m, r.maxNgL);
  return m;
}

const STATE_TEXT: Record<PfasState, string> = {
  detected: "PFAS at or above UCMR 5's reporting level",
  "not-detected": "no PFAS at or above the reporting level in UCMR 5",
  "not-in-ucmr5": "this system was not in UCMR 5 (no UCMR 5 results; systems serving under 3,300 people were sampled only as a representative 800)",
  unknown: "unknown: EPA's results did not answer this time",
};

export interface PfasExtra {
  state: PfasState;
  pwsid: string;
  /** Highest single result across contaminants, ng/L. */
  maxNgL: number | null;
  /** The boundary is EPA's model, not the system's or state's; null when not said or no boundary. */
  modelled: boolean | null;
  placement: "service-area" | "estimated-location";
  results: PfasResult[];
}

export interface NotDrawn {
  pwsid: string;
  state: PfasState;
  why: string;
}

/**
 * Systems as features. With polygons, a system with a service area is drawn on it; any system
 * placed by EPA's estimated location only is a point the layer draws as a ring. Without polygons,
 * every system with an estimated location is such a point. The rest are listed, never guessed.
 */
export function pfasFeatures(systems: PfasSystem[], polygons: boolean): { features: LayerFeature[]; notDrawn: NotDrawn[] } {
  const features: LayerFeature[] = [];
  const notDrawn: NotDrawn[] = [];
  for (const s of systems) {
    const poly = polygons && s.area?.geometry && (s.area.geometry.type === "Polygon" || s.area.geometry.type === "MultiPolygon") ? s.area.geometry : null;
    const geometry: GeoJSON.Geometry | null = poly ?? (s.place ? { type: "Point", coordinates: [s.place.lon, s.place.lat] } : null);
    if (!geometry) {
      notDrawn.push({
        pwsid: s.pwsid,
        state: s.state,
        why: s.area ? (polygons ? "its service-area polygon has no drawable geometry" : "EPA gives it no estimated location; its service area is drawn below 10 km") : "neither a service-area polygon nor an estimated location",
      });
      continue;
    }
    const placement: PfasExtra["placement"] = poly ? "service-area" : "estimated-location";
    const x: PfasExtra = { state: s.state, pwsid: s.pwsid, maxNgL: highest(s), modelled: s.area?.modelled ?? null, placement, results: s.results };
    const details: Record<string, string | number | null | undefined> = {
      "water system (as EPA lists it)": s.name,
      pwsid: s.pwsid,
      "population served": s.population,
      state: s.stateCode,
      "UCMR 5": STATE_TEXT[s.state],
    };
    for (const r of s.results) {
      details[`${r.contaminant} (ng/L)`] =
        r.detections > 0
          ? `highest ${r.maxNgL ?? "value not given"}; ${r.detections} of ${r.results} results at or above the reporting level`
          : `below the reporting level in all ${r.results} results`;
    }
    details["service area"] = !s.area
      ? "EPA has no service-area boundary for this system"
      : s.area.modelled
        ? `boundary modelled by EPA${s.area.provider ? ` (${s.area.provider})` : ""}`
        : s.area.modelled === false
          ? `boundary from the system or state${s.area.provider ? ` (${s.area.provider})` : ""}`
          : `boundary source not said${s.area.provider ? ` (${s.area.provider})` : ""}`;
    details["service area type"] = s.area?.type ?? undefined;
    details.drawn = poly ? "on the system's service area" : `as a ring at EPA's estimated location: ${s.place!.method}`;
    details["ECHO detailed facility report"] = s.area?.echo ?? undefined;
    details["what this is"] = "UCMR 5 samples where treated water enters the distribution system, 2023-2025; not a tap, and not compared with any health limit";
    features.push({
      type: "Feature",
      geometry,
      properties: {
        id: `pfas:${s.pwsid}`,
        layer: "pfas",
        name: `PWS ${s.pwsid}`,
        kind: s.state,
        source: "EPA UCMR 5 (PFAS Analytic Tools)",
        details,
        extra: x,
      },
    });
  }
  return { features, notDrawn };
}
