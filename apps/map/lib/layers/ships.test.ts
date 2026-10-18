// The area watch over Ships while AISStream's socket warms up, dies and comes
// back, through the layer's real fetch and a fake socket. A vessel first heard
// in the warm-up was not arriving, and a vessel aging out of a dead socket's
// table was not leaving; neither may reach the log. Digitraffic answers with
// nothing here, so every vessel is AISStream's.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { newWatch, watchStep } from "@/lib/aoi/area";
import type { Ring } from "@/lib/aoi/geometry";
import { watchModes } from "@/lib/aoi/store";
import type { LayerStatus } from "@/lib/store/globe";
import { AIS_WARMUP_MS, shipsLayer } from "./ships";
import type { ViewState } from "./types";

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static all: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeSocket.all.push(this);
  }
  send() {}
  close() {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  fail() {
    this.readyState = FakeSocket.CLOSED;
    this.onerror?.();
    this.onclose?.();
  }
  /** A PositionReport; navigational status 5 is "moored". */
  hear(mmsi: number, lon: number, lat: number) {
    const msg = {
      MessageType: "PositionReport",
      MetaData: { MMSI: mmsi, ShipName: `VESSEL ${mmsi}`, latitude: lat, longitude: lon, time_utc: new Date(Date.now()).toISOString() },
      Message: { PositionReport: { Sog: 0, Cog: 0, TrueHeading: 511, NavigationalStatus: 5 } },
    };
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

const latest = () => FakeSocket.all[FakeSocket.all.length - 1];
const ring: Ring = [[24.9, 60.1], [25.1, 60.1], [25.1, 60.2], [24.9, 60.2]];
const view: ViewState = { lon: 25, lat: 60.15, height: 200_000, heading: 0, pitch: -90 };
const SEC = 1000;
const MIN = 60 * SEC;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  vi.stubGlobal("window", {});
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: { locations: { features: [], dataUpdatedTime: "" }, vessels: [] }, source: "digitraffic", cacheAge: 0 }), { status: 200 })),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the watch over Ships across AISStream's warm-up and an outage", () => {
  const w = newWatch();
  /** One refresh as LayerHost runs it, then one watch step. */
  async function refresh() {
    const r = await shipsLayer.fetch({ keys: { AISSTREAM_KEY: "k" }, view, now: Date.now(), options: {} });
    const status: LayerStatus = { count: r.collection.features.length, source: r.source, fetchedAt: r.fetchedAt, loading: false, viewKey: "static", fetchView: view, settling: r.settling === true };
    const modes = watchModes({ ships: true }, { ships: status }, true, () => undefined, ring);
    const events = watchStep(w, r.collection.features, ring, modes, Date.now());
    return { events: events.map((e) => `${e.kind}:${e.id}`), mode: modes.get("ships"), source: r.source, n: r.collection.features.length };
  }
  const wait = (ms: number) => vi.setSystemTime(Date.now() + ms);

  it("does not read vessels first heard while the socket warms up as arrivals", async () => {
    const r0 = await refresh();
    expect(r0).toMatchObject({ source: "Digitraffic", events: [] });
    latest().open();
    wait(20 * SEC);
    latest().hear(244000001, 25.0, 60.15);
    const r1 = await refresh();
    expect(r1).toMatchObject({ source: "AISStream + Digitraffic", n: 1, events: [], mode: { mode: "hold", stale: true, reason: "settling" } });
    // A moored vessel that was there all along, first heard 3 min in.
    for (let t = 40 * SEC; t < AIS_WARMUP_MS; t += 20 * SEC) {
      wait(20 * SEC);
      if (t === 3 * MIN) latest().hear(244000002, 25.05, 60.12);
      expect((await refresh()).events).toEqual([]);
    }
    wait(20 * SEC);
    latest().hear(244000001, 25.0, 60.15);
    const settled = await refresh();
    expect(settled).toMatchObject({ source: "AISStream + Digitraffic", n: 2, events: [], mode: { mode: "step", key: "static|AISStream + Digitraffic" } });
    expect(w.log).toEqual([]);
  });

  it("does not read a dead socket's vessels as leaving, through a 21 min outage and the reconnect", async () => {
    latest().fail();
    // Every reconnect fails for 21 minutes; the table's records age past 20 min meanwhile.
    for (let t = 0; t <= 21 * MIN; t += 20 * SEC) {
      wait(20 * SEC);
      const r = await refresh();
      expect(r).toMatchObject({ source: "Digitraffic", n: 0, events: [] });
      latest().fail();
    }
    // Back: the socket opens and a new warm-up begins.
    wait(20 * SEC);
    expect((await refresh()).events).toEqual([]);
    latest().open();
    for (let t = 0; t <= AIS_WARMUP_MS; t += 20 * SEC) {
      wait(20 * SEC);
      latest().hear(244000001, 25.0, 60.15);
      const r = await refresh();
      expect(r.events).toEqual([]);
      if (t < AIS_WARMUP_MS - 20 * SEC) expect(r.mode).toMatchObject({ mode: "hold", reason: "settling" });
    }
    expect(w.log).toEqual([]);
  });

  it("still logs a vessel arriving and one leaving once the table has settled", async () => {
    wait(20 * SEC);
    latest().hear(244000003, 24.95, 60.18);
    expect((await refresh()).events).toEqual(["arrived:244000003"]);
    wait(20 * SEC);
    latest().hear(244000001, 25.3, 60.15);
    expect((await refresh()).events).toEqual(["left:244000001"]);
  });
});
