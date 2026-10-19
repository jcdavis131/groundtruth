// The drawn-area tools: inside tests, the watch, the exports and the land
// report's arithmetic. Polygons here are plain squares so each share has a
// known answer; the line layer is HIFLD's captured Austin payload.

import { describe, expect, it } from "vitest";
import type { LayerFeature, LayerId, LoadedBoxExtra } from "@/lib/layers/types";
import { buildFloodZones } from "@/lib/land/features";
import { buildPipelines, buildTransmission, type Row } from "@/lib/infra/features";
import transmission from "@/lib/infra/fixtures/transmission-austin.json";
import natgas from "@/lib/infra/fixtures/pipelines-natgas-sanantonio.json";
import { featureInside, lengthInside, metres, pointInPolygon, sampleGrid, type Ring } from "./geometry";
import { featuresInside, insideCsv, insideGeoJson, newWatch, watchCsv, watchStep, WATCH_LAYERS, WATCH_LOG_MAX, type WatchEvent, type WatchMode } from "./area";
import { ringKey, useArea, watchModes } from "./store";
import type { LayerStatus } from "@/lib/store/globe";
import { areaReport, reportText } from "./report";

const sq = (w: number, s: number, e: number, n: number): Ring => [[w, s], [e, s], [e, n], [w, n]];
/** A near-only layer's dashed loaded box, with what the answer left out. */
const loaded = (layer: LayerId, w: number, s: number, e: number, n: number, extra: LoadedBoxExtra = {}): LayerFeature => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
  properties: { id: `${layer}:loaded-box`, layer, name: "Loaded area", kind: "loaded-box", source: "this app", extra },
});
const point = (layer: LayerId, id: string, lon: number, lat: number, extra: Partial<LayerFeature["properties"]> = {}): LayerFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat, 0] },
  properties: { id, layer, name: id, source: "test", ...extra },
});

describe("geometry", () => {
  const ring = sq(0, 0, 1, 1);
  it("finds points, lines and polygons that touch the area", () => {
    expect(featureInside(point("dams", "in", 0.5, 0.5), ring)).toBe(true);
    expect(featureInside(point("dams", "out", 1.5, 0.5), ring)).toBe(false);
    const crossing: LayerFeature = { type: "Feature", geometry: { type: "LineString", coordinates: [[-1, 0.5], [2, 0.5]] }, properties: { id: "l", layer: "rail", name: "l", source: "t" } };
    expect(featureInside(crossing, ring)).toBe(true);
    const around: LayerFeature = { type: "Feature", geometry: { type: "Polygon", coordinates: [sq(-5, -5, 5, 5).concat([[-5, -5]])] }, properties: { id: "p", layer: "flood", name: "p", source: "t" } };
    expect(featureInside(around, ring)).toBe(true);
  });
  it("respects polygon holes", () => {
    const poly = [sq(0, 0, 10, 10), sq(4, 4, 6, 6)];
    expect(pointInPolygon(5, 5, poly)).toBe(false);
    expect(pointInPolygon(2, 2, poly)).toBe(true);
  });
  it("measures the part of a line inside the area to within a step", () => {
    const small = sq(-98, 30, -97.9, 30.1);
    const full = metres([-98.2, 30.05], [-97.7, 30.05]);
    const inside = lengthInside([[-98.2, 30.05], [-97.7, 30.05]], small);
    const expected = metres([-98, 30.05], [-97.9, 30.05]);
    expect(Math.abs(inside - expected)).toBeLessThan(2 * 200);
    expect(inside).toBeLessThan(full);
  });
  it("samples a grid inside the area", () => {
    const g = sampleGrid(sq(-98, 30, -97.9, 30.1), 2500);
    expect(g.points.length).toBeGreaterThan(2000);
    expect(g.points.length).toBeLessThanOrEqual(2600);
    expect(g.spacingM).toBeGreaterThan(150);
    expect(g.spacingM).toBeLessThan(250);
  });
});

