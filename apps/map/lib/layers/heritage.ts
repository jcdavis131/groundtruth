// Layer: national heritage. National Park System units, National Heritage
// Areas, American Battlefield Protection Program battlefields and World
// Heritage Sites, from four NPS services through /api/land?op=heritage.
//
//   units         every unit's centroid above UNITS_POLYGON_MAX_M, its authorised
//                 boundary below (in a box around the view)
//   nha, whs      one national answer each (62 areas, 35 site rows)
//   battlefields  study and core areas of three wars below BATTLEFIELD_MAX_M
//
// Designation, not ownership: Public lands (PAD-US) draws who owns the ground.
// Battlefields are survey areas, not National Register listings (Historic
// places draws those). One kind failing leaves the others standing.

import type { FeatureCollection } from "geojson";
import { bboxAround } from "@/lib/globe/geo";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature, ViewState } from "./types";
import { proxy } from "./aircraft";
import { UNITS_POLYGON_MAX_M } from "@/lib/land/heritage";

export const BATTLEFIELD_MAX_M = 1_500_000;
const UNIT_BOX_RADIUS_M = 100_000;
const BATTLE_BOX_RADIUS_M = 400_000;
const KEY_GRID = 0.5;

function tier(h: number): "far" | "mid" | "near" {
  return h > BATTLEFIELD_MAX_M ? "far" : h > UNITS_POLYGON_MAX_M ? "mid" : "near";
}

export function heritageViewKey(v: ViewState): string {
  const t = tier(v.height);
  return t === "far" ? "far" : `${t}:${Math.round(v.lon / KEY_GRID)},${Math.round(v.lat / KEY_GRID)}`;
}

const box = (v: Pick<ViewState, "lon" | "lat">, r: number) => {
  const lon = Math.round(v.lon / KEY_GRID) * KEY_GRID;
  const lat = Math.round(v.lat / KEY_GRID) * KEY_GRID;
  return bboxAround(lat, lon, r).map((x) => x.toFixed(2)).join(",");
};

/** The requests for a view, by kind; pure. */
export function heritageRequests(v: Pick<ViewState, "lon" | "lat" | "height">): Record<string, string> {
  const t = tier(v.height);
  const out: Record<string, string> = {
    units: t === "near" ? `/api/land?op=heritage&kind=units&bbox=${box(v, UNIT_BOX_RADIUS_M)}` : "/api/land?op=heritage&kind=units",
    nha: "/api/land?op=heritage&kind=nha",
    whs: "/api/land?op=heritage&kind=whs",
  };
  if (t !== "far") out.battlefields = `/api/land?op=heritage&kind=battlefields&bbox=${box(v, BATTLE_BOX_RADIUS_M)}`;
  return out;
}

async function fetchHeritage(ctx: FetchContext): Promise<FetchResult> {
  const reqs = heritageRequests(ctx.view);
  const kinds = Object.keys(reqs);
  const answers = await Promise.all(kinds.map((k) => proxy<FeatureCollection>(reqs[k], ctx).catch(() => null)));
  if (answers.every((a) => a == null)) throw new Error("NPS's heritage services did not answer");
  const features: LayerFeature[] = [];
  const counts: Record<string, number | null> = {};
  kinds.forEach((k, i) => {
    const a = answers[i];
    counts[k] = a ? a.data.features.length : null;
    if (a) features.push(...(a.data.features as unknown as LayerFeature[]));
  });
  const t = tier(ctx.view.height);
  const part = (k: string, label: string) => (counts[k] == null ? `${label} did not answer` : `${counts[k]} ${label}`);
  const note = [
    part("units", t === "near" ? "park unit boundaries in view" : "park units"),
    part("nha", "heritage areas"),
    part("whs", "World Heritage Sites"),
    t === "far" ? `descend below ${(BATTLEFIELD_MAX_M / 1000).toLocaleString("en-US")} km for battlefields` : part("battlefields", "battlefield study and core areas"),
    t !== "near" ? `below ${UNITS_POLYGON_MAX_M / 1000} km, unit boundaries` : "outlines are designations, not ownership (see Public lands)",
  ].join(" · ");
  return { collection: { type: "FeatureCollection", features }, source: "National Park Service", fetchedAt: ctx.now, note, meta: { count: features.length, ...counts } };
}

export const heritageLayer: LayerDefinition = {
  id: "heritage",
  label: "National heritage (NPS)",
  description:
    "National Park System units (centroids from afar, NPS's authorised boundaries below 250 km), National Heritage Areas, American Battlefield Protection Program battlefields (Civil War, Revolutionary War and War of 1812 study and core areas, below 1,500 km) and World Heritage Sites with an NPS boundary. Designations, not ownership: most battlefield land is private, and a heritage area is a partnership region, not federal land.",
  color: "#65A30D",
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  viewKey: heritageViewKey,
  attribution: "National Park Service: Land Resources Division, Heritage Partnerships (National Heritage Areas), American Battlefield Protection Program, Office of International Affairs (World Heritage)",
  fetch: fetchHeritage,
};
