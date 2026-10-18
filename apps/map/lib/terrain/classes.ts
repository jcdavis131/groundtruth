// Class tables for the picture layers whose services return only a code, and
// the parsers for their point answers. Pure; tested against payloads captured
// from each service (lib/terrain/fixtures).
//
//   WHP 2023   the ImageServer's identify returns the class code only and its
//              rasterAttributeTable is empty; the labels and swatches are the
//              service's own /legend, in code order 1..7 (verified: a pixel in
//              Canyon Lake answers 7 "Water", downtown San Antonio 6
//              "Non-burnable")
//   NLCD 2021  GetFeatureInfo returns PALETTE_INDEX, which is the NLCD class
//              code; the labels and colours are MRLC's own GetLegendGraphic
//   3DEP       identify with the "Slope Degrees" raster function returns the
//              slope as the service computes it, a whole number of degrees

export interface ClassEntry {
  code: number;
  label: string;
  color: string;
}

/** USFS Wildfire Hazard Potential 2023, classified (WHP_CLS_2023_8bit), as its /legend lists it. */
export const WHP_CLASSES: ClassEntry[] = [
  { code: 1, label: "Very Low", color: "#38A300" },
  { code: 2, label: "Low", color: "#A3FF94" },
  { code: 3, label: "Moderate", color: "#FFFF63" },
  { code: 4, label: "High", color: "#FFA300" },
  { code: 5, label: "Very High", color: "#ED1E00" },
  { code: 6, label: "Non-burnable", color: "#E1E1E1" },
  { code: 7, label: "Water", color: "#0070E1" },
];

/** NLCD 2021 land cover classes, as MRLC's GetLegendGraphic for NLCD_2021_Land_Cover_L48 lists them. */
export const NLCD_CLASSES: ClassEntry[] = [
  { code: 11, label: "Open Water", color: "#476BA0" },
  { code: 12, label: "Perennial Ice/Snow", color: "#D1DDF9" },
  { code: 21, label: "Developed, Open Space", color: "#DDC9C9" },
  { code: 22, label: "Developed, Low Intensity", color: "#D89382" },
  { code: 23, label: "Developed, Medium Intensity", color: "#ED0000" },
  { code: 24, label: "Developed, High Intensity", color: "#AA0000" },
  { code: 31, label: "Barren Land (Rock/Sand/Clay)", color: "#B2ADA3" },
  { code: 32, label: "Unconsolidated Shore", color: "#F9F9F9" },
  { code: 41, label: "Deciduous Forest", color: "#68AA63" },
  { code: 42, label: "Evergreen Forest", color: "#1C6330" },
  { code: 43, label: "Mixed Forest", color: "#B5C98E" },
  { code: 51, label: "Dwarf Scrub (AK only)", color: "#B0973D" },
  { code: 52, label: "Shrub/Scrub", color: "#CCBA7C" },
  { code: 71, label: "Grasslands/Herbaceous", color: "#E2E2C1" },
  { code: 72, label: "Sedge/Herbaceous (AK only)", color: "#D1D182" },
  { code: 73, label: "Lichens (AK only)", color: "#99C246" },
  { code: 74, label: "Moss (AK only)", color: "#82BA9E" },
  { code: 81, label: "Pasture/Hay", color: "#DBD83D" },
  { code: 82, label: "Cultivated Crops", color: "#AA7028" },
  { code: 90, label: "Woody Wetlands", color: "#BAD8EA" },
  { code: 95, label: "Emergent Herbaceous Wetlands", color: "#70A3BA" },
];

/**
 * USFWS NWI national wetlands raster (Wetlands_Raster; Wetlands_Raster_v5 retired by 2026-10-18), eight wetland types, as the
 * ImageServer's own rasterAttributeTable lists them (value, WETLAND_TYPE, Red/Green/Blue).
 * Pixel value 0 is not a class: the tiles ask for it as NoData, so it draws clear.
 */
export const NWI_RASTER_CLASSES: ClassEntry[] = [
  { code: 1, label: "Estuarine and Marine Deepwater", color: "#007C88" },
  { code: 2, label: "Estuarine and Marine Wetland", color: "#66C2A5" },
  { code: 3, label: "Freshwater Emergent Wetland", color: "#7FC31C" },
  { code: 4, label: "Freshwater Forested/Shrub Wetland", color: "#008837" },
  { code: 5, label: "Freshwater Pond", color: "#688CC0" },
  { code: 6, label: "Lake", color: "#13007C" },
  { code: 7, label: "Other", color: "#B28656" },
  { code: 8, label: "Riverine", color: "#0190BF" },
];

/** NOAA OCM sea level rise tiles, as the slr_Nft MapServer /legend lists them. */
export const SLR_LEGEND: Array<{ label: string; color: string; meaning: string }> = [
  { label: "Low-lying Areas", color: "#55FF00", meaning: "NOAA's \"Low-lying Areas\" layer" },
  { label: "Depth (High - Low)", color: "#4895E5", meaning: "NOAA's depth layer: water depth at the scenario level, darker is deeper; water that is there today (bays, the Gulf) is drawn in it too" },
];

export interface ClassAnswer {
  code: number;
  label: string;
  color: string;
}

/** A class code as the service sent it -> its entry; null when the code is missing, not a whole number, or not in the table. */
export function classFor(table: ClassEntry[], raw: unknown): ClassAnswer | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^-?\d+$/.test(s)) return null;
  const code = Number(s);
  const e = table.find((c) => c.code === code);
  return e ? { code: e.code, label: e.label, color: e.color } : null;
}

/** ArcGIS ImageServer identify: `value` is a string ("6"), "NoData" off the raster. */
interface IdentifyJson {
  value?: unknown;
  error?: { code?: number; message?: string };
}

/** The WHP class at a point, or null (off the raster, NoData, or a code the legend does not list). */
export function parseWhpIdentify(j: IdentifyJson): ClassAnswer | null {
  return classFor(WHP_CLASSES, j?.value);
}

/** Slope in whole degrees from 3DEP's "Slope Degrees" identify; null for NoData or anything not a number. */
export function parseSlopeIdentify(j: IdentifyJson): number | null {
  const v = j?.value;
  if (v == null) return null;
  const s = String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 90 ? n : null;
}

/** MRLC GetFeatureInfo (application/json): PALETTE_INDEX of the first feature is the NLCD class code. */
export function parseNlcdFeatureInfo(j: { features?: Array<{ properties?: { PALETTE_INDEX?: unknown } }> }): ClassAnswer | null {
  const raw = j?.features?.[0]?.properties?.PALETTE_INDEX;
  return classFor(NLCD_CLASSES, raw);
}