describe("featuresInside and the exports", () => {
  const ring = sq(0, 0, 1, 1);
  const fs = [
    point("dams", "a", 0.2, 0.2, { details: { "NID id": "TX1", "hazard potential": "High" } }),
    point("dams", "b", 3, 3),
    point("satellites", "iss", 0.5, 0.5),
    point("traffic", "car", 0.5, 0.5, { simulated: true }),
    point("flood", "box", 0.5, 0.5, { kind: "loaded-box" }),
  ];
  it("leaves out orbits, simulations and map furniture", () => {
    const g = featuresInside(fs, ring);
    expect(g).toEqual([{ layer: "dams", features: [fs[0]] }]);
  });
  it("writes GeoJSON with the area and CSV with one row per feature", () => {
    const g = featuresInside(fs, ring);
    const gj = insideGeoJson(ring, g, "2026-09-26T00:00:00.000Z");
    expect(gj.features[0].properties).toEqual({ role: "drawn area" });
    expect((gj.features[0].geometry as { coordinates: number[][][] }).coordinates[0]).toHaveLength(5);
    expect(gj.features[1].properties).toMatchObject({ layer: "dams", id: "a", "NID id": "TX1" });
    const csv = insideCsv(g).split("\r\n");
    expect(csv[0]).toBe("layer,id,name,kind,lon,lat,source,observed_at,details");
    expect(csv[1]).toBe("dams,a,a,,0.2,0.2,test,,NID id: TX1; hazard potential: High");
  });
});

