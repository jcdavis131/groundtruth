"use client";
// UI state for the releases workstream: the pinned vintage and whether the
// releases panel is open. Kept out of lib/store/globe.ts on purpose; the
// permalink code (lib/globe/share.ts) reads `getVintage()` from here.
//
// What a vintage means today: `vintage` is an ISO date (YYYY-MM-DD). When set,
// the permalink carries `&v=YYYY-MM-DD`, the mission clock is pinned to noon
// UTC of that date and the HUD shows "VINTAGE 2026-08-15". Layers that can
// read history (the series store, Zillow history) will honour it later; the
// live layers ignore it. Clearing it (null) drops the `v=` parameter and
// leaves the clock where it is.

import { create } from "zustand";

export type MoverTableId = "zillow" | "qcew" | "border" | "ports";
export type ReleasesTab = "calendar" | "vintages" | "movers";

interface ReleasesState {
  /** Pinned data vintage, ISO date, or null for "latest". */
  vintage: string | null;
  setVintage: (vintage: string | null) => void;
  releasesOpen: boolean;
  setReleasesOpen: (open: boolean) => void;
  tab: ReleasesTab;
  setTab: (tab: ReleasesTab) => void;
  moverTable: MoverTableId;
  setMoverTable: (table: MoverTableId) => void;
}

const VINTAGE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written YYYY-MM-DD (UTC). */
export function isValidVintage(v: string): boolean {
  if (!VINTAGE_RE.test(v)) return false;
  const ms = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === v;
}

export const useReleases = create<ReleasesState>()((set) => ({
  vintage: null,
  setVintage: (vintage) => set({ vintage: vintage && isValidVintage(vintage) ? vintage : null }),
  releasesOpen: false,
  setReleasesOpen: (releasesOpen) => set({ releasesOpen }),
  tab: "calendar",
  setTab: (tab) => set({ tab }),
  moverTable: "zillow",
  setMoverTable: (moverTable) => set({ moverTable }),
}));

/** Module-level read for code that must not subscribe (permalinks, exports). */
export function getVintage(): string | null {
  return useReleases.getState().vintage;
}

/** Epoch ms for noon UTC of a vintage date; what the mission clock is pinned to. */
export function vintageClockMs(vintage: string): number {
  return Date.parse(vintage + "T12:00:00Z");
}
