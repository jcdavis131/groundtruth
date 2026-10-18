import { describe, expect, it } from "vitest";
import type { LayerFeature } from "@/lib/layers/types";
import { selectionToItem } from "./selection";

function feature(layer: LayerFeature["properties"]["layer"], id: string, over: Partial<LayerFeature["properties"]> = {}, geometry: LayerFeature["geometry"] = { type: "Point", coordinates: [-97.5, 30.25, 0] }): LayerFeature {
  return { type: "Feature", geometry, properties: { id, layer, name: `Feature ${id}`, source: "test", ...over } };
}

describe("selectionToItem", () => {
  it("maps areas to county / state with the polygon anchor", () => {
    const poly: LayerFeature["geometry"] = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
    const c = selectionToItem({ layer: "realestate", id: "county:48453" }, feature("realestate", "county:48453", { anchor: [-97.78, 30.33], name: "Travis, TX" }, poly));
    expect(c).toEqual({ ok: true, item: { kind: "county", id: "48453", name: "Travis, TX", geo: [-97.78, 30.33] } });
    const s = selectionToItem({ layer: "commerce", id: "state:48" }, feature("commerce", "state:48", { anchor: [-99, 31] }, poly));
    expect(s.ok && s.item.kind).toBe("state");
    expect(s.ok && s.item.id).toBe("48");
    expect(selectionToItem({ layer: "realestate", id: "metro:1" }).ok).toBe(false);
  });

  it("maps trade features to ports and crossings", () => {
    const p = selectionToItem({ layer: "trade", id: "port:12345" }, feature("trade", "port:12345", { name: "Houston" }));
    expect(p).toEqual({ ok: true, item: { kind: "port", id: "12345", name: "Houston", geo: [-97.5, 30.25] } });
    const x = selectionToItem({ layer: "trade", id: "crossing:2304" }, feature("trade", "crossing:2304", { name: "Laredo, TX" }));
    expect(x.ok && x.item).toEqual({ kind: "crossing", id: "2304", name: "Laredo, TX", geo: [-97.5, 30.25] });
    expect(selectionToItem({ layer: "trade", id: "lane:1" }).ok).toBe(false);
  });

  it("maps USGS gauges, refuses reservoirs and wells", () => {
    const g = selectionToItem({ layer: "water", id: "usgs:USGS-08180800" }, feature("water", "usgs:USGS-08180800", { kind: "gauge", name: "Medina Rv" }));
    expect(g.ok && g.item).toEqual({ kind: "gauge", id: "USGS-08180800", name: "Medina Rv", geo: [-97.5, 30.25] });
    const r = selectionToItem({ layer: "water", id: "twdb:medina" }, feature("water", "twdb:medina", { kind: "reservoir" }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/reservoir/);
    expect(selectionToItem({ layer: "groundwater", id: "usgs:USGS-1" }).ok).toBe(false);
  });

  it("maps companies and works without a feature", () => {
    const c = selectionToItem({ layer: "companies", id: "cik:0000320193" });
    expect(c).toEqual({ ok: true, item: { kind: "company", id: "cik:0000320193", name: undefined, geo: undefined } });
    const a = selectionToItem({ layer: "aircraft", id: "abc123" });
    expect(a.ok).toBe(false);
    expect(!a.ok && a.reason).toMatch(/aircraft/);
  });
});
