// EPA Level III ecoregions: US_L3CODE -> US_L3NAME.

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, arcgisRows, norm, unreadable } from "./util";

export const epaEcoregions: Matcher = {
  id: "epa-ecoregions",
  sourceId: "epa-ecoregions",
  tolerance: { US_L3NAME: 0, US_L3CODE: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (!rows.length) return absent(`EPA has no Level III ecoregion ${item.code}`);
    const name = norm(rows[0].US_L3NAME);
    const code = norm(rows[0].US_L3CODE);
    if (name === null || code === null) return unreadable("the feature has no US_L3NAME or US_L3CODE");
    return { kind: "value", field: "US_L3NAME", publisherValue: name, itemValue: typeof item.value === "string" ? item.value : null, period: null, later: false, also: [also("US_L3CODE", item.code ?? null, code)] };
  },
};
