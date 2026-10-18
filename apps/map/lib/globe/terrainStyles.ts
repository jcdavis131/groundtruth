"use client";
// How the terrain, soil and land cover pictures are drawn: one TileSpec each
// (lib/globe/tiles.ts), with the source, zoom range, height gate, default
// opacity and stacking order. Where each picture comes from and what it is
// not lives in lib/terrain/products.ts.

import type { LayerStyle } from "./renderer";
import type { TileSpec } from "./tiles";
import {
  CRITHAB_MAX_ZOOM,
  CRITHAB_TILES,
  NMFS_EXPORT,
  NWI_RASTER_MAX_ZOOM,
  NWI_RASTER_TEMPLATE,
  RELIEF_TILES,
  RENDER_PRODUCTS,
  SDM_WMS,
  SLR_BASE,
  SLR_DEFAULT_FT,
  WHP_TEMPLATE,
  LANDSLIDE_SUSC_MAX_ZOOM,
  LANDSLIDE_SUSC_TILES,
  isSlrFeet,
  routeTileUrl,
  type RenderProductId,
} from "@/lib/terrain/products";
import {
  CONTOURS_MAX_HEIGHT_M,
  CONUS,
  LANDCOVER_MAX_HEIGHT_M,
  SEALEVEL_MAX_HEIGHT_M,
  SLOPE_MAX_HEIGHT_M,
  SOILS_MAX_HEIGHT_M,
} from "@/lib/layers/terrain";
import { FLOOD_MAX_HEIGHT_M } from "@/lib/layers/flood";
import { WETLANDS_MAX_HEIGHT_M } from "@/lib/layers/wetlands";
import { parseReleaseId, WAYBACK_ATTRIBUTION, WAYBACK_MAX_ZOOM, waybackTiles } from "@/lib/terrain/wayback";
import { HTMC_ATTRIBUTION, parseTopoYear, TOPO_MAX_ZOOM, TOPO_MIN_ZOOM, topoTiles } from "@/lib/terrain/topo";
import { HYDRO_ATTRIBUTION, HYDRO_MAX_ZOOM, HYDRO_TILES } from "@/lib/water/nldi";
import { NAIP_ATTRIBUTION, NAIP_MAX_ZOOM, NAIP_MIN_ZOOM, parseNaipYear, PC_MOSAIC } from "@/lib/terrain/naip";

/** Stacking among pictures, bottom to top: relief under everything, lines on top. */
export const TILE_Z = {
  wayback: 5,
  naip: 6,
  topo: 7,
  relief: 10,
  landcover: 20,
  wetlands: 25,
  firehazard: 30,
  landslidesusc: 32,
  soils: 40,
  slope: 50,
  sealevel: 60,
  crithab: 65,
  hydro: 75,
  floodmap: 70,
  contours: 80,
} as const;

/** A picture /api/terrain renders (slope, contours, land cover, FEMA's flood map). */
export function routeSpec(product: RenderProductId, over: Partial<TileSpec> & Pick<TileSpec, "alpha" | "z" | "credit">): TileSpec {
  const p = RENDER_PRODUCTS[product];
  return {
    key: `route:${product}`,
    kind: "xyz",
    url: routeTileUrl(product, "{z}", "{x}", "{y}"),
    tileSize: p.tileSize,
    maximumLevel: p.maxZoom,
    floorLevel: p.minZoom,
    ...over,
  };
}

const picture = (color: string, tiles: LayerStyle["tiles"]): LayerStyle => ({ color, tiles });

// USGS's relief tiles are opaque JPEGs, almost white (probed means 244-252), so drawn as they come
// they lay a milky veil over the whole globe; `shade` keeps only the shading. Levels 9 and deeper
// are published only around the US, and level 9 has holes even there (all 404), hence `sparse`.
export const reliefStyle = picture("#C9CED6", () => [
  {
    key: "relief",
    kind: "xyz",
    url: RELIEF_TILES,
    maximumLevel: 13,
    shade: true,
    sparse: true,
    alpha: 0.8,
    z: TILE_Z.relief,
    credit: "Relief: USGS The National Map, 3DEP and GMTED2010",
  },
]);

export const slopeStyle = picture("#F2C14E", () => [
  routeSpec("slope", { alpha: 0.6, z: TILE_Z.slope, maxHeight: SLOPE_MAX_HEIGHT_M, credit: "Slope: USGS 3DEP" }),
]);

export const contoursStyle = picture("#E8D9A0", () => [
  routeSpec("contours", { alpha: 0.9, z: TILE_Z.contours, maxHeight: CONTOURS_MAX_HEIGHT_M, ink: "#F3E3A6", credit: "Contours: USGS 3DEP" }),
]);

