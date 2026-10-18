// Layer 1: aircraft.
//
// Sources (all normalised to the same GeoJSON):
//   adsb.lol      no key, point query up to 250 nm around the camera target,
//                 plus its global feed of military-flagged airframes.
//   OpenSky       no key, global bounding-box query used when zoomed out.
//                 Anonymous quota is 400 credits/day; the route caches 90 s.
//   ADS-B Exchange (RapidAPI key) alternative point query, same JSON shape.

import type { Feature, Point } from "geojson";
import { FT_M, KNOT_MS, NM_M } from "@/lib/globe/geo";
import { keyHeaders } from "@/lib/store/settings";
import type { BaseProps, FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";

/** readsb / tar1090 aircraft.json record (adsb.lol and ADS-B Exchange share it). */
export interface ReadsbAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  dbFlags?: number;
  alt_baro?: number | "ground";
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  emergency?: string;
  category?: string;
  lat?: number;
  lon?: number;
  seen?: number;
  seen_pos?: number;
  dst?: number;
  mlat?: string[];
  tisb?: string[];
}

export interface ReadsbResponse {
  ac: ReadsbAircraft[];
  now?: number;
  msg?: string;
  total?: number;
}

/** OpenSky state vector, positional array (see the OpenSky REST docs for indices). */
export type OpenSkyState = [
  icao24: string,
  callsign: string | null,
  originCountry: string,
  timePosition: number | null,
  lastContact: number,
  longitude: number | null,
  latitude: number | null,
  baroAltitude: number | null,
  onGround: boolean,
  velocity: number | null,
  trueTrack: number | null,
  verticalRate: number | null,
  sensors: number[] | null,
  geoAltitude: number | null,
  squawk: string | null,
  spi: boolean,
  positionSource: number,
  category?: number,
];

export interface OpenSkyResponse {
  time: number;
  states: OpenSkyState[] | null;
  rateRemaining?: string | null;
}

const ROTORCRAFT_CATEGORIES = new Set(["A7"]);

export function fromReadsb(
  a: ReadsbAircraft,
  now: number,
  source: string,
  military = false,
): LayerFeature<Point> | null {
  if (a.lat == null || a.lon == null) return null;
  const onGround = a.alt_baro === "ground";
  const altFt = a.alt_geom ?? (typeof a.alt_baro === "number" ? a.alt_baro : undefined);
  const altitude = onGround ? 0 : altFt != null ? altFt * FT_M : undefined;
  const callsign = a.flight?.trim();
  const isMil = military || ((a.dbFlags ?? 0) & 1) === 1;
  const props: BaseProps = {
    id: a.hex.toLowerCase(),
    layer: "aircraft",
    name: callsign || a.r || a.hex.toUpperCase(),
    kind: ROTORCRAFT_CATEGORIES.has(a.category ?? "") ? "rotorcraft" : isMil ? "military" : "aircraft",
    heading: typeof a.track === "number" ? a.track : undefined,
    altitude,
    speed: typeof a.gs === "number" ? a.gs * KNOT_MS : undefined,
    observedAt: now - (a.seen_pos ?? a.seen ?? 0) * 1000,
    source,
    details: {
      icao24: a.hex.toUpperCase(),
      callsign: callsign || null,
      registration: a.r ?? null,
      type: a.t ?? null,
      description: a.desc ?? null,
      operator: a.ownOp ?? null,
      category: a.category ?? null,
      squawk: a.squawk ?? null,
      "vertical rate": a.baro_rate != null ? `${a.baro_rate} ft/min` : null,
      "on ground": onGround,
      emergency: a.emergency && a.emergency !== "none" ? a.emergency : null,
      military: isMil,
      "message type": a.type ?? null,
      "distance from view": a.dst != null ? `${a.dst.toFixed(0)} nm` : null,
    },
  };
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [a.lon, a.lat, altitude ?? 0] },
    properties: props,
  };
}

export function fromOpenSky(s: OpenSkyState, source: string): LayerFeature<Point> | null {
  const [icao24, callsign, country, timePos, lastContact, lon, lat, baroAlt, onGround, vel, track, vr, , geoAlt, squawk, , posSource, category] = s;
  if (lon == null || lat == null) return null;
  const altitude = onGround ? 0 : (geoAlt ?? baroAlt ?? undefined);
  const cs = callsign?.trim();
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat, altitude ?? 0] },
    properties: {
      id: icao24.toLowerCase(),
      layer: "aircraft",
      name: cs || icao24.toUpperCase(),
      kind: category === 7 ? "rotorcraft" : "aircraft",
      heading: track ?? undefined,
      altitude,
      speed: vel ?? undefined,
      observedAt: (timePos ?? lastContact) * 1000,
      source,
      details: {
        icao24: icao24.toUpperCase(),
        callsign: cs || null,
        "origin country": country,
        squawk,
        "vertical rate": vr != null ? `${vr.toFixed(1)} m/s` : null,
        "on ground": onGround,
        "position source": ["ADS-B", "ASTERIX", "MLAT", "FLARM"][posSource] ?? String(posSource),
      },
    },
  };
}

export interface ProxyEnvelope<T> {
  data: T;
  source: string;
  cacheAge: number;
  error?: string;
}

