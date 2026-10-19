// Layer 2: ships (AIS).
//
//   Digitraffic  no key. Real AIS from the Finnish Transport Infrastructure
//                Agency: Baltic Sea coverage, all vessels, every ~20 s.
//   AISStream    free key. Global coverage over a websocket; the browser holds
//                the socket open and this layer snapshots its vessel table.
//
// No mock ships are ever generated. Without a key the layer is honest about
// its coverage ("Baltic Sea") instead of inventing traffic elsewhere.

import type { Point } from "geojson";
import { KNOT_MS } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";

/** Digitraffic /locations feature. */
interface DtLocation {
  mmsi: number;
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    mmsi: number;
    sog: number;
    cog: number;
    navStat: number;
    rot: number;
    posAcc: boolean;
    raim: boolean;
    heading: number;
    timestamp: number;
    timestampExternal: number;
  };
}

/** Digitraffic /vessels record. */
interface DtVessel {
  mmsi: number;
  name: string;
  shipType: number;
  callSign: string;
  imo: number;
  destination: string;
  draught: number;
  eta: number;
  timestamp: number;
}

export const NAV_STATUS: Record<number, string> = {
  0: "under way using engine",
  1: "at anchor",
  2: "not under command",
  3: "restricted manoeuvrability",
  4: "constrained by draught",
  5: "moored",
  6: "aground",
  7: "engaged in fishing",
  8: "under way sailing",
  11: "towing astern",
  12: "pushing ahead",
  14: "AIS-SART active",
  15: "undefined",
};

export function shipKind(type: number | undefined): string {
  if (type == null) return "vessel";
  if (type >= 20 && type <= 29) return "wing-in-ground";
  if (type === 30) return "fishing";
  if (type >= 31 && type <= 32) return "towing";
  if (type === 35) return "military";
  if (type === 36) return "sailing";
  if (type === 37) return "pleasure";
  if (type >= 40 && type <= 49) return "high-speed";
  if (type === 50) return "pilot";
  if (type === 51) return "search-and-rescue";
  if (type === 52) return "tug";
  if (type === 55) return "law-enforcement";
  if (type >= 60 && type <= 69) return "passenger";
  if (type >= 70 && type <= 79) return "cargo";
  if (type >= 80 && type <= 89) return "tanker";
  return "vessel";
}

/** Snapshot table maintained by the AISStream websocket (see startAisStream). */
export interface AisRecord {
  mmsi: number;
  name?: string;
  lat: number;
  lon: number;
  sog?: number;
  cog?: number;
  heading?: number;
  navStat?: number;
  shipType?: number;
  callSign?: string;
  imo?: number;
  destination?: string;
  observedAt: number;
}

const aisTable = new Map<number, AisRecord>();
let aisSocket: WebSocket | null = null;
let aisKey: string | null = null;
let aisError: string | null = null;
/** When the current socket opened; null while it is connecting or gone. */
let aisOpenedAt: number | null = null;

/**
 * How long after the socket opens its vessel table is still filling in. AIS reporting
 * intervals (ITU-R M.1371): a Class A ship at anchor or moored sends its position every
 * 3 min, and static data (name, type) comes every 6 min, so a vessel that has been there
 * all along can first be heard up to 6 min in. Until then an answer is `settling`, and
 * the area watch does not read a vessel first heard as one that arrived.
 */
export const AIS_WARMUP_MS = 6 * 60_000;

/**
 * Open (or keep) the AISStream websocket. Global bounding box; AISStream is
 * subscription-based so one socket serves the whole session.
 */
export function ensureAisStream(key: string) {
  if (typeof window === "undefined") return;
  if (aisSocket && aisKey === key && aisSocket.readyState <= WebSocket.OPEN) return;
  aisSocket?.close();
  aisKey = key;
  aisError = null;
  aisOpenedAt = null;
  const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
  aisSocket = ws;
  ws.onopen = () => {
    if (aisSocket === ws) aisOpenedAt = Date.now();
    ws.send(
      JSON.stringify({
        APIKey: key,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ["PositionReport", "ShipStaticData"],
      }),
    );
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as {
        MessageType: string;
        MetaData: { MMSI: number; ShipName: string; latitude: number; longitude: number; time_utc: string };
        Message: {
          PositionReport?: { Sog: number; Cog: number; TrueHeading: number; NavigationalStatus: number };
          ShipStaticData?: { Type: number; CallSign: string; ImoNumber: number; Destination: string };
        };
      };
      if (msg.MessageType === "error" || !msg.MetaData) {
        aisError = JSON.stringify(msg).slice(0, 120);
        return;
      }
      const m = msg.MetaData;
      const cur = aisTable.get(m.MMSI) ?? { mmsi: m.MMSI, lat: m.latitude, lon: m.longitude, observedAt: Date.now() };
      cur.name = (m.ShipName ?? cur.name ?? "").trim() || cur.name;
      if (msg.Message.PositionReport) {
        const p = msg.Message.PositionReport;
        cur.lat = m.latitude;
        cur.lon = m.longitude;
        cur.sog = p.Sog;
        cur.cog = p.Cog;
        cur.heading = p.TrueHeading;
        cur.navStat = p.NavigationalStatus;
        cur.observedAt = Date.parse(m.time_utc) || Date.now();
      }
      if (msg.Message.ShipStaticData) {
        const s = msg.Message.ShipStaticData;
        cur.shipType = s.Type;
        cur.callSign = s.CallSign?.trim();
        cur.imo = s.ImoNumber;
        cur.destination = s.Destination?.trim();
      }
      aisTable.set(m.MMSI, cur);
      if (aisTable.size > 60_000) {
        // Drop the stalest entries.
        const cutoff = Date.now() - 30 * 60_000;
        for (const [k, v] of aisTable) if (v.observedAt < cutoff) aisTable.delete(k);
      }
    } catch {
      /* ignore malformed frames */
    }
  };
  ws.onerror = () => {
    aisError = "websocket error";
  };
  ws.onclose = () => {
    if (aisSocket === ws) {
      aisSocket = null;
      aisOpenedAt = null;
    }
  };
}

