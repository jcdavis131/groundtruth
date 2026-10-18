import { describe, expect, it } from "vitest";
import {
  aisstreamBox,
  countInPorts,
  digitrafficPositions,
  DIGITRAFFIC_MAX_AGE_MS,
  portOutputs,
  portVesselsCollector,
  sampleAisStream,
  type AnonPosition,
} from "./portVessels";
import { PORT_BY_LOCODE, PORTS } from "./ports";
import type { CollectorContext, WebSocketLike } from "./types";

const NOW = Date.UTC(2026, 8, 11, 12, 0, 0);
const HEL = PORT_BY_LOCODE.get("FIHEL")!;

/** Digitraffic /locations fixture: three ships near Helsinki, one stale, one far away, one with no SOG. */
const DT_FIXTURE = {
  type: "FeatureCollection",
  dataUpdatedTime: "2026-09-11T11:59:50Z",
  features: [
    { mmsi: 230111111, type: "Feature", geometry: { type: "Point", coordinates: [24.96, 60.14] }, properties: { mmsi: 230111111, sog: 0.1, cog: 12, navStat: 5, timestampExternal: NOW - 60_000 } },
    { mmsi: 230222222, type: "Feature", geometry: { type: "Point", coordinates: [25.05, 60.1] }, properties: { mmsi: 230222222, sog: 11.4, cog: 200, navStat: 0, timestampExternal: NOW - 5_000 } },
    { mmsi: 230333333, type: "Feature", geometry: { type: "Point", coordinates: [24.9, 60.16] }, properties: { mmsi: 230333333, sog: 102.3, cog: 0, navStat: 15, timestampExternal: NOW - 2_000 } },
    { mmsi: 230444444, type: "Feature", geometry: { type: "Point", coordinates: [24.95, 60.15] }, properties: { mmsi: 230444444, sog: 0, cog: 0, navStat: 1, timestampExternal: NOW - DIGITRAFFIC_MAX_AGE_MS - 1 } },
    { mmsi: 230555555, type: "Feature", geometry: { type: "Point", coordinates: [21.5, 61.2] }, properties: { mmsi: 230555555, sog: 8, cog: 90, navStat: 0, timestampExternal: NOW } },
    { mmsi: 230666666, type: "Feature", geometry: null, properties: { mmsi: 230666666, sog: 1, cog: 0, navStat: 0, timestampExternal: NOW } },
  ],
};

describe("digitrafficPositions", () => {
  it("drops stale and geometry-less features and blanks unavailable SOG", () => {
    const pos = digitrafficPositions(DT_FIXTURE, NOW);
    expect(pos).toHaveLength(4);
    expect(pos.find((p) => p.lon === 24.9)?.sog).toBeUndefined();
    expect(pos.every((p) => !("mmsi" in p))).toBe(true);
  });
});

describe("countInPorts", () => {
  it("counts inside the radius and splits by SOG", () => {
    const counts = countInPorts(digitrafficPositions(DT_FIXTURE, NOW), [HEL]);
    expect(counts.get("FIHEL")).toEqual({ all: 3, stationary: 1, moving: 1 });
  });
  it("counts a position in overlapping circles for both ports", () => {
    const sin = PORT_BY_LOCODE.get("SGSIN")!;
    const tpp = PORT_BY_LOCODE.get("MYTPP")!;
    const p: AnonPosition[] = [{ lat: 1.33, lon: 103.6, sog: 0 }];
    const counts = countInPorts(p, [sin, tpp]);
    expect(counts.get("SGSIN")?.all).toBe(1);
    expect(counts.get("MYTPP")?.all).toBe(1);
  });
  it("returns zeros for a port with nothing nearby", () => {
    expect(countInPorts([], [HEL]).get("FIHEL")).toEqual({ all: 0, stationary: 0, moving: 0 });
  });
});

