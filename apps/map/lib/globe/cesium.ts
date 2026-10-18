"use client";
// Lazy Cesium loader. Cesium is ~4 MB of JS and touches `window` at import
// time, so it is only ever imported on the client, after CESIUM_BASE_URL is
// set so its workers/assets resolve to /public/cesium.

import type * as CesiumNS from "cesium";

export type CesiumModule = typeof CesiumNS;

let mod: CesiumModule | null = null;
let loading: Promise<CesiumModule> | null = null;
let viewer: CesiumNS.Viewer | null = null;

export function loadCesium(): Promise<CesiumModule> {
  if (mod) return Promise.resolve(mod);
  if (!loading) {
    (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = "/cesium";
    loading = import("cesium").then((m) => {
      mod = m;
      return m;
    });
  }
  return loading;
}

/** Synchronous access once loadCesium() has resolved. */
export function getCesium(): CesiumModule {
  if (!mod) throw new Error("Cesium is not loaded yet");
  return mod;
}

export function setViewer(v: CesiumNS.Viewer | null) {
  viewer = v;
}

export function getViewer(): CesiumNS.Viewer | null {
  return viewer && !viewer.isDestroyed() ? viewer : null;
}
