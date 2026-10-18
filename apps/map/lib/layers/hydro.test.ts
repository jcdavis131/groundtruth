// Rivers and streams (hydro): the picture's host and style, the ground dossier's reach
// lines from the captured Boise answers, and Natural Earth's rivers stepping aside while
// the NHD picture is on.
import { describe, expect, it } from "vitest";
import epa from "@/lib/water/fixtures/epa-v21-boise.json";
import { parseV21 } from "@/lib/water/nldi";
import { traceData } from "@/lib/water/nldiStore";
import dm from "@/lib/water/fixtures/nldi-dm-boise.json";
import { flowlines } from "@/lib/water/nldi";
import { groundDetails, partsFor } from "@/lib/terrain/ground";
import { DIRECT_SOURCES } from "@/lib/terrain/products";
import { refineWater } from "./water";
import { hydroLayer } from "./hydro";
import type { FetchResult, LayerFeature, RefineContext } from "./types";

const ctx = (hydro: boolean): RefineContext => ({ layersOn: { hydro }, answering: {}, holds: () => false });
const feat = (id: string, kind: string): LayerFeature => ({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { id, layer: "water", name: id, kind, source: "x" } });

describe("hydro", () => {
  it("loads its tiles from The National Map directly, as a picture with a ground click", async () => {
    const d = DIRECT_SOURCES.find((x) => x.id === "hydro")!;
    expect(d).toMatchObject({ host: "basemap.nationalmap.gov", source: "usgs-nhd" });
    expect(d.template).toContain("/USGSHydroCached/MapServer/tile/{z}/{y}/{x}");
    expect(partsFor({ hydro: true })).toEqual(["hydro"]);
    const r = await hydroLayer.fetch({ keys: {}, view: { lon: 0, lat: 0, height: 10_000, heading: 0, pitch: 0 }, now: 0, options: {} });
    expect(r.meta).toMatchObject({ picture: true, count: 0 });
  });

  it("puts the reach in the ground dossier as 'drains to', and 'no reach here' outside the network", () => {
    const reach = parseV21(epa, 23398863);
    const d = groundDetails({ lon: -116.2023, lat: 43.615, parts: { hydro: { loading: false, data: { comid: 23398863, reach } } } });
    expect(d["drains to"]).toBe("Boise River (NHDPlus V2 reach)");
    expect(d["modelled mean annual flow (EROM, gauge-adjusted)"]).toBe("1,477 cfs");
    const none = groundDetails({ lon: -70, lat: 40, parts: { hydro: { loading: false, data: { comid: null, reach: null } } } });
    expect(none["drains to"]).toMatch(/^no NHDPlus V2 reach here/);
    const asking = groundDetails({ lon: -70, lat: 40, parts: { hydro: { loading: true } } });
    expect(asking["drains to"]).toBe("asking USGS NLDI…");
  });

  it("hides Natural Earth's rivers, and only them, while hydro is on", () => {
    const r: FetchResult = { collection: { type: "FeatureCollection", features: [feat("ne-river:1", "river"), feat("ne-lake:2", "lake"), feat("usgs:USGS-13206000", "gauge")] }, source: "x", fetchedAt: 0 };
    expect(refineWater(r, ctx(false))).toBe(r);
    expect(refineWater(r, ctx(true)).collection.features.map((f) => f.properties.id)).toEqual(["ne-lake:2", "usgs:USGS-13206000"]);
  });

  it("reads a trace answer back into the store's shapes", () => {
    const f = flowlines(dm);
    const down = traceData("down", { data: { features: [{ geometry: f.geometry, properties: {} }] } }) as GeoJSON.MultiLineString;
    expect(down.coordinates).toHaveLength(79);
    const g = traceData("gauges", { data: { features: [{ geometry: { type: "Point", coordinates: [-115.3, 43.5] }, properties: { identifier: "USGS-13186000", siteNo: "13186000", name: "SF BOISE RIVER NR FEATHERVILLE ID" } }] } }) as Array<{ siteNo: string }>;
    expect(g[0].siteNo).toBe("13186000");
    expect(traceData("basin", { data: { features: [] } })).toBeNull();
  });
});