export const soilsStyle = picture("#C98B4E", () => [
  {
    key: "soils",
    kind: "wms",
    url: SDM_WMS,
    layers: "mapunitpoly",
    wmsParameters: { version: "1.1.1", styles: "" },
    tileSize: 512,
    maximumLevel: 19,
    // The WMS draws map units only finer than its ScaleHint (about 88 m a pixel): 512 px tiles from level 10.
    floorLevel: 10,
    alpha: 0.9,
    z: TILE_Z.soils,
    maxHeight: SOILS_MAX_HEIGHT_M,
    credit: "Soils: USDA NRCS SSURGO",
  },
]);

export const firehazardStyle = picture("#FF7A3D", () => [
  {
    key: "firehazard",
    kind: "xyz",
    url: WHP_TEMPLATE,
    maximumLevel: 11,
    rectangle: CONUS,
    nearest: true,
    alpha: 0.65,
    z: TILE_Z.firehazard,
    credit: "Wildfire Hazard Potential 2023: USDA Forest Service",
  },
]);

// USGS's own class colours at a fixed alpha, never recoloured. 512 px tiles cached at levels 1 to 12.
export const landslidesuscStyle = picture("#A16207", () => [
  {
    key: "landslidesusc",
    kind: "xyz",
    url: LANDSLIDE_SUSC_TILES,
    tileSize: 512,
    maximumLevel: LANDSLIDE_SUSC_MAX_ZOOM,
    floorLevel: 1,
    nearest: true,
    alpha: 0.65,
    z: TILE_Z.landslidesusc,
    credit: "Landslide susceptibility: USGS, Belair and others (2024), CC0",
  },
]);

export const landcoverStyle = picture("#7FB77E", () => [
  routeSpec("landcover", { alpha: 0.7, z: TILE_Z.landcover, rectangle: CONUS, nearest: true, maxHeight: LANDCOVER_MAX_HEIGHT_M, credit: "Land cover: MRLC NLCD 2021" }),
]);

export const sealevelStyle = picture("#4895E5", ({ meta }) => {
  const ft = isSlrFeet(meta?.seaLevelFt) ? meta.seaLevelFt : SLR_DEFAULT_FT;
  return [
    {
      key: `sealevel:${ft}`,
      kind: "xyz",
      url: `${SLR_BASE}/slr_${ft}ft/MapServer/tile/{z}/{y}/{x}`,
      maximumLevel: 16,
      // Cached only along US coasts: a 404 is "nothing here". The service's published fullExtent
      // is nearly worldwide (3 ft: 348° of longitude, 45.0° S to 78.4° N), so it bounds nothing.
      sparse: true,
      alpha: 0.75,
      z: TILE_Z.sealevel,
      maxHeight: SEALEVEL_MAX_HEIGHT_M,
      credit: `Sea level rise ${ft} ft: NOAA Office for Coastal Management`,
    },
  ];
});

/**
 * NWI's national wetlands raster, drawn only above WETLANDS_MAX_HEIGHT_M, where the Wetlands
 * layer's clickable polygons are not loaded (the inverse of the FEMA map under flood zones).
 * Classes, so magnified without smoothing; no rectangle, since NWI maps Alaska, Hawaii and
 * the territories too.
 */
export const WETLANDS_PICTURE: TileSpec = {
  key: "wetlands:nwi-raster-v5",
  kind: "xyz",
  url: NWI_RASTER_TEMPLATE,
  maximumLevel: NWI_RASTER_MAX_ZOOM,
  nearest: true,
  alpha: 0.7,
  z: TILE_Z.wetlands,
  minHeight: WETLANDS_MAX_HEIGHT_M,
  credit: "Wetlands raster: U.S. Fish and Wildlife Service, National Wetlands Inventory",
};

/**
 * USFWS critical habitat: FWS's final and proposed caches, and NOAA Fisheries' /export (polygons
 * and river lines, transparent PNG, so not sparse), in FWS's own symbology, at every
 * height (cached to level 14, magnified beyond). Both are sparse: outside designated habitat
 * the caches answer 404, which is "no tile here".
 */
