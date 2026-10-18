"use client";
// Desk mode: a light, dense analyst workspace over the same globe and data.
// This store owns everything desk-specific (mode, theme, pane width, active
// tab, chart series, notes) and persists it to localStorage under "gev:desk".
// It never touches lib/store/globe.ts. The one cross-store effect is the
// cinematic idle drift: CesiumGlobe gates it on the settings pref alone, so
// entering desk mode turns that pref off and leaving restores what it was.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSettings } from "@/lib/store/settings";
import { colorAt, SERIES_COLORS } from "./chart";
import type { SeriesRef } from "./api";

export type DeskMode = "hud" | "desk";
export type DeskTheme = "light" | "dark";
export type DeskTab = "table" | "chart" | "report" | "notes";

/** Tabs in display order. Adding a tab = one entry here plus a panel in DeskLayout. */
export const DESK_TABS: Array<{ id: DeskTab; label: string; hint: string }> = [
  { id: "table", label: "Table", hint: "Loaded features of the economy layers as a sortable, exportable table" },
  { id: "chart", label: "Chart", hint: "Compare published series, indicators and county history on one chart" },
  { id: "report", label: "Report", hint: "Market and water reports side by side, printable" },
  { id: "notes", label: "Notes", hint: "Your notes, copied out as markdown with a permalink" },
];

export const PANE_MIN_PX = 360;
/** Pane may take at most this share of the window. */
export const PANE_MAX_FRACTION = 0.6;
export const PANE_DEFAULT_PX = 560;
/** Keep persisted notes bounded; localStorage quotas are small and shared. */
export const NOTES_MAX_CHARS = 100_000;
export const SERIES_MAX = 12;

export interface DeskState {
  mode: DeskMode;
  theme: DeskTheme;
  paneWidth: number;
  tab: DeskTab;
  series: SeriesRef[];
  notes: string;
  /** The operator's cinematic pref before desk turned it off; null while not in desk. */
  savedCinematic: boolean | null;

  setMode: (mode: DeskMode) => void;
  toggleMode: () => void;
  setTheme: (theme: DeskTheme) => void;
  setPaneWidth: (px: number) => void;
  setTab: (tab: DeskTab) => void;
  addSeries: (ref: Omit<SeriesRef, "color"> & { color?: string }) => void;
  removeSeries: (id: string) => void;
  setSeriesColor: (id: string, color: string) => void;
  clearSeries: () => void;
  setNotes: (notes: string) => void;
}

/** Clamp a pane width to [PANE_MIN_PX, PANE_MAX_FRACTION × window]; the max never drops below the min. */
export function clampPane(px: number, windowWidth: number): number {
  const max = Math.max(PANE_MIN_PX, Math.floor(windowWidth * PANE_MAX_FRACTION));
  if (!Number.isFinite(px)) return Math.min(PANE_DEFAULT_PX, max);
  return Math.min(max, Math.max(PANE_MIN_PX, Math.round(px)));
}

/** `?mode=desk` / `?mode=hud` from a search string; null when absent or unknown. */
export function parseDeskMode(search: string): DeskMode | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const m = q.get("mode");
  return m === "desk" || m === "hud" ? m : null;
}

/** A URL (path + search + hash) with `mode=desk` present or removed. Other params are kept in place. */
export function withDeskParam(url: string, mode: DeskMode): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = noHash.indexOf("?");
  const path = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const q = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : "");
  if (mode === "desk") q.set("mode", "desk");
  else q.delete("mode");
  const s = q.toString();
  return `${path}${s ? `?${s}` : ""}${hash}`;
}

/** Reflect mode and theme on <html> so CSS can restyle the whole cockpit. */
export function applyDeskDom(mode: DeskMode, theme: DeskTheme): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  if (mode === "desk") {
    el.dataset.mode = "desk";
    el.dataset.theme = theme;
  } else {
    delete el.dataset.mode;
    delete el.dataset.theme;
  }
}

/** Put `mode=desk` in (or take it out of) the address bar without a reload or a history entry. */
export function syncDeskUrl(mode: DeskMode): void {
  if (typeof window === "undefined" || !window.location || !window.history) return;
  const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = withDeskParam(cur, mode);
  if (next === cur) return;
  try {
    window.history.replaceState(window.history.state, "", next);
  } catch {
    /* some embedders forbid it */
  }
}

