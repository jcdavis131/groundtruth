"use client";
// Click-to-identify for the parcels layer. A click on the ground (or on a
// lot line, or on a zoning district) below PARCEL_IDENTIFY_MAX_M asks
// /api/parcels for the parcel at that point and opens its dossier
// (lib/globe/clickPrecedence.ts). The identified parcel is not one of the
// layer's features (outlines carry no record), so the store holds it, the
// dossier is fed from it, and startParcelOverlay draws its outline.

import { create } from "zustand";
import type * as CesiumNS from "cesium";
import { useGlobe } from "@/lib/store/globe";
import { getCesium } from "@/lib/globe/cesium";
import type { LayerFeature } from "@/lib/layers/types";
import { parcelFeature } from "./features";
import type { NadAddress, ParcelIdentify } from "./types";

export interface ParcelPick {
  lon: number;
  lat: number;
  loading: boolean;
  data?: ParcelIdentify;
  error?: string;
  /** Which record of a stacked answer the dossier shows. */
  index: number;
  /** NAD asked again after identify answered without it. */
  addressesLoading?: boolean;
  seq: number;
}

interface PickState {
  pick: ParcelPick | null;
  set: (pick: ParcelPick | null) => void;
}

export const useParcelPick = create<PickState>()((set) => ({
  pick: null,
  set: (pick) => set({ pick }),
}));

let seq = 0;

/** The dossier feature for a pick: loading, failed, or the record. */
export function pickFeature(p: ParcelPick): LayerFeature {
  if (p.data) return parcelFeature(p.data, p.index);
  const id = `parcel-at:${p.lon.toFixed(5)},${p.lat.toFixed(5)}`;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    properties: {
      id,
      layer: "parcels",
      name: p.loading ? "Looking up the parcel here…" : "Parcel lookup failed",
      kind: p.loading ? "loading" : "error",
      source: "county and state parcel services",
      details: p.error ? { error: p.error } : { point: `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}` },
      anchor: [p.lon, p.lat],
    },
  };
}

function show(p: ParcelPick) {
  useParcelPick.getState().set(p);
  const f = pickFeature(p);
  useGlobe.getState().select({ layer: "parcels", id: f.properties.id }, f);
}

/** Still the pick the dossier is showing (a newer click or another selection replaces it). */
function current(n: number): ParcelPick | null {
  const p = useParcelPick.getState().pick;
  if (!p || p.seq !== n) return null;
  const sel = useGlobe.getState().selected;
  return sel?.layer === "parcels" ? p : null;
}

/** Ask for the parcel at a point and open its dossier. */
export async function identifyParcel(lon: number, lat: number): Promise<void> {
  const n = ++seq;
  show({ lon, lat, loading: true, index: 0, seq: n });
  try {
    const res = await fetch(`/api/parcels?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}`);
    const j = (await res.json().catch(() => ({}))) as { data?: ParcelIdentify; error?: string };
    if (!current(n)) return;
    if (!res.ok || !j.data) throw new Error(j.error ?? `parcel lookup answered ${res.status}`);
    const p: ParcelPick = { lon, lat, loading: false, data: j.data, index: 0, seq: n, addressesLoading: j.data.addresses === null && j.data.county != null };
    show(p);
    if (p.addressesLoading) void moreAddresses(n);
  } catch (err) {
    if (!current(n)) return;
    show({ lon, lat, loading: false, index: 0, seq: n, error: err instanceof Error ? err.message : "parcel lookup failed" });
  }
}

/** NAD did not answer within identify's wait: ask the addresses mode, which waits longer. */
async function moreAddresses(n: number): Promise<void> {
  const p0 = current(n);
  if (!p0?.data) return;
  let addresses: NadAddress[] | null = null;
  try {
    const res = await fetch(`/api/parcels?mode=addresses&lon=${p0.lon.toFixed(5)}&lat=${p0.lat.toFixed(5)}`);
    const j = (await res.json().catch(() => ({}))) as { data?: { addresses?: NadAddress[] } };
    if (res.ok && Array.isArray(j.data?.addresses)) addresses = j.data.addresses;
  } catch {
    /* stays null: the dossier says NAD did not answer */
  }
  const p = current(n);
  if (!p?.data) return;
  show({ ...p, addressesLoading: false, data: { ...p.data, addresses } });
}

/** Show another record of a stacked answer. */
export function showParcelRecord(index: number): void {
  const p = useParcelPick.getState().pick;
  if (!p?.data || index < 0 || index >= p.data.parcels.length) return;
  show({ ...p, index });
}

/** Clear the pick (the dossier was closed or something else was selected). */
export function clearParcelPick(): void {
  useParcelPick.getState().set(null);
}

const OUTLINE = "#FACC15";

/** Draw the picked parcel's outline and the clicked point while its dossier is open. */
export function startParcelOverlay(viewer: CesiumNS.Viewer): () => void {
  const C = getCesium();
  const scene = viewer.scene;
  const lines = scene.primitives.add(new C.PolylineCollection());
  const points = scene.primitives.add(new C.PointPrimitiveCollection());
  const color = C.Color.fromCssColorString(OUTLINE);
  const draw = () => {
    if (viewer.isDestroyed()) return;
    lines.removeAll();
    points.removeAll();
    const p = useParcelPick.getState().pick;
    const sel = useGlobe.getState().selected;
    if (!p || sel?.layer !== "parcels") return;
    points.add({
      position: C.Cartesian3.fromDegrees(p.lon, p.lat, 0),
      pixelSize: 8,
      color,
      outlineColor: C.Color.BLACK.withAlpha(0.8),
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
    const g = p.data?.parcels[p.index]?.geometry;
    if (!g) return;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        if (ring.length < 3) continue;
        lines.add({
          positions: C.Cartesian3.fromDegreesArrayHeights(ring.flatMap(([x, y]) => [x, y, 0])),
          width: 3,
          material: C.Material.fromType("Color", { color: color.withAlpha(0.95) }),
        });
      }
    }
  };
  const unsubPick = useParcelPick.subscribe(draw);
  const unsubSel = useGlobe.subscribe((s, prev) => {
    if (s.selected === prev.selected) return;
    // Another object (or nothing) selected: the pick is over.
    if (s.selected?.layer !== "parcels" && useParcelPick.getState().pick) clearParcelPick();
    draw();
  });
  draw();
  return () => {
    unsubPick();
    unsubSel();
    if (!viewer.isDestroyed()) {
      scene.primitives.remove(lines);
      scene.primitives.remove(points);
    }
  };
}
