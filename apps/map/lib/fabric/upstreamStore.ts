"use client";
// The upstream catchment the HUD is showing, and what its rivers are doing.
//
// One call returns the catchment as a cover of whole WBD units (from the
// bundled table, instant). Outlines stream in behind it, coarse units first,
// up to DRAW_CAP; past that only names and areas are asked for, so the area
// is complete even when the drawing is not. Then the gauges near the outlet
// that lie inside the catchment are read with their flow percentile for the
// day and any NWS flood category: what is coming down toward the point.

import { create } from "zustand";
import { bboxContains, ringsBbox, ringsContain, type BBox } from "./geo";
import { FLOOD_CATEGORIES, flowClass, flowPercentile, median, type FlowClass, type FlowNormals } from "./condition";
import type { CoverUnit, HucLevel } from "./upstream";
import type { UpstreamResult } from "./fetch";

/** Most units drawn; the rest contribute names and areas only. */
export const DRAW_CAP = 600;
const OUTLINE_BATCH = 100;
const ATTR_BATCH = 500;
/** The gauge query box around the outlet, degrees (the water API's own limit). */
const GAUGE_BOX_DEG = 4;

export interface UpstreamGauge {
  site: string;
  name: string;
  lon: number;
  lat: number;
  flow: number | null;
  time: string | null;
  pct: number | null;
  cls: FlowClass | null;
  /** NWS flood category at a forecast point matched to the gauge, when one is in flood. */
  flood?: string;
}

export interface UpstreamState {
  status: "idle" | "loading" | "ready" | "error";
  point: { lon: number; lat: number } | null;
  startName: string;
  huc12s: number;
  cover: CoverUnit[];
  byLevel: Partial<Record<HucLevel, number>>;
  basins: string[];
  outlines: Record<string, number[][][]>;
  names: Record<string, string>;
  areas: Record<string, number>;
  pending: number;
  gaugeStatus: "idle" | "loading" | "ready" | "error";
  gaugeBox: BBox | null;
  gauges: UpstreamGauge[];
  /** NWS forecast points in flood inside the catchment and the box, with no USGS gauge beside them. */
  floods: Array<{ lid: string; name: string; lon: number; lat: number; category: string }>;
  error: string | null;
  run: (lon: number, lat: number) => Promise<void>;
  clear: () => void;
}

async function getData<T>(url: string): Promise<T> {
  const r = await fetch(url);
  const j = (await r.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!r.ok || !j.data) throw new Error(j.error ?? `${r.status} from ${url}`);
  return j.data;
}

const EMPTY = {
  status: "idle" as const,
  point: null,
  startName: "",
  huc12s: 0,
  cover: [],
  byLevel: {},
  basins: [],
  outlines: {},
  names: {},
  areas: {},
  pending: 0,
  gaugeStatus: "idle" as const,
  gaugeBox: null,
  gauges: [],
  floods: [],
  error: null,
};

let seq = 0;

/** Sum of the published areas that have arrived. */
export function upstreamAreaKm2(s: Pick<UpstreamState, "cover" | "areas">): { km2: number; known: number } {
  let km2 = 0;
  let known = 0;
  for (const u of s.cover) {
    const a = s.areas[u.code];
    if (a != null) {
      km2 += a;
      known++;
    }
  }
  return { km2, known };
}

/** The condition of the gauges read: median percentile, classes, floods. */
export function upstreamCondition(gauges: UpstreamGauge[]) {
  const pcts = gauges.map((g) => g.pct).filter((p): p is number => p != null);
  const classes: Partial<Record<FlowClass, number>> = {};
  for (const p of pcts) classes[flowClass(p)] = (classes[flowClass(p)] ?? 0) + 1;
  return { median: median(pcts), rated: pcts.length, classes, flooding: gauges.filter((g) => g.flood).length };
}

function inside(outlines: Record<string, number[][][]>, boxes: Map<string, BBox>, lon: number, lat: number): boolean {
  for (const [code, rings] of Object.entries(outlines)) {
    const b = boxes.get(code);
    if (b && bboxContains(b, lon, lat) && ringsContain(rings, lon, lat)) return true;
  }
  return false;
}

interface GaugeRow {
  site: string;
  name?: string;
  lon: number;
  lat: number;
  param: string;
  value: number;
  unit: string;
  time: string;
}

interface NwpsRow {
  lid: string;
  name: string;
  lat: number;
  lon: number;
  observed?: { floodCategory?: string };
}

