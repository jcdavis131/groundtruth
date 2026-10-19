"use client";
// Optional API keys and operator preferences. Persisted to localStorage.
// The app starts with NO keys; every key here unlocks an upgrade, never a
// baseline feature. Keys are only ever sent to this app's own /api routes
// (as request headers) or to the vendor SDK they belong to (voice).

import type { FieldPov } from "@/lib/fabric/fieldScale";
import type { LayerId } from "@/lib/layers/types";
import type { Measure, Normalise } from "@/lib/fabric/emergence";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ApiKeyId =
  | "GOOGLE_MAPS_API_KEY"
  | "CESIUM_ION_TOKEN"
  | "ADSBX_RAPIDAPI_KEY"
  | "OPENSKY_CLIENT_ID"
  | "OPENSKY_CLIENT_SECRET"
  | "AISSTREAM_KEY"
  | "WINDY_WEBCAMS_KEY"
  | "ELEVENLABS_AGENT_ID"
  | "ELEVENLABS_API_KEY"
  | "VAPI_PUBLIC_KEY"
  | "VAPI_ASSISTANT_ID";

export interface ApiKeyMeta {
  id: ApiKeyId;
  label: string;
  group: "Globe" | "Aircraft" | "Ships" | "Cameras" | "Voice";
  unlocks: string;
  url: string;
  secret?: boolean;
}

export const API_KEYS: ApiKeyMeta[] = [
  {
    id: "GOOGLE_MAPS_API_KEY",
    label: "Google Maps API key",
    group: "Globe",
    unlocks: "Photorealistic 3D Tiles (buildings, trees, terrain). Free tier: 1M tile requests/month.",
    url: "https://developers.google.com/maps/documentation/tile/get-api-key",
    secret: true,
  },
  {
    id: "CESIUM_ION_TOKEN",
    label: "Cesium ion token",
    group: "Globe",
    unlocks: "Cesium World Terrain instead of the keyless AWS Terrain Tiles when 3D terrain is on (lit relief, vertex normals). Free community tier.",
    url: "https://ion.cesium.com/tokens",
    secret: true,
  },
  {
    id: "ADSBX_RAPIDAPI_KEY",
    label: "ADS-B Exchange (RapidAPI) key",
    group: "Aircraft",
    unlocks: "Unfiltered ADS-B Exchange feed as an alternative aircraft source.",
    url: "https://rapidapi.com/adsbx/api/adsbexchange-com1",
    secret: true,
  },
  {
    id: "OPENSKY_CLIENT_ID",
    label: "OpenSky client id",
    group: "Aircraft",
    unlocks: "4000 OpenSky credits/day instead of the anonymous 400 for the global view.",
    url: "https://opensky-network.org/index.php/users/profile",
  },
  {
    id: "OPENSKY_CLIENT_SECRET",
    label: "OpenSky client secret",
    group: "Aircraft",
    unlocks: "Pairs with the client id (OAuth2 client credentials).",
    url: "https://openskynetwork.github.io/opensky-api/rest.html",
    secret: true,
  },
  {
    id: "AISSTREAM_KEY",
    label: "AISStream.io key",
    group: "Ships",
    unlocks: "Global AIS coverage via websocket. Without it: Digitraffic (Baltic Sea) only.",
    url: "https://aisstream.io/authenticate",
    secret: true,
  },
  {
    id: "WINDY_WEBCAMS_KEY",
    label: "Windy Webcams key",
    group: "Cameras",
    unlocks: "Tens of thousands of public webcams worldwide. Without it: TfL + NYC DOT traffic cams.",
    url: "https://api.windy.com/webcams",
    secret: true,
  },
  {
    id: "ELEVENLABS_AGENT_ID",
    label: "ElevenLabs agent id",
    group: "Voice",
    unlocks: "ElevenLabs Conversational AI agent for natural voice control.",
    url: "https://elevenlabs.io/app/conversational-ai",
  },
  {
    id: "ELEVENLABS_API_KEY",
    label: "ElevenLabs API key",
    group: "Voice",
    unlocks: "Only needed for private agents (signed-URL sessions).",
    url: "https://elevenlabs.io/app/settings/api-keys",
    secret: true,
  },
  {
    id: "VAPI_PUBLIC_KEY",
    label: "Vapi public key",
    group: "Voice",
    unlocks: "Vapi realtime voice agent as an alternative to ElevenLabs.",
    url: "https://dashboard.vapi.ai",
  },
  {
    id: "VAPI_ASSISTANT_ID",
    label: "Vapi assistant id",
    group: "Voice",
    unlocks: "The Vapi assistant configured with the Embedding Atlas tool schema (see README).",
    url: "https://dashboard.vapi.ai",
  },
];

