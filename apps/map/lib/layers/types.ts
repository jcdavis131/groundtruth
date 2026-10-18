// Shared contract for every data layer in Embedding Atlas.
//
// A layer is a plain module in lib/layers/<name>.ts that exports a
// LayerDefinition: metadata + a fetch() that resolves to GeoJSON. The globe
// never talks to an upstream API directly; it only ever sees FeatureCollections
// produced here, so every signal on screen is inspectable in one place.

import type { Feature, FeatureCollection, Geometry } from "geojson";
import type * as CesiumNS from "cesium";
import type { LayerRendererLike } from "@/lib/globe/rendererTypes";
import type { ApiKeyId } from "@/lib/store/settings";

export type LayerId =
  | "aircraft"
  | "ships"
  | "satellites"
  | "iss"
  | "earthquakes"
  | "cameras"
  | "traffic"
  | "launches"
  | "water"
  | "groundwater"
  | "turbidity"
  | "trade"
  | "commerce"
  | "realestate"
  | "companies"
  | "banks"
  | "spending"
  | "occupations"
  | "gasprices"
  | "gasforecast"
  | "ercotprices"
  | "uselectricity"
  | "globalgeneration"
  | "datacenters"
  | "weather"
  | "wildfire"
  | "fires"
  | "hazards"
  | "flood"
  | "wetlands"
  | "publiclands"
  | "historic"
  | "heritage"
  | "crithab"
  | "wayback"
  | "topo"
  | "hydro"
  | "naip"
  | "impaired"
  | "pfas"
  | "ust"
  | "riskindex"
  | "health"
  | "schools"
  | "hospitals"
  | "vulnerability"
  | "broadband"
  | "wildfirerisk"
  | "tribal"
  | "housing"
  | "relief"
  | "slope"
  | "contours"
  | "soils"
  | "firehazard"
  | "landslidesusc"
  | "landcover"
  | "sealevel"
  | "transmission"
  | "pipelines"
  | "plants"
  | "rail"
  | "airports"
  | "dams"
  | "faults"
  | "landslides"
  | "geology"
  | "plss"
  | "airquality"
  | "events"
  | "parcels"
  | "zoning"
  | "permits"
  | "licences"
  | "envpermits"
  | "contaminants"
  | "sports"
  | "constructs"
  | "field"
  | "alerts"
  | "employers"
  | "wikipedia"
  | "wikiday"
  | "windflow"
  | "oceanflow";

export const LAYER_IDS: LayerId[] = [
  "aircraft",
  "ships",
  "satellites",
  "iss",
  "earthquakes",
  "cameras",
  // "traffic" stays in the LayerId union for its module and old fixtures, but
  // not here: it is simulated, so it is not offered, and a share link that
  // names it (?layers=traffic) drops it as an unknown layer.
  "launches",
  "water",
  "groundwater",
  "turbidity",
  "trade",
  "commerce",
  "realestate",
  "companies",
  "banks",
  "spending",
  "occupations",
  "gasprices",
  "gasforecast",
  "ercotprices",
  "uselectricity",
  "globalgeneration",
  "datacenters",
  "weather",
  "wildfire",
  "fires",
  "hazards",
  "flood",
  "wetlands",
  "publiclands",
  "historic",
  "heritage",
  "crithab",
  "wayback",
  "topo",
  "hydro",
  "naip",
  "impaired",
  "pfas",
  "ust",
  "riskindex",
  "health",
  "schools",
  "hospitals",
  "vulnerability",
  "broadband",
  "wildfirerisk",
  "tribal",
  "housing",
  "relief",
  "slope",
  "contours",
  "soils",
  "firehazard",
  "landslidesusc",
  "landcover",
  "sealevel",
  "transmission",
  "pipelines",
  "plants",
  "rail",
  "airports",
  "dams",
  "faults",
  "landslides",
  "geology",
  "plss",
  "airquality",
  "events",
  "parcels",
  "zoning",
  "permits",
  "licences",
  "envpermits",
  "contaminants",
  "sports",
  "constructs",
  "field",
  "alerts",
  "employers",
  "wikipedia",
  "wikiday",
  "windflow",
  "oceanflow",
];

/** Properties every feature carries, whatever the layer. */
export interface BaseProps {
  /** Stable id inside the layer: ICAO24 hex, MMSI, NORAD id, USGS event id, ... */
  id: string;
  layer: LayerId;
  /** Display name: callsign, vessel name, satellite name, place string, ... */
  name: string;
  /** true: the name is a label only, never matched by search (palette or voice); the feature is found by its id and allowlisted fields (lib/search/allowlist.ts). */
  nameNotSearchable?: true;
  /** Sub-type used for icon / colour choice: aircraft type, ship class, sat group, ... */
  kind?: string;
  /** Degrees true. Leave undefined when the upstream says "unknown" (never invent one). */
  heading?: number;
  /** Metres above the WGS84 ellipsoid. 0 for surface objects. */
  altitude?: number;
  /** Metres per second over ground. */
  speed?: number;
  /** Epoch ms of the underlying observation, when the upstream provides one. */
  observedAt?: number;
  /** Human readable upstream name shown in the HUD. */
  source: string;
  /** true ONLY for the traffic simulation layer. Simulated features are never counted as live. */
  simulated?: boolean;
  /** Key/value pairs rendered verbatim in the info panel. */
  details?: Record<string, string | number | boolean | null | undefined>;
  /** Cameras: a still image URL that refreshes upstream. */
  imageUrl?: string;
  /** Layer specific opaque payload (e.g. OMM elements for satellites). */
  extra?: unknown;
  /** Label / pick anchor for a polygon feature, [lon, lat] (Census internal point, country label point). */
  anchor?: [number, number];
}

