"use client";
// Play modes: two game-flavoured ways to explore the atlas that stay honest
// about the data. Command mode is fog-of-war exploration: click to march a
// probe and claim the county under it; the veil lifts only where you have
// been. Fisherman mode casts a line at a click and reels in the county's
// nearest housing-trajectory twins from county-sim-v1. Neither mode invents
// data: the veil tracks your own trail, the catch is the published
// similarity embedding, and open water honestly reports no bite.
//
// This store owns everything play-specific and never touches
// lib/store/globe.ts, except the one cross-store effect below: a play mode
// owns globe clicks the way a measure tool does, so entering one parks the
// measure tool (and entering measure parks the play mode, in TopBar).

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useGlobe } from "@/lib/store/globe";

export type PlayMode = "off" | "command" | "fisherman";

export interface ConqueredCounty {
  fips: string;
  name: string;
  state: string;
  lon: number;
  lat: number;
  at: number;
}

export interface CastPoint {
  lon: number;
  lat: number;
  fips: string | null;
  name: string | null;
  state: string | null;
  at: number;
}

export interface HaulItem {
  fips: string;
  name: string;
  state: string;
  distance: number;
  similarity: number;
}

export interface Haul {
  fips: string;
  modelVersion: string;
  vintage: string;
  modelCard: string;
  caveat: string;
  items: HaulItem[];
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

interface PlayState {
  mode: PlayMode;
  setMode: (mode: PlayMode) => void;
  /** Counties claimed in Command mode, oldest first. */
  conquered: ConqueredCounty[];
  conquer: (c: Omit<ConqueredCounty, "at">) => void;
  clearConquered: () => void;
  /** Where the probe stands in Command mode. */
  probe: { lon: number; lat: number } | null;
  setProbe: (p: { lon: number; lat: number } | null) => void;
  /** Where the hook landed in Fisherman mode. */
  cast: CastPoint | null;
  setCast: (c: CastPoint | null) => void;
  haul: Haul | null;
  setHaul: (h: Haul | null) => void;
  reeling: boolean;
  setReeling: (b: boolean) => void;
  castError: string | null;
  setCastError: (e: string | null) => void;
}

export const usePlay = create<PlayState>()(
  persist(
    (set) => ({
      mode: "off",
      setMode: (mode) =>
        set((s) => {
          if (s.mode === mode) return s;
          if (mode !== "off") {
            // A play mode owns globe clicks; park the measure tool first.
            const g = useGlobe.getState();
            if (g.measure.mode !== "off") g.setMeasure({ mode: "off" });
          }
          return { mode };
        }),
      conquered: [],
      conquer: (c) =>
        set((s) => {
          if (s.conquered.some((e) => e.fips === c.fips)) return s;
          return { conquered: [...s.conquered, { ...c, at: Date.now() }].slice(-500) };
        }),
      clearConquered: () => set({ conquered: [], probe: null }),
      probe: null,
      setProbe: (probe) => set({ probe }),
      cast: null,
      setCast: (cast) => set({ cast }),
      haul: null,
      setHaul: (haul) => set({ haul }),
      reeling: false,
      setReeling: (reeling) => set({ reeling }),
      castError: null,
      setCastError: (castError) => set({ castError }),
    }),
    {
      name: "gev:play",
      storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage() : window.localStorage)),
      // Territory survives a reload; the ephemeral cast/haul/probe do not.
      partialize: (s) => ({ mode: s.mode, conquered: s.conquered }),
    },
  ),
);