export const useUpstream = create<UpstreamState>()((set, get) => ({
  ...EMPTY,
  run: async (lon, lat) => {
    const my = ++seq;
    const alive = () => my === seq;
    set({ ...EMPTY, status: "loading", point: { lon, lat } });
    let u: UpstreamResult;
    try {
      u = await getData<UpstreamResult>(`/api/fabric?op=upstream&lon=${lon.toFixed(3)}&lat=${lat.toFixed(3)}`);
    } catch (err) {
      if (alive()) set({ status: "error", error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!alive()) return;
    // Coarse units first: they carry most of the area and read at a glance.
    const cover = [...u.cover].sort((a, b) => a.level - b.level || a.code.localeCompare(b.code));
    set({ startName: u.startName, huc12s: u.huc12s, cover, byLevel: u.byLevel, basins: u.basins, pending: cover.length });

    const drawn = cover.slice(0, DRAW_CAP).map((c) => c.code);
    const rest = cover.slice(DRAW_CAP).map((c) => c.code);
    const batches: Array<{ codes: string[]; geometry: boolean }> = [];
    for (let i = 0; i < drawn.length; i += OUTLINE_BATCH) batches.push({ codes: drawn.slice(i, i + OUTLINE_BATCH), geometry: true });
    for (let i = 0; i < rest.length; i += ATTR_BATCH) batches.push({ codes: rest.slice(i, i + ATTR_BATCH), geometry: false });
    const one = async (b: { codes: string[]; geometry: boolean }) => {
      try {
        const d = await getData<{ outlines: Record<string, number[][][]>; names: Record<string, string>; areas: Record<string, number> }>(
          `/api/fabric?op=units&codes=${b.codes.join(",")}${b.geometry ? "" : "&geometry=0"}`,
        );
        if (!alive()) return;
        set((s) => ({
          outlines: { ...s.outlines, ...d.outlines },
          names: { ...s.names, ...d.names },
          areas: { ...s.areas, ...d.areas },
          pending: Math.max(0, s.pending - b.codes.length),
        }));
      } catch {
        if (alive()) set((s) => ({ pending: Math.max(0, s.pending - b.codes.length) }));
      }
    };
    // Two in flight: WBD is slow cold, and the politeness gate spaces them anyway.
    const queue = [...batches];
    await Promise.all([0, 1].map(async () => {
      while (queue.length && alive()) await one(queue.shift()!);
    }));
    if (!alive()) return;
    set({ status: "ready" });
    await readGauges(lon, lat, alive, set, get);
  },
  clear: () => {
    seq++;
    set({ ...EMPTY });
  },
}));

async function readGauges(lon: number, lat: number, alive: () => boolean, set: (p: Partial<UpstreamState>) => void, get: () => UpstreamState) {
  const { outlines } = get();
  const boxes = new Map<string, BBox>();
  let catchment: BBox | null = null;
  for (const [code, rings] of Object.entries(outlines)) {
    const b = ringsBbox(rings);
    if (!b) continue;
    boxes.set(code, b);
    catchment = catchment ? [Math.min(catchment[0], b[0]), Math.min(catchment[1], b[1]), Math.max(catchment[2], b[2]), Math.max(catchment[3], b[3])] : b;
  }
  if (!catchment) return;
  const h = GAUGE_BOX_DEG / 2;
  const box: BBox = [Math.max(catchment[0], lon - h), Math.max(catchment[1], lat - h), Math.min(catchment[2], lon + h), Math.min(catchment[3], lat + h)];
  set({ gaugeStatus: "loading", gaugeBox: box });
  try {
    const bbox = box.map((x) => x.toFixed(3)).join(",");
    const [rows, nwps] = await Promise.all([
      getData<GaugeRow[]>(`/api/water?op=gauges&param=00060&bbox=${bbox}`),
      getData<NwpsRow[]>(`/api/water?op=nwps&bbox=${bbox}`).catch(() => [] as NwpsRow[]),
    ]);
    if (!alive()) return;
    const latest = new Map<string, GaugeRow>();
    for (const r of rows) {
      if (r.param !== "00060" || !Number.isFinite(r.value) || !inside(outlines, boxes, r.lon, r.lat)) continue;
      const prev = latest.get(r.site);
      if (!prev || Date.parse(prev.time) < Date.parse(r.time)) latest.set(r.site, r);
    }
    const sites = [...latest.keys()].map((s) => s.replace(/^USGS-/, ""));
    const normals: Record<string, FlowNormals | null> = {};
    const now = new Date();
    const date = `${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    for (let i = 0; i < sites.length; i += 100) {
      const d = await getData<Record<string, FlowNormals | null>>(`/api/water?op=normals&date=${date}&sites=${sites.slice(i, i + 100).join(",")}`).catch(() => ({}));
      Object.assign(normals, d);
    }
    if (!alive()) return;
    const floodsIn = nwps.filter((n) => FLOOD_CATEGORIES.has((n.observed?.floodCategory ?? "").toLowerCase()) && inside(outlines, boxes, n.lon, n.lat));
    const near = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => Math.abs(a.lon - b.lon) < 0.002 && Math.abs(a.lat - b.lat) < 0.002;
    const gauges: UpstreamGauge[] = [...latest.values()].map((r) => {
      const n = normals[r.site.replace(/^USGS-/, "")];
      const pct = n ? flowPercentile(r.value, n) : null;
      const flood = floodsIn.find((f) => near(f, r))?.observed?.floodCategory;
      return { site: r.site, name: r.name ?? r.site, lon: r.lon, lat: r.lat, flow: r.value, time: r.time, pct, cls: pct != null ? flowClass(pct) : null, ...(flood ? { flood } : {}) };
    });
    // Furthest from normal first.
    gauges.sort((a, b) => (b.flood ? 1 : 0) - (a.flood ? 1 : 0) || Math.abs((b.pct ?? 50) - 50) - Math.abs((a.pct ?? 50) - 50));
    const floods = floodsIn
      .filter((f) => !gauges.some((g) => near(f, g)))
      .map((f) => ({ lid: f.lid, name: f.name, lon: f.lon, lat: f.lat, category: f.observed!.floodCategory! }));
    set({ gauges, floods, gaugeStatus: "ready" });
  } catch (err) {
    if (alive()) set({ gaugeStatus: "error", error: err instanceof Error ? err.message : String(err) });
  }
}
