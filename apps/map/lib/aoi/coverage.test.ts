// The area watch over Aircraft, through the layer's real fetch: an in-view area
// is not the area the aircraft answer covers. The fetch stub answers as
// adsb.lol does for the query the route sends (snapped by the route's own
// helper): the airframes within that circle. Cases F1a, F1b, F1c and F2 are
// the review's probes; each once logged a departure or an arrival that did
// not happen.

import { afterEach, describe, expect, it, vi } from "vitest";
import { destination, bboxAround, haversine, NM_M } from "@/lib/globe/geo";
import { aircraftLayer } from "@/lib/layers/aircraft";
import { snapPointQuery } from "@/lib/layers/pointQuery";
import { viewKey, type ViewState } from "@/lib/layers/types";
import type { LayerStatus } from "@/lib/store/globe";
import { newWatch, watchStep, type WatchState } from "./area";
import { aircraftCoverage, coversRing, coverageKey } from "./coverage";
import type { Ring } from "./geometry";
import { areaInView, watchModes } from "./store";

interface Contact {
  hex: string;
  lon: number;
  lat: number;
}

const box = (b: [number, number, number, number]): Ring => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
const view = (lon: number, lat: number, height: number, bbox?: [number, number, number, number]): ViewState => ({ lon, lat, height, heading: 0, pitch: -90, bbox });
/** A point `km` east (bearing 90°) of the target. */
const east = (v: ViewState, km: number): [number, number] => destination(v.lat, v.lon, 90, km * 1000);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let urls: string[] = [];

/** Stub this app's /api/aircraft as the route and adsb.lol answer; OpenSky refuses when asked. */
function sky(contacts: () => Contact[]) {
  urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      urls.push(input);
      const q = new URL(input, "http://localhost").searchParams;
      if (q.get("source") === "opensky") return json({ error: "403 from opensky" }, 502);
      if (q.get("source") === "mil") return json({ data: { ac: [] }, source: "adsb.lol/mil", cacheAge: 0 });
      const s = snapPointQuery(Number(q.get("lat")), Number(q.get("lon")), Number(q.get("dist")));
      const ac = contacts()
        .filter((c) => haversine(s.lat, s.lon, c.lat, c.lon) <= s.distNm * NM_M)
        .map((c) => ({ hex: c.hex, lat: c.lat, lon: c.lon }));
      return json({ data: { ac }, source: "adsb.lol", cacheAge: 0 });
    }),
  );
}

/** One refresh as LayerHost runs it (the answer stamped with its view), then one watch step. */
async function refresh(w: WatchState, v: ViewState, ring: Ring, t: number) {
  const r = await aircraftLayer.fetch({ keys: {}, view: v, now: t, options: { aircraftSource: "auto" } });
  const status: LayerStatus = { count: r.collection.features.length, source: r.source, fetchedAt: r.fetchedAt, loading: false, viewKey: viewKey(v), fetchView: v };
  const modes = watchModes({ aircraft: true }, { aircraft: status }, areaInView(ring, v), (id) => (id === "aircraft" ? aircraftLayer : undefined), ring);
  const events = watchStep(w, r.collection.features, ring, modes, t);
  return { events: events.map((e) => `${e.kind}:${e.id}`), mode: modes.get("aircraft"), source: r.source, url: urls.filter((u) => u.includes("source=adsb")).at(-1) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the watch over Aircraft holds while the answer does not cover the area", () => {
  it("F1a: an airframe crossing the rim of the query circle inside an in-view area is not logged", async () => {
    const v = view(-99, 31, 900_000);
    const [cx, cy] = east(v, 400);
    const ring = box(bboxAround(cy, cx, 100_000));
    expect(areaInView(ring, v)).toBe(true);
    let km = 440;
    sky(() => [{ hex: "a1b2c3", lon: east(v, km)[0], lat: east(v, km)[1] }]);
    const w = newWatch();
    const e1 = await refresh(w, v, ring, 1);
    expect(e1.url).toBe("/api/aircraft?source=adsblol&lat=31.000&lon=-99.000&dist=250");
    expect(e1.mode).toEqual({ mode: "hold", stale: true, reason: "coverage" });
    km = 470; // still inside the area, now past 250 nm
    expect((await refresh(w, v, ring, 2)).events).toEqual([]);
    km = 440;
    expect((await refresh(w, v, ring, 3)).events).toEqual([]);
    expect(w.log).toEqual([]);
  });

  it("F1b: a 14° by 12° area centred on the target is held, however the contact moves", async () => {
    const v = view(-99, 31, 900_000);
    const ring: Ring = box([-106, 25, -92, 37]);
    let km = 450;
    sky(() => [{ hex: "c0ffee", lon: east(v, km)[0], lat: east(v, km)[1] }]);
    const w = newWatch();
    for (let t = 1; t <= 4; t++) {
      km = t % 2 ? 450 : 480;
      const r = await refresh(w, v, ring, t);
      expect(r.events).toEqual([]);
      expect(r.mode).toMatchObject({ mode: "hold", reason: "coverage" });
    }
    expect(w.log).toEqual([]);
  });

  it("F1c: OpenSky refused, the 250 nm fallback does not reach the whole area", async () => {
    const v = view(-99, 31, 3_000_000);
    const [cx, cy] = east(v, 440);
    const ring = box(bboxAround(cy, cx, 100_000));
    expect(areaInView(ring, v)).toBe(true);
    let km = 450;
    sky(() => [{ hex: "c0ffee", lon: east(v, km)[0], lat: east(v, km)[1] }]);
    const w = newWatch();
    for (let t = 1; t <= 4; t++) {
      km = t % 2 ? 450 : 480;
      const r = await refresh(w, v, ring, t);
      expect(r.source).toBe("adsb.lol + adsb.lol mil");
      expect(r.url).toContain("dist=250");
      expect(r.events).toEqual([]);
    }
    expect(w.log).toEqual([]);
  });

  it("F2: a pan inside one view-key cell is a new circle, so a still airframe is not an arrival", async () => {
    const bbox: [number, number, number, number] = [-100, 30.5, -97.5, 32];
    const vA = view(-99.1, 31.1, 70_000, bbox);
    const vB = view(-98.8, 31.2, 90_000, bbox);
    expect(viewKey(vA)).toBe(viewKey(vB));
    const ring = box(bboxAround(31.5, -98, 5_000));
    let beef01: Contact[] = [{ hex: "beef01", lon: -98, lat: 31.5 }];
    sky(() => beef01);
    const w = newWatch();
    const a = await refresh(w, vA, ring, 1);
    expect(a.url).toContain("dist=45");
    expect(a.mode).toMatchObject({ mode: "hold", reason: "coverage" });
    const b = await refresh(w, vB, ring, 2);
    expect(b.url).toContain("dist=58");
    expect(b.events).toEqual([]);
    expect(b.mode).toEqual({ mode: "step", key: "circle:31.2,-98.8,60|adsb.lol" });
    expect((await refresh(w, vA, ring, 3)).events).toEqual([]);
    expect((await refresh(w, vB, ring, 4)).events).toEqual([]);
    expect((await refresh(w, vB, ring, 5)).events).toEqual([]);
    expect(w.log).toEqual([]);
    // Two answers that both covered the area, for the same circle, are still compared.
    beef01 = [];
    expect((await refresh(w, vB, ring, 6)).events).toEqual(["left:beef01"]);
  });

  it("still logs an airframe leaving an area its answer covers", async () => {
    const v = view(-99, 31, 900_000);
    const [cx, cy] = east(v, 100);
    const ring = box(bboxAround(cy, cx, 50_000));
    let km = 120;
    sky(() => [{ hex: "a1b2c3", lon: east(v, km)[0], lat: east(v, km)[1] }]);
    const w = newWatch();
    const r1 = await refresh(w, v, ring, 1);
    expect(r1.mode).toEqual({ mode: "step", key: "circle:31,-99,250|adsb.lol" });
    expect(r1.events).toEqual([]);
    km = 170;
    expect((await refresh(w, v, ring, 2)).events).toEqual(["left:a1b2c3"]);
    km = 130;
    expect((await refresh(w, v, ring, 3)).events).toEqual(["arrived:a1b2c3"]);
  });
});