export const crithabStyle = picture("#22C55E", () => [
  {
    key: "crithab:final",
    kind: "xyz",
    url: CRITHAB_TILES.final,
    maximumLevel: CRITHAB_MAX_ZOOM,
    sparse: true,
    alpha: 0.75,
    z: TILE_Z.crithab,
    credit: "Critical habitat (final): U.S. Fish and Wildlife Service",
  },
  {
    key: "crithab:proposed",
    kind: "xyz",
    url: CRITHAB_TILES.proposed,
    maximumLevel: CRITHAB_MAX_ZOOM,
    sparse: true,
    alpha: 0.75,
    z: TILE_Z.crithab + 1,
    credit: "Critical habitat (proposed): U.S. Fish and Wildlife Service",
  },
  {
    key: "crithab:noaa",
    kind: "xyz",
    url: NMFS_EXPORT,
    maximumLevel: CRITHAB_MAX_ZOOM,
    alpha: 0.75,
    z: TILE_Z.crithab + 2,
    credit: "Critical habitat (marine and anadromous): NOAA National Marine Fisheries Service",
  },
]);

/**
 * Esri World Imagery Wayback: the release the layer's fetch resolved (meta.waybackRelease),
 * straight from Esri, under every other picture. Nothing is drawn until the release index
 * has answered. Sparse: where a release has no tile Esri answers 404; where a tile did not
 * change it 301s to the release that last changed it, which the image loader follows.
 */
export const waybackStyle = picture("#94A3B8", ({ meta }) => {
  const release = parseReleaseId(meta?.waybackRelease);
  if (release == null) return null;
  const date = typeof meta?.waybackDate === "string" ? meta.waybackDate : "";
  return [
    {
      key: `wayback:${release}`,
      kind: "xyz",
      url: waybackTiles(release),
      maximumLevel: WAYBACK_MAX_ZOOM,
      sparse: true,
      alpha: 1,
      z: TILE_Z.wayback,
      credit: `World Imagery Wayback${date ? ` (release ${date})` : ""}: ${WAYBACK_ATTRIBUTION}`,
    },
  ];
});

/**
 * USGS historical topographic maps: the edition year the layer's fetch resolved (meta.topoYear),
 * from Esri's HTMC ImageServer, above Wayback and under every other picture. Levels below 11 are
 * drawn empty without asking (a coarser tile is blank: the sheets draw only finer than their MaxPS);
 * a year with no sheet under a tile answers a blank PNG, not a 404, so the layer is not sparse.
 */
export const topoStyle = picture("#D6B370", ({ meta }) => {
  const year = parseTopoYear(meta?.topoYear);
  if (year == null) return null;
  return [
    {
      key: `topo:${year}`,
      kind: "xyz",
      url: topoTiles(year),
      maximumLevel: TOPO_MAX_ZOOM,
      floorLevel: TOPO_MIN_ZOOM,
      alpha: 1,
      z: TILE_Z.topo,
      credit: `USGS topographic map, ${year} edition: ${HTMC_ATTRIBUTION}`,
    },
  ];
});

/**
 * USGS NHD streams and water bodies (USGSHydroCached): transparent PNG line art, drawn at every
 * height over the base pictures and under the contours. The cache answers 404 where it holds no
 * tile, so it is sparse.
 */
export const hydroStyle = picture("#38BDF8", () => [
  {
    key: "hydro",
    kind: "xyz",
    url: HYDRO_TILES,
    maximumLevel: HYDRO_MAX_ZOOM,
    sparse: true,
    alpha: 0.9,
    z: TILE_Z.hydro,
    credit: `Streams: ${HYDRO_ATTRIBUTION}`,
  },
]);

/**
 * USDA NAIP aerial photographs for the year the layer's fetch resolved (meta.naipYear), from the
 * Planetary Computer mosaic the route registered (meta.naipTiles), over Wayback and under the
 * topo maps. Levels below 11 are drawn empty without asking (Planetary Computer answers no
 * content there). A template from anywhere but Planetary Computer's mosaic path is refused.
 */
export const naipStyle = picture("#A3E635", ({ meta }) => {
  const year = parseNaipYear(meta?.naipYear);
  const url = typeof meta?.naipTiles === "string" ? meta.naipTiles : "";
  if (year == null || !url.startsWith(`${PC_MOSAIC}/`) || !url.includes("/tiles/WebMercatorQuad/{z}/{x}/{y}")) return null;
  return [
    {
      key: `naip:${year}:${url}`,
      kind: "xyz",
      url,
      maximumLevel: NAIP_MAX_ZOOM,
      floorLevel: NAIP_MIN_ZOOM,
      alpha: 1,
      z: TILE_Z.naip,
      credit: `Aerial photographs ${year}: ${NAIP_ATTRIBUTION}`,
    },
  ];
});

/** FEMA's own map of the flood zones, drawn under the clickable zones of the Flood zones layer. */
export const FLOOD_PICTURE: TileSpec = routeSpec("floodmap", {
  alpha: 0.8,
  z: TILE_Z.floodmap,
  maxHeight: FLOOD_MAX_HEIGHT_M,
  credit: "Flood map: FEMA National Flood Hazard Layer",
});