describe("watchStep", () => {
  const ring = sq(0, 0, 1, 1);
  type M = WatchMode;
  const modes = (m: Partial<Record<LayerId, M>>) => new Map(Object.entries(m) as Array<[LayerId, M]>);
  const step = (key = "static"): M => ({ mode: "step", key });
  const ids = (es: WatchEvent[]) => es.map((e) => `${e.kind}:${e.id}`).sort();
  it("takes a silent baseline, then reports arrivals and departures", () => {
    const w = newWatch();
    expect(watchStep(w, [point("earthquakes", "q1", 0.5, 0.5)], ring, modes({ earthquakes: step() }), 1)).toEqual([]);
    const e2 = watchStep(w, [point("earthquakes", "q1", 1.5, 0.5), point("earthquakes", "q2", 0.4, 0.4)], ring, modes({ earthquakes: step() }), 2);
    expect(ids(e2)).toEqual(["arrived:q2", "left:q1"]);
    expect(w.log).toHaveLength(2);
    expect(watchCsv(w.log).split("\r\n")[0]).toBe("time,event,layer,id,name");
  });
  it("keeps the newest WATCH_LOG_MAX events, counts the ones it drops, and says so in the CSV", () => {
    const w = newWatch();
    watchStep(w, [], ring, modes({ earthquakes: step() }), 1);
    const many = Array.from({ length: WATCH_LOG_MAX - 100 }, (_, i) => point("earthquakes", `q${i}`, 0.5, 0.5));
    watchStep(w, many, ring, modes({ earthquakes: step() }), 2);
    expect(w.dropped).toBe(0);
    expect(watchCsv(w.log, { count: w.dropped, through: w.droppedThrough }).trimEnd().split("\r\n")).toHaveLength(WATCH_LOG_MAX - 100 + 1);
    // They all leave: 400 more events, 300 of the oldest arrivals are dropped.
    watchStep(w, [], ring, modes({ earthquakes: step() }), 3);
    expect(w.log).toHaveLength(WATCH_LOG_MAX);
    expect(w.log.every((e, i) => i < WATCH_LOG_MAX - 100 || e.kind === "arrived")).toBe(true);
    expect(w.dropped).toBe(WATCH_LOG_MAX - 200);
    expect(w.droppedThrough).toBe(2);
    const rows = watchCsv(w.log, { count: w.dropped, through: w.droppedThrough }).trimEnd().split("\r\n");
    expect(rows).toHaveLength(WATCH_LOG_MAX + 2);
    expect(rows.at(-1)).toBe(`1970-01-01T00:00:00.002Z,dropped,,,${WATCH_LOG_MAX - 200} earlier events not kept: the log keeps the newest ${WATCH_LOG_MAX}`);
    expect(newWatch().dropped).toBe(0);
  });
  it("reports an aircraft and a ship arriving and leaving, by their stable ids", () => {
    expect(WATCH_LAYERS.has("aircraft")).toBe(true);
    expect(WATCH_LAYERS.has("ships")).toBe(true);
    const w = newWatch();
    const m = modes({ aircraft: step("0.5,0.5,5|adsb.lol"), ships: step("static|Digitraffic") });
    expect(watchStep(w, [], ring, m, 1)).toEqual([]);
    const e2 = watchStep(w, [point("aircraft", "a1b2c3", 0.5, 0.5), point("ships", "230000001", 0.3, 0.3)], ring, m, 2);
    expect(ids(e2)).toEqual(["arrived:230000001", "arrived:a1b2c3"]);
    const e3 = watchStep(w, [point("aircraft", "a1b2c3", 1.5, 0.5), point("ships", "230000001", 0.3, -0.2)], ring, m, 3);
    expect(ids(e3)).toEqual(["left:230000001", "left:a1b2c3"]);
    expect(e3.map((e) => e.layer).sort()).toEqual(["aircraft", "ships"]);
  });
  it("logs nothing for a contact that moves within the area", () => {
    const w = newWatch();
    const m = modes({ aircraft: step("0.5,0.5,5|adsb.lol"), ships: step("static|Digitraffic") });
    watchStep(w, [point("aircraft", "a1b2c3", 0.1, 0.1), point("ships", "230000001", 0.2, 0.8)], ring, m, 1);
    // Same id, a new reported position every refresh.
    for (let t = 2; t <= 5; t++) {
      const d = t / 10;
      expect(watchStep(w, [point("aircraft", "a1b2c3", 0.1 + d, 0.1 + d), point("ships", "230000001", 0.2 + d, 0.8)], ring, m, t)).toEqual([]);
    }
    expect(w.inside.size).toBe(2);
    expect(w.log).toEqual([]);
  });
  it("never reports a layer switched off as everything leaving, nor its return as arrivals", () => {
    const w = newWatch();
    watchStep(w, [point("earthquakes", "q1", 0.5, 0.5)], ring, modes({ earthquakes: step() }), 1);
    expect(watchStep(w, [], ring, modes({ earthquakes: { mode: "drop" } }), 2)).toEqual([]);
    expect(watchStep(w, [point("earthquakes", "q1", 0.5, 0.5), point("earthquakes", "q3", 0.6, 0.6)], ring, modes({ earthquakes: step() }), 3)).toEqual([]);
    expect(ids(watchStep(w, [point("earthquakes", "q1", 0.5, 0.5)], ring, modes({ earthquakes: step() }), 4))).toEqual(["left:q3"]);
  });
  it("reports nothing while a layer is loading, whatever its features do, and keeps its baseline", () => {
    const w = newWatch();
    watchStep(w, [point("fires", "f1", 0.5, 0.5)], ring, modes({ fires: step("A") }), 1);
    // Refetching: the renderer can hold anything (the previous view's answer); nothing is reported.
    expect(watchStep(w, [], ring, modes({ fires: { mode: "hold" } }), 2)).toEqual([]);
    expect(watchStep(w, [point("fires", "f9", 0.2, 0.2)], ring, modes({ fires: { mode: "hold" } }), 3)).toEqual([]);
    expect(w.inside.has("fires:f1")).toBe(true);
    // Settled again on the same view: compared with the baseline, so only real changes show.
    expect(watchStep(w, [point("fires", "f1", 0.5, 0.5)], ring, modes({ fires: step("A") }), 4)).toEqual([]);
    expect(ids(watchStep(w, [point("fires", "f2", 0.5, 0.5)], ring, modes({ fires: step("A") }), 5))).toEqual(["arrived:f2", "left:f1"]);
  });
  it("retakes the baseline silently when a layer answers for another view", () => {
    const w = newWatch();
    watchStep(w, [point("fires", "f1", 0.5, 0.5)], ring, modes({ fires: step("A") }), 1);
    expect(watchStep(w, [point("fires", "f2", 0.5, 0.5)], ring, modes({ fires: step("B") }), 2)).toEqual([]);
    expect(ids(watchStep(w, [point("fires", "f3", 0.5, 0.5)], ring, modes({ fires: step("B") }), 3))).toEqual(["arrived:f3", "left:f2"]);
  });
  it("forgets a view-dependent layer while the area is out of view, and comes back silently", () => {
    const w = newWatch();
    watchStep(w, [point("fires", "f1", 0.5, 0.5)], ring, modes({ fires: step("A") }), 1);
    expect(watchStep(w, [], ring, modes({ fires: { mode: "hold", stale: true } }), 2)).toEqual([]);
    expect(w.seen.has("fires")).toBe(false);
    // Back in view with the same view key, but the baseline is gone: silent.
    expect(watchStep(w, [point("fires", "f2", 0.5, 0.5)], ring, modes({ fires: step("A") }), 3)).toEqual([]);
    expect(ids(watchStep(w, [], ring, modes({ fires: step("A") }), 4))).toEqual(["left:f2"]);
  });
  it("ignores layers that do not come and go", () => {
    const w = newWatch();
    watchStep(w, [], ring, modes({ dams: step() }), 1);
    expect(watchStep(w, [point("dams", "d", 0.5, 0.5)], ring, modes({ dams: step() }), 2)).toEqual([]);
  });
});

