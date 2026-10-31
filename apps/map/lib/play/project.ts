"use client";
// Project a lon/lat onto the canvas in pixels when it faces the camera, or
// null when it is behind the globe. The fog veil and the play markers use
// this so nothing draws for the far side of the planet.

import type * as CesiumNS from "cesium";
import { getCesium } from "@/lib/globe/cesium";

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Canvas-pixel position of a ground point, or null when occluded.
 * A point faces the camera when the angle between its geocentric normal
 * and the camera-to-point direction is comfortably under 90 degrees; the
 * margin keeps markers from lingering on the limb.
 */
export function projectVisible(viewer: CesiumNS.Viewer, lon: number, lat: number): ScreenPoint | null {
  const C = getCesium();
  const cartesian = C.Cartesian3.fromDegrees(lon, lat, 0);
  const normal = new C.Cartesian3();
  viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(cartesian, normal);
  const toCamera = new C.Cartesian3();
  C.Cartesian3.subtract(viewer.camera.position, cartesian, toCamera);
  C.Cartesian3.normalize(toCamera, toCamera);
  if (C.Cartesian3.dot(normal, toCamera) < 0.12) return null;
  const out = new C.Cartesian2();
  const p = viewer.scene.cartesianToCanvasCoordinates(cartesian, out);
  if (!p) return null;
  return { x: p.x, y: p.y };
}
