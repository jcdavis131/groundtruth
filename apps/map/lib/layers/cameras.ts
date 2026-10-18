// Layer 5: public cameras.
//
// Only cameras that public transport and road agencies publish as open data,
// each added after reading its terms (lib/cameras/agencies.ts quotes them):
//   TfL JamCams (London)                  no key   ~900 traffic cameras
//   NYC DOT traffic cameras               no key   ~900 cameras
//   Caltrans CWWP2 (California)           no key   12 districts, public domain
//   DriveBC HighwayCams (British Columbia) no key  Open Government Licence - BC
//   Digitraffic weather cameras (Finland) no key   CC BY 4.0
//   LTA traffic images (Singapore)        no key   Singapore Open Data Licence
//   Windy Webcams                         key      public webcams worldwide, nearest 50 to the view
//
// Camera *positions* come from the operator. None of these feeds publishes a
// bearing this app can draw (DriveBC and Caltrans publish a compass word, which
// the dossier shows as published), so no view cone is drawn: a pose is only
// ever "coarse position, unknown bearing". Nothing here identifies people.
//
// The agency lists are fetched once and kept for ten minutes; each fetch draws
// the cameras within reach of the view (all of them from high orbit).

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import type { TrimmedCam } from "@/app/api/cameras/route";
import type { AgencyCam } from "@/lib/cameras/agencies";
import { haversine } from "@/lib/globe/geo";

interface WindyCam {
  webcamId: number;
  title: string;
  status: string;
  lastUpdatedOn?: string;
  images?: { current?: { preview?: string; thumbnail?: string; icon?: string } };
  location?: { city?: string; region?: string; country?: string; latitude: number; longitude: number };
  player?: { day?: string; live?: string };
  urls?: { detail?: string };
}

interface WindyResponse {
  total: number;
  webcams: WindyCam[];
}

interface Agency {
  source: string;
  operator: string;
  label: string;
  licence: string;
}

/** Every keyless camera list, with the operator named in each dossier and the licence it is used under. */
export const CAMERA_AGENCIES: Agency[] = [
  { source: "tfl", operator: "Transport for London", label: "TfL", licence: "TfL Open Data" },
  { source: "nyc", operator: "NYC DOT", label: "NYC DOT", licence: "NYC DOT public camera feed" },
  { source: "caltrans", operator: "Caltrans (California Department of Transportation)", label: "Caltrans", licence: "public domain (Caltrans Conditions of Use)" },
  { source: "drivebc", operator: "B.C. Ministry of Transportation and Transit (DriveBC)", label: "DriveBC", licence: "Open Government Licence – British Columbia" },
  { source: "digitraffic", operator: "Fintraffic (Digitraffic weather cameras)", label: "Digitraffic", licence: "CC BY 4.0, Fintraffic / digitraffic.fi" },
  { source: "lta", operator: "Land Transport Authority, Singapore", label: "LTA", licence: "Singapore Open Data Licence v1.0 (data.gov.sg)" },
];

type AnyCam = TrimmedCam & Partial<AgencyCam>;

export function camToFeature(c: AnyCam, a: Agency): LayerFeature<Point> | null {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon)) return null;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [c.lon, c.lat, 0] },
    properties: {
      id: `${a.source}:${c.id}`,
      layer: "cameras",
      name: c.name,
      kind: a.source === "digitraffic" ? "weather-cam" : "traffic-cam",
      altitude: 0,
      observedAt: c.updated ? Date.parse(c.updated) || undefined : undefined,
      source: a.source,
      imageUrl: c.available === false ? undefined : c.imageUrl,
      details: {
        operator: a.operator,
        road: c.road ?? null,
        area: c.area ?? null,
        view: c.view ?? c.caption ?? null,
        "facing (as published)": c.facing ?? null,
        status: c.available === false ? "offline" : c.available === true ? "online" : null,
        pose: c.facing ? "position from operator · the facing word is the operator's; no bearing is drawn" : "position from operator · bearing not published",
        credit: c.credit ?? null,
        "camera page": c.pageUrl ?? null,
        "video stream": c.videoUrl ?? null,
        licence: a.licence,
      },
    },
  };
}

// Static open-data lists change rarely; remember them across view changes.
const staticCache: { at: number; features: LayerFeature<Point>[]; sources: string[]; failed: string[] } = {
  at: 0,
  features: [],
  sources: [],
  failed: [],
};

