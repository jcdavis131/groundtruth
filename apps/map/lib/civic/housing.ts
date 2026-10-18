// HUD's Housing Choice Vouchers by census tract and its LIHTC Qualified Census
// Tracts, from HUD's eGIS organisation on ArcGIS Online (CORS *). Pure: the
// layers, the field allow-lists, the query builders, the fixed breaks, the
// tract features, the click lines and the place answer. The route is
// /api/civic?op=housing.
//
//   bbox    both layers' own 2020 tract polygons in a box of at most 0.3
//           degrees (snapped to 0.05), one page of 2,000 each, below 100 km
//   place   one tract (11-digit GEOID): its voucher row and QCT membership
//
// Suppression: HUD omits the count for "tracts containing 10 or fewer voucher
// holders" (the layer's description), so HCV_PUBLIC is null in 47,463 of
// 85,154 tracts and never 0. A null tract is drawn grey with a dashed edge and
// the legend line "10 or fewer vouchers, or none (HUD suppresses)": never a
// colour from the scale, never bin 0. Connecticut is different: every one of
// its 881 tracts is null (2026-10-17), which is not a small-count rule, so a
// Connecticut tract is "not published for Connecticut", dashed and unfilled.
//
// The share is HUD's: voucher households over renter-occupied units in the
// 2020 Census (DHC H4), as HUD states it. Field lists are named, never `*`:
// HUD's LIHTC property layer carries contacts and this op must never become
// the path to it.

import type { MultiPolygon, Polygon } from "geojson";
import type { LayerFeature } from "@/lib/layers/types";
import type { Bbox } from "./bbox";

export const HUD_ORG = "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services";
/** "Housing_Choice_Vouchers_by_Tract" (85,154 tracts on 2026-10-17). */
export const HCV_LAYER = `${HUD_ORG}/Housing_Choice_Vouchers_by_Tract/FeatureServer/0`;
/** "QUALIFIED_CENSUS_TRACTS_2026" (14,496 tracts on 2026-10-17). */
export const QCT_LAYER = `${HUD_ORG}/QUALIFIED_CENSUS_TRACTS_2026/FeatureServer/0`;
/** The two layers' maxRecordCount. */
export const HOUSING_PAGE = 2000;
/** Below this camera height the layer loads. */
export const HOUSING_MAX_M = 100_000;
/** The largest box, degrees a side (Manhattan's 0.3-degree box: 1,926 voucher tracts, 640 kB, on 2026-10-17). */
export const HOUSING_BOX_DEG = 0.3;
export const HOUSING_GRID = 0.05;

/** The only fields asked of each layer. */
export const HCV_FIELDS = ["GEOID", "HCV_PUBLIC", "HCV_PUBLIC_PCT"] as const;
export const QCT_FIELDS = ["GEOID"] as const;

/** The ArcGIS query parameters for a box (named fields, never *). */
export function housingBoxParams(b: Bbox, fields: readonly string[]): Record<string, string> {
  const [w, s, e, n] = b;
  return {
    where: "1=1",
    geometry: JSON.stringify({ xmin: w, ymin: s, xmax: e, ymax: n }),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outSR: "4326",
    outFields: fields.join(","),
    returnGeometry: "true",
    maxAllowableOffset: "0.0005",
    geometryPrecision: "5",
    resultRecordCount: String(HOUSING_PAGE),
  };
}

/** The ArcGIS query parameters for one tract (attributes only). */
export function housingPlaceParams(geoid: string, fields: readonly string[]): Record<string, string> {
  if (!/^\d{11}$/.test(geoid)) throw new Error(`housingPlaceParams: expected an 11-digit tract GEOID, got ${JSON.stringify(geoid)}`);
  return { where: `GEOID='${geoid}'`, outFields: fields.join(","), returnGeometry: "false" };
}

/** The two measures the layer can colour by (permalink hv=). */
export const HOUSING_MEASURES = [
  { id: "share", name: "Share of renter units (HUD)", unit: "%" },
  { id: "count", name: "Voucher households", unit: "households" },
] as const;
export type HousingMeasure = 0 | 1;

export function parseHousingMeasure(v: unknown): HousingMeasure {
  return v === 1 || v === "1" ? 1 : 0;
}

