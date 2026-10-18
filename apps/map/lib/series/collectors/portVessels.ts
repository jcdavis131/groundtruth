// Collector: vessels within reach of the world's major ports, as counts.
//
//   snapshot:port-vessels:<LOCODE>              distinct vessels inside the port circle
//   snapshot:port-vessels-stationary:<LOCODE>   of those, SOG < 1 kn (at berth or anchor)
//   snapshot:port-vessels-moving:<LOCODE>       of those, SOG >= 1 kn
//
// Sources
//   Digitraffic (keyless)  one GET of every position Finnish AIS stations hear;
//                          serves the Baltic ports in lib/series/collectors/ports.ts.
//   AISStream (free key)   a websocket subscribed to one bounding box per port,
//                          listened to for `listenMs`, then closed. Class A
//                          transponders report every 2-10 s under way and every
//                          3 min at anchor, so a 3 minute window hears nearly
//                          every ship in the box; shorter windows undercount the
//                          stationary bucket and the provenance says so.
//
// Identities never leave this module: MMSIs are used to dedupe inside one
// sample and then discarded. Only the three integers per port are stored.

import { bboxAround, haversine } from "@/lib/globe/geo";
import { provenance } from "@/lib/provenance/types";
import { source, type SourceId } from "@/lib/provenance/sources";
import type { SeriesMeta } from "@/lib/series/types";
import { PORTS, type WatchedPort } from "./ports";
import type { Collector, CollectorContext, CollectorOutput, WebSocketLike } from "./types";

/** A position with no identity attached. `sog` in knots; undefined when the transponder sent "not available". */
export interface AnonPosition {
  lat: number;
  lon: number;
  sog?: number;
}

export interface PortCounts {
  all: number;
  stationary: number;
  moving: number;
}

/** AIS encodes "speed not available" as 102.3 kn. */
const SOG_NOT_AVAILABLE = 102.3;
export const STATIONARY_MAX_KN = 1;

/** Digitraffic keeps last-known positions for hours; a ship heard this long ago is not "in port now". */
export const DIGITRAFFIC_MAX_AGE_MS = 30 * 60_000;
export const DIGITRAFFIC_URL = "https://meri.digitraffic.fi/api/ais/v1/locations";
export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
const DEFAULT_LISTEN_MS = 180_000;

/** Digitraffic /locations feature (see lib/layers/ships.ts for the full record). */
interface DtLocation {
  geometry?: { type: string; coordinates: number[] } | null;
  properties?: { sog?: number; timestampExternal?: number };
}

interface DtFeatureCollection {
  features?: DtLocation[];
  dataUpdatedTime?: string;
}

function normaliseSog(sog: number | undefined): number | undefined {
  if (sog == null || !Number.isFinite(sog) || sog < 0 || sog >= SOG_NOT_AVAILABLE) return undefined;
  return sog;
}

/** Reduce a Digitraffic snapshot to anonymous positions no older than `maxAgeMs`. */
export function digitrafficPositions(fc: DtFeatureCollection, now: number, maxAgeMs = DIGITRAFFIC_MAX_AGE_MS): AnonPosition[] {
  const out: AnonPosition[] = [];
  for (const f of fc.features ?? []) {
    const c = f.geometry?.coordinates;
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    const ts = f.properties?.timestampExternal;
    if (ts != null && now - ts > maxAgeMs) continue;
    out.push({ lon: c[0], lat: c[1], sog: normaliseSog(f.properties?.sog) });
  }
  return out;
}

/** Count positions inside each port circle. A position in two overlapping circles counts for both. */
export function countInPorts(positions: AnonPosition[], ports: WatchedPort[]): Map<string, PortCounts> {
  const out = new Map<string, PortCounts>();
  for (const port of ports) {
    const c: PortCounts = { all: 0, stationary: 0, moving: 0 };
    const rM = port.radiusKm * 1000;
    for (const p of positions) {
      // Cheap latitude reject before the trig: 1 degree of latitude is ~111 km.
      if (Math.abs(p.lat - port.lat) * 111_000 > rM) continue;
      if (haversine(port.lat, port.lon, p.lat, p.lon) > rM) continue;
      c.all++;
      if (p.sog == null) continue;
      if (p.sog < STATIONARY_MAX_KN) c.stationary++;
      else c.moving++;
    }
    out.set(port.locode, c);
  }
  return out;
}