/** Turn drift off on entry (remembering the pref) and restore it on exit. Pure of the DOM; safe in tests. */
function applyDrift(prev: DeskState, mode: DeskMode): { savedCinematic: boolean | null } {
  const settings = useSettings.getState();
  if (mode === "desk" && prev.mode !== "desk") {
    const was = settings.prefs.cinematic;
    if (was) settings.setPref("cinematic", false);
    return { savedCinematic: was };
  }
  if (mode === "hud" && prev.mode === "desk") {
    if (prev.savedCinematic != null) settings.setPref("cinematic", prev.savedCinematic);
    return { savedCinematic: null };
  }
  return { savedCinematic: prev.savedCinematic };
}

export const useDesk = create<DeskState>()(
  persist(
    (set, get) => ({
      mode: "hud",
      theme: "light",
      paneWidth: PANE_DEFAULT_PX,
      tab: "table",
      series: [],
      notes: "",
      savedCinematic: null,

      setMode: (mode) => {
        const prev = get();
        if (prev.mode === mode) return;
        const drift = applyDrift(prev, mode);
        set({ mode, ...drift });
        applyDeskDom(mode, prev.theme);
        syncDeskUrl(mode);
      },
      toggleMode: () => get().setMode(get().mode === "desk" ? "hud" : "desk"),
      setTheme: (theme) => {
        set({ theme });
        applyDeskDom(get().mode, theme);
      },
      setPaneWidth: (px) => set({ paneWidth: clampPane(px, (typeof window === "undefined" ? 0 : window.innerWidth) || 1920) }),
      setTab: (tab) => set({ tab }),
      addSeries: (ref) =>
        set((s) => {
          if (s.series.some((x) => x.id === ref.id)) return s;
          if (s.series.length >= SERIES_MAX) return s;
          // First colour not already in use, else cycle.
          const used = new Set(s.series.map((x) => x.color));
          const color = ref.color ?? SERIES_COLORS.find((c) => !used.has(c)) ?? colorAt(s.series.length);
          return { series: [...s.series, { id: ref.id, label: ref.label, source: ref.source, color }] };
        }),
      removeSeries: (id) => set((s) => ({ series: s.series.filter((x) => x.id !== id) })),
      setSeriesColor: (id, color) => set((s) => ({ series: s.series.map((x) => (x.id === id ? { ...x, color } : x)) })),
      clearSeries: () => set({ series: [] }),
      setNotes: (notes) => set({ notes: notes.length > NOTES_MAX_CHARS ? notes.slice(0, NOTES_MAX_CHARS) : notes }),
    }),
    {
      name: "gev:desk",
      version: 1,
      partialize: (s) => ({ mode: s.mode, theme: s.theme, paneWidth: s.paneWidth, tab: s.tab, series: s.series, notes: s.notes, savedCinematic: s.savedCinematic }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DeskState>;
        return {
          ...current,
          mode: p.mode === "desk" ? "desk" : "hud",
          theme: p.theme === "dark" ? "dark" : "light",
          paneWidth: typeof p.paneWidth === "number" ? p.paneWidth : current.paneWidth,
          tab: DESK_TABS.some((t) => t.id === p.tab) ? (p.tab as DeskTab) : current.tab,
          series: Array.isArray(p.series) ? p.series.filter((x) => x && typeof x.id === "string").slice(0, SERIES_MAX) : [],
          notes: typeof p.notes === "string" ? p.notes : "",
          savedCinematic: typeof p.savedCinematic === "boolean" ? p.savedCinematic : null,
        };
      },
    },
  ),
);

/**
 * Call once on mount. `?mode=desk` (or `?mode=hud`) in the URL wins over the
 * persisted mode; otherwise the persisted mode is applied to the DOM. Returns
 * the mode in effect.
 */
export function initDeskFromUrl(search: string = typeof window === "undefined" ? "" : (window.location?.search ?? "")): DeskMode {
  const fromUrl = parseDeskMode(search);
  const st = useDesk.getState();
  if (fromUrl && fromUrl !== st.mode) {
    st.setMode(fromUrl);
  } else {
    // A persisted desk session that reloaded: the pref is already off, but the DOM and URL need setting.
    applyDeskDom(st.mode, st.theme);
    syncDeskUrl(st.mode);
  }
  return useDesk.getState().mode;
}
