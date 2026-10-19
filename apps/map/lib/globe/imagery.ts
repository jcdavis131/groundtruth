"use client";
// Keyless imagery stack plus the optional upgrades that need a key.
//
//   base:   Esri World Imagery (free tile endpoint, no key)
//   night:  NASA GIBS VIIRS Black Marble, blended in only on the night side
//   +key:   Google Photorealistic 3D Tiles (GOOGLE_MAPS_API_KEY)
//   terrain: keyless AWS Terrain Tiles (terrarium) when switched on;
//   +key:   Cesium World Terrain instead (CESIUM_ION_TOKEN)

import type * as CesiumNS from "cesium";
import { getCesium } from "./cesium";
import { createTerrariumTerrain, RETRY_DELAYS_MS } from "@/lib/terrain/terrarium";

export const ESRI_IMAGERY_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const GIBS_BLACK_MARBLE_URL =
  "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/VIIRS_Black_Marble/default/2016-01-01/500m/{z}/{y}/{x}.png";

export function addBaseImagery(viewer: CesiumNS.Viewer): CesiumNS.ImageryLayer {
  const C = getCesium();
  const provider = new C.UrlTemplateImageryProvider({
    url: ESRI_IMAGERY_URL,
    maximumLevel: 19,
    // The World Imagery item's own attribution (accessInformation, read 2026-10-12).
    credit: new C.Credit("Imagery © Esri, Vantor, Earthstar Geographics, and the GIS User Community"),
  });
  const layer = viewer.imageryLayers.addImageryProvider(provider);
  // A cold, quiet Earth: pulled-down saturation and a touch more contrast so
  // coastlines and relief read crisply and the data layers own the colour.
  layer.brightness = 0.86;
  layer.contrast = 1.16;
  layer.saturation = 0.58;
  layer.gamma = 1.08;
  return layer;
}

export function addNightLights(viewer: CesiumNS.Viewer): CesiumNS.ImageryLayer {
  const C = getCesium();
  // GIBS's EPSG:4326 "500m" matrix set is 2x1, 3x2, 5x3, 10x5, 20x10, ...:
  // it only doubles from level 2 on. Cesium's tiling scheme must double from
  // level 0, so Cesium level n maps to GIBS level n + 2 on a 5x3 base grid.
  const provider = new C.UrlTemplateImageryProvider({
    url: GIBS_BLACK_MARBLE_URL.replace("{z}", "{gibsz}"),
    tilingScheme: new C.GeographicTilingScheme({ numberOfLevelZeroTilesX: 5, numberOfLevelZeroTilesY: 3 }),
    maximumLevel: 5,
    customTags: {
      gibsz: (_provider: unknown, _x: number, _y: number, level: number) => String(level + 2),
    },
    credit: new C.Credit("Night lights: NASA GIBS / VIIRS Black Marble"),
  });
  const layer = viewer.imageryLayers.addImageryProvider(provider);
  layer.dayAlpha = 0.0;
  layer.nightAlpha = 1.0;
  layer.brightness = 1.35;
  return layer;
}

let googleTileset: CesiumNS.Cesium3DTileset | null = null;

export async function setGoogleTiles(viewer: CesiumNS.Viewer, key: string | undefined, on: boolean) {
  const C = getCesium();
  if (!on || !key) {
    if (googleTileset) {
      viewer.scene.primitives.remove(googleTileset);
      googleTileset = null;
      viewer.scene.globe.show = true;
    }
    return { active: false as const };
  }
  if (googleTileset) return { active: true as const };
  try {
    const tileset = await C.Cesium3DTileset.fromUrl(
      `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`,
      { showCreditsOnScreen: true, maximumScreenSpaceError: 12 },
    );
    googleTileset = tileset;
    viewer.scene.primitives.add(tileset);
    // Google tiles include their own terrain + imagery; the ellipsoid globe
    // would z-fight with them, so hide it once tiles are on screen.
    viewer.scene.globe.show = false;
    return { active: true as const };
  } catch (err) {
    return { active: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export type TerrainResult =
  | { active: false; error?: string }
  | { active: true; kind: "ion" | "keyless"; error?: string };

export type TerrainLogLine = { level: "info" | "warn"; text: string };

/** Log line when keyless terrain gives up on its level-0 tile and the smooth globe comes back. */
export function terrainLostText(err: unknown): TerrainLogLine {
  const why = (err instanceof Error ? err.message : String(err)).slice(0, 80);
  return {
    level: "warn",
    text: `Keyless terrain unreachable: AWS Terrain Tiles did not answer after ${RETRY_DELAYS_MS.length + 1} tries (${why}); showing the smooth globe. Turn 3D terrain off and on to try again.`,
  };
}

/**
 * 3D terrain. Off: the smooth ellipsoid. On with a Cesium ion token: Cesium
 * World Terrain. On without one (or when ion fails): keyless AWS Terrain Tiles
 * (lib/terrain/terrarium.ts), no account needed. If keyless terrain cannot
 * fetch its level-0 tile after every retry, the smooth globe comes back and
 * `onLost` hears why.
 */
export async function setTerrain(
  viewer: CesiumNS.Viewer,
  ionToken: string | undefined,
  on: boolean,
  onLost?: (line: TerrainLogLine) => void,
): Promise<TerrainResult> {
  const C = getCesium();
  if (!on) {
    if (!(viewer.terrainProvider instanceof C.EllipsoidTerrainProvider)) {
      viewer.terrainProvider = new C.EllipsoidTerrainProvider();
    }
    return { active: false };
  }
  let ionError: string | undefined;
  if (ionToken) {
    try {
      C.Ion.defaultAccessToken = ionToken;
      const terrain = await C.createWorldTerrainAsync({ requestVertexNormals: true });
      viewer.terrainProvider = terrain;
      viewer.scene.globe.depthTestAgainstTerrain = false;
      return { active: true, kind: "ion" };
    } catch (err) {
      ionError = err instanceof Error ? err.message : String(err);
    }
  }
  try {
    const keyless: CesiumNS.TerrainProvider = createTerrariumTerrain({
      onUnreachable: (err) => {
        // Only if it is still this provider: terrain may have been switched off and on meanwhile.
        if (viewer.isDestroyed() || viewer.terrainProvider !== keyless) return;
        viewer.terrainProvider = new C.EllipsoidTerrainProvider();
        onLost?.(terrainLostText(err));
      },
    });
    viewer.terrainProvider = keyless;
    viewer.scene.globe.depthTestAgainstTerrain = false;
    return { active: true, kind: "keyless", error: ionError ? `Cesium World Terrain failed (${ionError}); using keyless terrain` : undefined };
  } catch (err) {
    return { active: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Log line for a terrain switch. */
export function terrainLogText(r: TerrainResult): TerrainLogLine | null {
  if (r.active && r.kind === "ion") return { level: "info", text: "Cesium World Terrain online" };
  if (r.active) {
    return {
      level: r.error ? "warn" : "info",
      text: `${r.error ? r.error + ". " : ""}Keyless terrain online: AWS Terrain Tiles (heights below sea level, the sea floor included, are drawn at sea level)`,
    };
  }
  return r.error ? { level: "warn", text: `Terrain: ${r.error}` } : null;
}
