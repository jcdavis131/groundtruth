"use client";
// Mission clock controls. The Cesium clock is the single source of truth;
// the Zustand store mirrors it for the HUD.

import { getCesium, getViewer } from "./cesium";
import { useGlobe } from "@/lib/store/globe";
import { allRenderers } from "./registry";

export function missionTimeMs(): number {
  const viewer = getViewer();
  if (!viewer) return Date.now();
  const C = getCesium();
  return C.JulianDate.toDate(viewer.clock.currentTime).getTime();
}

export function setMissionTime(ms: number) {
  const viewer = getViewer();
  if (!viewer) return;
  const C = getCesium();
  viewer.clock.currentTime = C.JulianDate.fromDate(new Date(ms));
  useGlobe.getState().setClock({ offsetMs: ms - Date.now() });
  for (const r of allRenderers()) r.refreshSelectedLines();
}

export function setMultiplier(multiplier: number) {
  const viewer = getViewer();
  if (!viewer) return;
  viewer.clock.multiplier = multiplier;
  useGlobe.getState().setClock({ multiplier });
}

export function setAnimate(animate: boolean) {
  const viewer = getViewer();
  if (!viewer) return;
  viewer.clock.shouldAnimate = animate;
  useGlobe.getState().setClock({ animate });
}

export function goLive() {
  const viewer = getViewer();
  if (!viewer) return;
  const C = getCesium();
  viewer.clock.currentTime = C.JulianDate.now();
  viewer.clock.multiplier = 1;
  viewer.clock.shouldAnimate = true;
  useGlobe.getState().setClock({ offsetMs: 0, multiplier: 1, animate: true, timeMachine: false });
  useGlobe.getState().setPlaybackYear(null);
  for (const r of allRenderers()) r.refreshSelectedLines();
}

/** True while the mission clock is within a minute of wall-clock time. */
export function isLive(offsetMs: number): boolean {
  return Math.abs(offsetMs) < 60_000;
}