async function staticCameras(ctx: FetchContext): Promise<typeof staticCache> {
  if (Date.now() - staticCache.at < 10 * 60_000 && staticCache.features.length) return staticCache;
  const features: LayerFeature<Point>[] = [];
  const sources: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    CAMERA_AGENCIES.map((a) =>
      proxy<AnyCam[]>(`/api/cameras?source=${a.source}`, ctx)
        .then((env) => {
          for (const c of env.data) {
            const f = camToFeature(c, a);
            if (f) features.push(f);
          }
          sources.push(a.label);
        })
        .catch(() => failed.push(a.label)),
    ),
  );
  if (features.length) {
    staticCache.at = Date.now();
    staticCache.features = features;
    staticCache.sources = sources;
    staticCache.failed = failed;
  }
  return { at: staticCache.at, features, sources, failed };
}

/** Above this camera height every camera is drawn; below, those within NEAR_CAMS_M of the target. */
export const ALL_CAMS_HEIGHT_M = 4_000_000;
export function nearRadiusM(height: number): number {
  return Math.max(250_000, height * 1.5);
}

export function camerasNear(features: LayerFeature<Point>[], view: Pick<ViewState, "lon" | "lat" | "height">): LayerFeature<Point>[] {
  if (view.height > ALL_CAMS_HEIGHT_M) return features;
  const r = nearRadiusM(view.height);
  return features.filter((f) => haversine(view.lat, view.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]) <= r);
}

async function windyCameras(ctx: FetchContext): Promise<LayerFeature<Point>[]> {
  const radius = Math.min(250, Math.max(10, ctx.view.height / 1000));
  const env = await proxy<WindyResponse>(
    `/api/cameras?source=windy&lat=${ctx.view.lat.toFixed(2)}&lon=${ctx.view.lon.toFixed(2)}&radius=${Math.round(radius)}`,
    ctx,
  );
  const out: LayerFeature<Point>[] = [];
  for (const w of env.data.webcams ?? []) {
    const loc = w.location;
    if (!loc) continue;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [loc.longitude, loc.latitude, 0] },
      properties: {
        id: `windy:${w.webcamId}`,
        layer: "cameras",
        name: w.title,
        kind: "webcam",
        altitude: 0,
        observedAt: w.lastUpdatedOn ? Date.parse(w.lastUpdatedOn) || undefined : undefined,
        source: "windy",
        imageUrl: w.images?.current?.preview,
        details: {
          operator: "Windy Webcams (public webcam)",
          place: [loc.city, loc.region, loc.country].filter(Boolean).join(", "),
          status: w.status,
          pose: "position from provider · bearing not published",
          "windy page": w.urls?.detail ?? null,
        },
      },
    });
  }
  return out;
}

async function fetchCameras(ctx: FetchContext): Promise<FetchResult> {
  const { features, sources, failed } = await staticCameras(ctx);
  const near = camerasNear(features, ctx.view);
  let all = near;
  const srcs = [...sources];
  let note =
    `${near.length.toLocaleString("en-US")} of ${features.length.toLocaleString("en-US")} agency cameras ${ctx.view.height > ALL_CAMS_HEIGHT_M ? "(all)" : "near the view"} · ${sources.join(", ")}` +
    (failed.length ? ` · did not answer: ${failed.join(", ")}` : "") +
    " · add WINDY_WEBCAMS_KEY for public webcams worldwide";
  if (ctx.keys.WINDY_WEBCAMS_KEY) {
    try {
      const w = await windyCameras(ctx);
      all = [...near, ...w];
      srcs.push("Windy");
      note = `${w.length} Windy webcams near view + ${near.length} agency cameras (${sources.join(", ")})`;
    } catch (err) {
      note = `Windy: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if (features.length === 0 && all.length === 0) throw new Error("no camera source reachable");
  return {
    collection: { type: "FeatureCollection", features: all },
    source: srcs.join(" + "),
    fetchedAt: Date.now(),
    note,
  };
}

export const camerasLayer: LayerDefinition = {
  id: "cameras",
  label: "Public cams",
  description:
    "Open-data cameras from transport and road agencies, with live stills: TfL (London), NYC DOT, Caltrans (California), DriveBC (British Columbia), Digitraffic (Finland's road weather cameras) and LTA (Singapore); Windy webcams with a key. Positions only, no bearings.",
  color: "#F5B849",
  updateIntervalMs: 5 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: (v: ViewState) => `${Math.round(v.lon * 2) / 2},${Math.round(v.lat * 2) / 2},${v.height > ALL_CAMS_HEIGHT_M ? "all" : Math.round(Math.log2(Math.max(v.height, 1000) / 1000))}`,
  attribution: "TfL Open Data · NYC DOT · Caltrans · DriveBC (OGL-BC) · Fintraffic Digitraffic (CC BY 4.0) · LTA via data.gov.sg (SODL) · Windy.com",
  fetch: fetchCameras,
};