export type LayerFeature<G extends Geometry = Geometry> = Feature<G, BaseProps>;
export type LayerCollection = FeatureCollection<Geometry, BaseProps>;

export interface ViewState {
  /** Camera target on the ellipsoid, degrees. */
  lon: number;
  lat: number;
  /** Camera height above the ellipsoid, metres. */
  height: number;
  heading: number;
  pitch: number;
  /** Visible extent [west, south, east, north] in degrees when the horizon is not in view. */
  bbox?: [number, number, number, number];
}

export interface FetchContext {
  keys: Partial<Record<ApiKeyId, string>>;
  view: ViewState;
  /** Epoch ms of the wall clock at fetch time. */
  now: number;
  /** Epoch ms of the mission clock (wall clock + timeline offset). */
  missionTime?: number;
  /** Playback year for time-aware layers; null when the time machine is off. */
  playbackYear?: number | null;
  signal?: AbortSignal;
  /** Free-form layer options coming from the settings store (e.g. satellite groups). */
  options: Record<string, unknown>;
}

/** What a definition's `refine` may read about the layers named in its `dependsOn`. */
export interface RefineContext {
  /** Whether each is switched on. */
  layersOn: Partial<Record<LayerId, boolean>>;
  /** Whether each has an answer on the globe: its last fetch did not fail, and it is not still waiting on its first. */
  answering: Partial<Record<LayerId, boolean>>;
  /** Whether that layer holds the feature with this id right now (drawn while it is on). */
  holds: (layer: LayerId, id: string) => boolean;
}

export interface FetchResult {
  collection: LayerCollection;
  /** Which upstream actually answered (a layer may have several). */
  source: string;
  fetchedAt: number;
  /** Short operator note shown next to the layer, e.g. coverage caveats. */
  note?: string;
  meta?: Record<string, unknown>;
  /**
   * The view key this answer was fetched for ("static" for a layer that is not
   * view-dependent). The host stamps it, so an answer kept on screen while the
   * next view loads still says which view it belongs to.
   */
  viewKey?: string;
  /**
   * The view this answer was fetched with, stamped by the host like `viewKey`. The
   * coarse key can stay the same while the view inside it moves; the area watch reads
   * this to know what a moving layer's answer covers (lib/aoi/coverage.ts).
   */
  fetchView?: ViewState;
  /**
   * The answer is still filling in (a stream that has just connected), so something
   * missing from it may only not have been heard yet: the area watch holds the layer and
   * retakes its baseline silently once an answer is not settling.
   */
  settling?: boolean;
}

/** `extra` of a near-only layer's dashed "loaded area" feature (kind "loaded-box"): what the answer it outlines left out. */
export interface LoadedBoxExtra {
  /** The service's record limit was hit, so only the first records (in the order the route asks for) came back. */
  truncated?: boolean;
  /** Outlines were coarsened to fit the response, so lengths drawn from them are approximate. */
  coarsenedForSize?: boolean;
  /** A size floor the layer asked with at this camera height (power plants: nameplate MW). */
  floorMw?: number;
  /**
   * Parts of the answer whose service did not answer (pipelines: the commodities whose
   * `counts` entry is null), so a report says "not loaded" for them, never "none".
   */
  missing?: string[];
}

export interface LayerDefinition {
  id: LayerId;
  label: string;
  description: string;
  /** Hex colour used for primitives, chips and the HUD. */
  color: string;
  /** How often the layer re-fetches while enabled. */
  updateIntervalMs: number;
  defaultEnabled: boolean;
  /** Re-fetch when the coarse view key changes (aircraft, traffic). */
  viewDependent?: boolean;
  /** Custom view key for view-dependent layers; defaults to viewKey(). */
  viewKey?: (view: ViewState) => string;
  /** Marks the whole layer as a simulation (traffic). Shown loudly in the UI. */
  simulated?: boolean;
  /** Re-fetch when the mission clock moves to another day (satellite scenes). */
  timeDependent?: boolean;
  /**
   * Other layers `refine` reads. Toggling one, or a new answer or a failure
   * from one, re-runs refine on the data already fetched (no network call).
   */
  dependsOn?: LayerId[];
  /**
   * What of a fetched result to draw, given the layers in `dependsOn` (hazard
   * alerts step aside for events Earthquakes and Live warnings are drawing).
   * Runs on each fetched result and again whenever one of those layers changes.
   */
  refine?: (result: FetchResult, ctx: RefineContext) => FetchResult;
  /** Short caption for estimate layers: what the numbers are and are not. */
  estimate?: string;
  attribution: string;
  fetch: (ctx: FetchContext) => Promise<FetchResult>;
  /**
   * Custom renderer factory. When present, LayerHost builds this instead of
   * the GeoJSON LayerRenderer (used by the particle-flow layers, which draw a
   * canvas overlay rather than primitives). The factory's result must satisfy
   * LayerRendererLike.
   */
  createRenderer?: (viewer: CesiumNS.Viewer) => LayerRendererLike;
}

/**
 * Coarse key for view-dependent layers. Changes only when the camera target
 * moves ~0.5 degrees or the height changes bucket, so panning a little does
 * not trigger a new upstream request.
 */
export function viewKey(view: ViewState): string {
  const lon = Math.round(view.lon * 2) / 2;
  const lat = Math.round(view.lat * 2) / 2;
  const bucket = Math.round(Math.log2(Math.max(view.height, 1000) / 1000));
  return `${lon},${lat},${bucket}`;
}

export function emptyCollection(): LayerCollection {
  return { type: "FeatureCollection", features: [] };
}
