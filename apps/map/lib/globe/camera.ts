"use client";
// Cinematic camera moves used by the UI, search and voice commands.

import type * as CesiumNS from "cesium";
import { getCesium, getViewer } from "./cesium";
import { destination } from "./geo";
import { getRenderer } from "./registry";
import { FOLLOW_RANGE } from "./styles";
import { useGlobe, type Selection } from "@/lib/store/globe";

export interface FlyOptions {
  height?: number;
  pitchDeg?: number;
  headingDeg?: number;
  durationS?: number;
}

/** Fly to a lon/lat with a cinematic tilted approach. */
export function flyTo(lon: number, lat: number, opts: FlyOptions = {}) {
  const viewer = getViewer();
  if (!viewer) return;
  const C = getCesium();
  stopFollowing();
  const height = opts.height ?? 120_000;
  // From very high up a tilt only shows horizon; look straight down instead.
  const pitchDeg = height > 1_500_000 ? -90 : (opts.pitchDeg ?? -55);
  const pitch = C.Math.toRadians(pitchDeg);
  const headingDeg = ((opts.headingDeg ?? 0) % 360 + 360) % 360;
  const heading = C.Math.toRadians(headingDeg);
  // Put the reticle on the target: back the camera off along the view heading
  // by height / tan(-pitch), so a shared link re-opens on the same spot.
  const back = pitchDeg <= -89 ? 0 : height / Math.tan(-pitch);
  const [camLon, camLat] = back > 0 ? destination(lat, lon, (headingDeg + 180) % 360, back) : [lon, lat];
  viewer.camera.flyTo({
    destination: C.Cartesian3.fromDegrees(camLon, Math.max(-89.9, Math.min(89.9, camLat)), height),
    orientation: { heading, pitch, roll: 0 },
    duration: opts.durationS ?? 3.2,
    easingFunction: C.EasingFunction.QUADRATIC_IN_OUT,
  });
}

/** Fly to a feature by selection, then optionally follow it. */
export function flyToSelection(sel: Selection, follow = false) {
  const viewer = getViewer();
  if (!viewer) return false;
  const C = getCesium();
  const r = getRenderer(sel.layer);
  let pos = r?.getPosition(sel.id);
  let feature = r?.getFeature(sel.id);
  if (!pos || !feature) {
    // A selection no layer draws (a zoning answer at a clicked point) flies to its own point.
    const held = useGlobe.getState().selectedFeature;
    if (follow || !held || held.properties.layer !== sel.layer || held.properties.id !== sel.id || held.geometry.type !== "Point") return false;
    const [lon, lat] = held.geometry.coordinates;
    pos = C.Cartesian3.fromDegrees(lon, lat, 0);
    feature = held;
  }
  useGlobe.getState().select(sel, feature);
  const range = FOLLOW_RANGE[sel.layer];
  const carto = C.Cartographic.fromCartesian(pos);
  if (follow) {
    startFollowing();
    return true;
  }
  stopFollowing();
  viewer.camera.flyToBoundingSphere(new C.BoundingSphere(pos, range / 4), {
    duration: 2.4,
    offset: new C.HeadingPitchRange(0, C.Math.toRadians(-45), range),
  });
  void carto;
  return true;
}

let followState: { key: string } | null = null;

export function startFollowing() {
  const viewer = getViewer();
  const { selected } = useGlobe.getState();
  if (!viewer || !selected) return;
  const C = getCesium();
  const r = getRenderer(selected.layer);
  const pos = r?.getPosition(selected.id);
  if (!pos) return;
  const range = FOLLOW_RANGE[selected.layer];
  viewer.camera.lookAt(pos, new C.HeadingPitchRange(viewer.camera.heading, C.Math.toRadians(-40), range));
  followState = { key: `${selected.layer}:${selected.id}` };
  useGlobe.getState().setFollowing(true);
}

export function stopFollowing() {
  const viewer = getViewer();
  if (viewer) {
    const C = getCesium();
    viewer.camera.lookAtTransform(C.Matrix4.IDENTITY);
  }
  followState = null;
  if (useGlobe.getState().following) useGlobe.getState().setFollowing(false);
}

/** Per-frame follow update. Keeps the operator's orbit offset while the target moves. */
export function followTick() {
  const viewer = getViewer();
  const { following, selected } = useGlobe.getState();
  if (!viewer || !following || !selected) {
    if (followState) stopFollowing();
    return;
  }
  const key = `${selected.layer}:${selected.id}`;
  if (!followState || followState.key !== key) {
    startFollowing();
    return;
  }
  const C = getCesium();
  const pos = getRenderer(selected.layer)?.getPosition(selected.id);
  if (!pos) return;
  // While a transform is active, camera.position is the operator's orbit
  // offset in the target's local frame (the mouse orbits/zooms it). Re-frame
  // around the target's new position and keep that offset, so the camera
  // moves with the target. lookAtTransform without an offset would instead
  // preserve the camera's *world* pose and never follow.
  const offset = C.Cartesian3.clone(viewer.camera.position, followOffsetScratch);
  viewer.camera.lookAtTransform(C.Transforms.eastNorthUpToFixedFrame(pos, undefined, followFrameScratch), offset);
}

let followOffsetScratch: CesiumNS.Cartesian3 | undefined;
let followFrameScratch: CesiumNS.Matrix4 | undefined;

/** Slow orbital drift for the idle cinematic mode. */
export function cinematicTick(dtSeconds: number) {
  const viewer = getViewer();
  if (!viewer) return;
  const C = getCesium();
  const h = viewer.camera.positionCartographic.height;
  if (h < 1_500_000) return;
  viewer.camera.rotate(C.Cartesian3.UNIT_Z, -0.012 * dtSeconds);
}

export function homeView(durationS = 4) {
  const viewer = getViewer();
  if (!viewer) return;
  const C = getCesium();
  stopFollowing();
  viewer.camera.flyTo({
    destination: C.Cartesian3.fromDegrees(-97.7, 18, 14_000_000),
    orientation: { heading: 0, pitch: C.Math.toRadians(-88), roll: 0 },
    duration: durationS,
  });
}