describe("aisstreamBox", () => {
  it("is [[south, west], [north, east]] around the port", () => {
    const [[s, w], [n, e]] = aisstreamBox(HEL);
    expect(s).toBeLessThan(HEL.lat);
    expect(n).toBeGreaterThan(HEL.lat);
    expect(w).toBeLessThan(HEL.lon);
    expect(e).toBeGreaterThan(HEL.lon);
    expect(n - s).toBeCloseTo((2 * HEL.radiusKm) / 111.2, 1);
  });
});

/** Scripted websocket: fires open, then each message, then optionally close. */
function fakeSocket(messages: unknown[], opts: { closeAfter?: boolean; errorFirst?: boolean } = {}) {
  const listeners: Record<string, Array<(ev: { data?: unknown }) => void>> = {};
  const sent: string[] = [];
  let closed = 0;
  const ws: WebSocketLike = {
    send: (d) => {
      sent.push(d);
    },
    close: () => {
      closed++;
    },
    addEventListener: (type, fn) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  const emit = (type: string, ev: { data?: unknown } = {}) => (listeners[type] ?? []).forEach((fn) => fn(ev));
  // Events fire on the next microtask after the socket is opened, once the
  // caller has attached its listeners, the way a real socket behaves.
  const openSocket = () => {
    queueMicrotask(() => {
      if (opts.errorFirst) {
        emit("error");
        return;
      }
      emit("open");
      for (const m of messages) emit("message", { data: typeof m === "string" ? m : JSON.stringify(m) });
      if (opts.closeAfter) emit("close");
    });
    return ws;
  };
  return { openSocket, sent, closed: () => closed };
}

const AIS_MSG = (mmsi: number, lat: number, lon: number, sog: number) => ({
  MessageType: "PositionReport",
  MetaData: { MMSI: mmsi, ShipName: "TEST", latitude: lat, longitude: lon, time_utc: "2026-09-11 11:59:59 +0000 UTC" },
  Message: { PositionReport: { Sog: sog, Cog: 1, TrueHeading: 1, NavigationalStatus: 0 } },
});

describe("sampleAisStream", () => {
  it("subscribes with one box per port, dedupes by MMSI and strips identity", async () => {
    const lax = PORT_BY_LOCODE.get("USLAX")!;
    const f = fakeSocket([AIS_MSG(1, 33.73, -118.25, 0.2), AIS_MSG(1, 33.74, -118.25, 0.3), AIS_MSG(2, 33.7, -118.2, 12), "not json", { foo: 1 }]);
    const r = await sampleAisStream({ key: "k", ports: [lax], listenMs: 5, openSocket: f.openSocket });
    expect(r.messages).toBe(3);
    expect(r.positions).toHaveLength(2);
    expect(r.positions[0]).toEqual({ lat: 33.74, lon: -118.25, sog: 0.3 });
    const sub = JSON.parse(f.sent[0]) as { APIKey: string; BoundingBoxes: unknown[]; FilterMessageTypes: string[] };
    expect(sub.APIKey).toBe("k");
    expect(sub.BoundingBoxes).toHaveLength(1);
    expect(sub.FilterMessageTypes).toEqual(["PositionReport"]);
    expect(f.closed()).toBe(1);
  });
  it("rejects on a server error message", async () => {
    const f = fakeSocket([{ error: "Api Key Is Not Valid" }]);
    await expect(sampleAisStream({ key: "bad", ports: PORTS.slice(0, 1), listenMs: 50, openSocket: f.openSocket })).rejects.toThrow(/Api Key/);
  });
  it("rejects when the socket errors before any message", async () => {
    const f = fakeSocket([], { errorFirst: true });
    await expect(sampleAisStream({ key: "k", ports: PORTS.slice(0, 1), listenMs: 50, openSocket: f.openSocket })).rejects.toThrow(/socket error/);
  });
  it("resolves with what it heard when the socket closes early", async () => {
    const f = fakeSocket([AIS_MSG(9, 0, 0, 1)], { closeAfter: true });
    const r = await sampleAisStream({ key: "k", ports: PORTS.slice(0, 1), listenMs: 10_000, openSocket: f.openSocket });
    expect(r.positions).toHaveLength(1);
  });
  it("rejects when aborted", async () => {
    const f = fakeSocket([]);
    const ctrl = new AbortController();
    const p = sampleAisStream({ key: "k", ports: PORTS.slice(0, 1), listenMs: 10_000, openSocket: f.openSocket, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow(/aborted/);
  });
});

describe("portOutputs", () => {
  it("emits all / stationary / moving series with port geo and snapshot provenance", () => {
    const out = portOutputs(HEL, { all: 5, stationary: 2, moving: 3 }, "digitraffic", NOW, "m", ["n"]);
    expect(out.map((o) => o.meta.id)).toEqual(["snapshot:port-vessels:FIHEL", "snapshot:port-vessels-stationary:FIHEL", "snapshot:port-vessels-moving:FIHEL"]);
    expect(out.map((o) => o.points[0].v)).toEqual([5, 2, 3]);
    expect(out[0].meta.geo).toMatchObject({ kind: "port", id: "FIHEL" });
    expect(out[0].meta.provenance.kind).toBe("snapshot");
    expect(out[0].meta.provenance.source.id).toBe("digitraffic");
    expect(out[0].meta.provenance.retrievedAt).toBe(new Date(NOW).toISOString());
  });
});

function ctx(over: Partial<CollectorContext> = {}): CollectorContext {
  return {
    now: NOW,
    keys: {},
    fetchJson: async <T>() => DT_FIXTURE as unknown as T,
    politeDelayMs: 0,
    listenMs: 5,
    ...over,
  };
}

describe("portVesselsCollector", () => {
  it("covers Baltic ports keylessly and skips the rest without a key", async () => {
    const out = await portVesselsCollector.collect(ctx());
    const baltic = PORTS.filter((p) => p.coverage === "digitraffic").length;
    expect(out).toHaveLength(baltic * 3);
    expect(out.find((o) => o.meta.id === "snapshot:port-vessels:FIHEL")?.points[0]).toEqual({ t: NOW, v: 3 });
    expect(out.some((o) => o.meta.id.endsWith(":USLAX"))).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/23011111/);
  });
  it("adds every other port from an AISStream sample when a key is present", async () => {
    const f = fakeSocket([AIS_MSG(1, 33.73, -118.25, 0), AIS_MSG(2, 51.95, 4.1, 5)]);
    const out = await portVesselsCollector.collect(ctx({ keys: { AISSTREAM_KEY: "k" }, openSocket: f.openSocket }));
    expect(out).toHaveLength(PORTS.length * 3);
    expect(out.find((o) => o.meta.id === "snapshot:port-vessels-stationary:USLAX")?.points[0].v).toBe(1);
    expect(out.find((o) => o.meta.id === "snapshot:port-vessels-moving:NLRTM")?.points[0].v).toBe(1);
    expect(out.find((o) => o.meta.id === "snapshot:port-vessels:SGSIN")?.points[0].v).toBe(0);
    expect(out.find((o) => o.meta.id === "snapshot:port-vessels:USLAX")?.meta.provenance.source.id).toBe("aisstream");
    expect(out.find((o) => o.meta.id === "snapshot:port-vessels:USLAX")?.meta.provenance.notes?.[0]).toMatch(/undercount/);
  });
  it("propagates a Digitraffic failure", async () => {
    await expect(
      portVesselsCollector.collect(
        ctx({
          fetchJson: async () => {
            throw new Error("meri.digitraffic.fi 503");
          },
        }),
      ),
    ).rejects.toThrow(/503/);
  });
  it("describes itself", () => {
    const d = portVesselsCollector.describe();
    expect(d.id).toBe("port-vessels");
    expect(d.optionalKeys).toEqual(["AISSTREAM_KEY"]);
    expect(d.sources).toContain("digitraffic");
  });
});
