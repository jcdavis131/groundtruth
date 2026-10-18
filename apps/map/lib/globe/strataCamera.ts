"use client";
// Camera moves for the constructs HUD: frame one construct's extent at a
// composed oblique pitch, and tilt a top-down view so the strata read as
// layers. Both honour prefers-reduced-motion with a cut instead of a flight.

import type * as CesiumNS from "cesium";
import { getCesium, getViewer } from "./cesium";
import { stopFollowing } from "./camera";
import { constructExtent, extentSpanM, framePitch } from "@/lib/fabric/strata";
import type { ConstructNode } from "@/lib/fabric/types";
import { isMobileViewport } from "@/lib/hooks/useIsMobile";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Range that fits a sphere of `radius` in the narrower field of view (portrait phones are narrow). */
function fitRange(camera: CesiumNS.Camera, radius: number, aspect: number): number {
  const f = camera.frustum as CesiumNS.PerspectiveFrustum;
  const fov = f.fov ?? Math.PI / 3;
  // Cesium applies `fov` to the wider dimension; derive the other.
  const wide = fov;
  const narrow = aspect >= 1 ? 2 * Math.atan(Math.tan(fov / 2) / aspect) : 2 * Math.atan(Math.tan(fov / 2) * aspect);
  const half = Math.min(wide, narrow) / 2;
  return (radius / Math.sin(half)) * 1.04;
}

/**
 * Fly to frame a construct: its outline's extent (or a square of its area
 * when no outline is published) centred, at a pitch composed for its size,
 * keeping the current heading. On a phone the lower part of the frame is
 * under the sheet, so the frame is pulled back a little further.
 */
export function flyToConstruct(node: ConstructNode, ground: [number, number], opts: { durationS?: number; instant?: boolean } = {}): void {
  const viewer = getViewer();
  if (!viewer) return;
  const C = getCesium();
  stopFollowing();
  const box = constructExtent(node, ground);
  const span = extentSpanM(box);
  const pitch = C.Math.toRadians(framePitch(span));
  const rect = C.Rectangle.fromDegrees(box[0], box[1], box[2], box[3]);
  const sphere = C.BoundingSphere.fromRectangle3D(rect);
  const canvas = viewer.scene.canvas;
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const mobile = isMobileViewport();
  const range = Math.max(1_500, fitRange(viewer.camera, sphere.radius, aspect) * (mobile ? 1.25 : 1));
  const instant = opts.instant ?? prefersReducedMotion();
  viewer.camera.flyToBoundingSphere(sphere, {
    offset: new C.HeadingPitchRange(viewer.camera.heading, pitch, range),
    duration: instant ? 0 : (opts.durationS ?? 2.6),
    easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
  });
}

/**
 * Tilt the camera about the point at the centre of the frame, keeping the
 * distance to it, so a top-down view of the stack becomes an oblique one.
 */
export function tiltToOblique(pitchDeg = -52, durationS = 1.8): boolean {
  const viewer = getViewer();
  if (!viewer) return false;
  const C = getCesium();
  const scene = viewer.scene;
  const canvas = scene.canvas;
  const centre = new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const target = viewer.camera.pickEllipsoid(centre, scene.globe.ellipsoid);
  if (!target) return false;
  const range = C.Cartesian3.distance(viewer.camera.positionWC, target);
  viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target, 1), {
    offset: new C.HeadingPitchRange(viewer.camera.heading, C.Math.toRadians(pitchDeg), range),
    duration: prefersReducedMotion() ? 0 : durationS,
    easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
  });
  return true;
}
