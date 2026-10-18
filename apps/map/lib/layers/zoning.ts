// Layer: zoning. District outlines as ten city zoning services publish them,
// and the full answer for one point when you click.
//
//   /api/zoning?op=districts  below ZONING_OUTLINE_MAX_M: district outlines (code and
//                             colour family) in a box of about 1.7 km around the view,
//                             inside a dashed "loaded" box, from Seattle, Denver, New
//                             York, Chicago, Dallas, San Antonio, Austin, Los Angeles
//                             and San Francisco
//   /api/zoning?op=point      below ZONING_IDENTIFY_MAX_M: a click on the ground asks for
//                             the district at that point (lib/zoning/pick.ts): overlays,
//                             ordinance, effective date and the code link as the city
//                             publishes them. Houston answers that it has no zoning
//                             ordinance. With Parcels on, below PARCEL_IDENTIFY_MAX_M
//                             (5 km) the click is the parcel's, inside a district too
//                             (lib/globe/clickPrecedence.ts): zoning answers from 5 to
//                             15 km, and with Parcels off everywhere below 15 km.
//
// Outside the covered cities the note says so; an empty map there is "not
// covered", never "unzoned".

import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import { FeatureMemo } from "./featureMemo";
import { civicLoadedBox, gridBox } from "./civicBox";
import { citiesInBox, coveredCityNames, ZONING_CITIES, type Bbox, type ZoningCityId, type ZoningOutlineExtra } from "@/lib/zoning/features";

/** District outlines load below this camera height. */
export const ZONING_OUTLINE_MAX_M = 4_000;
/** A click on the ground asks for the zoning at that point below this height (with Parcels on, above 5 km). */
export const ZONING_IDENTIFY_MAX_M = 15_000;
/** What the notes say about the click with Parcels also on (lib/globe/clickPrecedence.ts). */
const PARCELS_FIRST = "with Parcels on, a click below 5 km opens the parcel: switch Parcels off to read zoning up close";
/**
 * Half the box's height in degrees (~830 m). San Antonio maps zoning lot by lot: 2,258 districts in
 * 2 x 2 km of downtown, over its 2,000-record limit; this box holds about 1,300 there.
 */
const HALF_LAT = 0.0075;
/** View-key grid; the box edges land on the route's 0.0025 degree grid, so it is not grown. */
const KEY_GRID = 0.005;

/** The box asked for around the view key's cell: HALF_LAT tall each way, about as wide on the ground. */
export function districtBox(lon: number, lat: number): Bbox {
  return gridBox(lon, lat, HALF_LAT, KEY_GRID, 0.0025);
}

const memo = new FeatureMemo(6000);

interface DistrictsMeta {
  bbox?: Bbox;
  truncated?: boolean;
  sources?: Array<{ city: ZoningCityId; name: string; count: number; truncated: boolean }>;
  failed?: Array<{ city: ZoningCityId; name: string }>;
  pointOnly?: Array<{ city: ZoningCityId; name: string; reason: string }>;
}

/** The layer note for an outline answer: what loaded, from where, and what did not. */
export function districtsNote(count: number, meta: DistrictsMeta, box: Bbox): string {
  const parts: string[] = [];
  const cities = citiesInBox(box);
  if (!cities.length) {
    return `no zoning source here. Covered: ${coveredCityNames()} (Houston: no zoning ordinance). Click the ground for the answer at a point (${PARCELS_FIRST})`;
  }
  parts.push(`${count.toLocaleString("en-US")} district outlines in the dashed box (outside it: not loaded)`);
  if (meta.sources?.length) parts.push(`from ${meta.sources.map((s) => ZONING_CITIES[s.city].publisher).join(", ")}`);
  parts.push(`click the ground for overlays, ordinance and code link (${PARCELS_FIRST})`);
  if (meta.truncated) parts.push("record limit hit, zoom in for every district");
  for (const p of meta.pointOnly ?? []) parts.push(p.city === "houston" ? "Houston has no zoning ordinance" : `${p.name}: click for the district (no outlines)`);
  if (meta.failed?.length) parts.push(`did not answer: ${meta.failed.map((f) => f.name).join(", ")}`);
  return parts.join(" · ");
}

function outlineFeature(f: { id: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; properties: ZoningOutlineExtra }): LayerFeature {
  const p = f.properties;
  const city = ZONING_CITIES[p.city];
  return {
    type: "Feature",
    geometry: f.geometry,
    properties: {
      id: f.id,
      layer: "zoning",
      name: p.code,
      kind: p.family,
      source: `${city.publisher} zoning`,
      details: {
        zoning: p.code,
        "category (city's words)": p.category,
        city: city.name,
        "for more": `click the ground inside the district for its overlays, ordinance and code link (${PARCELS_FIRST})`,
      },
      extra: p,
    },
  };
}

async function fetchZoning(ctx: FetchContext): Promise<FetchResult> {
  const h = ctx.view.height;
  if (h > ZONING_OUTLINE_MAX_M) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "city zoning services",
      fetchedAt: ctx.now,
      note:
        h > ZONING_IDENTIFY_MAX_M
          ? `descend below ${ZONING_IDENTIFY_MAX_M / 1000} km and click the ground for the zoning at a point, below ${ZONING_OUTLINE_MAX_M / 1000} km for district outlines · ${coveredCityNames()}; Houston has none`
          : `click the ground for the zoning at a point (${PARCELS_FIRST}); district outlines draw below ${ZONING_OUTLINE_MAX_M / 1000} km`,
      meta: { count: 0 },
    };
  }
  const want = districtBox(ctx.view.lon, ctx.view.lat);
  if (!citiesInBox(want).length) {
    return {
      collection: { type: "FeatureCollection", features: [] },
      source: "city zoning services",
      fetchedAt: ctx.now,
      note: districtsNote(0, {}, want),
      meta: { count: 0 },
    };
  }
  const env = await proxy<{ type: "FeatureCollection"; features: Array<{ id: string; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon; properties: ZoningOutlineExtra }> }>(
    `/api/zoning?op=districts&bbox=${want.map((x) => x.toFixed(4)).join(",")}`,
    ctx,
  );
  const meta = env as unknown as DistrictsMeta;
  const loaded: Bbox = Array.isArray(meta.bbox) && meta.bbox.length === 4 ? meta.bbox : want;
  const features = memo.stable(env.data.features.map(outlineFeature));
  return {
    collection: { type: "FeatureCollection", features: [...features, civicLoadedBox("zoning", loaded, "zoning districts")] },
    source: "city zoning services",
    fetchedAt: ctx.now,
    note: districtsNote(features.length, meta, loaded),
    meta: { count: features.length },
  };
}

export const zoningLayer: LayerDefinition = {
  id: "zoning",
  label: "Zoning",
  description:
    "Zoning districts as ten city zoning services publish them: outlines below 4 km in Seattle, Denver, New York, Chicago, Dallas, San Antonio, Austin, Los Angeles and San Francisco, and a click on the ground below 15 km for the district at that point with its overlays, ordinance and code link (Houston answers that it has no zoning ordinance). With Parcels on, a click below 5 km opens the parcel instead, inside a district too: switch Parcels off to read zoning up close.",
  color: "#F0ABFC",
  updateIntervalMs: 6 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: (v) => (v.height > ZONING_IDENTIFY_MAX_M ? "far" : v.height > ZONING_OUTLINE_MAX_M ? "identify" : `${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`),
  attribution: "City zoning services: Seattle (PDDL), Denver, NYC DCP, Chicago, Dallas, San Antonio, Austin, Los Angeles, San Francisco (PDDL)",
  fetch: fetchZoning,
};
