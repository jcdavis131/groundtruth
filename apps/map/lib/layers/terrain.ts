// Layers: terrain, soils, land cover and the long-range hazard pictures.
//
// These are picture layers: each is tiled imagery its publisher renders
// (lib/terrain/products.ts has every source, lib/globe/terrainStyles.ts how
// each is drawn), so fetch() makes no request of its own. It reports whether
// the camera is inside the layer's height band and what the picture is and is
// not, and passes the scenario the style draws (the sea level rise feet).
// A click on the ground while any of them is on opens a "ground here" dossier
// with the value under the click (lib/terrain/ground.ts).
//
//   relief      USGS Shaded Relief tile cache (3DEP, GMTED2010), levels 0–13
//   slope       USGS 3DEP "Slope Map", rendered through /api/terrain
//   contours    USGS 3DEP 2 ft contours, rendered through /api/terrain, below 4 km
//   soils       NRCS SSURGO map units (Soil Data Mart WMS), below 40 km;
//               the click answer adds the farmland class and NCCPI (/api/soil)
//   firehazard  USFS Wildfire Hazard Potential 2023, classes 1–7
//   landslidesusc  USGS slope-relief landslide susceptibility (2024), classes 1–5 as the
//               tile service draws them; the click answer is the county's share (/api/hazards)
//   landcover   NLCD 2021 land cover, rendered through /api/terrain
//   sealevel    NOAA sea level rise inundation, 1 to 10 ft above MHHW
//   geology     Macrostrat's geologic map; the click answer is the map unit (/api/infra)
//   crithab     USFWS critical habitat, final and proposed; the click answer is the
//               designations containing the point (/api/land?op=crithab)

import type { FetchContext, FetchResult, LayerDefinition, LayerId, ViewState } from "./types";
import { LANDSLIDE_SUSC_CAVEAT, LANDSLIDE_SUSC_LEGEND, SLR_CAVEAT, SLR_DEFAULT_FT, SOIL_CAVEAT, WHP_CAVEAT, isSlrFeet } from "@/lib/terrain/products";

/** Camera-height bands (metres): above them the layer's picture is hidden and its note says why. */
export const SLOPE_MAX_HEIGHT_M = 250_000;
export const CONTOURS_MAX_HEIGHT_M = 4_000;
export const SOILS_MAX_HEIGHT_M = 40_000;
export const LANDCOVER_MAX_HEIGHT_M = 2_500_000;
export const SEALEVEL_MAX_HEIGHT_M = 1_500_000;

/** The conterminous United States, for pictures that stop at its edge (WHP, NLCD L48). */
export const CONUS: [number, number, number, number] = [-125.5, 24, -66, 49.8];

interface PictureOptions {
  id: LayerId;
  label: string;
  description: string;
  color: string;
  attribution: string;
  source: string;
  /** Hidden above this camera height (metres). */
  maxHeight?: number;
  /** Note while the picture is drawn. */
  note: string;
  estimate?: string;
  /** Extra meta for the style (the scenario it draws). */
  meta?: (ctx: FetchContext) => Record<string, unknown>;
  /** Note while drawn, when it depends on the meta. */
  noteFor?: (meta: Record<string, unknown>) => string;
}

function km(m: number): string {
  return m >= 1000 ? `${(m / 1000).toLocaleString("en-US")} km` : `${m} m`;
}

/** Height-band view key: a picture layer refetches (no network) only when the camera crosses its band. */
export function bandKey(max: number | undefined) {
  return (v: ViewState) => (max != null && v.height > max ? "above" : "in");
}

export function picture(o: PictureOptions): LayerDefinition {
  return {
    id: o.id,
    label: o.label,
    description: o.description,
    color: o.color,
    updateIntervalMs: 6 * 60 * 60_000,
    defaultEnabled: false,
    viewDependent: o.maxHeight != null,
    viewKey: bandKey(o.maxHeight),
    estimate: o.estimate,
    attribution: o.attribution,
    async fetch(ctx: FetchContext): Promise<FetchResult> {
      const meta: Record<string, unknown> = { picture: true, count: 0, ...(o.meta?.(ctx) ?? {}) };
      const above = o.maxHeight != null && ctx.view.height > o.maxHeight;
      return {
        collection: { type: "FeatureCollection", features: [] },
        source: o.source,
        fetchedAt: ctx.now,
        note: above ? `descend below ${km(o.maxHeight!)} for this picture` : (o.noteFor?.(meta) ?? o.note),
        meta,
      };
    },
  };
}