describe("watchModes", () => {
  const status = (x: Partial<LayerStatus>): LayerStatus => ({ count: 0, source: "t", fetchedAt: 1, loading: false, ...x });
  const info = (id: LayerId) => ({ fires: { viewDependent: true }, hazards: { dependsOn: ["earthquakes", "alerts"] as LayerId[] } })[id as "fires" | "hazards"];
  const ring = sq(0, 0, 1, 1);
  it("steps a settled layer on the view key its answer was fetched for and the sources that answered", () => {
    const m = watchModes({ fires: true, earthquakes: true }, { fires: status({ viewKey: "12,4" }), earthquakes: status({ viewKey: "static" }) }, true, info, ring);
    expect(m.get("fires")).toEqual({ mode: "step", key: "12,4|t" });
    expect(m.get("earthquakes")).toEqual({ mode: "step", key: "static|t" });
  });
  it("retakes the baseline silently when the same view is answered from other sources", () => {
    const air = (id: LayerId) => (id === "aircraft" ? { viewDependent: true } : undefined);
    // Zoomed out past OpenSky's global height: OpenSky answers for the world; refused, adsb.lol's 250 nm around the view centre covers the area.
    const view = { lon: 0.5, lat: 0.5, height: 3_000_000, heading: 0, pitch: -90 };
    const opensky = { aircraft: status({ viewKey: "0.5,0.5,12", source: "opensky (anon) + adsb.lol mil", fetchView: view }) };
    const fallback = { aircraft: status({ viewKey: "0.5,0.5,12", source: "adsb.lol + adsb.lol mil", fetchView: view }) };
    const w = newWatch();
    watchStep(w, [point("aircraft", "a1", 0.5, 0.5), point("aircraft", "a2", 0.6, 0.6)], ring, watchModes({ aircraft: true }, opensky, true, air, ring), 1);
    // OpenSky did not answer and adsb.lol does not report a1: another feed, not a departure.
    expect(watchStep(w, [point("aircraft", "a2", 0.6, 0.6)], ring, watchModes({ aircraft: true }, fallback, true, air, ring), 2)).toEqual([]);
    // Two answers from the same sources are compared again.
    const e3 = watchStep(w, [], ring, watchModes({ aircraft: true }, fallback, true, air, ring), 3);
    expect(e3.map((e) => `${e.kind}:${e.id}`)).toEqual(["left:a2"]);
  });
  it("holds a layer that is loading, and forgets a view-dependent one while the area is out of view", () => {
    expect(watchModes({ earthquakes: true }, { earthquakes: status({ loading: true }) }, true, info, ring).get("earthquakes")).toEqual({ mode: "hold" });
    const out = watchModes({ fires: true, earthquakes: true }, { fires: status({}), earthquakes: status({}) }, false, info, ring);
    expect(out.get("fires")).toEqual({ mode: "hold", stale: true });
    // A layer that loads the whole world keeps watching while the camera is elsewhere.
    expect(out.get("earthquakes")?.mode).toBe("step");
  });
  it("forgets a layer whose answer is still filling in, and steps it once it has settled", () => {
    expect(watchModes({ ships: true }, { ships: status({ settling: true }) }, true, info, ring).get("ships")).toEqual({ mode: "hold", stale: true, reason: "settling" });
    expect(watchModes({ ships: true }, { ships: status({ settling: false }) }, true, info, ring).get("ships")?.mode).toBe("step");
  });
  it("drops a layer that is off, failed or has not answered", () => {
    const m = watchModes({ earthquakes: false, fires: true, events: true }, { earthquakes: status({}), fires: status({ error: "x" }), events: status({ fetchedAt: 0 }) }, true, info, ring);
    expect([m.get("earthquakes"), m.get("fires"), m.get("events")]).toEqual([{ mode: "drop" }, { mode: "drop" }, { mode: "drop" }]);
  });
  it("leaves Hazard alerts out while a layer it hands events to is on, so a hand-off is never a departure", () => {
    const st = { hazards: status({}), earthquakes: status({}) };
    expect(watchModes({ hazards: true }, st, true, info, ring).get("hazards")?.mode).toBe("step");
    expect(watchModes({ hazards: true, earthquakes: true }, st, true, info, ring).get("hazards")).toEqual({ mode: "drop" });
    expect(watchModes({ hazards: true, alerts: true }, st, true, info, ring).get("hazards")).toEqual({ mode: "drop" });
    // Switching Earthquakes on mid-watch: the hazard quakes it takes over are not logged as leaving.
    const w = newWatch();
    watchStep(w, [point("hazards", "h1", 0.5, 0.5)], ring, watchModes({ hazards: true }, st, true, info, ring), 1);
    expect(watchStep(w, [], ring, watchModes({ hazards: true, earthquakes: true }, st, true, info, ring), 2)).toEqual([]);
    expect(watchStep(w, [point("hazards", "h1", 0.5, 0.5)], ring, watchModes({ hazards: true }, st, true, info, ring), 3)).toEqual([]);
  });
});