/** Call one of this app's own /api routes, forwarding optional operator keys. */
export async function proxy<T>(url: string, ctx: FetchContext): Promise<ProxyEnvelope<T>> {
  const res = await fetch(url, { headers: keyHeaders(ctx.keys), signal: ctx.signal });
  const json = (await res.json().catch(() => ({}))) as ProxyEnvelope<T>;
  if (!res.ok) throw new Error(json.error ?? `${res.status} from ${url}`);
  return json;
}

/** Height above which the point query cannot cover the view and OpenSky takes over. */
export const GLOBAL_VIEW_HEIGHT_M = 2_500_000;

async function fetchAircraft(ctx: FetchContext): Promise<FetchResult> {
  const pref = (ctx.options.aircraftSource as string | undefined) ?? "auto";
  const global = ctx.view.height > GLOBAL_VIEW_HEIGHT_M;
  const now = ctx.now;
  const features = new Map<string, Feature<Point, BaseProps>>();
  const sources: string[] = [];
  let note: string | undefined;
  let meta: Record<string, unknown> = {};

  const useOpenSky = pref === "opensky" || (pref === "auto" && global);
  const useAdsbx = pref === "adsbx" && !!ctx.keys.ADSBX_RAPIDAPI_KEY;

  // adsb.lol's global military-flagged feed is only needed when the view is
  // served by OpenSky (which has no military flag); point queries already
  // carry dbFlags. It is fetched after the main query so the two never race
  // adsb.lol's per-IP limiter.
  const mergeMil = async () => {
    if (!useOpenSky) return;
    try {
      const env = await proxy<ReadsbResponse>("/api/aircraft?source=mil", ctx);
      for (const a of env.data.ac ?? []) {
        const f = fromReadsb(a, now, "adsb.lol/mil", true);
        if (f) features.set(f.properties.id, f);
      }
      sources.push("adsb.lol mil");
    } catch {
      /* the military overlay is best-effort */
    }
  };

  let openSkyFailed: string | null = null;
  if (useOpenSky) {
    const bbox = ctx.view.bbox && !global ? `&bbox=${ctx.view.bbox.join(",")}` : "";
    try {
      const env = await proxy<OpenSkyResponse>(`/api/aircraft?source=opensky${bbox}`, ctx);
      for (const s of env.data.states ?? []) {
        const f = fromOpenSky(s, env.source);
        if (f && !features.has(f.properties.id)) features.set(f.properties.id, f);
      }
      sources.push(env.source);
      if (env.data.rateRemaining != null) {
        meta = { openskyCreditsRemaining: env.data.rateRemaining };
        note = `OpenSky credits left today: ${env.data.rateRemaining}`;
      }
    } catch (err) {
      // OpenSky refuses some hosting providers' egress (Vercel included) and
      // exhausts its anonymous quota per IP. Degrade to what adsb.lol gives us
      // around the view centre instead of showing nothing.
      openSkyFailed = err instanceof Error ? err.message : String(err);
    }
  }
  if (useOpenSky && openSkyFailed) {
    try {
      const env = await proxy<ReadsbResponse>(
        `/api/aircraft?source=adsblol&lat=${ctx.view.lat.toFixed(3)}&lon=${ctx.view.lon.toFixed(3)}&dist=250`,
        ctx,
      );
      for (const a of env.data.ac ?? []) {
        const f = fromReadsb(a, now, env.source);
        if (f && !features.has(f.properties.id)) features.set(f.properties.id, f);
      }
      sources.push(env.source);
    } catch {
      /* fall through to the military overlay alone */
    }
    note = `OpenSky unreachable from this host (${openSkyFailed.slice(0, 40)}) · showing adsb.lol 250 nm around view centre; zoom in for full coverage`;
  }
  if (!useOpenSky) {
    // Point query radius: cover the visible disc but never more than 250 nm.
    const distNm = Math.min(250, Math.max(40, (ctx.view.height * 1.2) / NM_M));
    const src = useAdsbx ? "adsbx" : "adsblol";
    const env = await proxy<ReadsbResponse>(
      `/api/aircraft?source=${src}&lat=${ctx.view.lat.toFixed(3)}&lon=${ctx.view.lon.toFixed(3)}&dist=${Math.round(distNm)}`,
      ctx,
    );
    for (const a of env.data.ac ?? []) {
      const f = fromReadsb(a, now, env.source);
      if (f && !features.has(f.properties.id)) features.set(f.properties.id, f);
    }
    sources.push(env.source);
    note = `${Math.round(distNm)} nm around view centre`;
  }
  await mergeMil();

  return {
    collection: { type: "FeatureCollection", features: [...features.values()] },
    source: sources.join(" + "),
    fetchedAt: Date.now(),
    note,
    meta,
  };
}

export const aircraftLayer: LayerDefinition = {
  id: "aircraft",
  label: "Aircraft",
  description:
    "Live ADS-B positions. adsb.lol around the view, OpenSky when zoomed out, global military-flagged feed always.",
  color: "#4DD8FF",
  updateIntervalMs: 10_000,
  defaultEnabled: true,
  viewDependent: true,
  attribution: "adsb.lol (ODbL) · OpenSky Network · ADS-B Exchange",
  fetch: fetchAircraft,
};