/** AISStream bounding box: [[latSouth, lonWest], [latNorth, lonEast]]. */
export function aisstreamBox(port: WatchedPort): [[number, number], [number, number]] {
  const [w, s, e, n] = bboxAround(port.lat, port.lon, port.radiusKm * 1000);
  return [
    [s, w],
    [n, e],
  ];
}

interface AisStreamMessage {
  MessageType?: string;
  error?: string;
  MetaData?: { MMSI?: number; latitude?: number; longitude?: number };
  Message?: { PositionReport?: { Sog?: number } };
}

export interface AisStreamSampleOptions {
  key: string;
  ports: WatchedPort[];
  listenMs: number;
  openSocket: (url: string) => WebSocketLike;
  signal?: AbortSignal;
  url?: string;
}

/**
 * Subscribe to AISStream for the port boxes, listen for `listenMs`, close, and
 * return the last position per vessel with the identity stripped. Resolves
 * with whatever was heard if the socket closes early; rejects only when the
 * server answers with an error (bad key, bad subscription) or the socket
 * errors before any message arrived.
 */
export function sampleAisStream(opts: AisStreamSampleOptions): Promise<{ positions: AnonPosition[]; messages: number }> {
  // shape per https://aisstream.io/documentation; unverified in sandbox
  return new Promise((resolve, reject) => {
    const byMmsi = new Map<number, AnonPosition>();
    let messages = 0;
    let settled = false;
    const ws = opts.openSocket(opts.url ?? AISSTREAM_URL);
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      try {
        ws.close();
      } catch {
        // already closed
      }
      if (err) reject(err);
      else resolve({ positions: [...byMmsi.values()], messages });
    };
    const onAbort = () => finish(new Error("aborted"));
    const timer = setTimeout(() => finish(), opts.listenMs);
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          APIKey: opts.key,
          BoundingBoxes: opts.ports.map(aisstreamBox),
          FilterMessageTypes: ["PositionReport"],
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      let msg: AisStreamMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as AisStreamMessage;
      } catch {
        return;
      }
      if (msg.error || msg.MessageType === "error") {
        finish(new Error(`aisstream: ${msg.error ?? "error"}`));
        return;
      }
      const m = msg.MetaData;
      if (!m || m.MMSI == null || !Number.isFinite(m.latitude) || !Number.isFinite(m.longitude)) return;
      messages++;
      byMmsi.set(m.MMSI, { lat: m.latitude!, lon: m.longitude!, sog: normaliseSog(msg.Message?.PositionReport?.Sog) });
    });
    ws.addEventListener("error", () => {
      if (messages === 0) finish(new Error("aisstream: socket error before any message"));
    });
    ws.addEventListener("close", () => finish());
  });
}

const VARIANTS = [
  { key: "all", suffix: "port-vessels", title: "Vessels within" },
  { key: "stationary", suffix: "port-vessels-stationary", title: "Stationary vessels (SOG < 1 kn) within" },
  { key: "moving", suffix: "port-vessels-moving", title: "Moving vessels (SOG >= 1 kn) within" },
] as const;

/** Series metadata + one point per variant for one port. */
export function portOutputs(port: WatchedPort, counts: PortCounts, src: SourceId, now: number, method: string, notes: string[]): CollectorOutput[] {
  const retrievedAt = new Date(now).toISOString();
  return VARIANTS.map(({ key, suffix, title }) => {
    const meta: SeriesMeta = {
      id: `snapshot:${suffix}:${port.locode}`,
      title: `${title} ${port.radiusKm} km of ${port.name}`,
      unit: "count",
      frequency: "irregular",
      geo: { kind: "port", id: port.locode, name: port.name, lon: port.lon, lat: port.lat },
      provenance: provenance(source(src), { kind: "snapshot", retrievedAt, method, notes }),
      tags: ["freight", "shipping", "port", port.kind, port.country],
    };
    return { meta, points: [{ t: now, v: counts[key] }] };
  });
}