/** Fixed breaks (this plan's choice, recorded on the card): shares in percent, counts from HUD's published minimum of 11. */
export const HOUSING_SHARE_BREAKS = [2, 5, 10, 20, 40] as const;
export const HOUSING_SHARE_LABELS = ["under 2 %", "2 to 5 %", "5 to 10 %", "10 to 20 %", "20 to 40 %", "40 % or more"] as const;
export const HOUSING_COUNT_BREAKS = [25, 50, 100, 250, 500] as const;
export const HOUSING_COUNT_LABELS = ["11 to 24", "25 to 49", "50 to 99", "100 to 249", "250 to 499", "500 or more"] as const;
/** Pale to deep teal; no grey, so a suppressed tract can never read as a bin. */
export const HOUSING_BIN_COLORS = ["#F0FDFA", "#CCFBF1", "#5EEAD4", "#14B8A6", "#0F766E", "#134E4A"] as const;
export const HOUSING_SUPPRESSED_FILL = "#9CA3AF";
export const HOUSING_NO_DATA_EDGE = "#9CA3AF";
export const QCT_EDGE = "#F59E0B";
export const SUPPRESSED_LEGEND = "10 or fewer vouchers, or none (HUD suppresses)";
export const CT_NOT_PUBLISHED = "not published for Connecticut: HUD's layer has no voucher count for any of its 881 Connecticut tracts (2026-10-17)";

export function housingBreaks(m: HousingMeasure): readonly number[] {
  return m === 1 ? HOUSING_COUNT_BREAKS : HOUSING_SHARE_BREAKS;
}
export function housingBinLabels(m: HousingMeasure): readonly string[] {
  return m === 1 ? HOUSING_COUNT_LABELS : HOUSING_SHARE_LABELS;
}

export const HOUSING_CAVEAT =
  "Housing Choice Voucher households per 2020 census tract as HUD aggregates them, through December 2025. HUD omits tracts with 10 or fewer voucher holders, so a grey tract may have a few vouchers or none. The share is HUD's: vouchers over renter-occupied units in the 2020 Census. Qualified Census Tracts are a tax-credit designation, not a measure of conditions. HUD titles this list 2026, but its descriptions also say 2025 and 2024.";
export const HCV_SUPPRESSION_QUOTE = "tracts containing 10 or fewer voucher holders have been omitted from this service";
export const HCV_DENOMINATOR_QUOTE = "HCV_PUBLIC_PCT are calculated using 2020 Census Demographic and Housing Characteristics File (DHC) table H4 Tenure Renter Occupied field";
export const QCT_YEAR_NOTE =
  "HUD's QCT year is stated three ways: the service and its item description say 2026 (QUALIFIED_CENSUS_TRACTS_2026), the item snippet says 2025, and the layer description says 'for 2024' (Date Updated: 10/2023). huduser.gov answered a keyless request with a WAF challenge (2026-10-17), so it is labelled 'titled 2026 by HUD'.";
export const CT_HOUSING_NOTE =
  "Connecticut: HUD's voucher layer has all 881 Connecticut tracts (filed under the old county codes 09001-09015) and a count for none of them, so Connecticut is 'not published', never 'suppressed'. HUD's QCT 2026 list files Connecticut under the planning regions (09110-09190). Each layer draws its own tracts; nothing is joined to a county.";
export const HOUSING_ATTRIBUTION = "U.S. Department of Housing and Urban Development (HUD eGIS), with the U.S. Census Bureau: Housing Choice Vouchers by Tract (through 12/2025) and Qualified Census Tracts (titled 2026)";
export const HOUSING_SOURCE_LABEL = "HUD Housing Choice Vouchers by Tract; HUD QCT (titled 2026)";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** A published count or percentage: a finite number, 0 or more; anything else is null. */
const pub = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

export interface HcvRow {
  geoid: string;
  /** Voucher households as HUD publishes them; null: suppressed (10 or fewer, or none) or, in Connecticut, not published. */
  vouchers: number | null;
  /** HUD's share of renter-occupied units, percent, rounded to HUD's one decimal. */
  share: number | null;
}

/** One HCV attribute row (only the allow-listed fields are read). */
export function hcvRow(a: Readonly<Record<string, unknown>>): HcvRow | null {
  const geoid = str(a.GEOID);
  if (!geoid || !/^\d{11}$/.test(geoid)) return null;
  const pct = pub(a.HCV_PUBLIC_PCT);
  return { geoid, vouchers: pub(a.HCV_PUBLIC), share: pct == null ? null : Math.round(pct * 10) / 10 };
}

