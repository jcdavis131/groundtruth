// Map what is selected on the globe to a WatchItem. Pure so the store and
// the tests share it; the layer id conventions come from lib/economy/
// features.ts (areas: "<level>:<geoid>", trade: "port:<wpi>" /
// "crossing:<code>") and lib/layers/water.ts (gauges: "usgs:<site>").

import type { LayerFeature } from "@/lib/layers/types";
import type { WatchItem } from "./model";

export interface SelectionLike {
  layer: string;
  id: string;
}

export type SelectionMapping = { ok: true; item: WatchItem } | { ok: false; reason: string };

function pointGeo(f: LayerFeature | null | undefined): [number, number] | undefined {
  if (!f) return undefined;
  if (f.properties.anchor) return [f.properties.anchor[0], f.properties.anchor[1]];
  if (f.geometry.type === "Point") return [f.geometry.coordinates[0], f.geometry.coordinates[1]];
  return undefined;
}

/** Turn a selection (+ its feature, when the layer still holds it) into a watch item. */
export function selectionToItem(sel: SelectionLike, feature?: LayerFeature | null): SelectionMapping {
  const name = feature?.properties.name;
  const geo = pointGeo(feature);
  switch (sel.layer) {
    case "realestate":
    case "commerce": {
      const m = sel.id.match(/^(county|state):(\d{2}|\d{5})$/);
      if (!m) return { ok: false, reason: `area id "${sel.id}" is not <level>:<geoid>` };
      return { ok: true, item: { kind: m[1] as "county" | "state", id: m[2], name, geo } };
    }
    case "trade": {
      if (sel.id.startsWith("port:")) return { ok: true, item: { kind: "port", id: sel.id.slice(5), name, geo } };
      if (sel.id.startsWith("crossing:")) return { ok: true, item: { kind: "crossing", id: sel.id.slice(9), name, geo } };
      return { ok: false, reason: `trade feature "${sel.id}" is neither a port nor a crossing` };
    }
    case "water": {
      const kind = feature?.properties.kind;
      if (kind === "reservoir") return { ok: false, reason: "reservoirs (TWDB) cannot be watched yet; pick a USGS gauge" };
      if (!sel.id.startsWith("usgs:")) return { ok: false, reason: `water feature "${sel.id}" is not a USGS gauge` };
      return { ok: true, item: { kind: "gauge", id: sel.id.slice(5), name, geo } };
    }
    case "groundwater":
      return { ok: false, reason: "wells report daily values; the watch resolver reads continuous gauges only" };
    case "companies":
      return { ok: true, item: { kind: "company", id: sel.id, name, geo } };
    default:
      return { ok: false, reason: `the ${sel.layer} layer has nothing a watchlist can track` };
  }
}
