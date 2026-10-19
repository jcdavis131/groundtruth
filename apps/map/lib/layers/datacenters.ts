// Layer: data centers. Operating locations plus under-construction projects
// from OpenStreetMap, drawn as point markers (amber for construction).
//
//   OpenStreetMap via Overpass API   bundled as lib/energy/data/datacenters.json
//                                   by lib/energy/build_bundles.py; refresh
//                                   with `npm run data:energy`
//
// HONEST COVERAGE NOTE (surfaced in the description and every fetch note):
// no complete data-center registry exists. This is the OSM subset — it skews
// toward well-mapped regions and misses stealth/unlisted sites, so counts are
// a floor, not a census. Permit portals were bot-walled; under-construction
// projects come from OSM construction tags only.

import type { Point } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { datacentersBundle, type DataCenter } from "@/lib/energy/energy";

const COVERAGE_NOTE =
  "OSM subset — no complete registry exists; counts are a floor, not a census.";

export interface DataCenterExtra {
  status: "operating" | "construction";
  operator: string | null;
}

function toFeature(
  dc: DataCenter,
  status: "operating" | "construction",
  idx: number,
): LayerFeature<Point> {
  const details: Record<string, string | number | boolean | null | undefined> = {
    "Status": status === "operating" ? "Operating" : "Under construction",
    "Operator": dc.operator ?? "n/a",
  };
  if (dc.start_date) details["Start"] = dc.start_date;
  if (dc.opening_date) details["Opening"] = dc.opening_date;
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [dc.lon, dc.lat] },
    properties: {
      id: `dc-${status}-${idx}`,
      layer: "datacenters",
      name: dc.name,
      kind: status,
      altitude: 0,
      source: "OpenStreetMap",
      details,
      extra: {
        status,
        operator: dc.operator,
      } satisfies DataCenterExtra,
    },
  };
}

async function fetchDatacenters(ctx: FetchContext): Promise<FetchResult> {
  const bundle = datacentersBundle();
  const features: LayerFeature<Point>[] = [
    ...bundle.operating.map((dc, i) => toFeature(dc, "operating", i)),
    ...bundle.construction.map((dc, i) => toFeature(dc, "construction", i)),
  ];
  return {
    collection: { type: "FeatureCollection", features },
    source: "OpenStreetMap",
    fetchedAt: ctx.now,
    note: [
      `${bundle.operating.length} operating · ${bundle.construction.length} under construction`,
      COVERAGE_NOTE,
      `refresh: npm run data:energy`,
    ].join(" · "),
    meta: {
      operating: bundle.operating.length,
      construction: bundle.construction.length,
      count: features.length,
      coverageCaveats: bundle.meta.coverage_caveats,
      provenance: bundle.meta.provenance,
    },
  };
}

export const datacentersLayer: LayerDefinition = {
  id: "datacenters",
  label: "Data centers",
  description:
    "Data-center locations from OpenStreetMap: operating sites plus under-construction projects (amber). No complete registry exists — OSM skews to well-mapped regions and misses stealth sites, so counts are a floor, not a census.",
  color: "#22D3EE",
  updateIntervalMs: 24 * 3600_000,
  defaultEnabled: false,
  attribution: "OpenStreetMap contributors, via Overpass API",
  fetch: fetchDatacenters,
};
