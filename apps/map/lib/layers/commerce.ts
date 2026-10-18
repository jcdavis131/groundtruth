// Layer 11: jobs & wages. Where people work and what work pays, by county.
//
//   BLS QCEW    quarterly census of employment and wages: establishments,
//               employment, total wages and the average weekly wage for every
//               county, with over-the-year changes as BLS publishes them.
//               Latest quarter available (about five months after quarter end).
//   TIGERweb    generalized county polygons (states above 2,500 km).
//
// Suppressed cells (BLS disclosure code N) stay blank. The sector mix with
// location quotients loads when a county is selected.

import type { FetchContext, FetchResult, LayerDefinition } from "./types";
import { fetchAreas } from "./areas";

export type { AreaExtra, JobsRow, SectorRow } from "@/lib/economy/features";

function fetchCommerce(ctx: FetchContext): Promise<FetchResult> {
  return fetchAreas(ctx, "commerce");
}

export const commerceLayer: LayerDefinition = {
  id: "commerce",
  label: "Jobs & wages",
  description:
    "Employment, employers and the average weekly wage in every county from the BLS Quarterly Census of Employment and Wages, with the sector mix and location quotients on selection.",
  color: "#C084FC",
  updateIntervalMs: 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  attribution: "BLS QCEW · US Census Bureau TIGERweb",
  fetch: fetchCommerce,
};
