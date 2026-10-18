"use client";
// The zoning at a clicked point. With the Zoning layer on and the camera
// below ZONING_IDENTIFY_MAX_M, a click on the ground (or on a district
// outline, which carries only its code) asks /api/zoning?op=point about that
// spot and opens the answer as a dossier. With Parcels on, below 5 km the
// click is the parcel's instead, inside a district too; zoning answers from
// 5 to 15 km (lib/globe/clickPrecedence.ts). The point is marked on the globe
// while its dossier is open, and travels in share links as `zoning=lat,lon`.

import type * as CesiumNS from "cesium";
import { create } from "zustand";
import { getCesium } from "@/lib/globe/cesium";
import { useGlobe } from "@/lib/store/globe";
import { zoningErrorFeature, zoningPointFeature, zoningPointId, ZONING_POINT_KIND } from "./dossier";
import type { ZoningRecord } from "./features";

export interface ZoningPickState {
  pick: { lon: number; lat: number } | null;
  loading: boolean;
}

export const useZoningPick = create<ZoningPickState>(() => ({ pick: null, loading: false }));

let seq = 0;

export async function identifyZoning(lon: number, lat: number): Promise<void> {
  const my = ++seq;
  const pick = { lon: Number(lon.toFixed(5)), lat: Number(lat.toFixed(5)) };
  useZoningPick.setState({ pick, loading: true });
  const st = useGlobe.getState();
  try {
    const res = await fetch(`/api/zoning?op=point&lon=${pick.lon}&lat=${pick.lat}`);
    const body = (await res.json().catch(() => ({}))) as { data?: ZoningRecord; error?: string };
    if (my !== seq) return;
    if (!res.ok || !body.data) throw new Error(body.error ?? `zoning ${res.status}`);
    const f = zoningPointFeature(body.data, Date.now());
    useGlobe.getState().select({ layer: "zoning", id: f.properties.id }, f);
  } catch (err) {
    if (my !== seq) return;
    const msg = err instanceof Error ? err.message : String(err);
    st.pushLog({ level: "warn", text: `Zoning lookup failed: ${msg.slice(0, 80)}` });
    const f = zoningErrorFeature(pick.lon, pick.lat, msg, Date.now());
    useGlobe.getState().select({ layer: "zoning", id: f.properties.id }, f);
  } finally {
    if (my === seq) useZoningPick.setState({ loading: false });
  }
}

/** Whether the selection is a zoning point answer. */
export function isZoningPointSelected(): boolean {
  const f = useGlobe.getState().selectedFeature;
  return !!f && f.properties.layer === "zoning" && f.properties.kind === ZONING_POINT_KIND;
}

/** Marks the picked point while its dossier is open. */
export function startZoningOverlay(viewer: CesiumNS.Viewer): () => void {
  const C = getCesium();
  const points = viewer.scene.primitives.add(new C.PointPrimitiveCollection());
  const color = C.Color.fromCssColorString("#F0ABFC");
  const draw = () => {
    if (viewer.isDestroyed()) return;
    points.removeAll();
    const pick = useZoningPick.getState().pick;
    const sel = useGlobe.getState().selected;
    if (!pick || !sel || sel.layer !== "zoning" || sel.id !== zoningPointId(pick.lon, pick.lat)) return;
    points.add({
      position: C.Cartesian3.fromDegrees(pick.lon, pick.lat, 0),
      pixelSize: 11,
      color,
      outlineColor: C.Color.BLACK.withAlpha(0.85),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  };
  const a = useZoningPick.subscribe(draw);
  const b = useGlobe.subscribe((s, prev) => {
    if (s.selected !== prev.selected) draw();
  });
  draw();
  return () => {
    a();
    b();
    if (!viewer.isDestroyed()) viewer.scene.primitives.remove(points);
  };
}