export const isCtTract = (geoid: string) => geoid.startsWith("09");
/** A Connecticut tract GEOID in a legacy county (09001-09015), the code HUD files vouchers under; the QCT list uses planning-region codes (091x0). */
export const isCtLegacyTract = (geoid: string) => /^090(0[1-9]|1[0-5])\d{6}$/.test(geoid);

export type HousingStatus = "published" | "suppressed" | "not-published-ct";
export function hcvStatus(r: HcvRow): HousingStatus {
  if (r.vouchers != null) return "published";
  return isCtTract(r.geoid) ? "not-published-ct" : "suppressed";
}

export function housingValue(r: HcvRow, m: HousingMeasure): number | null {
  return m === 1 ? r.vouchers : r.vouchers == null ? null : r.share;
}

export function housingBin(v: number | null, m: HousingMeasure): number | null {
  if (v == null) return null;
  const br = housingBreaks(m);
  let b = 0;
  while (b < br.length && v >= br[b]) b++;
  return b;
}

/** The click lines for a voucher tract. The GEOID is shown as HUD publishes it; no county name is looked up. */
export function hcvDetails(r: HcvRow, inQct: boolean | null): Record<string, string> {
  const st = hcvStatus(r);
  const d: Record<string, string> = {};
  d["census tract (2020, as HUD publishes it)"] = r.geoid;
  if (st === "published") {
    d["voucher households"] = r.vouchers!.toLocaleString("en-US");
    d["share of renter units"] = r.share == null ? "not published" : `${r.share.toFixed(1)} % (as HUD calculates it: 2020 Census renter-occupied units)`;
  } else if (st === "suppressed") {
    d["voucher households"] = "suppressed: 10 or fewer, or none";
  } else {
    d["voucher households"] = CT_NOT_PUBLISHED;
  }
  d["qualified census tract"] = inQct == null ? "not known here (outside the loaded QCT box)" : inQct ? "yes, in HUD's 2026-titled QCT list" : "no, not in HUD's 2026-titled QCT list";
  if (isCtTract(r.geoid)) d.connecticut = "HUD files these vouchers under Connecticut's old counties";
  d.source = "HUD Housing Choice Vouchers by Tract (through 12/2025)";
  return d;
}

export interface HousingExtra {
  kind: "hcv" | "qct";
  geoid: string;
  row: HcvRow | null;
  status: HousingStatus | null;
  measure: HousingMeasure;
  value: number | null;
  bin: number | null;
}

type Raw = { geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> | null };
const isPoly = (g: GeoJSON.Geometry | null): g is Polygon | MultiPolygon => !!g && (g.type === "Polygon" || g.type === "MultiPolygon");

function hcvFeature(g: Polygon | MultiPolygon, r: HcvRow, m: HousingMeasure, inQct: boolean | null): LayerFeature<Polygon | MultiPolygon> {
  const status = hcvStatus(r);
  const value = status === "published" ? housingValue(r, m) : null;
  const bin = housingBin(value, m);
  const extra: HousingExtra = { kind: "hcv", geoid: r.geoid, row: r, status, measure: m, value, bin };
  return {
    type: "Feature",
    geometry: g,
    properties: {
      id: `housing:hcv:${r.geoid}`,
      layer: "housing",
      name: `Tract ${r.geoid}`,
      kind: bin != null ? `b${bin + 1}` : status,
      source: HOUSING_SOURCE_LABEL,
      details: hcvDetails(r, inQct),
      extra,
    },
  };
}

function qctFeature(g: Polygon | MultiPolygon, geoid: string, m: HousingMeasure): LayerFeature<Polygon | MultiPolygon> {
  const extra: HousingExtra = { kind: "qct", geoid, row: null, status: null, measure: m, value: null, bin: null };
  return {
    type: "Feature",
    geometry: g,
    properties: {
      id: `housing:qct:${geoid}`,
      layer: "housing",
      name: `QCT ${geoid}`,
      kind: "qct",
      source: "HUD Qualified Census Tracts (titled 2026)",
      details: {
        "census tract (as HUD publishes it)": geoid,
        "qualified census tract": "yes, in HUD's 2026-titled QCT list",
        "what this is": "a LIHTC tax-credit designation (50 % of households under 60 % of area median income, or a 25 % poverty rate), not a measure of conditions",
        ...(isCtTract(geoid) ? { connecticut: "HUD's QCT list files Connecticut under its planning regions" } : {}),
        source: "HUD Qualified Census Tracts (titled 2026)",
      },
      extra,
    },
  };
}

