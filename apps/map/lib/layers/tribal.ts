// Layer: Trust land (BIA). BIA's American Indian and Alaska Native Land Area
// Representation, one national answer from /api/land?op=tribal (335 land
// areas, held a day), drawn lightly filled with an outline, one colour, each
// land area labelled once by its published name on its largest part.
//
// Not Census tribal areas: fabric draws those (AIANNH, "Tribal land", a Census
// tabulation geography) with a different look; this layer is land held in
// trust, restricted fee or mixed ownership as BIA's title records define it.
// Parts under 0.7 km2 are dropped from the answer (allotment-sized; Cam,
// 2026-10-17), except each land area's largest part, which is drawn even when
// it is under 0.7 km2 so no land area disappears (meta.keptSmallLargest counts
// them). BIA's layer has no Oklahoma land, so a blank area is not "no tribal
// land". Never joined to parcels, names or addresses.

import type { FeatureCollection } from "geojson";
import type { FetchContext, FetchResult, LayerDefinition, LayerFeature } from "./types";
import { proxy } from "./aircraft";
import { TRIBAL_ATTRIBUTION, TRIBAL_COLOR, TRIBAL_SOURCE_LABEL } from "@/lib/land/tribal";

async function fetchTribal(ctx: FetchContext): Promise<FetchResult> {
  const env = await proxy<FeatureCollection>("/api/land?op=tribal", ctx);
  const features = env.data.features as unknown as LayerFeature[];
  const meta = env as unknown as { droppedParts?: number; keptSmallLargest?: number; hiddenAreas?: unknown[] };
  const dropped = meta.droppedParts ?? 0;
  const keptSmall = meta.keptSmallLargest ?? 0;
  const hidden = meta.hiddenAreas?.length ?? 0;
  return {
    collection: { type: "FeatureCollection", features },
    source: TRIBAL_SOURCE_LABEL,
    fetchedAt: ctx.now,
    note:
      `${features.length} BIA land areas (trust, restricted fee or mixed ownership)` +
      (dropped ? ` · ${dropped.toLocaleString("en-US")} parts under 0.7 km2 dropped` : "") +
      (keptSmall ? ` · ${keptSmall.toLocaleString("en-US")} parts under 0.7 km2 drawn, each its land area's only or largest part` : "") +
      (hidden ? ` · ${hidden} land areas not drawn (listed in the answer)` : " · every land area drawn at least once") +
      " · no Oklahoma land in BIA's layer: blank is not 'no tribal land' · Census tribal areas are on the Field layer",
    meta: { count: features.length, droppedParts: dropped, keptSmallLargest: keptSmall, hiddenAreas: hidden },
  };
}

export const tribalLayer: LayerDefinition = {
  id: "tribal",
  label: "Trust land (BIA)",
  description:
    "The Bureau of Indian Affairs' Land Area Representation: the outer extent of land held in trust or restricted fee for federally recognized tribes and individual Indians (335 land areas), from BIA land title records, for illustrative and reference purposes only, never jurisdiction. Parts smaller than 0.7 km2 (allotment-sized) are dropped, except each land area's largest part, which is drawn even when it is under 0.7 km2 so no land area disappears. BIA's layer has no Oklahoma land and not every tribe's land, so a blank area does not mean no tribal land. Census tribal statistical areas are a different thing, on the Field layer.",
  color: TRIBAL_COLOR,
  updateIntervalMs: 24 * 60 * 60_000,
  defaultEnabled: false,
  attribution: TRIBAL_ATTRIBUTION,
  fetch: fetchTribal,
};
