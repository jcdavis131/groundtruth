"use client";
// Runtime UI state for the cockpit: which layers are on, what is selected,
// where the camera is, the mission clock and the signal log.

import { create } from "zustand";
import type { LayerId, LayerFeature, ViewState } from "@/lib/layers/types";
import { LAYER_IDS } from "@/lib/layers/types";

export interface Selection {
  layer: LayerId;
  id: string;
}

export interface LayerStatus {
  count: number;
  source: string;
  fetchedAt: number;
  loading: boolean;
  error?: string;
  note?: string;
  /** A picture layer (tiled imagery): it has no feature count, the panel says MAP. */
  picture?: boolean;
  /** The view key the drawn answer was fetched for ("static" when not view-dependent); see FetchResult.viewKey. */
  viewKey?: string;
  /** The view the drawn answer was fetched with; see FetchResult.fetchView. */
  fetchView?: ViewState;
  /** The drawn answer is still filling in; see FetchResult.settling. */
  settling?: boolean;
}

export interface LogEntry {
  t: number;
  level: "info" | "warn" | "alert";
  text: string;
  layer?: LayerId;
}

/** Measure tools: what a click on the globe does while one is active. */
export type MeasureMode = "off" | "distance" | "area" | "elevation";

/** A drawn line or area, [lon, lat] vertices in click order. Travels in share links. */
export interface Shape {
  kind: "line" | "area";
  points: Array<[number, number]>;
}

export interface ElevationPick {
  lon: number;
  lat: number;
  loading: boolean;
  metres?: number;
  resolutionM?: number;
  /** The service's own words when it answered without a value. */
  note?: string;
  error?: string;
}

export interface MeasureState {
  mode: MeasureMode;
  shape: Shape | null;
  elevation: ElevationPick | null;
}

export interface ClockState {
  /** Offset of the mission clock from wall-clock time, ms. 0 = LIVE. */
  offsetMs: number;
  /** Clock rate multiplier while animating. */
  multiplier: number;
  /** Whether the Cesium clock advances. */
  animate: boolean;
  /** Time machine engaged: layers redraw for the playback year instead of latest. */
  timeMachine: boolean;
}

interface GlobeState {
  ready: boolean;
  setReady: (ready: boolean) => void;

  layers: Record<LayerId, boolean>;
  toggleLayer: (id: LayerId) => void;
  setLayer: (id: LayerId, on: boolean) => void;

  status: Partial<Record<LayerId, LayerStatus>>;
  setStatus: (id: LayerId, patch: Partial<LayerStatus>) => void;

  selected: Selection | null;
  selectedFeature: LayerFeature | null;
  select: (sel: Selection | null, feature?: LayerFeature | null) => void;
  hover: Selection | null;
  setHover: (sel: Selection | null) => void;

  following: boolean;
  setFollowing: (on: boolean) => void;

  view: ViewState;
  setView: (view: ViewState) => void;

  clock: ClockState;
  setClock: (patch: Partial<ClockState>) => void;

  /** Playback year the time-aware layers are drawn for; null when live. */
  playbackYear: number | null;
  setPlaybackYear: (year: number | null) => void;

  log: LogEntry[];
  pushLog: (entry: Omit<LogEntry, "t">) => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  searchOpen: boolean;
  /** `seed` prefills the palette, e.g. with what was typed in the home page's search field. */
  setSearchOpen: (open: boolean, seed?: string) => void;
  searchSeed: string;
  waterReportOpen: boolean;
  setWaterReportOpen: (open: boolean) => void;
  marketReportOpen: boolean;
  setMarketReportOpen: (open: boolean) => void;
  exploreOpen: boolean;
  setExploreOpen: (open: boolean) => void;
  spaceWeatherOpen: boolean;
  setSpaceWeatherOpen: (open: boolean) => void;
  insightsOpen: boolean;
  setInsightsOpen: (open: boolean) => void;
  measure: MeasureState;
  setMeasure: (patch: Partial<MeasureState>) => void;
  /** ?embed=1: no HUD chrome, for iframes. */
  embed: boolean;
  setEmbed: (embed: boolean) => void;
  /** Guided tour through the Explore presets. */
  tour: { active: boolean; index: number; startedAt: number; paused: boolean };
  setTour: (patch: Partial<GlobeState["tour"]>) => void;
}

const defaultLayers = Object.fromEntries(
  LAYER_IDS.map((id) => [id, false]),
) as Record<LayerId, boolean>;

export const useGlobe = create<GlobeState>()((set) => ({
  ready: false,
  setReady: (ready) => set({ ready }),

  layers: defaultLayers,
  toggleLayer: (id) => set((s) => ({ layers: { ...s.layers, [id]: !s.layers[id] } })),
  setLayer: (id, on) => set((s) => ({ layers: { ...s.layers, [id]: on } })),

  status: {},
  setStatus: (id, patch) =>
    set((s) => ({
      status: {
        ...s.status,
        [id]: {
          count: 0,
          source: "",
          fetchedAt: 0,
          loading: false,
          ...(s.status[id] ?? {}),
          ...patch,
        },
      },
    })),

  selected: null,
  selectedFeature: null,
  select: (sel, feature) =>
    set((s) => ({
      selected: sel,
      selectedFeature: sel ? (feature ?? s.selectedFeature) : null,
      following: sel ? s.following : false,
    })),
  hover: null,
  setHover: (hover) => set({ hover }),

  following: false,
  setFollowing: (following) => set({ following }),

  view: { lon: -97.74, lat: 30.27, height: 12_000_000, heading: 0, pitch: -90 },
  setView: (view) => set({ view }),

  clock: { offsetMs: 0, multiplier: 1, animate: true, timeMachine: false },
  setClock: (patch) => set((s) => ({ clock: { ...s.clock, ...patch } })),

  playbackYear: null,
  setPlaybackYear: (playbackYear) => set({ playbackYear }),

  log: [],
  pushLog: (entry) =>
    set((s) => ({
      log: [{ t: Date.now(), ...entry }, ...s.log].slice(0, 80),
    })),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  searchOpen: false,
  setSearchOpen: (searchOpen, seed) => set({ searchOpen, searchSeed: seed ?? "" }),
  searchSeed: "",
  waterReportOpen: false,
  setWaterReportOpen: (waterReportOpen) => set({ waterReportOpen }),
  marketReportOpen: false,
  setMarketReportOpen: (marketReportOpen) => set({ marketReportOpen }),
  exploreOpen: false,
  setExploreOpen: (exploreOpen) => set({ exploreOpen }),
  spaceWeatherOpen: false,
  setSpaceWeatherOpen: (spaceWeatherOpen) => set({ spaceWeatherOpen }),
  insightsOpen: false,
  setInsightsOpen: (insightsOpen) => set({ insightsOpen }),
  measure: { mode: "off", shape: null, elevation: null },
  setMeasure: (patch) => set((s) => ({ measure: { ...s.measure, ...patch } })),
  embed: false,
  setEmbed: (embed) => set({ embed }),
  tour: { active: false, index: 0, startedAt: 0, paused: false },
  setTour: (patch) => set((s) => ({ tour: { ...s.tour, ...patch } })),
}));

/** Mission time = wall clock + operator offset. */
export function missionNow(clock: ClockState): number {
  return Date.now() + clock.offsetMs;
}