/**
 * Voucher tracts and QCT outlines from the two answers. Only the allow-listed fields are read from
 * either; a tract that comes back twice is drawn once. QCT outlines come after the tracts so they
 * draw on top.
 */
export function buildHousing(hcv: readonly Raw[], qct: readonly Raw[], m: HousingMeasure): { features: LayerFeature<Polygon | MultiPolygon>[]; published: number; suppressed: number; ctNotPublished: number; qct: number } {
  const qctIds = new Set<string>();
  const qctFeatures: LayerFeature<Polygon | MultiPolygon>[] = [];
  for (const f of qct) {
    const id = str(f.properties?.GEOID);
    if (!id || !/^\d{11}$/.test(id) || qctIds.has(id) || !isPoly(f.geometry)) continue;
    qctIds.add(id);
    qctFeatures.push(qctFeature(f.geometry, id, m));
  }
  const out: LayerFeature<Polygon | MultiPolygon>[] = [];
  const seen = new Set<string>();
  let published = 0;
  let suppressed = 0;
  let ctNotPublished = 0;
  for (const f of hcv) {
    if (!isPoly(f.geometry)) continue;
    const r = hcvRow({ GEOID: f.properties?.GEOID, HCV_PUBLIC: f.properties?.HCV_PUBLIC, HCV_PUBLIC_PCT: f.properties?.HCV_PUBLIC_PCT });
    if (!r || seen.has(r.geoid)) continue;
    seen.add(r.geoid);
    const st = hcvStatus(r);
    if (st === "published") published++;
    else if (st === "suppressed") suppressed++;
    else ctNotPublished++;
    // A QCT list in another tract regime (Connecticut) is not matched to a voucher tract: membership is unknown there.
    out.push(hcvFeature(f.geometry, r, m, isCtTract(r.geoid) ? null : qctIds.has(r.geoid)));
  }
  return { features: [...out, ...qctFeatures], published, suppressed, ctNotPublished, qct: qctFeatures.length };
}

/** Re-colour features already built for the other measure (no network). */
export function remeasureHousing(features: ReadonlyArray<LayerFeature>, m: HousingMeasure): LayerFeature[] {
  return features.map((f) => {
    const x = f.properties.extra as HousingExtra | undefined;
    if (!x || x.measure === m) return f;
    if (x.kind === "qct" || !x.row) return { ...f, properties: { ...f.properties, extra: { ...x, measure: m } } };
    const value = x.status === "published" ? housingValue(x.row, m) : null;
    const bin = housingBin(value, m);
    return { ...f, properties: { ...f.properties, kind: bin != null ? `b${bin + 1}` : (x.status ?? "suppressed"), extra: { ...x, measure: m, value, bin } } };
  });
}

/** Only the allow-listed properties of an answer's features, so nothing else can reach the browser. */
export function pickFields(features: readonly Raw[], fields: readonly string[]): Array<{ type: "Feature"; geometry: GeoJSON.Geometry | null; properties: Record<string, unknown> }> {
  return features.map((f) => ({ type: "Feature" as const, geometry: f.geometry, properties: Object.fromEntries(fields.map((k) => [k, f.properties?.[k] ?? null])) }));
}

export interface HousingPlace {
  geoid: string;
  vouchers: number | null;
  share: number | null;
  status: HousingStatus | "not-in-layer";
  /** In HUD's QCT list; null (unknown) for a Connecticut legacy-county GEOID, which that list never uses. */
  qct: boolean | null;
}

/**
 * One tract's answer: its voucher row (or none) and whether it is in the QCT list. HUD's QCT list
 * files Connecticut under planning-region codes, so a legacy-county GEOID (every Connecticut voucher
 * tract) can never match it: qct is null, unknown, not false.
 */
export function housingPlace(geoid: string, hcvRows: ReadonlyArray<Record<string, unknown>>, qctRows: ReadonlyArray<Record<string, unknown>>): HousingPlace {
  const r = hcvRows.map((a) => hcvRow(a)).find((x): x is HcvRow => x != null && x.geoid === geoid) ?? null;
  const qct = isCtLegacyTract(geoid) ? null : qctRows.some((a) => str(a.GEOID) === geoid);
  return { geoid, vouchers: r?.vouchers ?? null, share: r?.vouchers == null ? null : (r?.share ?? null), status: r ? hcvStatus(r) : "not-in-layer", qct };
}
