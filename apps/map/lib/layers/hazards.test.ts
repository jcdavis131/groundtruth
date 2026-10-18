import { describe, expect, it } from "vitest";
import type { FetchResult, LayerFeature, RefineContext } from "./types";
import { markLiveOutlined, type HazardAlertExtra } from "@/lib/hazards/features";
import { liveAlertId, liveDrawnIds } from "@/lib/live/live";
import { hazardsLayer, hazardsNote, stepAside } from "./hazards";

const feature = (id: string, extra: HazardAlertExtra): LayerFeature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [0, 0] },
  properties: { id, layer: "hazards", name: id, source: extra.source, extra },
});

const nws = (id: string, severity: string | undefined, liveOutlined?: boolean): LayerFeature =>
  feature(`nws:${id}`, { source: "NWS", severity, event: "alert", drawnAs: "polygon", nwsId: id, liveOutlined });

const ALL = [
  nws("extreme", "Extreme", true),
  nws("severe", "Severe", true),
  nws("moderate", "Moderate"),
  nws("minor", "Minor"),
  nws("unrated", undefined),
  feature("gdacs-green-dup", { source: "GDACS", severity: "Green", event: "earthquake", drawnAs: "point", alsoInUsgs: true }),
  feature("gdacs-orange-dup", { source: "GDACS", severity: "Orange", event: "earthquake", drawnAs: "point", alsoInUsgs: true }),
  feature("gdacs-red-flood", { source: "GDACS", severity: "Red", event: "flood", drawnAs: "point" }),
  feature("eonet", { source: "EONET", event: "volcano", drawnAs: "point" }),
];
const ids = (fs: LayerFeature[]) => fs.map((f) => f.properties.id);

/** A host context: which layers are on and answering, and which alerts Live warnings holds (by NWS id). */
const ctx = (on: { earthquakes?: boolean; alerts?: boolean }, answering: { earthquakes?: boolean; alerts?: boolean } = on, liveHolds: string[] = []): RefineContext => ({
  layersOn: on,
  answering,
  holds: (layer, id) => layer === "alerts" && liveHolds.map(liveAlertId).includes(id),
});