const ID = "port-vessels";
const TITLE = "Vessels at major ports";
const CADENCE = "3h";

export const portVesselsCollector: Collector = {
  id: ID,
  title: TITLE,
  cadence: CADENCE,
  // A stream sample is the slow part: subscribe, listen 3 min, close.
  timeoutMs: DEFAULT_LISTEN_MS + 60_000,
  describe() {
    return {
      id: ID,
      title: TITLE,
      cadence: CADENCE,
      seriesPrefix: "snapshot:port-vessels",
      sources: ["digitraffic", "aisstream"],
      optionalKeys: ["AISSTREAM_KEY"],
      note:
        `Distinct vessels inside each port circle (lib/series/collectors/ports.ts), split by SOG < ${STATIONARY_MAX_KN} kn. ` +
        "Baltic ports come from Digitraffic with no key; every other port needs AISSTREAM_KEY. Only counts are stored, never MMSIs.",
    };
  },
  async collect(ctx: CollectorContext) {
    const out: CollectorOutput[] = [];
    const baltic = PORTS.filter((p) => p.coverage === "digitraffic");
    const global = PORTS.filter((p) => p.coverage === "aisstream");

    const fc = await ctx.fetchJson<DtFeatureCollection>(DIGITRAFFIC_URL, {
      headers: { "accept-encoding": "gzip", "digitraffic-user": "embedding-atlas/0.1 (snapshot collector)" },
      timeoutMs: 30_000,
      signal: ctx.signal,
    });
    const positions = digitrafficPositions(fc, ctx.now);
    const counts = countInPorts(positions, baltic);
    const dtMethod = `distinct MMSI with a Digitraffic /locations position inside the port radius, no older than ${DIGITRAFFIC_MAX_AGE_MS / 60_000} min`;
    const dtNotes = ["Finnish AIS station coverage: Gulf of Finland and the northern Baltic.", "Counts only; no vessel identity is stored."];
    for (const port of baltic) out.push(...portOutputs(port, counts.get(port.locode)!, "digitraffic", ctx.now, dtMethod, dtNotes));
    ctx.log?.(`port-vessels: digitraffic ${positions.length} fresh positions, ${baltic.length} Baltic ports`);

    const key = ctx.keys.AISSTREAM_KEY;
    if (!key || !ctx.openSocket) {
      ctx.log?.(`port-vessels: ${global.length} ports skipped (${key ? "no websocket in this runtime" : "AISSTREAM_KEY not set"})`);
      return out;
    }
    const listenMs = ctx.listenMs ?? DEFAULT_LISTEN_MS;
    const sample = await sampleAisStream({ key, ports: global, listenMs, openSocket: ctx.openSocket, signal: ctx.signal });
    const gCounts = countInPorts(sample.positions, global);
    const aisMethod = `distinct MMSI heard in a ${Math.round(listenMs / 1000)} s AISStream PositionReport window over one bounding box per port, filtered to the port radius`;
    const aisNotes = [
      listenMs < DEFAULT_LISTEN_MS ? "Window shorter than the 3 min anchored-vessel report interval: stationary counts undercount." : "Window covers the 3 min anchored-vessel report interval.",
      "Counts only; no vessel identity is stored.",
    ];
    for (const port of global) out.push(...portOutputs(port, gCounts.get(port.locode)!, "aisstream", ctx.now, aisMethod, aisNotes));
    ctx.log?.(`port-vessels: aisstream ${sample.messages} messages, ${sample.positions.length} vessels, ${global.length} ports`);
    return out;
  },
};
