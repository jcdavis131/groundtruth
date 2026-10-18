"use client";
// "What's here": a right-click on the globe (or ⌘K on the camera target) asks
// what this app knows about one point, from sources it already uses:
//
//   loaded     the nearest features the layers that are on have loaded
//   place      the constructs stack at the point (/api/fabric): country, state,
//              county, city, ZIP code area, watershed, NWS office
//   elevation  USGS 3DEP (/api/land?op=elevation), United States
//   geology    the Macrostrat map unit (/api/infra?op=geology), worldwide
//   survey     the PLSS township and section (/api/infra?op=plss), PLSS states
//
// Each part answers on its own and says so when its source did not; none is
// guessed. Nothing here reverse-geocodes an address. The point travels in share
// links as `here=lat,lon`.

import { create } from "zustand";
import type * as CesiumNS from "cesium";
import { getCesium } from "@/lib/globe/cesium";
import { allFeatures } from "@/lib/globe/registry";
import type { LayerFeature, LayerId } from "@/lib/layers/types";
import type { ConstructNode, Fabric } from "@/lib/fabric/types";
import type { GeologyAnswer } from "@/lib/infra/geology";
import { countable } from "@/lib/aoi/area";
import { featurePoint, metres, pointInPolygon, polygons } from "@/lib/aoi/geometry";
import { townshipName } from "@/lib/infra/features";

export type HerePart = "place" | "elevation" | "geology" | "survey";

export interface HereState<T = unknown> {
  loading: boolean;
  error?: string;
  data?: T;
}

export interface HerePick {
  lon: number;
  lat: number;
  seq: number;
  parts: Partial<Record<HerePart, HereState>>;
}

interface Store {
  pick: HerePick | null;
  set: (pick: HerePick | null) => void;
}

export const useHere = create<Store>()((set) => ({ pick: null, set: (pick) => set({ pick }) }));

/** The loaded features nearest a point, within `maxM`, nearest first. */
export function nearestLoaded(features: Iterable<LayerFeature>, lon: number, lat: number, maxM = 50_000, max = 8): Array<{ f: LayerFeature; m: number }> {
  const out: Array<{ f: LayerFeature; m: number }> = [];
  for (const f of features) {
    if (!countable(f)) continue;
    const p = featurePoint(f);
    if (!p) continue;
    const m = metres([lon, lat], p);
    if (m <= maxM) out.push({ f, m });
  }
  return out.sort((a, b) => a.m - b.m).slice(0, max);
}

/** The constructs of a stack worth one line each here, smallest first. */
const PLACE_KINDS: Record<string, string> = {
  country: "country",
  state: "state",
  county: "county",
  place: "city or town",
  cdp: "census-designated place",
  tribal: "tribal area",
  zcta: "ZIP code area",
  huc12: "subwatershed",
  "nws-office": "NWS forecast office",
  cd: "congressional district",
};

export function placeLines(f: Fabric): Array<{ kind: string; name: string; code?: string }> {
  const out: Array<{ kind: string; name: string; code?: string }> = [];
  for (const n of f.nodes as ConstructNode[]) {
    const k = PLACE_KINDS[n.kind];
    if (k) out.push({ kind: k, name: n.name, code: n.code });
  }
  return out;
}

export interface SurveyAnswer {
  township?: string;
  range?: string;
  meridian?: string;
  state?: string;
  section?: string;
  plssId?: string;
}