export interface Prefs {
  scanlines: boolean;
  cinematic: boolean;
  labels: boolean;
  nightLights: boolean;
  atmosphere: boolean;
  googleTiles: boolean;
  /** 3D terrain: keyless AWS Terrain Tiles, or Cesium World Terrain with an ion token. */
  terrain: boolean;
  /** Vertical exaggeration of the terrain, 1 to 3 (Cesium Scene.verticalExaggeration). */
  terrainExaggeration: number;
  /** Sea level rise scenario the Sea level rise layer draws, whole feet above MHHW (1 to 10). */
  seaLevelFt: number;
  /** Esri World Imagery Wayback release the Historic imagery layer draws; null = the newest. */
  waybackRelease: number | null;
  /** USGS historical topographic map edition year the Historic topo maps layer draws; null = the newest at the view centre. */
  topoYear: number | null;
  /** National Risk Index: what the layer colours by, "composite" or a hazard code (TRND, HRCN, ...). */
  nriHazard: string;
  /** Historic places: National Historic Landmarks only (the "Landmarks only" chip). */
  nhlOnly: boolean;
  /** USDA NAIP year the Aerial photos by year layer draws; null = the newest at the view centre. */
  naipYear: number | null;
  /** Community health: the CDC PLACES measure drawn (a measureid, e.g. DIABETES). */
  placesMeasure: string;
  /** Social vulnerability: the CDC SVI ranking drawn, "0" overall or "1"-"4" a theme. */
  sviTheme: string;
  /** Broadband: the measure drawn, "0" unserved share, "1" underserved share, "2" fiber share, "3" providers. */
  broadbandMeasure: string;
  /** Housing assistance: the measure drawn, "0" HUD's share of renter units, "1" voucher households. */
  housingMeasure: string;
  /** Housing assistance: the tax-credit chips on, comma-joined ("dda", "lihtc"); "" none (round 8). */
  housingParts: string;
  /** Wildfire risk ranks: the WRC rank family drawn, "0" RISK, "1" BP, "2" WHP, "3" EA_HURISK. */
  wrcMeasure: string;
  /** Wildfire risk ranks: national or state rank. */
  wrcScope: "national" | "state";
  /** Hospitals: "open" (default) or "all" (closed ones too). */
  hospitalStatus: "open" | "all";
  /** The viewer's opacity for each picture layer (0..1); absent = the layer's default. */
  tileAlpha: Partial<Record<LayerId, number>>;
  /** CelesTrak GP groups to load. "active" is ~10k objects and opt-in. */
  satelliteGroups: string[];
  /** Observer location for satellite pass predictions; null = not set. */
  observer: { lat: number; lon: number; label: string } | null;
  aircraftSource: "auto" | "adsblol" | "opensky" | "adsbx";
  voiceProvider: "browser" | "elevenlabs" | "vapi";
  /** Construct field: the point of view whose constructs tile the view. */
  fieldPov: FieldPov;
  /** Construct field: which physical signals set each construct's heat ("all" or a layer id). */
  fieldMeasure: Measure;
  /** Construct field: raw counts, or per 1,000 km² so big units do not win by size. */
  fieldNormalise: Normalise;
}

export const DEFAULT_PREFS: Prefs = {
  scanlines: true,
  cinematic: true,
  labels: true,
  nightLights: true,
  atmosphere: true,
  googleTiles: false,
  terrain: false,
  terrainExaggeration: 1,
  seaLevelFt: 3,
  waybackRelease: null,
  topoYear: null,
  nriHazard: "composite",
  nhlOnly: false,
  naipYear: null,
  placesMeasure: "DIABETES",
  sviTheme: "0",
  broadbandMeasure: "0",
  housingMeasure: "0",
  housingParts: "",
  wrcMeasure: "0",
  wrcScope: "national",
  hospitalStatus: "open",
  tileAlpha: {},
  satelliteGroups: ["stations", "visual", "gps-ops", "military", "weather"],
  observer: null,
  aircraftSource: "auto",
  voiceProvider: "browser",
  fieldPov: "hydrologic",
  fieldMeasure: "all",
  fieldNormalise: "density",
};

interface SettingsState {
  keys: Partial<Record<ApiKeyId, string>>;
  prefs: Prefs;
  setKey: (id: ApiKeyId, value: string) => void;
  clearKey: (id: ApiKeyId) => void;
  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      keys: {},
      prefs: DEFAULT_PREFS,
      setKey: (id, value) =>
        set((s) => ({ keys: { ...s.keys, [id]: value.trim() } })),
      clearKey: (id) =>
        set((s) => {
          const keys = { ...s.keys };
          delete keys[id];
          return { keys };
        }),
      setPref: (key, value) =>
        set((s) => ({ prefs: { ...s.prefs, [key]: value } })),
    }),
    {
      name: "gev:settings",
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...current,
          keys: { ...current.keys, ...(p.keys ?? {}) },
          prefs: { ...current.prefs, ...(p.prefs ?? {}) },
        };
      },
    },
  ),
);

/** Headers that carry optional keys to this app's own route handlers. */
export function keyHeaders(keys: Partial<Record<ApiKeyId, string>>): Record<string, string> {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(keys)) {
    if (v) h[`x-gev-${k.toLowerCase().replace(/_/g, "-")}`] = v;
  }
  return h;
}