export function stopAisStream() {
  aisSocket?.close();
  aisSocket = null;
  aisKey = null;
  aisOpenedAt = null;
}

function toFeature(
  mmsi: number,
  lon: number,
  lat: number,
  v: {
    name?: string;
    sog?: number;
    cog?: number;
    heading?: number;
    navStat?: number;
    shipType?: number;
    callSign?: string;
    imo?: number;
    destination?: string;
    draught?: number;
  },
  observedAt: number,
  source: string,
): LayerFeature<Point> {
  // AIS sentinels: heading 511 = not available, cog 360 = not available.
  const heading = v.heading != null && v.heading !== 511 ? v.heading : v.cog != null && v.cog < 360 ? v.cog : undefined;
  const kind = shipKind(v.shipType);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat, 0] },
    properties: {
      id: String(mmsi),
      layer: "ships",
      name: v.name?.trim() || `MMSI ${mmsi}`,
      kind,
      heading,
      altitude: 0,
      speed: v.sog != null && v.sog < 102.3 ? v.sog * KNOT_MS : undefined,
      observedAt,
      source,
      details: {
        mmsi,
        "call sign": v.callSign || null,
        imo: v.imo || null,
        "ship type": v.shipType != null ? `${kind} (${v.shipType})` : null,
        status: v.navStat != null ? (NAV_STATUS[v.navStat] ?? `code ${v.navStat}`) : null,
        destination: v.destination || null,
        draught: v.draught != null && v.draught > 0 ? `${(v.draught / 10).toFixed(1)} m` : null,
        "true heading": v.heading != null && v.heading !== 511 ? `${v.heading}°` : "not available",
        "course over ground": v.cog != null && v.cog < 360 ? `${v.cog.toFixed(1)}°` : "not available",
      },
    },
  };
}

async function fetchShips(ctx: FetchContext): Promise<FetchResult> {
  const features: LayerFeature<Point>[] = [];
  const sources: string[] = [];
  let note: string | undefined;
  let settling = false;

  if (ctx.keys.AISSTREAM_KEY) {
    ensureAisStream(ctx.keys.AISSTREAM_KEY);
    // Only a live socket's table is an answer. While it connects, or after it died, its
    // vessels would only age out one by one, so they are left out, and so is its name
    // in the sources: they go in the same answer as the sources change, which the area
    // watch reads as a new baseline, not as each vessel leaving.
    const live = aisSocket?.readyState === WebSocket.OPEN;
    if (live) {
      const cutoff = Date.now() - 20 * 60_000;
      for (const r of aisTable.values()) {
        if (r.observedAt < cutoff) continue;
        features.push(toFeature(r.mmsi, r.lon, r.lat, r, r.observedAt, "AISStream"));
      }
      sources.push("AISStream");
      settling = aisOpenedAt == null || Date.now() - aisOpenedAt < AIS_WARMUP_MS;
    }
    note = aisError
      ? `AISStream: ${aisError}`
      : live
        ? `AISStream live · ${aisTable.size} vessels heard${settling ? " · still filling in (first 6 min)" : ""}`
        : "AISStream connecting…";
  }

  try {
    const env = await proxy<{ locations: { features: DtLocation[]; dataUpdatedTime: string }; vessels: DtVessel[] }>(
      "/api/ships?source=digitraffic",
      ctx,
    );
    const meta = new Map<number, DtVessel>();
    for (const v of env.data.vessels ?? []) meta.set(v.mmsi, v);
    const seen = new Set(features.map((f) => f.properties.id));
    for (const l of env.data.locations.features ?? []) {
      if (seen.has(String(l.mmsi))) continue;
      const [lon, lat] = l.geometry.coordinates;
      const m = meta.get(l.mmsi);
      const p = l.properties;
      features.push(
        toFeature(
          l.mmsi,
          lon,
          lat,
          {
            name: m?.name,
            sog: p.sog,
            cog: p.cog,
            heading: p.heading,
            navStat: p.navStat,
            shipType: m?.shipType,
            callSign: m?.callSign,
            imo: m?.imo,
            destination: m?.destination,
            draught: m?.draught,
          },
          p.timestampExternal,
          "Digitraffic (FI)",
        ),
      );
    }
    sources.push("Digitraffic");
    if (!note) note = "Coverage: Baltic Sea · add AISSTREAM_KEY for global";
  } catch (err) {
    if (features.length === 0) throw err;
  }

  return {
    collection: { type: "FeatureCollection", features },
    source: sources.join(" + "),
    fetchedAt: Date.now(),
    note,
    settling,
  };
}

export const shipsLayer: LayerDefinition = {
  id: "ships",
  label: "Ships",
  description: "AIS vessel positions. Digitraffic (Baltic Sea) without a key; AISStream worldwide with one.",
  color: "#79E6A8",
  updateIntervalMs: 20_000,
  defaultEnabled: true,
  attribution: "Digitraffic / Fintraffic (CC BY 4.0) · AISStream.io",
  fetch: fetchShips,
};