/** The township and section polygons (from /api/infra?op=plss) that hold the point. */
export function surveyAt(lon: number, lat: number, townships: LayerFeature[], sections: LayerFeature[]): SurveyAnswer | null {
  const hit = (fs: LayerFeature[]) => fs.find((f) => f.properties.kind !== "loaded-box" && polygons(f.geometry).some((p) => pointInPolygon(lon, lat, p)));
  const t = hit(townships);
  const s = hit(sections);
  if (!t && !s) return null;
  const tr = t ? townshipName(String((t.properties.extra as { label?: string } | undefined)?.label ?? "")) : {};
  return {
    township: tr.township,
    range: tr.range,
    meridian: t ? String(t.properties.details?.["principal meridian"] ?? "") || undefined : undefined,
    state: t ? String(t.properties.details?.state ?? "") || undefined : undefined,
    section: s ? String(s.properties.details?.section ?? "") || undefined : undefined,
    plssId: String((t ?? s)!.properties.details?.["PLSS id"] ?? "") || undefined,
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const j = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.data as T;
}

const ASK: Record<HerePart, (lon: number, lat: number) => Promise<unknown>> = {
  place: (lon, lat) => getJson<Fabric>(`/api/fabric?op=stack&lon=${lon.toFixed(3)}&lat=${lat.toFixed(3)}`).then(placeLines),
  elevation: (lon, lat) => getJson(`/api/land?op=elevation&lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}`),
  geology: (lon, lat) => getJson<GeologyAnswer>(`/api/infra?op=geology&lon=${lon.toFixed(4)}&lat=${lat.toFixed(4)}`),
  survey: async (lon, lat) => {
    const box = (d: number) => [lon - d, lat - d, lon + d, lat + d].map((x) => x.toFixed(4)).join(",");
    const [t, s] = await Promise.all([
      getJson<{ features: LayerFeature[] }>(`/api/infra?op=plss&level=township&bbox=${box(0.01)}`),
      getJson<{ features: LayerFeature[] }>(`/api/infra?op=plss&level=section&bbox=${box(0.005)}`),
    ]);
    return surveyAt(lon, lat, t.features, s.features);
  },
};

let seq = 0;

/** Ask every part about a point and open the panel; answers land as they come. */
export async function openHere(lon: number, lat: number): Promise<void> {
  const n = ++seq;
  const x = Number(lon.toFixed(5));
  const y = Number(lat.toFixed(5));
  const parts: HerePart[] = ["place", "elevation", "geology", "survey"];
  useHere.getState().set({ lon: x, lat: y, seq: n, parts: Object.fromEntries(parts.map((p) => [p, { loading: true }])) });
  await Promise.all(
    parts.map(async (k) => {
      let st: HereState;
      try {
        st = { loading: false, data: await ASK[k](x, y) };
      } catch (err) {
        st = { loading: false, error: err instanceof Error ? err.message : String(err) };
      }
      const cur = useHere.getState().pick;
      if (cur && cur.seq === n) useHere.getState().set({ ...cur, parts: { ...cur.parts, [k]: st } });
    }),
  );
}

export function closeHere(): void {
  useHere.getState().set(null);
}

/** The nearest loaded features to the open point (read at render time). */
export function hereNearest(p: Pick<HerePick, "lon" | "lat">, maxM?: number): Array<{ f: LayerFeature; m: number; layer: LayerId }> {
  return nearestLoaded(allFeatures(), p.lon, p.lat, maxM).map((x) => ({ ...x, layer: x.f.properties.layer }));
}

/** Draws a marker where "what's here" was asked; returns a disposer. */
export function startHereOverlay(viewer: CesiumNS.Viewer): () => void {
  const C = getCesium();
  const scene = viewer.scene;
  const points = scene.primitives.add(new C.PointPrimitiveCollection());
  const draw = () => {
    if (viewer.isDestroyed()) return;
    points.removeAll();
    const p = useHere.getState().pick;
    if (!p) return;
    points.add({
      position: C.Cartesian3.fromDegrees(p.lon, p.lat, 0),
      pixelSize: 11,
      color: C.Color.fromCssColorString("#7DD3FC"),
      outlineColor: C.Color.BLACK.withAlpha(0.85),
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    });
  };
  draw();
  const unsub = useHere.subscribe(draw);
  return () => {
    unsub();
    if (!viewer.isDestroyed() && scene.primitives.contains(points)) scene.primitives.remove(points);
  };
}
