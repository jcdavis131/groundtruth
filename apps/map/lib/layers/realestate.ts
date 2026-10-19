// Layer 12: home values & rents. What a typical home is worth and what a
// typical rental costs, by county, and how that compares with local wages.
//
//   Zillow ZHVI   typical home value (35th–65th percentile, smoothed,
//                 seasonally adjusted), monthly, ~3,070 counties and every state
//   Zillow ZORI   typical observed rent, monthly, ~1,390 counties
//   TIGERweb      generalized county polygons (states above 2,500 km)
//
// Labelled ESTIMATE: ZHVI and ZORI are Zillow's models of a typical home and
// rental, not sale prices or leases; the affordability lines print their
// arithmetic. This layer is aggregates: counties and states.

import type { FetchContext, FetchResult, LayerDefinition } from "./types";
import { fetchAreas } from "./areas";

export type { AreaExtra, HomeValue, RentValue } from "@/lib/economy/features";

function fetchRealEstate(ctx: FetchContext): Promise<FetchResult> {
  return fetchAreas(ctx, "realestate");
}

export const realestateLayer: LayerDefinition = {
  id: "realestate",
  label: "Home values",
  description:
    "Zillow's typical home value and typical rent for every county, coloured by the one-year change, with a ten-year trace and a mortgage-against-wages estimate on selection. Aggregates only.",
  color: "#F472B6",
  updateIntervalMs: 6 * 60 * 60_000,
  defaultEnabled: false,
  viewDependent: true,
  estimate: "Zillow index values are model estimates of a typical home and rental, not sale prices; affordability lines print their formula",
  attribution: "Zillow Research (ZHVI, ZORI) · US Census Bureau TIGERweb",
  fetch: fetchRealEstate,
};