export const reliefLayer = picture({
  id: "relief",
  label: "Shaded relief",
  description:
    "USGS Shaded Relief from The National Map: hillshade of the 3DEP elevation program (GMTED2010 at small scales), cached to level 13. Click the ground for its elevation.",
  color: "#C9CED6",
  attribution: "USGS The National Map: 3D Elevation Program; USGS EROS: GMTED2010",
  source: "USGS The National Map, Shaded Relief",
  note: "USGS hillshade, cached to level 13 (about 17 m a pixel at 30° N), magnified closer in · click the ground for its elevation",
});

export const slopeLayer = picture({
  id: "slope",
  label: "Slope (3DEP)",
  description:
    "Slope rendered by USGS from the 3DEP bare-earth DEM (1 m lidar where flown), below 250 km. Click the ground for the slope there in degrees.",
  color: "#F2C14E",
  attribution: "USGS 3D Elevation Program (3DEP) dynamic elevation service",
  source: "USGS 3DEP Slope Map",
  maxHeight: SLOPE_MAX_HEIGHT_M,
  note: "USGS 3DEP \"Slope Map\" render in USGS's colours (yellow to red is steeper) · click the ground for the slope in degrees",
});

export const contoursLayer = picture({
  id: "contours",
  label: "Contours 2 ft (3DEP)",
  description:
    "Two-foot contour lines drawn by USGS from the 3DEP bare-earth DEM, below 4 km. Unlabelled; click the ground for its elevation and the DEM's resolution there.",
  color: "#E8D9A0",
  attribution: "USGS 3D Elevation Program (3DEP) dynamic elevation service",
  source: "USGS 3DEP Preset 2ft Contour Interval",
  maxHeight: CONTOURS_MAX_HEIGHT_M,
  note: "2 ft contours from the 3DEP DEM, unlabelled · click the ground for the elevation and the source DEM resolution (a 10 m DEM holds less than a 2 ft interval shows)",
});

export const soilsLayer = picture({
  id: "soils",
  label: "Soils (SSURGO)",
  description:
    "NRCS SSURGO soil map units below 40 km, outlined with their map symbols. Click the ground for the map unit, its NRCS farmland classification and the NCCPI crop productivity index of its main soil.",
  color: "#C98B4E",
  attribution: "USDA NRCS Soil Survey Geographic Database (SSURGO), Soil Data Access",
  source: "NRCS SSURGO (Soil Data Mart WMS)",
  maxHeight: SOILS_MAX_HEIGHT_M,
  note: `SSURGO map units · click the ground for the soil, farmland class and NCCPI · ${SOIL_CAVEAT}`,
});

export const firehazardLayer = picture({
  id: "firehazard",
  label: "Wildfire hazard potential",
  description:
    "USFS Wildfire Hazard Potential 2023 in its classes (very low to very high, non-burnable, water), 270 m, conterminous US. An index for long-term fuels planning, not a map of risk and not a forecast.",
  color: "#FF7A3D",
  attribution: "USDA Forest Service, Fire Modeling Institute: Wildfire Hazard Potential 2023 (Dillon)",
  source: "USFS Wildfire Hazard Potential 2023",
  estimate: WHP_CAVEAT,
  note: "USFS WHP 2023 classes, 270 m, landscape as of 2020 · not a map of risk, not a forecast · click the ground for the class",
});

export const landslidesuscLayer = picture({
  id: "landslidesusc",
  label: "Landslide susceptibility (USGS)",
  description:
    "USGS's 2024 slope-relief threshold model of where terrain is steep and high enough for landslides, at 90 m, for the 50 states and Puerto Rico, in the tile service's classes 1-5 (higher means more of each 90 m cell is susceptible terrain). Susceptible terrain, not a forecast, not a hazard rating and not a record of landslides. Click the ground for the county's share of susceptible terrain.",
  color: "#A16207",
  attribution: "U.S. Geological Survey: Belair and others (2024), Slope-Relief Threshold Landslide Susceptibility Models for the United States and Puerto Rico, doi:10.5066/P13KAGU3 (CC0 1.0); tiles from USGS's ArcGIS Online service",
  source: "USGS landslide susceptibility (2024)",
  estimate: LANDSLIDE_SUSC_CAVEAT,
  note: `${LANDSLIDE_SUSC_LEGEND} · cached to level 12 · terrain, not a forecast · click the ground for the county's share`,
});

