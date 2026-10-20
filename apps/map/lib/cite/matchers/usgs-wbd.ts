// USGS Watershed Boundary Dataset, HUC-12 layer: huc12 -> name, tohuc (the next watershed downstream).

import type { CiteItem, Matcher, Reading } from "../types";
import { absent, also, arcgisRows, noteField, norm, unreadable } from "./util";

export const usgsWbd: Matcher = {
  id: "usgs-wbd",
  sourceId: "usgs-wbd",
  tolerance: { name: 0, huc12: 0, tohuc: 0 },
  read(item: CiteItem, body: string): Reading {
    const rows = arcgisRows(body);
    if (!rows) return unreadable("not an ArcGIS query reply");
    if (!rows.length) return absent(`WBD has no HUC-12 ${item.code}`);
    const r = rows[0];
    const name = norm(r.name);
    const huc = norm(r.huc12);
    if (name === null || huc === null) return unreadable("the feature has no name or huc12");
    return {
      kind: "value",
      field: "name",
      publisherValue: name,
      itemValue: typeof item.value === "string" ? item.value : null,
      period: null,
      later: false,
      also: [also("huc12", item.code ?? null, huc), also("tohuc", noteField(item.note, "drains to:"), norm(r.tohuc))],
    };
  },
};