describe("a redrawn area", () => {
  it("is told apart by value, and restarting the watch clears the baseline and the log", () => {
    expect(ringKey(sq(0, 0, 1, 1))).toBe(ringKey(sq(0, 0, 1, 1)));
    expect(ringKey(sq(0, 0, 1, 1))).not.toBe(ringKey(sq(0, 0, 2, 1)));
    const st = useArea.getState();
    st.startWatch();
    st.watch.log.push({ at: 1, kind: "arrived", layer: "earthquakes", id: "q", name: "q" });
    st.watch.seen.set("earthquakes", "static");
    useArea.getState().restartWatch(ringKey(sq(0, 0, 2, 1)));
    const after = useArea.getState();
    expect(after.watching).toBe(true);
    expect(after.watchRing).toBe(ringKey(sq(0, 0, 2, 1)));
    expect(after.watch.log).toEqual([]);
    expect(after.watch.seen.size).toBe(0);
    useArea.getState().stopWatch();
  });
});

describe("areaReport", () => {
  const ring = sq(-98, 30, -97.98, 30.02);
  // A zone AE square covering the west half of the drawn area, and a minimal-hazard X over the rest.
  const zones = buildFloodZones([
    { geometry: { type: "Polygon", coordinates: [[[-98.1, 29.9], [-97.99, 29.9], [-97.99, 30.1], [-98.1, 30.1], [-98.1, 29.9]]] }, properties: { FLD_AR_ID: "1", FLD_ZONE: "AE", SFHA_TF: "T" } },
    { geometry: { type: "Polygon", coordinates: [[[-97.99, 29.9], [-97.9, 29.9], [-97.9, 30.1], [-97.99, 30.1], [-97.99, 29.9]]] }, properties: { FLD_AR_ID: "2", FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD", SFHA_TF: "F" } },
  ]);
  it("gives a polygon layer's share by class with its sample arithmetic", () => {
    const r = areaReport({ ring, areaM2: 4_000_000, features: zones, answering: new Set<LayerId>(["flood"]), on: { flood: true } });
    const flood = r.sections.find((s) => s.title.startsWith("Flood"))!;
    const ae = flood.lines.find((l) => l.label.startsWith("1 % annual-chance"))!;
    const pct = Number(ae.value.split(" %")[0]);
    expect(pct).toBeGreaterThan(47);
    expect(pct).toBeLessThan(53);
    expect(ae.formula).toMatch(/^\d+ of \d+ loaded samples = \d+ %/);
    expect(r.samples).toBeGreaterThan(2000);
  });
  it("counts samples outside the loaded box as not loaded, never as none", () => {
    const box: LayerFeature = { type: "Feature", geometry: { type: "Polygon", coordinates: [[[-98.1, 29.9], [-97.99, 29.9], [-97.99, 30.1], [-98.1, 30.1], [-98.1, 29.9]]] }, properties: { id: "flood:loaded-box", layer: "flood", name: "Loaded area", kind: "loaded-box", source: "this app" } };
    const r = areaReport({ ring, areaM2: 4_000_000, features: [...zones, box], answering: new Set<LayerId>(["flood"]), on: { flood: true } });
    const flood = r.sections.find((s) => s.title.startsWith("Flood"))!;
    expect(flood.notes?.some((n) => /outside the box this layer loaded/.test(n))).toBe(true);
    // Every loaded sample is in the AE half.
    expect(flood.lines[0].value.startsWith("100 %")).toBe(true);
  });
  it("lists layers that are off or have no answer instead of reporting zero", () => {
    const r = areaReport({ ring, areaM2: 4_000_000, features: [], answering: new Set<LayerId>(), on: { wetlands: true, landcover: true }, labels: { wetlands: "Wetlands" } });
    expect(r.sections.map((s) => s.title)).toEqual(["Drawn area"]);
    expect(r.missing).toEqual(expect.arrayContaining(["flood: off (switch it on to include it)", "Wetlands: no answer yet, or it failed"]));
    expect(r.missing.some((m) => m.startsWith("landcover: a picture"))).toBe(true);
  });
  const lines = buildTransmission(transmission.features as Row[] as never);
  const tl = (ring: Ring, box: LayerFeature | null) =>
    areaReport({ ring, areaM2: 1e10, features: box ? [...lines, box] : lines, answering: new Set<LayerId>(["transmission"]), on: { transmission: true } }).sections.find((s) => s.title.startsWith("Transmission"))!;
  it("sums line length inside the area by class, on HIFLD's Austin lines", () => {
    const big: Ring = sq(-98, 30, -97, 31);
    const r = areaReport({ ring: big, areaM2: 1e10, features: [...lines, loaded("transmission", -99, 29, -96, 32)], answering: new Set<LayerId>(["transmission"]), on: { transmission: true } });
    const t = r.sections.find((s) => s.title.startsWith("Transmission"))!;
    expect(t.lines.length).toBeGreaterThan(0);
    expect(t.lines[0].formula).toMatch(/200 m steps/);
    expect(t.notes ?? []).toEqual([]);
    expect(reportText(r, "test")).toContain("Transmission lines (HIFLD archive)");
  });
  it("says a length is partial when the area runs past the loaded box, and not loaded outside it", () => {
    const big: Ring = sq(-98, 30, -97, 31);
    const part = tl(big, loaded("transmission", -98, 30, -97.5, 31));
    expect(part.lines[0].value).not.toBe("not loaded");
    expect(part.notes?.some((n) => /outside the box this layer loaded: lengths cover only the loaded part/.test(n))).toBe(true);
    const away = tl(big, loaded("transmission", -90, 40, -89, 41));
    expect(away.lines).toEqual([expect.objectContaining({ value: "not loaded" })]);
    // No loaded box: the layer loaded nothing here (it was above the heights it loads at), which is not "none".
    const none = tl(big, null);
    expect(none.lines).toEqual([expect.objectContaining({ value: "not loaded" })]);
  });
  it("says a length from a capped or coarsened answer is a floor, not a total", () => {
    const t = tl(sq(-98, 30, -97, 31), loaded("transmission", -99, 29, -96, 32, { truncated: true, coarsenedForSize: true }));
    expect(t.notes?.some((n) => /record limit was hit when this layer loaded \(highest voltage first\): lengths are a floor, not a total/.test(n))).toBe(true);
    expect(t.notes?.some((n) => /coarsened to fit the response: lengths are approximate/.test(n))).toBe(true);
  });
  it("says a pipeline commodity whose service did not answer is not loaded, never leaves it out as none", () => {
    // EIA's San Antonio natural gas lines answered; the HGL service did not (counts.hgl null -> missing).
    const gas = buildPipelines("natgas", natgas.features as Row[]);
    const pipes = (ring: Ring) =>
      areaReport({ ring, areaM2: 1e10, features: [...gas, loaded("pipelines", -99, 29, -98, 30, { missing: ["hgl"] })], answering: new Set<LayerId>(["pipelines"]), on: { pipelines: true } }).sections.find((s) => s.title.startsWith("Pipelines"))!;
    const over = pipes(sq(-98.6, 29.2, -98.2, 29.6));
    expect(over.lines.find((l) => l.label === "Natural gas")!.value).toMatch(/^[\d.,]+ k?m$/);
    expect(over.lines.find((l) => l.label === "Hydrocarbon gas liquids")).toEqual(expect.objectContaining({ value: "not loaded", formula: expect.stringContaining("did not answer") }));
    // No loaded line inside the area: the answered ones are none, the unanswered one is still not loaded.
    const empty = pipes(sq(-98.95, 29.8, -98.9, 29.85));
    expect(empty.lines).toEqual([expect.objectContaining({ value: "none of the loaded lines" }), expect.objectContaining({ label: "Hydrocarbon gas liquids", value: "not loaded" })]);
  });
  it("names what the plant sum leaves out: planned-only plants, no-nameplate generators, Wikidata plants and the size floor", () => {
    const ring = sq(0, 0, 1, 1);
    const plant = (id: string, extra: object) => point("plants", id, 0.5, 0.5, { extra });
    const fs = [
      plant("a", { family: "gas", mw: 500, source: "eia" }),
      plant("b", { family: "solar", plannedMw: 80, source: "eia" }),
      plant("c", { family: "nuclear", mw: 1000, source: "wikidata" }),
      loaded("plants", -1, -1, 2, 2, { floorMw: 50 }),
    ];
    const r = areaReport({ ring, areaM2: 1e10, features: fs, answering: new Set<LayerId>(["plants"]), on: { plants: true } });
    const sum = r.sections.find((s) => s.title === "Counted inside")!.lines.find((l) => l.label.startsWith("operating nameplate"))!;
    expect(sum.value).toBe("500 MW");
    expect(sum.formula).toContain("1 planned-only plants add none");
    expect(sum.formula).toContain("no nameplate value adds nothing");
    expect(sum.formula).toContain("1 nuclear plant from Wikidata is not summed");
    expect(sum.formula).toContain("only US plants of 50 MW or more");
    // Loaded as the world view (no loaded box): the sum says so rather than passing as a total.
    const world = areaReport({ ring, areaM2: 1e10, features: fs.slice(0, 3), answering: new Set<LayerId>(["plants"]), on: { plants: true } });
    expect(world.sections.find((s) => s.title === "Counted inside")!.lines.find((l) => l.label.startsWith("operating nameplate"))!.formula).toContain("world view");
  });
});