export const landcoverLayer = picture({
  id: "landcover",
  label: "Land cover (NLCD 2021)",
  description:
    "NLCD 2021 land cover classes at 30 m for the conterminous US (water, developed, forest, shrub, grass, crops, wetlands…), rendered by MRLC. Click the ground for the class.",
  color: "#7FB77E",
  attribution: "MRLC / USGS National Land Cover Database 2021",
  source: "MRLC NLCD 2021",
  maxHeight: LANDCOVER_MAX_HEIGHT_M,
  note: "NLCD 2021 classes, 30 m, conterminous US · a class is what the pixel looked like to the classifier, not a land use · click the ground for it",
});

/** The scenario from settings, only ever one NOAA publishes a cache for. */
export function seaLevelFeet(options: Record<string, unknown>): number {
  const v = options.seaLevelFt;
  return isSlrFeet(v) ? v : SLR_DEFAULT_FT;
}

export const sealevelLayer = picture({
  id: "sealevel",
  label: "Sea level rise",
  description:
    "NOAA's sea level rise inundation scenarios, 1 to 10 ft above today's Mean Higher High Water, with low-lying areas. A screening-level scenario, not a forecast of when or exactly where.",
  color: "#4895E5",
  attribution: "NOAA Office for Coastal Management, Sea Level Rise Viewer data",
  source: "NOAA OCM sea level rise",
  maxHeight: SEALEVEL_MAX_HEIGHT_M,
  estimate: SLR_CAVEAT,
  meta: (ctx) => ({ seaLevelFt: seaLevelFeet(ctx.options) }),
  note: "",
  noteFor: (m) =>
    `${m.seaLevelFt} ft above MHHW · blue: water depth at that level (darker deeper), green: NOAA's low-lying areas · a screening scenario, not a forecast`,
});

/** Macrostrat's geologic map; a click on the ground asks /api/infra?op=geology for the unit there. */
export const geologyLayer = picture({
  id: "geology",
  label: "Geology (Macrostrat)",
  description:
    "Macrostrat's geologic map worldwide, compiled from published maps at several scales and coloured by age. Click the ground for the map unit there: its name, lithology, age and the map it comes from.",
  color: "#C084FC",
  attribution: "Macrostrat (CC BY 4.0) and the geologic maps it compiles",
  source: "Macrostrat",
  note: "Macrostrat geologic map, coloured by age; the map scale changes with zoom · click the ground for the unit, its age and the map it comes from",
});

/**
 * USFWS critical habitat, final and proposed: FWS's own tile caches at every height, and a
 * click on the ground asks /api/land?op=crithab which designations contain the point.
 */
export const crithabLayer = picture({
  id: "crithab",
  label: "Critical habitat (ESA)",
  description:
    "Designated critical habitat for threatened and endangered species, final and proposed, in FWS's own map, with NOAA Fisheries' marine and anadromous species in NOAA's. Click the ground for the species, its listing status, whether the designation is final or proposed, and the Federal Register rule. Regulatory designations, not range or occurrence.",
  color: "#22C55E",
  attribution: "U.S. Fish and Wildlife Service, critical habitat (final and proposed); NOAA National Marine Fisheries Service",
  source: "USFWS critical habitat",
  note: "FWS's final and proposed designations, and NOAA Fisheries' for marine and anadromous species · regulatory polygons, not where a species lives; many listed species have none · click the ground for the species and rule",
});

export const TERRAIN_LAYERS: LayerDefinition[] = [reliefLayer, slopeLayer, contoursLayer, soilsLayer, firehazardLayer, landslidesuscLayer, landcoverLayer, sealevelLayer, geologyLayer, crithabLayer];

/** Layers whose click on the ground opens the "ground here" dossier. */
export const GROUND_LAYERS: LayerId[] = ["soils", "firehazard", "landslidesusc", "landcover", "slope", "contours", "relief", "geology", "crithab", "topo", "wayback", "hydro", "naip"];