describe("aircraftCoverage", () => {
  it("is the circle the route asks adsb.lol for", () => {
    for (const v of [view(-99.14, 31.06, 70_000), view(-98.8, 31.2, 90_000), view(12.3456, -45.6789, 400_000), view(-99, 31, 3_000_000)]) {
      const c = aircraftCoverage("adsb.lol", v);
      const dist = Math.round(Math.min(250, Math.max(40, (v.height * 1.2) / NM_M)));
      expect(c).toEqual({ kind: "circle", ...snapPointQuery(Number(v.lat.toFixed(3)), Number(v.lon.toFixed(3)), dist) });
    }
    expect(aircraftCoverage("adsb.lol + adsb.lol mil", view(-99.14, 31.06, 70_000))).toEqual({ kind: "circle", lat: 31.1, lon: -99.1, distNm: 250 });
    expect(aircraftCoverage("adsbexchange", view(-99, 31, 70_000))).toMatchObject({ kind: "circle", distNm: 50 });
  });
  it("is the box OpenSky was sent, or the world", () => {
    expect(aircraftCoverage("opensky (anon) + adsb.lol mil", view(-99, 31, 3_000_000, [-120, 20, -80, 45]))).toEqual({ kind: "world" });
    expect(aircraftCoverage("opensky (auth)", view(-99, 31, 900_000, [-104, 27, -94, 35]))).toEqual({ kind: "box", bbox: [-104, 27, -94, 35] });
    expect(aircraftCoverage("opensky (anon)", view(-99, 31, 900_000))).toEqual({ kind: "world" });
    expect(aircraftCoverage("opensky (anon)", view(179, 0, 900_000, [175, -5, -175, 5]))).toEqual({ kind: "none" });
  });
  it("vouches for nothing when only the military feed or nothing answered, or the view is unknown", () => {
    expect(aircraftCoverage("adsb.lol mil", view(-99, 31, 3_000_000))).toEqual({ kind: "none" });
    expect(aircraftCoverage("", view(-99, 31, 3_000_000))).toEqual({ kind: "none" });
    expect(aircraftCoverage("adsb.lol", undefined)).toEqual({ kind: "none" });
    expect(coversRing({ kind: "none" }, box([0, 0, 1, 1]))).toBe(false);
  });
  it("covers a ring only when its whole outline is inside", () => {
    const c = { kind: "circle" as const, lat: 0, lon: 0, distNm: 100 };
    expect(coversRing(c, box([-1, -1, 1, 1]))).toBe(true);
    expect(coversRing(c, box([-1, -1, 1.6, 1]))).toBe(false);
    expect(coversRing({ kind: "box", bbox: [-2, -2, 2, 2] }, box([-1, -1, 1, 1]))).toBe(true);
    expect(coversRing({ kind: "box", bbox: [-2, -2, 2, 2] }, box([-1, -1, 3, 1]))).toBe(false);
    expect(coverageKey(c)).toBe("circle:0,0,100");
  });
});
