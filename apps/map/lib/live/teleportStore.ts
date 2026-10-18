"use client";
// Teleport: fly to wherever the world is doing something unusual right now,
// strongest first (lib/live/live.ts orders them), and land in the
// constructs world. Each hop switches on what makes the place legible: the
// live warning itself and the stack of constructs under it; for a flood, the
// gauges and the construct field lit by streamflow against normal; for an
// earthquake, the earthquake layer. Autoplay moves on every DWELL_S.

import { create } from "zustand";
import { flyTo } from "@/lib/globe/camera";
import { getRenderer } from "@/lib/globe/registry";
import { useGlobe } from "@/lib/store/globe";
import { useSettings } from "@/lib/store/settings";
import type { LiveFeed } from "./fetch";
import type { LiveItem } from "./live";

export const DWELL_S = 20;

export interface TeleportState {
  status: "idle" | "loading" | "ready" | "error";
  active: boolean;
  items: LiveItem[];
  index: number;
  auto: boolean;
  startedAt: number;
  error: string | null;
  start: () => Promise<void>;
  go: (i: number) => void;
  next: () => void;
  setAuto: (on: boolean) => void;
  stop: () => void;
}

/** Camera height that frames an item: a warning's extent, or a fixed height for a point. */
export function frameHeight(item: Pick<LiveItem, "bbox" | "kind">): number {
  if (!item.bbox) return item.kind === "quake" ? 700_000 : 250_000;
  const [w, s, e, n] = item.bbox;
  const km = Math.max((e - w) * 111 * Math.cos((((s + n) / 2) * Math.PI) / 180), (n - s) * 111);
  return Math.round(Math.min(2_500_000, Math.max(60_000, km * 1000 * 1.8)));
}

let selectTimer: ReturnType<typeof setTimeout> | null = null;

function land(item: LiveItem) {
  const g = useGlobe.getState();
  // A tour of presets and a teleport cannot both drive the camera.
  if (g.tour.active) g.setTour({ active: false, paused: false });
  g.setLayer("constructs", true);
  if (item.kind === "alert") g.setLayer("alerts", true);
  if (item.kind === "quake") g.setLayer("earthquakes", true);
  if (item.family === "flood" || item.family === "coastal") {
    g.setLayer("water", true);
    g.setLayer("field", true);
    const s = useSettings.getState();
    s.setPref("fieldPov", "hydrologic");
    s.setPref("fieldMeasure", "streamflow");
  }
  flyTo(item.lon, item.lat, { height: frameHeight(item), pitchDeg: -60, durationS: 3.5 });
  g.pushLog({ level: "info", text: `Teleport: ${item.title} · ${item.subtitle}` });
  // Select the thing itself once the camera is there and its layer has it.
  if (selectTimer) clearTimeout(selectTimer);
  selectTimer = setTimeout(() => {
    const layer = item.kind === "alert" ? "alerts" : "earthquakes";
    const f = getRenderer(layer)?.getFeature(item.id);
    if (f) useGlobe.getState().select({ layer, id: item.id }, f);
  }, 4200);
}

export const useTeleport = create<TeleportState>()((set, get) => ({
  status: "idle",
  active: false,
  items: [],
  index: 0,
  auto: false,
  startedAt: 0,
  error: null,
  start: async () => {
    set({ active: true, status: get().items.length ? "ready" : "loading", error: null });
    try {
      const r = await fetch("/api/live");
      const j = (await r.json()) as { data?: LiveFeed; error?: string };
      if (!r.ok || !j.data) throw new Error(j.error ?? `live feed ${r.status}`);
      if (!get().active) return;
      set({ items: j.data.items, status: "ready", index: 0 });
      if (j.data.items.length) get().go(0);
    } catch (err) {
      set({ status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  },
  go: (i) => {
    const items = get().items;
    if (!items.length) return;
    const index = ((i % items.length) + items.length) % items.length;
    set({ index, startedAt: Date.now() });
    land(items[index]);
  },
  next: () => get().go(get().index + 1),
  setAuto: (on) => set({ auto: on, startedAt: Date.now() }),
  stop: () => {
    if (selectTimer) clearTimeout(selectTimer);
    set({ active: false, auto: false });
  },
}));