describe("hazards stepping aside for overlapping layers", () => {
  it("draws everything while Earthquakes and Live warnings are both off", () => {
    const r = stepAside(ALL, ctx({ earthquakes: false, alerts: false }));
    expect(r.features).toHaveLength(ALL.length);
    expect(r.quakesHidden + r.leftToLive + r.keptFromLive).toBe(0);
    expect(stepAside(ALL, undefined).features).toHaveLength(ALL.length);
  });

  it("leaves a Severe or Extreme alert to Live warnings only when it is marked and that layer holds it", () => {
    const r = stepAside(ALL, ctx({ alerts: true }, { alerts: true }, ["extreme", "severe"]));
    expect(r.leftToLive).toBe(2);
    expect(ids(r.features)).not.toContain("nws:extreme");
    expect(ids(r.features)).not.toContain("nws:severe");
    expect(ids(r.features)).toEqual(expect.arrayContaining(["nws:moderate", "nws:minor", "nws:unrated", "gdacs-red-flood", "eonet"]));
  });

  it("keeps an alert Live warnings could not outline (unmapped: not marked by the server)", () => {
    const unmapped = nws("zone-only", "Severe");
    // Even if the layer somehow held the id, an unmarked alert is not left.
    const r = stepAside([unmapped], ctx({ alerts: true }, { alerts: true }, ["zone-only"]));
    expect(ids(r.features)).toEqual(["nws:zone-only"]);
    expect(r.leftToLive).toBe(0);
    expect(r.keptFromLive).toBe(1);
  });

  it("keeps every alert when the live feed failed: the server marks none", () => {
    const fresh = [nws("t1", "Extreme"), nws("t2", "Severe")];
    const outlined = liveDrawnIds({ alerts: [], failed: [{ source: "nws-api" }] });
    expect(outlined).toBeNull();
    const { features, marked } = markLiveOutlined(fresh, outlined);
    expect(marked).toBe(0);
    const r = stepAside(features, ctx({ alerts: true }, { alerts: true }, ["t1", "t2"]));
    expect(r.features).toHaveLength(2);
    expect(r.leftToLive).toBe(0);
  });

  it("keeps a marked alert Live warnings does not hold (a different or older answer)", () => {
    const r = stepAside(ALL, ctx({ alerts: true }, { alerts: true }, ["extreme"]));
    expect(r.leftToLive).toBe(1);
    expect(ids(r.features)).toContain("nws:severe");
    expect(r.keptFromLive).toBe(1);
  });

  it("steps aside for nothing while Live warnings is erroring or has not answered yet", () => {
    const r = stepAside(ALL, ctx({ alerts: true }, { alerts: false }, ["extreme", "severe"]));
    expect(r.leftToLive).toBe(0);
    expect(ids(r.features)).toEqual(expect.arrayContaining(["nws:extreme", "nws:severe"]));
    expect(r.keptFromLive).toBe(2);
  });

  it("never leaves a Moderate, Minor or unrated alert, even marked and held", () => {
    const odd = [nws("m", "Moderate", true), nws("n", "Minor", true), nws("u", undefined, true)];
    const r = stepAside(odd, ctx({ alerts: true }, { alerts: true }, ["m", "n", "u"]));
    expect(r.features).toHaveLength(3);
  });

  it("leaves only Green GDACS quakes USGS also has to Earthquakes, and only while it answers", () => {
    const r = stepAside(ALL, ctx({ earthquakes: true }));
    expect(r.quakesHidden).toBe(1);
    expect(ids(r.features)).not.toContain("gdacs-green-dup");
    expect(ids(r.features)).toContain("gdacs-orange-dup");
    expect(stepAside(ALL, ctx({ earthquakes: true }, { earthquakes: false })).quakesHidden).toBe(0);
  });

  it("partitions: what is kept and what is left add back up to the whole", () => {
    const r = stepAside(ALL, ctx({ earthquakes: true, alerts: true }, { earthquakes: true, alerts: true }, ["extreme", "severe"]));
    expect(r.features.length + r.quakesHidden + r.leftToLive).toBe(ALL.length);
  });

  it("says why Severe/Extreme alerts stay here instead of claiming Live warnings draws them", () => {
    const meta = { counts: { nws: { alerts: 5, drawnAsPolygon: 5, drawnAsCounties: 0, notDrawn: 0, liveChecked: true, liveOutlined: 2 } } };
    const down = ctx({ alerts: true }, { alerts: false });
    expect(hazardsNote(meta, stepAside(ALL, down), down)).toContain("Live warnings has no answer on the map");
    const partial = ctx({ alerts: true }, { alerts: true }, ["extreme"]);
    const note = hazardsNote(meta, stepAside(ALL, partial), partial);
    expect(note).toContain("1 Severe/Extreme alert left to Live warnings, which is drawing it");
    expect(note).toContain("1 Severe/Extreme alert drawn here because Live warnings is not drawing it");
    const unchecked = { counts: { nws: { ...meta.counts.nws, liveChecked: false, liveOutlined: 0 } } };
    const on = ctx({ alerts: true }, { alerts: true });
    expect(hazardsNote(unchecked, stepAside(ALL, on), on)).toContain("the live feed did not answer on the server");
  });

  it("refines the fetched data without a refetch, and re-runs when either overlapping layer changes", () => {
    expect(hazardsLayer.dependsOn).toEqual(["earthquakes", "alerts"]);
    const fetched: FetchResult = { collection: { type: "FeatureCollection", features: ALL }, source: "NWS + GDACS + EONET", fetchedAt: 0, meta: { count: ALL.length, envelope: {} } };
    const shown = hazardsLayer.refine!(fetched, ctx({ earthquakes: true, alerts: true }, { earthquakes: true, alerts: true }, ["extreme"]));
    expect(shown.collection.features).toHaveLength(ALL.length - 2);
    expect(shown.meta?.count).toBe(ALL.length - 2);
    // The fetched collection is not touched.
    expect(fetched.collection.features).toHaveLength(ALL.length);
  });
});
